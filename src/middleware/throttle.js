/**
 * Request throttling middleware
 * Limits request rate per IP address
 */

// Store request timestamps per IP
const requestTimestamps = new Map();

// Configuration
const THROTTLE_CONFIG = {
    windowMs: 60000, // 1 minute window
    maxRequests: 100, // Max requests per window
    cleanupInterval: 300000 // Clean up old entries every 5 minutes
};

/**
 * Gets client IP from request
 */
function getClientIp(req) {
    return req.ip || 
           req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
           req.headers['x-real-ip'] || 
           req.connection?.remoteAddress || 
           'unknown';
}

/**
 * Cleans up old entries from the request timestamps map
 */
function cleanupOldEntries() {
    const now = Date.now();
    const windowMs = THROTTLE_CONFIG.windowMs;

    for (const [ip, timestamps] of requestTimestamps.entries()) {
        // Remove timestamps outside the window
        const recentTimestamps = timestamps.filter(ts => now - ts < windowMs);
        
        if (recentTimestamps.length === 0) {
            requestTimestamps.delete(ip);
        } else {
            requestTimestamps.set(ip, recentTimestamps);
        }
    }
}

// Start cleanup interval
setInterval(cleanupOldEntries, THROTTLE_CONFIG.cleanupInterval);

/**
 * Throttling middleware
 */
export function throttleMiddleware(req, res, next) {
    const ip = getClientIp(req);
    const now = Date.now();
    const windowMs = THROTTLE_CONFIG.windowMs;
    const maxRequests = THROTTLE_CONFIG.maxRequests;

    // Get or create timestamps array for this IP
    if (!requestTimestamps.has(ip)) {
        requestTimestamps.set(ip, []);
    }

    const timestamps = requestTimestamps.get(ip);

    // Remove timestamps outside the window
    const recentTimestamps = timestamps.filter(ts => now - ts < windowMs);
    requestTimestamps.set(ip, recentTimestamps);

    // Check if limit exceeded
    if (recentTimestamps.length >= maxRequests) {
        const retryAfter = Math.ceil((recentTimestamps[0] + windowMs - now) / 1000);
        
        res.status(429).json({
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests',
            hint: `Rate limit exceeded. Please try again after ${retryAfter} seconds.`,
            retryAfter
        });
        return;
    }

    // Add current request timestamp
    recentTimestamps.push(now);
    requestTimestamps.set(ip, recentTimestamps);

    next();
}

/**
 * Updates throttle configuration
 */
export function updateThrottleConfig(config) {
    if (config.windowMs) THROTTLE_CONFIG.windowMs = config.windowMs;
    if (config.maxRequests) THROTTLE_CONFIG.maxRequests = config.maxRequests;
    if (config.cleanupInterval) THROTTLE_CONFIG.cleanupInterval = config.cleanupInterval;
}

/**
 * Gets current throttle configuration
 */
export function getThrottleConfig() {
    return { ...THROTTLE_CONFIG };
}

