/**
 * Provider kill-switch configuration
 * Allows enabling/disabling providers at runtime
 */

// Provider enable/disable flags
// Set to false to disable a provider
export const PROVIDER_CONFIG = {
    getTwoEmbed: true,
    getAutoembed: true,
    get111Movies: true,
    getVidSrcCC: true,
    getVidSrc: true,
    getVidrock: true,
    getCinemaOS: true,
    getMultiembed: true,
    getVidsrcWtf: true,
    getVidZee: true,
    getXprime: false, // Already disabled in code
    getPrimewire: false, // Already disabled in code
    getWyzie: true,
    getLibre: true
};

/**
 * Checks if a provider is enabled
 */
export function isProviderEnabled(providerName) {
    return PROVIDER_CONFIG[providerName] !== false;
}

/**
 * Enables a provider
 */
export function enableProvider(providerName) {
    PROVIDER_CONFIG[providerName] = true;
}

/**
 * Disables a provider
 */
export function disableProvider(providerName) {
    PROVIDER_CONFIG[providerName] = false;
}

/**
 * Gets all provider statuses
 */
export function getProviderStatuses() {
    return { ...PROVIDER_CONFIG };
}

