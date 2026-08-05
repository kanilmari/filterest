// filterbar_visibility_handler_helpers.js
// Pure helper functions extracted from filterbar_visibility_handler.js for testability.
// Zero DOM access — all functions are pure input→output.

/**
 * Build the localStorage key for filterbar visibility based on table name and screen width category.
 *
 * @param {string} tableName
 * @param {boolean} isWideScreen - true when viewport exceeds the breakpoint
 * @returns {string}
 */
export function buildVisibilityKey(tableName, isWideScreen) {
    return `${tableName}_filterbar_visible_${isWideScreen ? "wide" : "narrow"}`;
}

/**
 * Parse a stored visibility string into a boolean or null.
 *
 * @param {string|null} storedValue - raw localStorage value ("true", "false", or null)
 * @returns {boolean|null} true/false if stored, null if no stored value
 */
export function parseStoredVisibility(storedValue) {
    if (storedValue === null || storedValue === undefined) return null;
    return storedValue === "true";
}

/**
 * Determine whether the filterbar should be visible given the available inputs.
 * Priority: stored user preference > DB default > screen-width fallback.
 *
 * @param {boolean|null} storedVisibility - parsed stored preference (null = not set)
 * @param {boolean|undefined} dbDefault - table spec default (undefined = not configured)
 * @param {boolean} isWideScreen - whether the viewport exceeds the breakpoint
 * @returns {boolean}
 */
export function resolveInitialVisibility(storedVisibility, dbDefault, isWideScreen) {
    if (storedVisibility !== null) return storedVisibility;
    if (dbDefault !== undefined) return dbDefault;
    return isWideScreen;
}
