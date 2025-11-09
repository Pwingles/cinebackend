import fetch from 'node-fetch';
import { extractOriginalUrl, getOriginFromUrl } from './parser.js';
import { handleCors, setCorsHeaders } from './handleCors.js';
import { proxyM3U8 } from './m3u8proxy.js';
import { proxyTs } from './proxyTs.js';
import { normalizeUrl, validateUrlSafety, sanitizeUrlForLogging } from '../utils/urlNormalizer.js';
import { extractHostname, isHostAllowed, getHeadersForHost } from '../utils/hostConfig.js';
import { logRequest } from '../utils/metrics.js';
import { resolveUrl } from '../utils/resolver.js';
import { ErrorObject } from '../helpers/ErrorObject.js';

// Helper function to validate and fix Referer header
// Ensures Referer is always a full URL, not just a video ID
function validateRefererHeader(referer, origin) {
    if (!referer) {
        // No referer provided, use origin
        return origin ? `${origin}/` : null;
    }
    
    // Check if referer is already a valid URL
    try {
        new URL(referer);
        return referer; // Valid URL
    } catch (e) {
        // Not a valid URL - might be just a video ID or path
        // Construct full URL from origin
        if (origin) {
            // If referer looks like a path (starts with /), append to origin
            if (referer.startsWith('/')) {
                return `${origin}${referer}`;
            }
            // Otherwise, treat as video ID and construct URL
            return `${origin}/${referer}`;
        }
        // No origin available, return null (will be set from URL later)
        return null;
    }
}

