// query_params.js
// Manages per-dataset URL query parameters: the search, filter and sort parameters in
// localStorage, shared by every browser tab, and the view parameter in this page's memory only.
// Bridges the URL bar and filter/sort state across navigation and popstate events.
// Exists to centralise param read/write logic so every navigation path shares a consistent state model.

import { writeDatasetAddress } from "./dataset_address_writer.js";
import { getInternalDatasetName } from './dataset_aliases.js';

const STORAGE_KEY = 'dataset_query_params';
export const DATASET_PREFIX = '/';
const AUTH_SHELL_QUERY_KEYS = new Set([
    'login-entry',
    'register-entry',
    'redirect',
]);
/**
 * The address's view parameter names the view this page shows, which is the
 * page's own choice (owner decision K143). It is cached only in this page's
 * memory, so another tab's view never reaches this one's addresses, and a newly
 * loaded page starts from the view its own address names. A view that earlier
 * versions stored with the shared parameters is ignored and left out of the
 * next write.
 */
const PAGE_OWN_PARAM_KEY = 'view';
let datasetParams = {};
let currentDataset = null;

function withoutPageOwnParams(params) {
    if (!params || typeof params !== 'object' || !Object.hasOwn(params, PAGE_OWN_PARAM_KEY)) {
        return params;
    }
    const { [PAGE_OWN_PARAM_KEY]: _pageOwnView, ...sharedParams } = params;
    return sharedParams;
}

/**
 * One dataset's parameters after the shared ones were read again: the shared
 * values in the order this page already had them, the page's own view where it
 * was, and any parameter another tab added after them. The address the page
 * writes from them therefore stays the same string, so the browser history
 * entry is replaced rather than a second one added.
 */
function keepPageParamOrder(pageParams, sharedParams) {
    const merged = {};
    for (const key of Object.keys(pageParams)) {
        if (key === PAGE_OWN_PARAM_KEY) {
            merged[key] = pageParams[key];
        } else if (Object.hasOwn(sharedParams, key)) {
            merged[key] = sharedParams[key];
        }
    }
    for (const [key, value] of Object.entries(sharedParams)) {
        if (!Object.hasOwn(merged, key)) merged[key] = value;
    }
    return merged;
}

function loadFromStorage() {
    const pageParams = datasetParams;
    let storedParams;
    try {
        storedParams = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
        storedParams = {};
    }
    datasetParams = {};
    for (const [dataset, params] of Object.entries(storedParams)) {
        datasetParams[dataset] = withoutPageOwnParams(params);
    }
    for (const [dataset, params] of Object.entries(pageParams)) {
        if (params && Object.hasOwn(params, PAGE_OWN_PARAM_KEY)) {
            datasetParams[dataset] = keepPageParamOrder(params, datasetParams[dataset] || {});
        }
    }
}

function saveToStorage() {
    const sharedParams = Object.fromEntries(
        Object.entries(datasetParams).map(([dataset, params]) => [dataset, withoutPageOwnParams(params)])
    );
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sharedParams));
    } catch {
        /* ignore quota errors */
    }
}

/**
 * Reads only dataset-owned query parameters from a browser search string.
 * Between authentication shell handoff URLs and per-dataset filter persistence.
 * Exists so transient login/register navigation markers cannot become row filters.
 */
export function parseDatasetParamsFromSearch(searchString) {
    const paramsObj = {};
    const searchParams = new URLSearchParams(searchString);
    searchParams.forEach((value, key) => {
        if (!AUTH_SHELL_QUERY_KEYS.has(key.toLowerCase())) {
            paramsObj[key] = value;
        }
    });
    return paramsObj;
}

export function normalizePath(pathname) {
    if (!pathname) return pathname;
    if (pathname !== '/' && pathname.endsWith('/')) {
        return pathname.slice(0, -1);
    }
    return pathname;
}

function parseCurrentSearch() {
    const path = normalizePath(window.location.pathname);
    let datasetPathName = null;
    if (path.startsWith('/admin/')) {
        datasetPathName = path.replace('/admin/', '') || null;
    } else if (path !== '/' && !path.startsWith('/api/') && !path.startsWith('/frontend/')) {
        datasetPathName = path.replace(DATASET_PREFIX, '') || null;
    }
    // Strip row ID from /{dataset}/{id} pattern — keep only the dataset name
    if (datasetPathName && datasetPathName.includes('/')) {
        datasetPathName = datasetPathName.substring(0, datasetPathName.indexOf('/'));
    }
    currentDataset = getInternalDatasetName(datasetPathName) || null;
    const paramsObj = parseDatasetParamsFromSearch(window.location.search);
    if (currentDataset) {
        datasetParams[currentDataset] = paramsObj;
        saveToStorage();
        window.dispatchEvent(
            new CustomEvent('dataset-query-params-changed', {
                detail: {
                    dataset: currentDataset,
                    params: datasetParams[currentDataset]
                }
            })
        );
    }
}

