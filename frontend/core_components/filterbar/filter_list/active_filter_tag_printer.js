// active_filter_tag_printer.js
// Displays removable filter tags above dataset results with synchronized state.
// Between filter bar state, search cache, URL params, and dataset rendering.
// Exists to give users a single control surface for active filter constraints.

import { getUnifiedTableState, setUnifiedTableState, refreshTableUnified } from "../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js";
import { getParams, setParams, updateURL } from "../../navigation/nav_engine/query_params.js";
import {
    ongoingSearchResults,
    getDatasetSearchInputs,
    rerenderCachedSearchResults,
} from "../text_search/create_text_search_panel.js";
import {
    groupFilters,
    buildFilterLabel,
    buildDisplayValue,
    buildDedupeKey,
    isTranslatableValue,
    formatRangeLabel,
} from "./active_filter_tag_printer_helpers.js";

let bigCardFilterSyncListenerBound = false;

function ensureActiveFiltersResultsCount(topControls, tableName) {
    let countEl = topControls.querySelector(".active_filters_results_count");
    if (!countEl) {
        countEl = document.createElement("div");
        countEl.classList.add("results_count", "active_filters_results_count");
        countEl.dataset.resultsCountFor = tableName;
        topControls.appendChild(countEl);
    }
    return countEl;
}

function syncResultsCountMirror(tableName, mirrorEl) {
    const primaryCountEl = document.getElementById(`${tableName}_results_count`);
    if (!mirrorEl || !primaryCountEl) return;
    mirrorEl.replaceChildren();
    primaryCountEl.childNodes.forEach((node) => {
        mirrorEl.appendChild(node.cloneNode(true));
    });
}

function resolveSingleFilterDisplayValue(keys, rawValue) {
    const firstKey = String(keys[0] || '');
    const filterInput = document.getElementById(firstKey)
        || document.getElementById(firstKey.replace(/_exclude$/, ''));
    const dropdown = filterInput?.__dropdown;
    if (!dropdown || typeof dropdown.getLabelsForValues !== "function") {
        return String(rawValue);
    }

    const rawValues = String(rawValue)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    if (rawValues.length === 0) {
        return String(rawValue);
    }

    return dropdown.getLabelsForValues(rawValues).join(", ");
}

function ensureBigCardFilterSyncListener() {
    if (bigCardFilterSyncListenerBound) {
        return;
    }

    document.addEventListener("big-card-toggle", (event) => {
        const tableName = event.detail?.tableName;
        if (!tableName) {
            return;
        }
        window.requestAnimationFrame(() => {
            renderActiveFilters(tableName);
        });
    });

    bigCardFilterSyncListenerBound = true;
}

function getBigCardSidebarFiltersHost(tableName) {
    return Array.from(
        document.querySelectorAll(
            `#${tableName}_card_view_container .card_sidebar_active_filters`
        )
    ).find((host) =>
        host.closest(".card_view_wrapper.big-card-open")
    );
}

