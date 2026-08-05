// table_loader_handler_helpers.js
// Pure helper functions extracted from table_loader_handler.js for testability.
// Zero DOM access — all functions are pure input→output.

import { getInternalDatasetName } from '../../navigation/nav_engine/dataset_aliases.js';

/**
 * Strip an optional SEO slug from a row-ID segment.
 * "125-some-title" → "125", "125" → "125", "" → "".
 *
 * @param {string} slugPart - The raw slug segment (e.g. "125-some-title")
 * @returns {string} The numeric ID portion, or the original string if no dash
 */
export function extractRowId(slugPart) {
    if (!slugPart) return "";
    const dashIdx = slugPart.indexOf('-');
    return dashIdx > 0 ? slugPart.substring(0, dashIdx) : slugPart;
}

/**
 * Parse a normalized pathname into a deep-linked table name and optional row ID.
 * Recognizes "/admin/{table}" and "/{table}" prefixes.
 * Handles "/{table}/{id}" and "/{table}/{id}-{slug}" patterns.
 *
 * @param {string} pathname - Normalized pathname (no trailing slash weirdness)
 * @param {string} [datasetPrefix='/'] - The dataset URL prefix
 * @returns {{ tableName: string|null, rowId: string|null }}
 */
export function parseDeepLink(pathname, datasetPrefix = '/') {
    if (!pathname || pathname === '/' || pathname === '') {
        return { tableName: null, rowId: null };
    }

    let rawName = null;

    if (pathname.startsWith("/admin/")) {
        rawName = pathname.replace("/admin/", "");
    } else if (pathname.startsWith(datasetPrefix) && pathname !== datasetPrefix) {
        rawName = pathname.replace(datasetPrefix, "");
    }

    if (!rawName) {
        return { tableName: null, rowId: null };
    }

    // Handle /{dataset}/{id} or /{dataset}/{id}-{slug}
    if (rawName.includes('/')) {
        const slashIdx = rawName.indexOf('/');
        const baseName = rawName.substring(0, slashIdx);
        const rowIdPart = rawName.substring(slashIdx + 1);
        return {
            tableName: getInternalDatasetName(baseName),
            rowId: extractRowId(rowIdPart),
        };
    }

    return { tableName: getInternalDatasetName(rawName), rowId: null };
}

/**
 * Resolve which table name to display, following a 3-step priority:
 * 1. Deep-linked name (if present and available)
 * 2. Stored/session name (if present, available, and not landing on front page)
 * 3. Default: first active-project top-level table by tab order, then first table marked is_default,
 *    then "app_service_catalog", then first custom view, then first available
 *
 * @param {Object} options
 * @param {string|null} options.deepLinkedName - Table name from URL deep link
 * @param {string|null} options.storedName - Table name from session/localStorage
 * @param {Set<string>} options.availableNames - Set of all valid table/view names
 * @param {Array<{ dataset_name: string, is_default?: boolean, is_top_level_in_current_project?: boolean }>} options.tables - Server table list
 * @param {Array<{ name: string }>} options.customViews - Custom view list
 * @param {boolean} options.isLandingOnFrontpage - Whether user landed on "/"
 * @param {Array<{ tab_id?: string, dataset_name?: string, sort_order?: number }>} [options.tabOrder] - Active project tab order
 * @returns {{ resolvedName: string|null, deepLinkInvalid: boolean }}
 */
export function resolveTableName({
    deepLinkedName,
    storedName,
    availableNames,
    tables,
    customViews,
    isLandingOnFrontpage,
    tabOrder = [],
}) {
    // 1) Deep-linked name
    if (deepLinkedName) {
        if (availableNames.has(deepLinkedName)) {
            return { resolvedName: deepLinkedName, deepLinkInvalid: false };
        }
        // Deep link pointed to a table that doesn't exist
        return { resolvedName: null, deepLinkInvalid: true };
    }

    // 2) Stored/session name (skip if landing on front page)
    if (!isLandingOnFrontpage && storedName && availableNames.has(storedName)) {
        return { resolvedName: storedName, deepLinkInvalid: false };
    }

    // 3) Default table
    let defaultName = null;
    const projectDefaultTable = findCurrentProjectDefaultTable(tables, tabOrder, availableNames);
    if (projectDefaultTable) {
        defaultName = projectDefaultTable.dataset_name;
    }

    const defaultTable = tables.find(t => t.is_default);
    if (!defaultName && defaultTable) {
        defaultName = defaultTable.dataset_name;
    }
    if (!defaultName) {
        defaultName = "app_service_catalog";
    }

    if (!availableNames.has(defaultName)) {
        defaultName = customViews.length > 0
            ? customViews[0].name
            : [...availableNames][0] || null;
    }

    return { resolvedName: defaultName, deepLinkInvalid: false };
}

function findCurrentProjectDefaultTable(tables, tabOrder, availableNames) {
    const projectTables = tables.filter((table) =>
        table.is_top_level_in_current_project === true &&
        table.dataset_name &&
        table.dataset_name !== 'system_users' &&
        availableNames.has(table.dataset_name)
    );
    if (projectTables.length === 0) {
        return null;
    }

    const tablesByName = new Map(projectTables.map((table) => [table.dataset_name, table]));
    const orderedProjectEntry = [...(tabOrder || [])]
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
        .find((entry) => {
            const tabId = entry?.tab_id || entry?.dataset_name;
            return tablesByName.has(tabId);
        });
    if (orderedProjectEntry) {
        return tablesByName.get(orderedProjectEntry.tab_id || orderedProjectEntry.dataset_name);
    }

    return projectTables[0];
}