export function useStorageParams() {
    loadFromStorage();
}

export function useUrlParams() {
    loadFromStorage();
    parseCurrentSearch();
}

useUrlParams();
let popstateRegistered = false;
if (!popstateRegistered) {
    window.addEventListener('popstate', () => {
        useUrlParams();
    });
    popstateRegistered = true;
}

export function getParams(dataset) {
    const name = dataset || currentDataset;
    return datasetParams[name] ? { ...datasetParams[name] } : {};
}

export function setParams(dataset, params = {}) {
    loadFromStorage();
    currentDataset = dataset;
    datasetParams[dataset] = { ...params };
    saveToStorage();
}

/**
 * Forgets the parameters this page holds in memory for every dataset, its own
 * views included. Sign-out clears the stored ones; without this, a view kept
 * only in the page's memory would outlive the signed-out session.
 */
export function forgetPageDatasetParams() {
    datasetParams = {};
}

/**
 * Writes one dataset address with the parameters the caller supplies.
 *
 * The serialisation itself belongs to the dataset address owner
 * ([dataset_address_writer.js](./dataset_address_writer.js)), which also
 * reconciles the address with the state a finished render left on screen. This
 * keeps the long-standing public name and call shape for every existing caller.
 */
export function updateURL(
    dataset,
    params = getParams(dataset),
    prefix = DATASET_PREFIX,
    options = {}
) {
    writeDatasetAddress(dataset, params, prefix, options);
}

/**
 * Parses a URL search string into a structured table-query object.
 * Recognized keys: sort_column, sort_order, offset, search, view. All others → filters.
 *
 * @param {string} searchString - e.g. "?sort_column=name&sort_order=ASC&offset=20&status=active"
 * @returns {{ sort: { column: string|null, direction: string|null }, offset: number, filters: Object }}
 */
export function parseTableQueryString(searchString) {
    const sp = new URLSearchParams(searchString);
    const result = {
        sort: { column: null, direction: null },
        offset: 0,
        search: null,
        view: null,
        filters: {}
    };

    const sortCol = sp.get('sort_column');
    const sortDir = sp.get('sort_order');
    const offsetStr = sp.get('offset');
    const search = sp.get('search');
    const view = sp.get('view');

    if (sortCol) result.sort.column = sortCol;
    if (sortDir) result.sort.direction = sortDir.toUpperCase();
    if (offsetStr) result.offset = parseInt(offsetStr, 10) || 0;
    if (search) result.search = search;
    if (view) result.view = view;

    const RESERVED_KEYS = new Set([
        'sort_column',
        'sort_order',
        'offset',
        'table',
        'search',
        'view',
        ...AUTH_SHELL_QUERY_KEYS,
    ]);
    sp.forEach((value, key) => {
        if (!RESERVED_KEYS.has(key.toLowerCase())) {
            result.filters[key] = value;
        }
    });

    return result;
}

/**
 * Builds a URL search string from a structured table-query object.
 * Inverse of parseTableQueryString.
 *
 * @param {{ sort?: { column?: string|null, direction?: string|null }, offset?: number, filters?: Object }} params
 * @returns {string} e.g. "?sort_column=name&sort_order=ASC&offset=20&status=active" or "" if empty
 */
export function buildTableQueryString(params = {}) {
    const sp = new URLSearchParams();
    const { sort = {}, offset = 0, filters = {} } = params;

    if (sort.column) sp.set('sort_column', sort.column);
    if (sort.direction) {
        const dir = sort.direction.toUpperCase();
        if (dir === 'ASC' || dir === 'DESC') sp.set('sort_order', dir);
    }
    if (offset > 0) sp.set('offset', String(offset));

    for (const [key, value] of Object.entries(filters)) {
        if (value != null && value !== '') {
            sp.set(key, value);
        }
    }

    const qs = sp.toString();
    return qs ? `?${qs}` : '';
}
