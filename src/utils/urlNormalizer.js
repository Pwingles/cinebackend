/**
 * URL normalization and safety utilities
 * Handles URL cleaning, validation, and security checks
 */

/**
 * Normalizes a URL by:
 * - Stripping fragments (#)
 * - Trimming whitespace
 * - Decoding once and re-encoding once
 * - Validating format
 */
export function normalizeUrl(urlString) {
    if (!urlString || typeof urlString !== 'string') {
        throw new Error('URL_MALFORMED: Invalid URL input');
    }

    // Trim whitespace
    let normalized = urlString.trim();

    // Remove fragments
    const fragmentIndex = normalized.indexOf('#');
    if (fragmentIndex !== -1) {
        normalized = normalized.substring(0, fragmentIndex);
    }

    // Decode once (handle double-encoded URLs)
    try {
        // Check if it's already a valid URL
        const testUrl = new URL(normalized);
        normalized = testUrl.href;
    } catch (e) {
        // Try decoding once
        try {
            const decoded = decodeURIComponent(normalized);
            // Re-encode to ensure proper encoding
            const urlObj = new URL(decoded);
            normalized = urlObj.href;
        } catch (e2) {
            // If still fails, try without decoding
            try {
                const urlObj = new URL(normalized);
                normalized = urlObj.href;
            } catch (e3) {
                throw new Error('URL_MALFORMED: Cannot parse URL');
            }
        }
    }

    // Validate protocol
    const urlObj = new URL(normalized);
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
        throw new Error('URL_MALFORMED: Only HTTP/HTTPS URLs are allowed');
    }

    return normalized;
}

/**
 * Checks if a URL contains nested URLs or double-encoded JSON blobs
 */
export function validateUrlSafety(urlString) {
    if (!urlString || typeof urlString !== 'string') {
        return { valid: false, reason: 'URL_MALFORMED: Invalid URL input' };
    }

    // Check for nested URLs in query parameters
    try {
        const urlObj = new URL(urlString);
        
        // Check query parameters for nested URLs
        for (const [key, value] of urlObj.searchParams.entries()) {
            // Check if value looks like a URL
            if (value.startsWith('http://') || value.startsWith('https://')) {
                // Check if it's double-encoded JSON
                try {
                    const decoded = decodeURIComponent(value);
                    JSON.parse(decoded);
                    return { valid: false, reason: 'URL_MALFORMED: Double-encoded JSON blob detected in query' };
                } catch {
                    // Not JSON, but might be a nested URL
                    if (value.includes('?') || value.includes('&')) {
                        return { valid: false, reason: 'URL_MALFORMED: Nested URL detected in query parameter' };
                    }
                }
            }
        }

        // Check for multiple URLs concatenated
        const urlPattern = /https?:\/\//g;
        const matches = urlString.match(urlPattern);
        if (matches && matches.length > 1) {
            return { valid: false, reason: 'URL_MALFORMED: Multiple URLs concatenated' };
        }

        return { valid: true };
    } catch (e) {
        return { valid: false, reason: `URL_MALFORMED: ${e.message}` };
    }
}

/**
 * Sanitizes a URL for logging (removes tokens and sensitive data)
 */
export function sanitizeUrlForLogging(urlString) {
    if (!urlString || typeof urlString !== 'string') {
        return '[invalid-url]';
    }

    try {
        const urlObj = new URL(urlString);
        const host = urlObj.hostname;
        
        // Remove common token parameters
        const sensitiveParams = ['token', 'key', 'auth', 'signature', 'sig', 'access_token', 'api_key'];
        sensitiveParams.forEach(param => {
            if (urlObj.searchParams.has(param)) {
                urlObj.searchParams.set(param, '[REDACTED]');
            }
        });

        // Return sanitized URL with host visible but tokens hidden
        return `${urlObj.protocol}//${host}${urlObj.pathname}${urlObj.search}`;
    } catch {
        // If URL parsing fails, return truncated version
        return urlString.substring(0, 100) + (urlString.length > 100 ? '...' : '');
    }
}

