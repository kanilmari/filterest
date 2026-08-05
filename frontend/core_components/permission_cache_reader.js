// permission_cache_reader.js
// Reads route permissions from the browser-side sessionStorage cache.
// Bridges post-auth permission payloads and synchronous UI visibility checks.
// Exists so route checks can avoid importing the heavier function-access middleware graph.

/**
 * Synchronously check cached route permissions.
 * Operates between sessionStorage's user_permissions array and route-gated UI callers.
 * Exists as a small import-safe cache reader for early navigation/bootstrap modules.
 *
 * @param {string} route - The URL route to check permissions for.
 * @returns {boolean}
 */
export function hasCachedRouteRights(route) {
    const rawPerms = sessionStorage.getItem('user_permissions');
    if (!rawPerms) return false;

    try {
        const perms = JSON.parse(rawPerms);
        return Array.isArray(perms) ? perms.includes(route) : false;
    } catch (err) {
        console.warn('Failed to parse user_permissions:', err);
        return false;
    }
}