// Helper function to validate URL format
function isValidUrl(urlString) {
    try {
        const url = new URL(urlString);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (e) {
        return false;
    }
}

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

    // Helper function to handle m3u8 proxy requests (used by both GET and POST)
    async function handleM3U8Proxy(req, res, targetUrl, headers) {
        if (handleCors(req, res)) return;

        const startTime = Date.now();

        // Validate URL parameter
        if (!targetUrl) {
            setCorsHeaders(res);
            res.status(400).json(new ErrorObject(
                'URL_MALFORMED: URL parameter required',
                'proxy',
                400,
                'The url parameter is missing',
                true
            ).toJSON());
            return;
        }

        let normalizedUrl;
        let hostname;

        try {
            // Validate URL safety first
            const safety = validateUrlSafety(targetUrl);
            if (!safety.valid) {
                setCorsHeaders(res);
                res.status(400).json(new ErrorObject(
                    safety.reason,
                    'proxy',
                    400,
                    safety.reason,
                    true
                ).toJSON());
                return;
            }

            // Normalize URL
            normalizedUrl = normalizeUrl(targetUrl);
            hostname = extractHostname(normalizedUrl);

            // Check host allowlist
            if (!isHostAllowed(hostname)) {
                const sanitized = sanitizeUrlForLogging(normalizedUrl);
                logRequest(hostname, 'manifest', false, Date.now() - startTime, 403, sanitized);
                setCorsHeaders(res);
                res.status(403).json(new ErrorObject(
                    `HOST_NOT_ALLOWED: Host ${hostname} is not in allowlist`,
                    'proxy',
                    403,
                    `Host ${hostname} is not allowed`,
                    true
                ).toJSON());
                return;
            }

            // Get headers for host
            headers = getHeadersForHost(hostname, headers || {});

            // Validate and fix Referer header if present
            if (headers.Referer && headers.Origin) {
                const validReferer = validateRefererHeader(headers.Referer, headers.Origin);
                if (validReferer && validReferer !== headers.Referer) {
                    headers.Referer = validReferer;
                }
            }

        } catch (error) {
            const sanitized = sanitizeUrlForLogging(targetUrl);
            logRequest(hostname || 'unknown', 'manifest', false, Date.now() - startTime, 400, sanitized);
            setCorsHeaders(res);
            res.status(400).json(new ErrorObject(
                error.message || 'URL_MALFORMED: Invalid URL',
                'proxy',
                400,
                error.message || 'Invalid URL format',
                true
            ).toJSON());
            return;
        }

        // Get server URL for building proxy URLs with proper HTTPS detection
        const serverUrl = getServerUrl(req);
        const sanitized = sanitizeUrlForLogging(normalizedUrl);

        try {
            await proxyM3U8(normalizedUrl, headers, res, serverUrl);
            const duration = Date.now() - startTime;
            logRequest(hostname, 'manifest', true, duration, 200, sanitized);
        } catch (error) {
            const duration = Date.now() - startTime;
            let statusCode = 500;
            let errorCode = 'ERROR';

            if (error.message.includes('timeout')) {
                statusCode = 504;
                errorCode = 'TIMEOUT';
            } else if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
                statusCode = 502;
                errorCode = 'BAD_GATEWAY';
            } else if (error.message.includes('403') || error.message.includes('UPSTREAM_403')) {
                statusCode = 403;
                errorCode = 'UPSTREAM_403';
            }

            logRequest(hostname, 'manifest', false, duration, statusCode, sanitized);

            if (!res.headersSent) {
                setCorsHeaders(res);
                res.status(statusCode).json(new ErrorObject(
                    `${errorCode}: ${error.message || 'Unknown error occurred'}`,
                    'proxy',
                    statusCode,
                    error.message || 'Unknown error',
                    true
                ).toJSON());
            }
        }
    }

    // GET /m3u8-proxy (legacy support)
    app.get('/m3u8-proxy', async (req, res) => {
        const targetUrl = req.query.url;
        let headers = {};

        try {
            headers = JSON.parse(req.query.headers || '{}');
        } catch (e) {
            // Continue with empty headers
        }

        await handleM3U8Proxy(req, res, targetUrl, headers);
    });

    // POST /m3u8-proxy (new endpoint)
    app.post('/m3u8-proxy', async (req, res) => {
        const { url, headers } = req.body || {};
        await handleM3U8Proxy(req, res, url, headers);
    });

    // POST /resolve - normalize messy provider responses to single valid m3u8 URL
    app.post('/resolve', async (req, res) => {
        if (handleCors(req, res)) return;

        const startTime = Date.now();
        const { url, headers } = req.body || {};

        if (!url) {
            setCorsHeaders(res);
            res.status(400).json(new ErrorObject(
                'URL_MALFORMED: URL parameter required',
                'resolver',
                400,
                'The url parameter is missing in request body',
                true
            ).toJSON());
            return;
        }

        try {
            const resolvedUrl = await resolveUrl(url, headers || {});
            const duration = Date.now() - startTime;
            const hostname = extractHostname(resolvedUrl);
            const sanitized = sanitizeUrlForLogging(resolvedUrl);
            
            logRequest(hostname, 'resolve', true, duration, 200, sanitized);
            
            setCorsHeaders(res);
            res.status(200).json({
                url: resolvedUrl,
                resolved: true
            });
        } catch (error) {
            const duration = Date.now() - startTime;
            let statusCode = 400;
            let errorCode = 'URL_MALFORMED';

            if (error.message.includes('HOST_NOT_ALLOWED')) {
                statusCode = 403;
                errorCode = 'HOST_NOT_ALLOWED';
            } else if (error.message.includes('timeout')) {
                statusCode = 504;
                errorCode = 'TIMEOUT';
            }

            logRequest('unknown', 'resolve', false, duration, statusCode);

            setCorsHeaders(res);
            res.status(statusCode).json(new ErrorObject(
                error.message || `${errorCode}: Failed to resolve URL`,
                'resolver',
                statusCode,
                error.message || 'Failed to resolve URL',
                true
            ).toJSON());
        }
    });

    // TS/Segment Proxy endpoint
    app.get('/ts-proxy', async (req, res) => {
        if (handleCors(req, res)) return;

        const startTime = Date.now();
        const targetUrl = req.query.url;
        let headers = {};

        try {
            headers = JSON.parse(req.query.headers || '{}');
        } catch (e) {
            // Continue with empty headers
        }

        if (!targetUrl) {
            setCorsHeaders(res);
            res.status(400).json(new ErrorObject(
                'URL_MALFORMED: URL parameter required',
                'proxy',
                400,
                'The url query parameter is missing',
                true
            ).toJSON());
            return;
        }

        let normalizedUrl;
        let hostname;

        try {
            // Validate URL safety
            const safety = validateUrlSafety(targetUrl);
            if (!safety.valid) {
                setCorsHeaders(res);
                res.status(400).json(new ErrorObject(
                    safety.reason,
                    'proxy',
                    400,
                    safety.reason,
                    true
                ).toJSON());
                return;
            }

            // Normalize URL
            normalizedUrl = normalizeUrl(targetUrl);
            hostname = extractHostname(normalizedUrl);

            // Check host allowlist
            if (!isHostAllowed(hostname)) {
                const sanitized = sanitizeUrlForLogging(normalizedUrl);
                logRequest(hostname, 'segment', false, Date.now() - startTime, 403, sanitized);
                setCorsHeaders(res);
                res.status(403).json(new ErrorObject(
                    `HOST_NOT_ALLOWED: Host ${hostname} is not in allowlist`,
                    'proxy',
                    403,
                    `Host ${hostname} is not allowed`,
                    true
                ).toJSON());
                return;
            }

            // Get headers for host
            headers = getHeadersForHost(hostname, headers);

            // Validate and fix Referer header if present
            if (headers.Referer && headers.Origin) {
                const validReferer = validateRefererHeader(headers.Referer, headers.Origin);
                if (validReferer && validReferer !== headers.Referer) {
                    headers.Referer = validReferer;
                }
            }

        } catch (error) {
            const sanitized = sanitizeUrlForLogging(targetUrl);
            logRequest(hostname || 'unknown', 'segment', false, Date.now() - startTime, 400, sanitized);
            setCorsHeaders(res);
            res.status(400).json(new ErrorObject(
                error.message || 'URL_MALFORMED: Invalid URL',
                'proxy',
                400,
                error.message || 'Invalid URL format',
                true
            ).toJSON());
            return;
        }

        const sanitized = sanitizeUrlForLogging(normalizedUrl);

        try {
            await proxyTs(normalizedUrl, headers, req, res);
            const duration = Date.now() - startTime;
            logRequest(hostname, 'segment', true, duration, 200, sanitized);
        } catch (error) {
            const duration = Date.now() - startTime;
            let statusCode = 500;
            let errorCode = 'ERROR';

            if (error.message.includes('timeout')) {
                statusCode = 504;
                errorCode = 'TIMEOUT';
            } else if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
                statusCode = 502;
                errorCode = 'BAD_GATEWAY';
            } else if (error.message.includes('403') || error.message.includes('UPSTREAM_403')) {
                statusCode = 403;
                errorCode = 'UPSTREAM_403';
            }

            logRequest(hostname, 'segment', false, duration, statusCode, sanitized);

            if (!res.headersSent) {
                setCorsHeaders(res);
                res.status(statusCode).json(new ErrorObject(
                    `${errorCode}: ${error.message || 'Unknown error occurred'}`,
                    'proxy',
                    statusCode,
                    error.message || 'Unknown error',
                    true
                ).toJSON());
            }
        }
    });

    // HLS Proxy endpoint (alternative endpoint)
    app.get('/proxy/hls', async (req, res) => {
        if (handleCors(req, res)) return;

        const targetUrl = req.query.link;
        let headers = {};

        try {
            headers = JSON.parse(req.query.headers || '{}');
        } catch (e) {
            console.warn('[HLS-Proxy] Invalid headers JSON:', e.message);
        }

        if (!targetUrl) {
            setCorsHeaders(res);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                error: 'Link parameter is required',
                message: 'The link query parameter is missing'
            }));
            return;
        }

        // Normalize URL encoding
        let normalizedUrl = targetUrl;
        try {
            const urlObj = new URL(targetUrl);
            normalizedUrl = urlObj.href;
        } catch (e) {
            // Not a valid URL, validation will catch it
        }

        // Validate URL format
        if (!isValidUrl(normalizedUrl)) {
            setCorsHeaders(res);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                error: 'Invalid URL format',
                message: 'The provided URL is not a valid HTTP/HTTPS URL'
            }));
            return;
        }

        // Validate and fix Referer header if present
        if (headers.Referer && headers.Origin) {
            const validReferer = validateRefererHeader(headers.Referer, headers.Origin);
            if (validReferer && validReferer !== headers.Referer) {
                headers.Referer = validReferer;
            }
        }

        // Get server URL for building proxy URLs with proper HTTPS detection
        const serverUrl = getServerUrl(req);

        // Add timeout wrapper
        const timeout = 60000;
        const timeoutId = setTimeout(() => {
            if (!res.headersSent) {
                setCorsHeaders(res);
                res.writeHead(504, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    error: 'Gateway Timeout',
                    message: 'The upstream server did not respond in time'
                }));
            }
        }, timeout);

        try {
            await proxyM3U8(normalizedUrl, headers, res, serverUrl);
        } catch (error) {
            clearTimeout(timeoutId);
            if (!res.headersSent) {
                setCorsHeaders(res);
                let statusCode = 500;
                let errorMessage = error.message || 'Unknown error occurred';
                
                if (error.message.includes('timeout')) {
                    statusCode = 504;
                    errorMessage = 'Gateway Timeout - upstream server did not respond';
                } else if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
                    statusCode = 502;
                    errorMessage = 'Bad Gateway - could not connect to upstream server';
                }
                
                res.writeHead(statusCode, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    error: statusCode === 504 ? 'Gateway Timeout' : statusCode === 502 ? 'Bad Gateway' : 'Internal Server Error',
                    message: errorMessage
                }));
            }
        } finally {
            clearTimeout(timeoutId);
        }
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
            res.end(JSON.stringify({ 
                error: 'URL parameter required',
                message: 'The url query parameter is missing'
            }));
            return;
        }

        // Normalize URL encoding
        let normalizedUrl = targetUrl;
        try {
            const urlObj = new URL(targetUrl);
            normalizedUrl = urlObj.href;
        } catch (e) {
            // Not a valid URL, validation will catch it
        }

        // Validate URL format
        if (!isValidUrl(normalizedUrl)) {
            setCorsHeaders(res);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                error: 'Invalid URL format',
                message: 'The provided URL is not a valid HTTP/HTTPS URL'
            }));
            return;
        }

        fetch(normalizedUrl, {
            headers: {
                'User-Agent': DEFAULT_USER_AGENT,
                ...headers
            }
        })
            .then((response) => {
                if (!response.ok) {
                    setCorsHeaders(res);
                    res.writeHead(response.status, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ 
                        error: 'Subtitle fetch failed',
                        status: response.status,
                        statusText: response.statusText
                    }));
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
                let statusCode = 500;
                let errorMessage = error.message || 'Unknown error occurred';
                
                if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
                    statusCode = 502;
                    errorMessage = 'Bad Gateway - could not connect to upstream server';
                }
                
                res.writeHead(statusCode, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    error: statusCode === 502 ? 'Bad Gateway' : 'Internal Server Error',
                    message: errorMessage
                }));
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
                // Validate and fix Referer header - ensure it's always a full URL
                const validReferer = validateRefererHeader(proxyHeaders.Referer, m3u8Origin);
                proxyHeaders = {
                    ...proxyHeaders,
                    Referer: validReferer || `${m3u8Origin}/`,
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
                // Validate and fix Referer header - ensure it's always a full URL
                const validReferer = validateRefererHeader(proxyHeaders.Referer, videoOrigin);
                proxyHeaders = {
                    ...proxyHeaders,
                    Referer: validReferer || `${videoOrigin}/`,
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