export function renderActiveFilters(tableName) {
    const topControls = document.getElementById(`${tableName}_card_top_controls`);
    if (!topControls) return;
    ensureBigCardFilterSyncListener();

    const sidebarFiltersHosts = Array.from(
        document.querySelectorAll(
            `#${tableName}_card_view_container .card_sidebar_active_filters`
        )
    );
    const sidebarFiltersHost = getBigCardSidebarFiltersHost(tableName);
    const activeFiltersHost = sidebarFiltersHost || topControls;
    const candidateHosts = [topControls, ...sidebarFiltersHosts];

    let container = null;
    candidateHosts.forEach((host) => {
        host.querySelectorAll(".active_filters").forEach((el) => {
            if (!container) {
                container = el;
                return;
            }
            el.remove();
        });
    });

    if (!container) {
        container = document.createElement("div");
        container.classList.add("active_filters");
        container.dataset.testid = "active-filters";
    }
    if (container.parentElement !== activeFiltersHost) {
        activeFiltersHost.appendChild(container);
    }

    container.dataset.testid = "active-filters";

    if (sidebarFiltersHost) {
        topControls
            .querySelectorAll(".active_filters_results_count")
            .forEach((el) => el.remove());
    }

    let resultsCountMirror = null;
    if (!sidebarFiltersHost) {
        resultsCountMirror = ensureActiveFiltersResultsCount(topControls, tableName);
    }

    container.innerHTML = "";

    const params = getParams(tableName);
    const { filters = {} } = getUnifiedTableState(tableName);

    const seenLabels = new Set();

    if (params.search) {
        seenLabels.add(`search::${params.search}`);
        const searchItem = document.createElement("div");
        searchItem.classList.add("active-filter-item");
        searchItem.dataset.testid = "active-filter-item";
        const btn = document.createElement("button");
        btn.type = 'button';
        btn.classList.add("remove-active-filter");
        btn.dataset.testid = "active-filter-remove";
        btn.textContent = "×";
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            removeSearch(tableName);
        });
        const label = document.createElement("span");
        const nameSpan = document.createElement("span");
        nameSpan.dataset.langKey = "search";
        nameSpan.textContent = "search";
        label.appendChild(nameSpan);
        label.append(`: ${params.search}`);
        searchItem.appendChild(btn);
        searchItem.appendChild(label);
        container.appendChild(searchItem);
    }

    const grouped = groupFilters(filters);

    Object.entries(grouped).forEach(([base, data]) => {
        // Duplikaattiesto: sama näyttönimi + arvo ohitetaan
        const labelBase = buildFilterLabel(data.baseKey || base, tableName);
        const displayValue = data.type === 'range'
            ? buildDisplayValue(data)
            : resolveSingleFilterDisplayValue(data.keys, data.value);
        const dedupeKey = buildDedupeKey(data.exclude ? `${labelBase}!=` : labelBase, displayValue);
        if (seenLabels.has(dedupeKey)) return;
        seenLabels.add(dedupeKey);

        const item = document.createElement("div");
        item.classList.add("active-filter-item");
        if (data.exclude) {
            item.classList.add("active-filter-item--exclude");
        }
        item.dataset.testid = "active-filter-item";
        const btn = document.createElement("button");
        btn.type = 'button';
        btn.classList.add("remove-active-filter");
        btn.dataset.testid = "active-filter-remove";
        btn.textContent = "×";
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            void removeFilter(tableName, data.keys);
        });
        const nameSpan = document.createElement("span");
        nameSpan.dataset.langKey = labelBase;
        nameSpan.textContent = labelBase;
        const label = document.createElement("span");
        label.appendChild(nameSpan);

        if (data.type === 'range') {
            label.append(formatRangeLabel(data.values));
        } else {
            label.append(data.exclude ? ' \u2260 ' : ': ');
            const valSpan = document.createElement('span');
            valSpan.textContent = displayValue;
            if (isTranslatableValue(displayValue)) {
                valSpan.dataset.langKey = String(displayValue).toLowerCase();
            }
            label.append(valSpan);
        }

        item.appendChild(btn);
        item.appendChild(label);
        container.appendChild(item);
    });

    container.style.display = container.childElementCount ? "" : "none";
    if (resultsCountMirror) {
        resultsCountMirror.style.display = "";
        syncResultsCountMirror(tableName, resultsCountMirror);
    }
    if (sidebarFiltersHost) {
        sidebarFiltersHost.style.display = container.childElementCount ? "" : "none";
    }
    sidebarFiltersHosts.forEach((host) => {
        if (host !== sidebarFiltersHost) {
            host.style.display = "none";
        }
    });
}

async function removeFilter(tableName, keys) {
    const state = getUnifiedTableState(tableName);
    if (!state.filters) state.filters = {};
    keys.forEach((k) => {
        delete state.filters[k];
        const input = document.getElementById(k) || document.getElementById(String(k).replace(/_exclude$/, ''));
        if (input) {
            if (input.__dropdown) {
                input.__dropdown.setValue({ includeValues: [], excludeValues: [] }, false);
            } else if ('checked' in input) {
                input.checked = false;
            } else {
                input.value = '';
            }
        }
    });
    setUnifiedTableState(tableName, state);

    const params = getParams(tableName);
    keys.forEach((k) => delete params[k]);
    setParams(tableName, params);
    updateURL(tableName, params);

    const searchCache = ongoingSearchResults[tableName];
    if (params.search && searchCache) {
        searchCache.filters = { ...(state.filters || {}) };
        await rerenderCachedSearchResults(tableName);
        renderActiveFilters(tableName);
    } else {
        // Välitön UI-päivitys ennen async-refreshiä — tunnisteet päivittyvät heti
        renderActiveFilters(tableName);
        refreshTableUnified(tableName, { skipUrlParams: true });
    }
}

function removeSearch(tableName) {
    const params = getParams(tableName);
    delete params.search;
    setParams(tableName, params);
    updateURL(tableName, params);

    const inputs = getDatasetSearchInputs(tableName);
    inputs.forEach((input) => {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    ongoingSearchResults[tableName] = null;

    // Clean up search artifacts (second AI table, stage notices)
    const viewContainer = document.getElementById(`${tableName}_table_view_container`);
    if (viewContainer) {
        viewContainer
            .querySelectorAll(
                `#${tableName}_search_ai_table, #${tableName}_search_ai_cards, #${tableName}_search_ai_host`
            )
            .forEach((el) => el.remove());
        viewContainer.querySelectorAll(".search-stage-notice").forEach((el) => el.remove());
    }

    const cardViewContainer = document.getElementById(`${tableName}_card_view_container`);
    if (cardViewContainer) {
        cardViewContainer
            .querySelectorAll(
                `#${tableName}_search_ai_table, #${tableName}_search_ai_cards, #${tableName}_search_ai_host, .search-stage-notice`
            )
            .forEach((el) => el.remove());
    }

    // Välitön UI-päivitys ennen async-refreshiä
    renderActiveFilters(tableName);
    refreshTableUnified(tableName, { skipUrlParams: true });
}
