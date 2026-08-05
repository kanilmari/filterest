// permission_granter_helpers.js
// Pure helper functions extracted from permission_granter.js for testability.
// Zero DOM access — all functions are pure input→output.

/**
 * Build a permission object for a single group+function+table combination.
 *
 * @param {number} groupId - User group ID
 * @param {number} funcId - Function ID
 * @param {Object} tableSpecs - Map of table names to specs (each with table_uid)
 * @param {string} tableName - Target table name
 * @returns {{ user_group_id: number, function_id: number, target_schema_name: string, target_dataset_name: string, target_table_uid: number|null }}
 */
export function buildPermissionObject(groupId, funcId, tableSpecs, tableName) {
    const uidStr = tableSpecs[tableName] ? tableSpecs[tableName].table_uid : null;
    const uid = uidStr !== null ? parseInt(uidStr, 10) : null;
    return {
        user_group_id: parseInt(groupId, 10),
        function_id: parseInt(funcId, 10),
        target_schema_name: "public",
        target_dataset_name: tableName,
        target_table_uid: uid,
    };
}

/**
 * Compute the diff between existing non-table-specific permissions and a set of edits.
 * Returns the final array of permissions to save.
 *
 * @param {Array<{ user_group_id: number, function_id: number, target_dataset_name: string }>} existing - Current permissions from server
 * @param {Array<{ groupId: string|number, functionId: string|number, checked: boolean }>} edits - Edited checkbox states
 * @returns {Array<{ user_group_id: number, function_id: number, target_schema_name: string, target_table_uid: null }>}
 */
export function computePermissionDiff(existing, edits) {
    const rightsMap = new Map();

    existing
        .filter((p) => p.target_dataset_name === "")
        .forEach((p) => {
            const key = `${p.user_group_id}-${p.function_id}`;
            rightsMap.set(key, {
                user_group_id: p.user_group_id,
                function_id: p.function_id,
                target_schema_name: "public",
                target_table_uid: null,
            });
        });

    edits.forEach((edit) => {
        const key = `${edit.groupId}-${edit.functionId}`;
        if (edit.checked) {
            rightsMap.set(key, {
                user_group_id: parseInt(edit.groupId, 10),
                function_id: parseInt(edit.functionId, 10),
                target_schema_name: "public",
                target_table_uid: null,
            });
        } else {
            rightsMap.delete(key);
        }
    });

    return Array.from(rightsMap.values());
}
