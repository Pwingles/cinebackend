import fetch from 'node-fetch';
import { extractOriginalUrl, getOriginFromUrl } from './parser.js';
import { handleCors, setCorsHeaders } from './handleCors.js';
import { proxyM3U8 } from './m3u8proxy.js';
import { proxyTs } from './proxyTs.js';

// Default user agent
export const DEFAULT_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Helper function to get server URL with proper HTTPS detection
export function getServerUrl(req) {
    const host = req.headers.host || req.get('host') || req.headers['x-forwarded-host'] || '';
    
    // Check if we're on localhost (explicit HTTP for development)
    const isLocalhost = host.includes('localhost') || 
                       host.includes('127.0.0.1') || 
                       host.includes('::1') ||
                       host.startsWith('192.168.') ||
                       host.startsWith('10.');
    
    // Check if we're on Railway domain (always HTTPS)
    const isRailway = host.includes('.up.railway.app') || 
                     host.includes('railway.app');
    
    // Check for x-forwarded-proto header (set by Railway/proxies)
    // Railway should set this, but we'll be defensive
    let protocol = req.headers['x-forwarded-proto'];
    
    // If Railway domain detected, ALWAYS use HTTPS (Railway requires HTTPS)
    if (isRailway) {
        protocol = 'https';
    }
    // If localhost, use HTTP (development)
    else if (isLocalhost) {
        protocol = 'http';
    }
    // Try to get protocol from headers
    else if (!protocol) {
        protocol = req.protocol; // Works when trust proxy is enabled
    }
    
    // Final fallback: default to HTTPS for production, HTTP for localhost
    if (!protocol || (protocol !== 'https' && protocol !== 'http')) {
        protocol = isLocalhost ? 'http' : 'https';
    }
    
    return `${protocol}://${host}`;
}

export function createProxyRoutes(app) {
    // Test endpoint to verify proxy is working and check server URL detection
    app.get('/proxy/status', (req, res) => {
        if (handleCors(req, res)) return;

        const serverUrl = getServerUrl(req);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
            JSON.stringify({
                status: 'Proxy server is working',
                timestamp: new Date().toISOString(),
                userAgent: req.headers['user-agent'],
                serverUrl: serverUrl,
                protocol: serverUrl.startsWith('https') ? 'https' : 'http',
                host: req.headers.host || req.get('host'),
                xForwardedProto: req.headers['x-forwarded-proto'],
                reqProtocol: req.protocol
            })
        );
    });

    // Simplified M3U8 Proxy endpoint based on working implementation
    app.get('/m3u8-proxy', (req, res) => {
        if (handleCors(req, res)) return;

        const targetUrl = req.query.url;
        let headers = {};

        try {
            headers = JSON.parse(req.query.headers || '{}');
        } catch (e) {
            // Invalid headers JSON
        }

        if (!targetUrl) {
            setCorsHeaders(res);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'URL parameter required' }));
            return;
        }

        // Get server URL for building proxy URLs with proper HTTPS detection
        const serverUrl = getServerUrl(req);

        proxyM3U8(targetUrl, headers, res, serverUrl);
    });

    // Simplified TS/Segment Proxy endpoint
    app.get('/ts-proxy', (req, res) => {
        if (handleCors(req, res)) return;

        const targetUrl = req.query.url;
        let headers = {};

        try {
            headers = JSON.parse(req.query.headers || '{}');
        } catch (e) {
            // Invalid headers JSON
        }

        if (!targetUrl) {
            setCorsHeaders(res);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'URL parameter required' }));
            return;
        }

        proxyTs(targetUrl, headers, req, res).then((r) => r);
    });

    // HLS Proxy endpoint (alternative endpoint)
    app.get('/proxy/hls', (req, res) => {
        if (handleCors(req, res)) return;

        const targetUrl = req.query.link;
        let headers = {};

        try {
            headers = JSON.parse(req.query.headers || '{}');
        } catch (e) {
            // Invalid headers JSON
        }

        if (!targetUrl) {
            setCorsHeaders(res);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Link parameter is required' }));
            return;
        }

        // Get server URL for building proxy URLs with proper HTTPS detection
        const serverUrl = getServerUrl(req);

        proxyM3U8(targetUrl, headers, res, serverUrl);
    });

    // Subtitle Proxy endpoint
    app.get('/sub-proxy', (req, res) => {
        if (handleCors(req, res)) return;

        const targetUrl = req.query.url;
        let headers = {};

        try {
            headers = JSON.parse(req.query.headers || '{}');
        } catch (e) {
            // Invalid headers JSON
        }

        if (!targetUrl) {
            setCorsHeaders(res);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'url parameter required' }));
            return;
        }

        fetch(targetUrl, {
            headers: {
                'User-Agent': DEFAULT_USER_AGENT,
                ...headers
            }
        })
            .then((response) => {
                if (!response.ok) {
                    setCorsHeaders(res);
                    res.writeHead(response.status);
                    res.end(`Subtitle fetch failed: ${response.status}`);
                    return;
                }

                // Set CORS headers for subtitle responses
                setCorsHeaders(res);
                res.setHeader(
                    'Content-Type',
                    response.headers.get('content-type') || 'text/vtt'
                );
                res.setHeader('Cache-Control', 'public, max-age=3600');

                res.writeHead(200);
                response.body.pipe(res);
            })
            .catch((error) => {
                console.error('[Sub Proxy Error]:', error.message);
                setCorsHeaders(res);
                res.writeHead(500);
                res.end(`Subtitle Proxy error: ${error.message}`);
            });
    });
}

