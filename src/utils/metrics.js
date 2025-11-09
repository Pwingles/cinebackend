/**
 * Observability and metrics system
 * Tracks success rates, timing, and errors per host
 */

class MetricsCollector {
    constructor() {
        // Per-host metrics
        this.hostMetrics = new Map();
        
        // Global metrics
        this.globalMetrics = {
            totalRequests: 0,
            totalErrors: 0,
            totalManifestRequests: 0,
            totalSegmentRequests: 0,
            segmentErrors: 0,
            manifestTimings: [],
            segmentTimings: []
        };
    }

    /**
     * Record a request
     */
    recordRequest(hostname, type = 'unknown', success = true, duration = 0, statusCode = null) {
        this.globalMetrics.totalRequests++;

        if (!hostname) {
            hostname = 'unknown';
        }

        // Initialize host metrics if needed
        if (!this.hostMetrics.has(hostname)) {
            this.hostMetrics.set(hostname, {
                totalRequests: 0,
                totalErrors: 0,
                manifestRequests: 0,
                segmentRequests: 0,
                segmentErrors: 0,
                manifestTimings: [],
                segmentTimings: [],
                lastError: null,
                lastErrorTime: null
            });
        }

        const hostMetric = this.hostMetrics.get(hostname);
        hostMetric.totalRequests++;

        if (type === 'manifest') {
            this.globalMetrics.totalManifestRequests++;
            hostMetric.manifestRequests++;
            if (duration > 0) {
                this.globalMetrics.manifestTimings.push(duration);
                hostMetric.manifestTimings.push(duration);
                // Keep only last 1000 timings
                if (this.globalMetrics.manifestTimings.length > 1000) {
                    this.globalMetrics.manifestTimings.shift();
                }
                if (hostMetric.manifestTimings.length > 1000) {
                    hostMetric.manifestTimings.shift();
                }
            }
        } else if (type === 'segment') {
            this.globalMetrics.totalSegmentRequests++;
            hostMetric.segmentRequests++;
            if (duration > 0) {
                this.globalMetrics.segmentTimings.push(duration);
                hostMetric.segmentTimings.push(duration);
                // Keep only last 1000 timings
                if (this.globalMetrics.segmentTimings.length > 1000) {
                    this.globalMetrics.segmentTimings.shift();
                }
                if (hostMetric.segmentTimings.length > 1000) {
                    hostMetric.segmentTimings.shift();
                }
            }
        }

        if (!success) {
            this.globalMetrics.totalErrors++;
            hostMetric.totalErrors++;
            hostMetric.lastError = statusCode || 'unknown';
            hostMetric.lastErrorTime = new Date().toISOString();

            if (type === 'segment') {
                this.globalMetrics.segmentErrors++;
                hostMetric.segmentErrors++;
            }
        }
    }

    /**
     * Get metrics for a specific host
     */
    getHostMetrics(hostname) {
        if (!hostname || !this.hostMetrics.has(hostname)) {
            return null;
        }

        const hostMetric = this.hostMetrics.get(hostname);
        const manifestTimings = hostMetric.manifestTimings;
        const segmentTimings = hostMetric.segmentTimings;

        return {
            hostname,
            totalRequests: hostMetric.totalRequests,
            totalErrors: hostMetric.totalErrors,
            successRate: hostMetric.totalRequests > 0 
                ? ((hostMetric.totalRequests - hostMetric.totalErrors) / hostMetric.totalRequests * 100).toFixed(2) + '%'
                : '0%',
            manifestRequests: hostMetric.manifestRequests,
            segmentRequests: hostMetric.segmentRequests,
            segmentErrors: hostMetric.segmentErrors,
            segmentErrorRate: hostMetric.segmentRequests > 0
                ? ((hostMetric.segmentErrors / hostMetric.segmentRequests) * 100).toFixed(2) + '%'
                : '0%',
            meanManifestTime: manifestTimings.length > 0
                ? (manifestTimings.reduce((a, b) => a + b, 0) / manifestTimings.length).toFixed(2) + 'ms'
                : 'N/A',
            meanSegmentTime: segmentTimings.length > 0
                ? (segmentTimings.reduce((a, b) => a + b, 0) / segmentTimings.length).toFixed(2) + 'ms'
                : 'N/A',
            lastError: hostMetric.lastError,
            lastErrorTime: hostMetric.lastErrorTime
        };
    }

    /**
     * Get all host metrics
     */
    getAllHostMetrics() {
        const hosts = Array.from(this.hostMetrics.keys());
        return hosts.map(host => this.getHostMetrics(host));
    }

    /**
     * Get global metrics
     */
    getGlobalMetrics() {
        const manifestTimings = this.globalMetrics.manifestTimings;
        const segmentTimings = this.globalMetrics.segmentTimings;

        return {
            totalRequests: this.globalMetrics.totalRequests,
            totalErrors: this.globalMetrics.totalErrors,
            successRate: this.globalMetrics.totalRequests > 0
                ? ((this.globalMetrics.totalRequests - this.globalMetrics.totalErrors) / this.globalMetrics.totalRequests * 100).toFixed(2) + '%'
                : '0%',
            manifestRequests: this.globalMetrics.totalManifestRequests,
            segmentRequests: this.globalMetrics.totalSegmentRequests,
            segmentErrors: this.globalMetrics.segmentErrors,
            segmentErrorRate: this.globalMetrics.totalSegmentRequests > 0
                ? ((this.globalMetrics.segmentErrors / this.globalMetrics.totalSegmentRequests) * 100).toFixed(2) + '%'
                : '0%',
            meanManifestTime: manifestTimings.length > 0
                ? (manifestTimings.reduce((a, b) => a + b, 0) / manifestTimings.length).toFixed(2) + 'ms'
                : 'N/A',
            meanSegmentTime: segmentTimings.length > 0
                ? (segmentTimings.reduce((a, b) => a + b, 0) / segmentTimings.length).toFixed(2) + 'ms'
                : 'N/A',
            uniqueHosts: this.hostMetrics.size
        };
    }

    /**
     * Reset all metrics
     */
    reset() {
        this.hostMetrics.clear();
        this.globalMetrics = {
            totalRequests: 0,
            totalErrors: 0,
            totalManifestRequests: 0,
            totalSegmentRequests: 0,
            segmentErrors: 0,
            manifestTimings: [],
            segmentTimings: []
        };
    }
}

// Singleton instance
export const metrics = new MetricsCollector();

/**
 * Logs a request with sanitized URL (never logs full URLs with tokens)
 */
export function logRequest(hostname, type, success, duration, statusCode, sanitizedUrl = null) {
    const logData = {
        timestamp: new Date().toISOString(),
        host: hostname || 'unknown',
        type,
        success,
        duration: duration ? `${duration.toFixed(2)}ms` : 'N/A',
        statusCode: statusCode || (success ? 200 : 'error')
    };

    if (sanitizedUrl) {
        logData.url = sanitizedUrl;
    }

    // Record in metrics
    metrics.recordRequest(hostname, type, success, duration, statusCode);

    // Log to console (structured logging)
    if (success) {
        console.log('[PROXY]', JSON.stringify(logData));
    } else {
        console.error('[PROXY-ERROR]', JSON.stringify(logData));
    }
}

