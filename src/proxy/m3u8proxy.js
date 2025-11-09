// M3U8 proxy function based on the working implementation
import fetch from 'node-fetch';
import { DEFAULT_USER_AGENT } from './proxyserver.js';
import { setCorsHeaders } from './handleCors.js';
import { getCachedPlaylist, setCachedPlaylist } from '../utils/hlsCache.js';

export async function proxyM3U8(targetUrl, headers, res, serverUrl) {
    try {
        // Check cache first
        const cachedContent = getCachedPlaylist(targetUrl);
        if (cachedContent) {
            setCorsHeaders(res);
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.setHeader('Content-Length', Buffer.byteLength(cachedContent));
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('X-Cache', 'HIT');
            res.writeHead(200);
            res.end(cachedContent);
            return;
        }

        // Create fetch options with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 55000); // 55 seconds (slightly less than route timeout)

        try {
            const response = await fetch(targetUrl, {
                headers: {
                    'User-Agent': DEFAULT_USER_AGENT,
                    ...headers
                },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                // Check for specific error codes
                let errorMessage = `UPSTREAM_${response.status}: M3U8 fetch failed`;
                let statusCode = response.status;

                // Handle expired signed URLs (403/401)
                if (response.status === 403 || response.status === 401) {
                    errorMessage = `UPSTREAM_403: Access denied - URL may be expired or invalid`;
                    statusCode = 403;
                } else if (response.status === 404) {
                    errorMessage = 'NOT_FOUND: Manifest not found';
                }

                // Set CORS headers even on error responses
                setCorsHeaders(res);
                res.writeHead(statusCode, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    code: response.status === 403 ? 'UPSTREAM_403' : response.status === 404 ? 'NOT_FOUND' : 'ERROR',
                    message: errorMessage,
                    status: response.status,
                    statusText: response.statusText
                }));
                return;
            }

            const m3u8Content = await response.text();

            // Process M3U8 content line by line - key difference from our previous implementation
            const processedLines = m3u8Content.split('\n').map((line) => {
                line = line.trim();

                // Skip empty lines and comments (except special ones)
                if (!line || (line.startsWith('#') && !line.includes('URI='))) {
                    return line;
                }

                // Handle URI in #EXT-X-MEDIA tags (for audio/subtitle tracks)
                if (line.startsWith('#EXT-X-MEDIA:') && line.includes('URI=')) {
                    const uriMatch = line.match(/URI="([^"]+)"/);
                    if (uriMatch) {
                        const mediaUrl = new URL(uriMatch[1], targetUrl).href;
                        const proxyUrl = `${serverUrl}/m3u8-proxy?url=${encodeURIComponent(mediaUrl)}`;
                        return line.replace(uriMatch[1], proxyUrl);
                    }
                    return line;
                }

                // Handle encryption keys
                if (line.startsWith('#EXT-X-KEY:') && line.includes('URI=')) {
                    const uriMatch = line.match(/URI="([^"]+)"/);
                    if (uriMatch) {
                        const keyUrl = new URL(uriMatch[1], targetUrl).href;
                        const proxyUrl = `${serverUrl}/ts-proxy?url=${encodeURIComponent(keyUrl)}`;
                        return line.replace(uriMatch[1], proxyUrl);
                    }
                    return line;
                }

                // Handle segment URLs (non-comment lines)
                if (!line.startsWith('#')) {
                    try {
                        const segmentUrl = new URL(line, targetUrl).href;

                        // Check if it's another m3u8 file (master playlist)
                        if (line.includes('.m3u8') || line.includes('m3u8')) {
                            return `${serverUrl}/m3u8-proxy?url=${encodeURIComponent(segmentUrl)}`;
                        } else {
                            // It's a media segment
                            return `${serverUrl}/ts-proxy?url=${encodeURIComponent(segmentUrl)}`;
                        }
                    } catch (e) {
                        return line; // Return original if URL parsing fails
                    }
                }

                return line;
            });

            const processedContent = processedLines.join('\n');

            // Cache the processed content
            setCachedPlaylist(targetUrl, processedContent);

            // Set CORS headers BEFORE setting other headers
            setCorsHeaders(res);
            
            // Set proper headers for M3U8 content
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.setHeader('Content-Length', Buffer.byteLength(processedContent));
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('X-Cache', 'MISS');

            res.writeHead(200);
            res.end(processedContent);
        } catch (fetchError) {
            clearTimeout(timeoutId);
            if (fetchError.name === 'AbortError') {
                throw new Error('Request timeout - upstream server did not respond');
            }
            throw fetchError;
        }
    } catch (error) {
        console.error('[M3U8 Proxy Error]:', {
            message: error.message,
            name: error.name,
            url: targetUrl ? targetUrl.substring(0, 100) : 'unknown'
        });
        
        // Set CORS headers even on error responses
        setCorsHeaders(res);
        
        // Determine appropriate status code
        let statusCode = 500;
        let errorMessage = error.message || 'Unknown error occurred';
        
        if (error.message.includes('timeout')) {
            statusCode = 504;
            errorMessage = 'Gateway Timeout - upstream server did not respond';
        } else if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
            statusCode = 502;
            errorMessage = 'Bad Gateway - could not connect to upstream server';
        }
        
        if (!res.headersSent) {
            setCorsHeaders(res);
            res.writeHead(statusCode, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                code: statusCode === 504 ? 'TIMEOUT' : statusCode === 502 ? 'BAD_GATEWAY' : 'ERROR',
                message: errorMessage
            }));
        }
    }
}
