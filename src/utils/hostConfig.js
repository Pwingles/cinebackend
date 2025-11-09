/**
 * Host allowlist and per-host header templates
 * Manages which hosts are allowed and what headers to use for each
 */

// Host allowlist - only these hosts are allowed for proxying
export const ALLOWED_HOSTS = new Set([
    // Add common streaming hosts here
    // This is a security measure to prevent SSRF attacks
    // Empty by default - all hosts allowed, but can be restricted
]);

// Per-host header templates
export const HOST_HEADER_TEMPLATES = {
    // Example template structure:
    // 'example.com': {
    //     'Referer': 'https://example.com/',
    //     'Origin': 'https://example.com',
    //     'User-Agent': 'Mozilla/5.0...'
    // }
};

/**
 * Checks if a host is allowed
 */
export function isHostAllowed(hostname) {
    if (!hostname) {
        return false;
    }

    // If allowlist is empty, allow all hosts
    if (ALLOWED_HOSTS.size === 0) {
        return true;
    }

    // Check exact match
    if (ALLOWED_HOSTS.has(hostname)) {
        return true;
    }

    // Check subdomain matches (e.g., cdn.example.com matches example.com)
    const parts = hostname.split('.');
    for (let i = 0; i < parts.length; i++) {
        const domain = parts.slice(i).join('.');
        if (ALLOWED_HOSTS.has(domain)) {
            return true;
        }
    }

    return false;
}

/**
 * Gets headers for a specific host
 */
export function getHeadersForHost(hostname, defaultHeaders = {}) {
    if (!hostname) {
        return defaultHeaders;
    }

    // Find matching host template
    let template = null;
    
    // Check exact match first
    if (HOST_HEADER_TEMPLATES[hostname]) {
        template = HOST_HEADER_TEMPLATES[hostname];
    } else {
        // Check subdomain matches
        const parts = hostname.split('.');
        for (let i = 0; i < parts.length; i++) {
            const domain = parts.slice(i).join('.');
            if (HOST_HEADER_TEMPLATES[domain]) {
                template = HOST_HEADER_TEMPLATES[domain];
                break;
            }
        }
    }

    if (template) {
        // Merge template with provided headers (provided headers take precedence)
        return {
            ...template,
            ...defaultHeaders
        };
    }

    return defaultHeaders;
}

/**
 * Extracts hostname from URL
 */
export function extractHostname(urlString) {
    try {
        const urlObj = new URL(urlString);
        return urlObj.hostname;
    } catch {
        return null;
    }
}

