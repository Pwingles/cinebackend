/**
 * URL resolver - normalizes messy provider responses to single valid m3u8 URL
 * Handles cases like "url1 or url2" and extracts the best URL
 */

import { normalizeUrl, validateUrlSafety } from './urlNormalizer.js';
import { extractHostname, isHostAllowed } from './hostConfig.js';
import fetch from 'node-fetch';
import { DEFAULT_USER_AGENT } from '../proxy/proxyserver.js';

/**
 * Resolves a messy URL response to a single valid m3u8 URL
 * Handles cases like:
 * - "url1 or url2"
 * - Multiple URLs separated by various delimiters
 * - JSON responses with URLs
 * - Plain text with URLs
 */
export async function resolveUrl(input, headers = {}) {
    if (!input || typeof input !== 'string') {
        throw new Error('URL_MALFORMED: Invalid input');
    }

    // Clean up the input
    let cleaned = input.trim();

    // Check for "or" patterns (e.g., "url1 or url2")
    const orPattern = /\s+or\s+/i;
    if (orPattern.test(cleaned)) {
        const parts = cleaned.split(orPattern);
        // Try each part, return the first valid m3u8 URL
        for (const part of parts) {
            try {
                const url = await tryResolveUrl(part.trim(), headers);
                if (url) return url;
            } catch (e) {
                // Continue to next part
            }
        }
        throw new Error('URL_MALFORMED: No valid m3u8 URL found in "or" separated list');
    }

    // Check for pipe-separated URLs
    if (cleaned.includes('|')) {
        const parts = cleaned.split('|');
        for (const part of parts) {
            try {
                const url = await tryResolveUrl(part.trim(), headers);
                if (url) return url;
            } catch (e) {
                // Continue to next part
            }
        }
        throw new Error('URL_MALFORMED: No valid m3u8 URL found in pipe-separated list');
    }

    // Try to resolve as single URL
    return await tryResolveUrl(cleaned, headers);
}

/**
 * Tries to resolve a single URL string
 */
async function tryResolveUrl(urlString, headers) {
    // Try parsing as JSON first
    let parsed;
    try {
        parsed = JSON.parse(urlString);
        // If it's an object, look for common URL fields
        if (typeof parsed === 'object') {
            const urlFields = ['url', 'link', 'src', 'source', 'stream', 'm3u8', 'playlist'];
            for (const field of urlFields) {
                if (parsed[field] && typeof parsed[field] === 'string') {
                    urlString = parsed[field];
                    break;
                }
            }
            // If no field found, try to stringify and extract URL
            if (urlString === parsed) {
                urlString = JSON.stringify(parsed);
            }
        }
    } catch {
        // Not JSON, continue with original string
    }

    // Extract URLs from text using regex
    const urlPattern = /https?:\/\/[^\s"<>{}|]+/g;
    const matches = urlString.match(urlPattern);
    
    if (!matches || matches.length === 0) {
        throw new Error('URL_MALFORMED: No URL found in input');
    }

    // Filter for m3u8 URLs first
    const m3u8Urls = matches.filter(url => url.includes('.m3u8') || url.includes('m3u8'));
    
    // If we have m3u8 URLs, use the first one
    if (m3u8Urls.length > 0) {
        const url = m3u8Urls[0];
        // Validate and normalize
        const safety = validateUrlSafety(url);
        if (!safety.valid) {
            throw new Error(safety.reason);
        }
        
        const normalized = normalizeUrl(url);
        const hostname = extractHostname(normalized);
        
        // Check host allowlist
        if (!isHostAllowed(hostname)) {
            throw new Error(`HOST_NOT_ALLOWED: Host ${hostname} is not in allowlist`);
        }

        // Verify it's actually an m3u8 URL by checking the response
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
            
            const response = await fetch(normalized, {
                headers: {
                    'User-Agent': DEFAULT_USER_AGENT,
                    ...headers
                },
                method: 'HEAD',
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);

            const contentType = response.headers.get('content-type') || '';
            if (response.ok && (contentType.includes('mpegurl') || contentType.includes('m3u8') || normalized.includes('.m3u8'))) {
                return normalized;
            }
        } catch (e) {
            // If HEAD fails, still return the URL if it looks like m3u8
            if (normalized.includes('.m3u8') || normalized.includes('m3u8')) {
                return normalized;
            }
            throw new Error(`URL_MALFORMED: Could not verify m3u8 URL: ${e.message}`);
        }
    }

    // If no m3u8 URLs found, use the first URL and hope it resolves to m3u8
    const url = matches[0];
    const safety = validateUrlSafety(url);
    if (!safety.valid) {
        throw new Error(safety.reason);
    }

    const normalized = normalizeUrl(url);
    const hostname = extractHostname(normalized);
    
    if (!isHostAllowed(hostname)) {
        throw new Error(`HOST_NOT_ALLOWED: Host ${hostname} is not in allowlist`);
    }

    return normalized;
}

