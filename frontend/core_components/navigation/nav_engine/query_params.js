// query_params.js
// Manages per-dataset URL query parameters using URLSearchParams and localStorage.
// Bridges the URL bar and filter/sort state across navigation and popstate events.
// Exists to centralise param read/write logic so every navigation path shares a consistent state model.

import {
    buildDatasetPath,
    getInternalDatasetName,
} from './dataset_aliases.js';

const STORAGE_KEY = 'dataset_query_params';
export const DATASET_PREFIX = '/';
let datasetParams = {};
let currentDataset = null;

function loadFromStorage() {
    try {
        datasetParams = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
        datasetParams = {};
    }
}

function saveToStorage() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(datasetParams));
    } catch {
        /* ignore quota errors */
    }
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
    const paramsObj = {};
    const sp = new URLSearchParams(window.location.search);
    sp.forEach((v, k) => {
        paramsObj[k] = v;
    });
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

export function updateURL(
    dataset,
    params = getParams(dataset),
    prefix = DATASET_PREFIX,
    options = {}
) {
    setParams(dataset, params);
    const sp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') {
            sp.set(k, v);
        }
    });
    const query = sp.toString();
    const targetPath = typeof options.pathOverride === 'string' && options.pathOverride
        ? normalizePath(options.pathOverride)
        : buildDatasetPath(dataset, prefix);
    const newUrl = `${targetPath}${query ? `?${query}` : ''}`;
    const currentUrl = window.location.pathname + window.location.search;
    const state = options.state === undefined ? {} : options.state;
    if (options.replace) {
        history.replaceState(state, '', newUrl);
    } else if (currentUrl === newUrl) {
        history.replaceState(state, '', newUrl);
    } else {
        history.pushState(state, '', newUrl);
    }
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

    const RESERVED_KEYS = new Set(['sort_column', 'sort_order', 'offset', 'table', 'search', 'view']);
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
