// column_manager_state_cleanup.js
// Rewrites the dataset view state a browser remembers after columns are renamed or removed.
// Bridges a saved schema change with the stored sort, filters, hidden columns and open filters.
// Exists so a schema edit can stay inside the running application without leaving
// the person's own saved view pointing at a column that no longer exists.
import { getUnifiedTableState, setUnifiedTableState } from '../../state_stores/table_state_store.js';
import { getHiddenColumns } from '../../filterbar/filter_list/column_visibility_handler.js';
import { getOpenedFilters, saveOpenedFilters } from '../../filterbar/filterbar_engine/filterbar_state_saver.js';

/**
 * Rewrites persisted dataset UI state after schema changes remove or rename columns.
 * Keeps sort/filter/visibility UI storage aligned with the latest column names.
 * Exists so column-management saves can stay inside the SPA shell without stale localStorage keys.
 * @param {string} key
 * @param {Set<string>} removedSet
 * @param {Record<string, string>} renameIndex
 * @returns {string | null}
 */
export function rewriteStoredFilterKey(key, removedSet, renameIndex) {
    let suffix = '';
    let baseKey = key;

    if (key.endsWith('_from')) {
        suffix = '_from';
        baseKey = key.slice(0, -suffix.length);
    } else if (key.endsWith('_to')) {
        suffix = '_to';
        baseKey = key.slice(0, -suffix.length);
    }

    if (removedSet.has(baseKey)) {
        return null;
    }

    return `${renameIndex[baseKey] || baseKey}${suffix}`;
}

/**
 * Rewrites persisted dataset UI state after schema changes remove or rename columns.
 * Keeps sort/filter/visibility UI storage aligned with the latest column names.
 * Exists so column-management saves can stay inside the SPA shell without stale localStorage keys.
 * @param {string} tableName
 * @param {string[]} removedColumns
 * @param {{ old_name: string, new_name: string }[]} renamedMap
 */
export function purgeStaleColumnState(tableName, removedColumns, renamedMap) {
    if (!removedColumns.length && !renamedMap.length) return;

    const removedSet = new Set(removedColumns);
    const renameIndex = Object.fromEntries(renamedMap.map(r => [r.old_name, r.new_name]));

    // --- A. Unified table state (sort + filters) ---
    const state = getUnifiedTableState(tableName);
    let stateChanged = false;

    if (state.sort && state.sort.column) {
        if (removedSet.has(state.sort.column)) {
            state.sort.column = null;
            state.sort.direction = null;
            stateChanged = true;
        } else if (renameIndex[state.sort.column]) {
            state.sort.column = renameIndex[state.sort.column];
            stateChanged = true;
        }
    }

    if (state.filters) {
        const nextFilters = {};
        for (const [key, value] of Object.entries(state.filters)) {
            const nextKey = rewriteStoredFilterKey(key, removedSet, renameIndex);
            if (!nextKey) {
                stateChanged = true;
                continue;
            }
            if (nextKey !== key) {
                stateChanged = true;
            }
            nextFilters[nextKey] = value;
        }
        state.filters = nextFilters;
    }

    if (stateChanged) {
        state.offset = 0;
        setUnifiedTableState(tableName, state);
    }

    // --- B. Hidden columns ---
    const hiddenMap = getHiddenColumns(tableName);
    let hiddenChanged = false;

    for (const col of removedColumns) {
        if (hiddenMap[col]) {
            delete hiddenMap[col];
            hiddenChanged = true;
        }
    }
    for (const { old_name, new_name } of renamedMap) {
        if (hiddenMap[old_name]) {
            hiddenMap[new_name] = true;
            delete hiddenMap[old_name];
            hiddenChanged = true;
        }
    }

    if (hiddenChanged) {
        localStorage.setItem(`${tableName}_hide_columns`, JSON.stringify(hiddenMap));
    }

    // --- C. Open filters ---
    const openFilters = getOpenedFilters(tableName);
    const seenFilters = new Set();
    const updatedFilters = [];
    let openFiltersChanged = false;

    for (const filterName of openFilters) {
        if (removedSet.has(filterName)) {
            openFiltersChanged = true;
            continue;
        }

        const nextFilterName = renameIndex[filterName] || filterName;
        if (nextFilterName !== filterName || seenFilters.has(nextFilterName)) {
            openFiltersChanged = true;
        }
        if (seenFilters.has(nextFilterName)) {
            continue;
        }

        seenFilters.add(nextFilterName);
        updatedFilters.push(nextFilterName);
    }

    if (openFiltersChanged) {
        saveOpenedFilters(tableName, updatedFilters);
    }
}
