// permission_checker_helpers.js
// Pure helper functions extracted from permission_checker.js for testability.
// Zero DOM access — all functions are pure input→output.

/**
 * Compute the checkbox state for a function+group across multiple tables.
 * Returns 'checked' if all selected tables have the permission,
 * 'unchecked' if none do, or 'ambiguous' if mixed.
 *
 * @param {Array<{target_dataset_name: string, function_id: number, user_group_id: number}>} permissionsData
 * @param {string[]} selectedNames - Table names to check
 * @param {number} funcId - Function ID to match
 * @param {number} groupId - User group ID to match
 * @returns {'checked'|'unchecked'|'ambiguous'}
 */
export function computeMultipleTableState(permissionsData, selectedNames, funcId, groupId) {
    const states = selectedNames.map((name) =>
        permissionsData.some(
            (p) =>
                p.target_dataset_name === name &&
                p.function_id === funcId &&
                p.user_group_id === groupId
        )
    );
    const allTrue = states.every(Boolean);
    const allFalse = states.every((v) => !v);
    if (allTrue) return "checked";
    if (allFalse) return "unchecked";
    return "ambiguous";
}

/**
 * Map raw function records to the slim shape used by the permission UI.
 *
 * @param {Array<{id: number, name: string, url_route_endpoint: string, specific_table_related: boolean, ui_only: boolean, disabled: boolean}>} functions
 * @returns {Array<{id: number, name: string, url_route_endpoint: string, specific_table_related: boolean, ui_only: boolean}>}
 */
export function mapFunctionFields(functions) {
    if (!Array.isArray(functions)) return [];
    return functions
        .filter((fn) => !fn.disabled)
        .map((fn) => ({
            id: fn.id,
            name: fn.name,
            url_route_endpoint: fn.url_route_endpoint,
            specific_table_related: fn.specific_table_related,
            ui_only: fn.ui_only,
        }));
}

/**
 * Map raw group records to the slim shape used by the permission UI.
 *
 * @param {Array<{id: number, name: string}>} groups
 * @returns {Array<{id: number, name: string}>}
 */
export function mapGroupFields(groups) {
    if (!Array.isArray(groups)) return [];
    return groups.map((g) => ({
        id: g.id,
        name: g.name,
    }));
}
