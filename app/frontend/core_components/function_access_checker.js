// function_access_checker.js
// Checks whether the current user may execute frontend-triggered functions.
// Bridges user actions with permission checks, counters, and visible access-denied feedback.
// Exists to prevent silent permission failures and centralize frontend function-gate behavior.

import { count_this_function } from '../core_components/dev_tools/function_counter.js';
import { showAccessDeniedToast } from '../reusable_components/notifications/toast_notification_printer.js';
import { custom_views } from '../core_components/navigation/admin_and_user_tools/custom_view_reader.js';
export { hasCachedRouteRights } from './permission_cache_reader.js';

/**
 * Middleware function that handles both function counting and usage rights checking
 * @param {string} functionName - The name of the function being called
 * @param {Object} options - Optional parameters for middleware behavior
 * @param {boolean} options.skipRightsCheck - Skip the usage rights check
 * @returns {Promise<boolean>} - Returns true if allowed to proceed, false otherwise
 */
export async function functionAccessMiddleware(functionName, options = {}) {
    // Always count the function call
    count_this_function?.(functionName);
    
    // Check usage rights if not skipped
    if (!options.skipRightsCheck) {
        const hasRights = await check_usage_rights(functionName);
        if (!hasRights) {
            showAccessDeniedToast(functionName);
            return false;
        }
    }
    
    return true;
}

/**
 * Check if the current user has rights to execute the specified function
 * This is a placeholder implementation - you'll need to implement the actual logic
 * @param {string} functionName - The name of the function to check rights for
 * @returns {Promise<boolean>} - Returns true if user has rights, false otherwise
 */
export async function check_usage_rights(functionName) {
    // Read cached permission list from sessionStorage:
    const rawPerms = sessionStorage.getItem('user_permissions');

    if (!rawPerms) {
        console.warn('user_permissions missing from sessionStorage');
        return false;
    }

    try {
        const perms = JSON.parse(rawPerms);
        if (Array.isArray(perms)) {
            if (perms.includes(functionName)) return true;

            // Permissions currently store URL endpoints. If the function name
            // doesn't look like one (no leading slash), check if it's a custom
            // view with a requiredPermission mapping.
            if (!functionName.startsWith('/')) {
                const viewDef = custom_views.find(v => v.name === functionName);
                if (viewDef && viewDef.requiredPermission) {
                    return perms.includes(viewDef.requiredPermission);
                }
                // Unmapped view names pass through — backend enforces auth
                return true;
            }

            return false;
        }
        console.warn('user_permissions is not an array — treating as empty permissions');
    } catch (err) {
        console.warn('Failed to parse user_permissions:', err);
    }

    return false;
}

/**
 * One-liner middleware replacement for count_this_function
 * Performs counting and rights checking silently
 * @param {string} functionName - The name of the function being called
 * @param {Object} options - Optional parameters
 */
export function logAndCheckAccess(functionName, options = {}) {
    // Synchronous counting
    count_this_function?.(functionName);
    
    // Asynchronous rights checking (fire and forget for now)
    if (!options.skipRightsCheck) {
        check_usage_rights(functionName).then(hasRights => {
            if (!hasRights) {
                showAccessDeniedToast(functionName);
            }
        }).catch(err => {
            console.warn(`Error checking rights for ${functionName}:`, err);
        });
    }
}
