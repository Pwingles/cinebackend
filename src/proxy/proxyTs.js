// TS/Segment proxy function based on the working implementation
import fetch from 'node-fetch';
import { DEFAULT_USER_AGENT } from './proxyserver.js';
import { setCorsHeaders } from './handleCors.js';

export async function proxyTs(targetUrl, headers, req, res) {
    try {
        // Handle range requests for video playback
        const fetchHeaders = {
            'User-Agent': DEFAULT_USER_AGENT,
            ...headers
        };

        // Forward range header if present
        if (req.headers.range) {
            fetchHeaders['Range'] = req.headers.range;
        }

        // Create fetch options with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 55000); // 55 seconds

        try {
            const response = await fetch(targetUrl, {
                headers: fetchHeaders,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                // Check for specific error codes
                let errorMessage = `TS fetch failed: ${response.status}`;
                let statusCode = response.status;

                if (response.status === 403 || response.status === 401) {
                    errorMessage = 'Access denied - URL may be expired or invalid';
                    statusCode = 403;
                } else if (response.status === 404) {
                    errorMessage = 'Segment not found';
                }

                // Set CORS headers even on error responses
                setCorsHeaders(res);
                res.writeHead(statusCode, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    error: errorMessage,
                    status: response.status
                }));
                return;
            }

            // Set CORS headers FIRST - critical for HLS.js to read response headers
            setCorsHeaders(res);
            
            // Set response headers
            const contentType =
                response.headers.get('content-type') || 'video/mp2t';
            res.setHeader('Content-Type', contentType);

            // Forward important headers from upstream (these are exposed via CORS)
            if (response.headers.get('content-length')) {
                res.setHeader(
                    'Content-Length',
                    response.headers.get('content-length')
                );
            }
            if (response.headers.get('content-range')) {
                res.setHeader(
                    'Content-Range',
                    response.headers.get('content-range')
                );
            }
            if (response.headers.get('accept-ranges')) {
                res.setHeader(
                    'Accept-Ranges',
                    response.headers.get('accept-ranges')
                );
            }

            // Set status code for range requests
            if (response.status === 206) {
                res.writeHead(206);
            } else {
                res.writeHead(200);
            }

            // Stream the response directly
            response.body.pipe(res);
        } catch (fetchError) {
            clearTimeout(timeoutId);
            if (fetchError.name === 'AbortError') {
                throw new Error('Request timeout - upstream server did not respond');
            }
            throw fetchError;
        }
    } catch (error) {
        console.error('[TS Proxy Error]:', {
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
            res.writeHead(statusCode, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                error: 'Proxy Error',
                message: errorMessage
            }));
        }
    }
}
