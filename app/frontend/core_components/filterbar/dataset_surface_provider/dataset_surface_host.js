// dataset_surface_host.js
// Mounts the standard hero/filterbar around an extension-owned result renderer.
// Between shared URL/query state, explicit API adapters and surface lifecycle.
// Keeps specialized result layouts on the same search, filter, clear and sort controls.

import { create_filter_bar } from '../filter_bar_builder.js';
import { getParams } from '../../navigation/nav_engine/query_params.js';
import { getUnifiedTableState, setUnifiedTableState } from '../../state_stores/table_state_store.js';
import { renderActiveFilters } from '../filter_list/active_filter_tag_printer.js';
import { setResultsCount } from '../../../reusable_components/results_count/results_count_printer.js';
import { registerDatasetQueryAdapter } from './dataset_query_adapter_registry.js';

/** Mount one data source; stale requests cannot replace a later query or a destroyed view. */
export function mountDatasetSurface({
    container, datasetName, columns, dataTypes, metadata = {},
    loadSnapshot, renderSnapshot, onError = () => {},
}) {
    if (!container || typeof loadSnapshot !== 'function' || typeof renderSnapshot !== 'function') {
        throw new TypeError('A surface needs a container, loader and renderer');
    }
    const parts = document.createElement('div');
    parts.id = `${datasetName}_tab_parts_container`;
    parts.className = 'tab_parts_container dataset-query-surface';
    parts.dataset.view = 'custom';
    const area = document.createElement('div');
    area.className = 'tab-content-area';
    area.dataset.tableName = datasetName;
    const body = document.createElement('div');
    body.className = 'tab-content-body';
    const scroll = document.createElement('div');
    scroll.className = 'scrollable_content';
    const controls = document.createElement('div');
    controls.id = `${datasetName}_card_top_controls`;
    const count = document.createElement('div');
    count.id = `${datasetName}_results_count`;
    count.className = 'results_count';
    count.hidden = true; // The shared active-filter mirror is the sole visible result counter.
    const results = document.createElement('div');
    results.dataset.testid = 'dataset-surface-results';
    controls.append(count);
    scroll.append(controls, results);
    body.append(scroll);
    area.append(body);
    parts.append(area);
    container.append(parts);

    let destroyed = false;
    let generation = 0;
    let pending = null;
    let completedKey = null;
    let snapshot = null;
    let panel = null;
    let controlsNeedRebuild = false;
    const activeContainer = container.closest('.content_div') || container;
    const isActive = () => container.isConnected && !activeContainer.classList.contains('hidden');
    const keyFor = (params) => JSON.stringify(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)));

    function syncQueryState(params) {
        const filters = Object.fromEntries(Object.entries(params).filter(([key]) =>
            !['search', 'sort_column', 'sort_order', 'offset', 'view'].includes(key)));
        setUnifiedTableState(datasetName, {
            filters, offset: 0,
            sort: { column: params.sort_column || '__newest', direction: params.sort_order || 'DESC' },
        });
    }

    function present(value) {
        if (destroyed || !isActive()) return;
        renderSnapshot(results, value);
        setResultsCount(datasetName, value.filtered_count ?? 0);
        renderActiveFilters(datasetName);
    }

    async function refresh(options = {}) {
        if (destroyed) return null;
        const params = { ...getParams(datasetName) };
        if (options.skipUrlParams) {
            // Shared field-sort buttons intentionally write unified state without changing the URL.
            // Honor that same refresh contract while keeping the committed search term from the URL.
            const state = getUnifiedTableState(datasetName);
            for (const key of Object.keys(params)) {
                if (!['search', 'offset', 'view'].includes(key)) delete params[key];
            }
            Object.assign(params, state.filters || {});
            if (state.sort?.column) params.sort_column = state.sort.column;
            if (state.sort?.direction) params.sort_order = state.sort.direction;
        }
        if (options.search !== undefined) params.search = options.search;
        if (options.newFilters) Object.assign(params, options.newFilters);
        if (options.newSortColumn) params.sort_column = options.newSortColumn;
        if (options.newSortDirection) params.sort_order = options.newSortDirection;
        syncQueryState(params);
        for (const field of parts.querySelectorAll('[id]')) {
            if (!field.__dropdown?.setValue || !field.id.startsWith(`${datasetName}_`)) continue;
            const values = (key) => String(params[key] || '').split(',').filter(Boolean);
            field.__dropdown.setValue({ includeValues: values(field.id), excludeValues: values(`${field.id}_exclude`) });
        }
        const key = keyFor(params);
        if (!options.force && pending?.key === key) return pending.promise;
        if (!options.force && completedKey === key && snapshot) {
            // Returning to a completed query must invalidate another query still in flight.
            generation += 1;
            pending = null;
            results.removeAttribute('aria-busy');
            present(snapshot);
            return snapshot;
        }
        const current = ++generation;
        results.setAttribute('aria-busy', 'true');
        const promise = Promise.resolve().then(() => loadSnapshot(params)).then((value) => {
            if (destroyed || current !== generation) return null;
            snapshot = value;
            completedKey = key;
            present(value);
            return value;
        }).catch((error) => {
            if (!destroyed && current === generation) onError(error, results);
            return null;
        }).finally(() => {
            if (current === generation) {
                pending = null;
                results.removeAttribute('aria-busy');
            }
        });
        pending = { key, promise };
        return promise;
    }

    const unregister = registerDatasetQueryAdapter(datasetName, { refresh });
    function rebuildControls() {
        panel?.destroy?.();
        syncQueryState(getParams(datasetName));
        const spec = typeof metadata === 'function' ? metadata() : metadata;
        panel = create_filter_bar(datasetName, datasetName, columns, dataTypes,
            snapshot?.filtered_count ?? null, false, 'custom', {
                metadata: spec, allowDatasetManagement: false, sortOptions: spec.sort_options,
            });
        // A virtual surface can provide its own heading instead of SQL dataset-key fallback copy.
        if (spec.hero_heading) {
            parts.querySelectorAll('.morphing-title').forEach((heading) => {
                heading.textContent = spec.hero_heading;
                delete heading.dataset.langKey;
            });
        }
        if (spec.display_name) {
            parts.querySelectorAll(`[data-lang-key="${datasetName}"]`).forEach((label) => {
                delete label.dataset.langKey;
                label.textContent = spec.display_name;
            });
        }
        // An explicit localized placeholder also owns its accessible label; do not ask
        // the ordinary SQL dataset translation key to replace extension-provided copy.
        if (spec.search_placeholder) {
            parts.querySelectorAll(`[data-lang-key="search_for_${datasetName}"]`).forEach((label) => {
                delete label.dataset.langKey;
                label.textContent = spec.search_placeholder;
            });
        }
        renderActiveFilters(datasetName);
    }
    const onQueryChange = (event) => {
        if (event.detail?.dataset === datasetName) void refresh();
    };
    window.addEventListener('dataset-query-params-changed', onQueryChange);
    const languageObserver = new MutationObserver(() => {
        if (destroyed) return;
        controlsNeedRebuild = true;
        if (!isActive()) return;
        rebuildControls();
        controlsNeedRebuild = false;
        if (snapshot) present(snapshot);
    });
    const activationObserver = new MutationObserver(() => {
        if (destroyed || !isActive()) return;
        if (controlsNeedRebuild) { rebuildControls(); controlsNeedRebuild = false; }
        void refresh();
    });
    activationObserver.observe(activeContainer, { attributes: true, attributeFilter: ['class'] });
    languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    try { rebuildControls(); }
    catch (error) {
        unregister();
        languageObserver.disconnect();
        activationObserver.disconnect();
        window.removeEventListener('dataset-query-params-changed', onQueryChange);
        parts.remove();
        throw error;
    }
    return {
        refresh,
        results,
        destroy() {
            if (destroyed) return;
            destroyed = true;
            generation += 1;
            unregister();
            languageObserver.disconnect();
            activationObserver.disconnect();
            window.removeEventListener('dataset-query-params-changed', onQueryChange);
            panel?.destroy?.();
            parts.remove();
        },
    };
}
