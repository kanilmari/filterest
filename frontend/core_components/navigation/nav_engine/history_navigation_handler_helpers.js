// history_navigation_handler_helpers.js
// Pure helper functions extracted from history_navigation_handler.js for testability.
// Zero DOM access — all functions are pure input→output.
import { extractRowId } from '../../admin_tools/main/table_loader_handler_helpers.js';
import { getInternalDatasetName } from './dataset_aliases.js';

/**
 * Determine the URL prefix from a pathname, or null if the path should be skipped.
 *
 * @param {string} pathname - e.g. '/admin/users', '/elections', '/'
 * @param {string} datasetPrefix - the default dataset prefix (e.g. '/')
 * @returns {string|null} the prefix to use, or null if navigation should be skipped
 */
export function getPrefixFromPathname(pathname, datasetPrefix) {
    if (pathname.startsWith('/admin/')) {
        return '/admin/';
    }
    if (pathname === '/' || pathname.startsWith('/api/') || pathname.startsWith('/frontend/')) {
        return null;
    }
    return datasetPrefix;
}

/**
 * Parse a deep-link path segment into a base name and optional row ID.
 * Handles patterns like "dataset/123" and "dataset/123-some-slug".
 *
 * @param {string} name - the path segment after the prefix, e.g. "elections/42-title"
 * @returns {{ name: string, deepLinkedRowId: string|null }}
 */
export function parseDeepLink(name) {
    let deepLinkedRowId = null;
    if (name.includes('/')) {
        const slashIdx = name.indexOf('/');
        const baseName = name.substring(0, slashIdx);
        const rowIdPart = extractRowId(name.substring(slashIdx + 1));
        if (baseName && rowIdPart) {
            return {
                name: getInternalDatasetName(baseName),
                deepLinkedRowId: rowIdPart,
            };
        }
    }
    return { name: getInternalDatasetName(name), deepLinkedRowId };
}

/**
 * Check whether a pathname points to the base dataset route without a row deep link.
 *
 * @param {string} pathname - Full browser pathname
 * @param {string} datasetPrefix - Public dataset prefix such as "/"
 * @param {string} expectedDatasetName - Raw internal dataset name
 * @returns {boolean} True when the path resolves to the dataset root
 */
export function isDatasetBasePath(pathname, datasetPrefix, expectedDatasetName) {
    const prefix = getPrefixFromPathname(pathname, datasetPrefix);
    if (!prefix || !expectedDatasetName) {
        return false;
    }

    const rawName = pathname.slice(prefix.length);
    const { name, deepLinkedRowId } = parseDeepLink(rawName);
    return name === expectedDatasetName && !deepLinkedRowId;
}

/**
 * Check whether a pathname points to a row deep link for the expected dataset.
 *
 * @param {string} pathname - Full browser pathname
 * @param {string} datasetPrefix - Public dataset prefix such as "/"
 * @param {string} expectedDatasetName - Raw internal dataset name
 * @returns {boolean} True when the path resolves to a row inside the dataset
 */
export function isDatasetRowPath(pathname, datasetPrefix, expectedDatasetName) {
    const prefix = getPrefixFromPathname(pathname, datasetPrefix);
    if (!prefix || !expectedDatasetName) {
        return false;
    }

    const rawName = pathname.slice(prefix.length);
    const { name, deepLinkedRowId } = parseDeepLink(rawName);
    return name === expectedDatasetName && Boolean(deepLinkedRowId);
}

/**
 * Build a flat params object from a parsed query string result.
 * Maps the structured { filters, sort, offset } shape into key-value pairs
 * suitable for setParams().
 *
 * @param {{ filters: object, sort: { column: string|null, direction: string|null }, offset: number }} parsed
 * @returns {object}
 */
export function buildParamsFromParsed(parsed) {
    return {
        ...parsed.filters,
        ...(parsed.sort.column ? { sort_column: parsed.sort.column } : {}),
        ...(parsed.sort.direction ? { sort_order: parsed.sort.direction } : {}),
        ...(parsed.offset > 0 ? { offset: String(parsed.offset) } : {}),
        ...(parsed.search ? { search: parsed.search } : {}),
        ...(parsed.view ? { view: parsed.view } : {}),
    };
}
