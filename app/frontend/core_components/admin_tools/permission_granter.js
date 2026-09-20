// permission_granter.js
// Saves permission assignments from the admin editor back to the backend.
// Bridges row-based permission changes with per-table and multi-table save endpoints.
// Exists to isolate permission persistence logic from permission-editor rendering code.

import { getAllSpecs } from "../state_stores/table_specs_reader.js";
import { buildPermissionObject, computePermissionDiff } from "./permission_granter_helpers.js";

function resolveGroupIdFromColumnKey(columnKey, groupColumnMap) {
    if (groupColumnMap && Object.prototype.hasOwnProperty.call(groupColumnMap, columnKey)) {
        return groupColumnMap[columnKey];
    }
    const match = /^group_(\d+)$/.exec(columnKey);
    if (!match) {
        return null;
    }
    return parseInt(match[1], 10);
}

export async function savePermissionRowsForMultipleTables({
    changedCells,
    targetTableNames,
    functionAccessMiddleware,
    endpoint_router,
    groupColumnMap = null,
}) {
    const proceed = await functionAccessMiddleware("save_permissions");
    if (!proceed) {
        return null;
    }

    const tableSpecs = getAllSpecs();
    const toAdd = [];
    const toRemove = [];

    (changedCells || []).forEach((cell) => {
        const groupId = resolveGroupIdFromColumnKey(cell.columnKey, groupColumnMap);
        if (!groupId) {
            return;
        }
        targetTableNames.forEach((tbl) => {
            const permissionObject = buildPermissionObject(groupId, cell.rowId, tableSpecs, tbl);
            if (cell.nextValue === true) {
                toAdd.push(permissionObject);
            } else {
                toRemove.push(permissionObject);
            }
        });
    });

    if (toAdd.length === 0 && toRemove.length === 0) {
        return null;
    }

    return await endpoint_router("datasetPermissions", {
        method: "PATCH",
        body_data: { add: toAdd, remove: toRemove },
    });
}

export async function savePermissionRowsTableless({
    changedCells,
    existingPermissions,
    functionAccessMiddleware,
    endpoint_router,
    groupColumnMap = null,
}) {
    const edits = [];
    (changedCells || []).forEach((cell) => {
        const groupId = resolveGroupIdFromColumnKey(cell.columnKey, groupColumnMap);
        if (!groupId) {
            return;
        }
        edits.push({
            groupId,
            functionId: cell.rowId,
            checked: cell.nextValue === true,
        });
    });

    const permissions_to_save = computePermissionDiff(existingPermissions || [], edits);

    const proceed = await functionAccessMiddleware("save_permissions");
    if (!proceed) {
        return null;
    }

    let urlParamsFixed = "";
    if (permissions_to_save.length === 0) {
        urlParamsFixed = "?schema=public&dataset=";
    }

    return await endpoint_router("datasetPermissions", {
        method: "POST",
        url_params: urlParamsFixed,
        body_data: { permissions: permissions_to_save },
    });
}
