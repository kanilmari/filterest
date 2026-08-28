// dataset_search_location_handler_helpers.js
// Pure helper functions extracted from dataset_search_location_handler.js for testability.
// Zero DOM access — all functions are pure input→output.

/**
 * Parse a comma-separated GPS coordinate string into lat/lon object.
 * Returns null if the string is falsy or does not contain two finite numbers.
 *
 * @param {string|null|undefined} raw - Raw string in "lat,lon" format
 * @returns {{ lat: number, lon: number }|null}
 */
export function parseGpsCoordString(raw) {
    if (!raw) return null;
    const [lat, lon] = raw.split(",").map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
}
