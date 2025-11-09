/**
 * HLS playlist and segment caching
 * In-memory cache for playlists with TTL, optional LRU for segments
 */

import NodeCache from 'node-cache';

// Playlist cache - short TTL (30 seconds) for playlists
const playlistCache = new NodeCache({
    stdTTL: 30, // 30 seconds
    checkperiod: 10, // Check for expired entries every 10 seconds
    useClones: false // Better performance
});

// Segment cache - optional, can be enabled for frequently accessed segments
// Using longer TTL but with size limits
const segmentCache = new NodeCache({
    stdTTL: 300, // 5 minutes for segments
    checkperiod: 60,
    maxKeys: 1000, // Limit to 1000 segments in cache
    useClones: false
});

let segmentCacheEnabled = false;

/**
 * Gets a cached playlist
 */
export function getCachedPlaylist(url) {
    return playlistCache.get(url);
}

/**
 * Sets a playlist in cache
 */
export function setCachedPlaylist(url, content) {
    playlistCache.set(url, content);
}

/**
 * Gets a cached segment
 */
export function getCachedSegment(url) {
    if (!segmentCacheEnabled) {
        return undefined;
    }
    return segmentCache.get(url);
}

/**
 * Sets a segment in cache
 */
export function setCachedSegment(url, buffer) {
    if (!segmentCacheEnabled) {
        return;
    }
    segmentCache.set(url, buffer);
}

/**
 * Enables segment caching
 */
export function enableSegmentCache() {
    segmentCacheEnabled = true;
}

/**
 * Disables segment caching
 */
export function disableSegmentCache() {
    segmentCacheEnabled = false;
    segmentCache.flushAll();
}

/**
 * Gets cache statistics
 */
export function getCacheStats() {
    return {
        playlists: {
            keys: playlistCache.keys().length,
            hits: playlistCache.getStats().hits,
            misses: playlistCache.getStats().misses,
            ttl: 30
        },
        segments: {
            enabled: segmentCacheEnabled,
            keys: segmentCache.keys().length,
            hits: segmentCache.getStats().hits,
            misses: segmentCache.getStats().misses,
            ttl: 300,
            maxKeys: 1000
        }
    };
}

/**
 * Clears all caches
 */
export function clearCaches() {
    playlistCache.flushAll();
    segmentCache.flushAll();
}