export function processApiResponse(apiResponse, serverUrl) {
    if (!apiResponse.files) return apiResponse;

    const processedFiles = apiResponse.files.map((file) => {
        if (!file.file || typeof file.file !== 'string') return file;

        let finalUrl = file.file;
        let proxyHeaders = file.headers || {};

        // Extract original URL if it's wrapped in external proxy
        finalUrl = extractOriginalUrl(finalUrl);

        // proxy ALL URLs through our system
        if (
            finalUrl.includes('.m3u8') ||
            finalUrl.includes('m3u8') ||
            (!finalUrl.includes('.mp4') &&
                !finalUrl.includes('.mkv') &&
                !finalUrl.includes('.webm') &&
                !finalUrl.includes('.avi'))
        ) {
            // Use M3U8 proxy for HLS streams and unknown formats
            const m3u8Origin = getOriginFromUrl(finalUrl);
            if (m3u8Origin) {
                proxyHeaders = {
                    ...proxyHeaders,
                    Referer: proxyHeaders.Referer || m3u8Origin,
                    Origin: proxyHeaders.Origin || m3u8Origin
                };
            }

            const localProxyUrl = `${serverUrl}/m3u8-proxy?url=${encodeURIComponent(finalUrl)}&headers=${encodeURIComponent(JSON.stringify(proxyHeaders))}`;

            return {
                ...file,
                file: localProxyUrl,
                type: 'hls',
                headers: proxyHeaders
            };
        } else {
            // Use TS proxy for direct video files (.mp4, .mkv, .webm, .avi)
            const videoOrigin = getOriginFromUrl(finalUrl);
            if (videoOrigin) {
                proxyHeaders = {
                    ...proxyHeaders,
                    Referer: proxyHeaders.Referer || videoOrigin,
                    Origin: proxyHeaders.Origin || videoOrigin
                };
            }

            const localProxyUrl = `${serverUrl}/ts-proxy?url=${encodeURIComponent(finalUrl)}&headers=${encodeURIComponent(JSON.stringify(proxyHeaders))}`;

            return {
                ...file,
                file: localProxyUrl,
                type: file.type || 'mp4',
                headers: proxyHeaders
            };
        }
    });

    const processedSubtitles = (apiResponse.subtitles || []).map((sub) => {
        if (!sub.url || typeof sub.url !== 'string') return sub;

        const localProxyUrl = `${serverUrl}/sub-proxy?url=${encodeURIComponent(sub.url)}`;
        return {
            ...sub,
            url: localProxyUrl
        };
    });

    return {
        ...apiResponse,
        files: processedFiles,
        subtitles: processedSubtitles
    };
}
