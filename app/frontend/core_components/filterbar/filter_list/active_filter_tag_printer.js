// active_filter_tag_printer.js
// Displays removable filter tags above dataset results with synchronized state.
// Between filter bar state, search cache, URL params, and dataset rendering.
// Exists to give users a single control surface for active filter constraints.

import { getUnifiedTableState, setUnifiedTableState, refreshTableUnified } from "../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js";
import { getParams, setParams, updateURL } from "../../navigation/nav_engine/query_params.js";
import {
    ongoingSearchResults,
    do_intelligent_search,
    rerenderCachedSearchResults,
} from "../text_search/create_text_search_panel.js";
import { clearCommittedDatasetSearch } from "../text_search/dataset_search_clearer.js";
import { highlightActiveFilterSetChange } from "./active_filter_change_highlighter.js";
import { ROW_GROUP_FILTER_KEY, ROW_GROUP_MODE_KEY, renderRowGroupFilterTags } from "./row_group_facet_printer.js";
import {
    groupFilters,
    buildFilterLabel,
    buildDisplayValue,
    buildDedupeKey,
    isTranslatableValue,
    formatRangeLabel,
} from "./active_filter_tag_printer_helpers.js";

import { getTranslationForKey } from "../../lang/translation_handler.js";
import { bindDatasetLanguageRenderer } from "../../table_views/dataset_value_localizer.js";

import { buildActiveFilterChip } from "./active_filter_chip_builder.js";

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
    mirrorEl.dataset.resultCount = primaryCountEl.dataset.resultCount || "";
    mirrorEl.setAttribute("aria-live", "polite");
    mirrorEl.setAttribute("aria-atomic", "true");
    mirrorEl.replaceChildren();
    primaryCountEl.childNodes.forEach((node) => {
        mirrorEl.appendChild(node.cloneNode(true));
    });
    mirrorEl.dispatchEvent(new CustomEvent("results-count-updated", { bubbles: true }));
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
        activeFiltersHost.insertBefore(container, activeFiltersHost.querySelector(".active_filters_results_count"));
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
        const label = document.createElement("span");
        const nameSpan = document.createElement("span");
        nameSpan.dataset.langKey = "search";
        nameSpan.textContent = "search";
        label.appendChild(nameSpan);
        label.append(`: ${params.search}`);
        const { item: searchItem, button: btn } = buildActiveFilterChip({ label, onRemove: () => removeSearch(tableName) });
        container.appendChild(searchItem);
        bindDatasetLanguageRenderer(searchItem, () => {
            nameSpan.textContent = getTranslationForKey("search");
            btn.setAttribute("aria-label", `${getTranslationForKey("remove")}: ${label.textContent}`);
        });
    }

    const grouped = groupFilters(filters);

    Object.entries(grouped).forEach(([base, data]) => {
        if (base === ROW_GROUP_MODE_KEY) return;
        if (base === ROW_GROUP_FILTER_KEY) {
            renderRowGroupFilterTags(tableName, container).forEach(slug => seenLabels.add(`${ROW_GROUP_FILTER_KEY}::${slug}`));
            return;
        }
        // Duplikaattiesto: sama näyttönimi + arvo ohitetaan
        const labelBase = buildFilterLabel(data.baseKey || base, tableName);
        const displayValue = data.type === 'range'
            ? buildDisplayValue(data)
            : resolveSingleFilterDisplayValue(data.keys, data.value);
        const dedupeKey = buildDedupeKey(data.exclude ? `${labelBase}!=` : labelBase, displayValue);
        if (seenLabels.has(dedupeKey)) return;
        seenLabels.add(dedupeKey);

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

        const { item, button: btn } = buildActiveFilterChip({
            label, exclude: data.exclude, onRemove: () => removeFilter(tableName, data.keys),
        });
        container.appendChild(item);
        bindDatasetLanguageRenderer(item, () => {
            item.querySelectorAll("[data-lang-key]").forEach(span => {
                span.textContent = getTranslationForKey(span.dataset.langKey);
            });
            btn.setAttribute("aria-label", `${getTranslationForKey("remove")}: ${label.textContent}`);
        });
    });

    const hasSelections = container.childElementCount > 0;
    if (hasSelections) {
        const lead = document.createElement("span");
        lead.className = "active-filters-lead";
        lead.dataset.langKey = "selected_filters";
        const clear = document.createElement("button");
        clear.type = "button";
        clear.className = "active-filters-clear-all";
        clear.dataset.testid = "active-filters-clear-all";
        clear.dataset.langKey = "clear_all";
        clear.addEventListener("click", async () => {
            const { clearAllFilters } = await import("../top_row_buttons/top_row_builder.js");
            clearAllFilters(tableName, document.getElementById(`${tableName}_filterBar_panel`));
            renderActiveFilters(tableName);
            const searchInputs = document.querySelectorAll(".dataset-search-input");
            [...searchInputs].find(input => input.dataset.datasetSearchInput === tableName && input.getClientRects().length > 0)?.focus();
        });
        container.prepend(lead);
        container.appendChild(clear);
        bindDatasetLanguageRenderer(lead, () => { lead.textContent = getTranslationForKey("selected_filters"); });
        bindDatasetLanguageRenderer(clear, () => { clear.textContent = getTranslationForKey("clear_all"); });
    }
    container.style.display = hasSelections ? "" : "none";
    if (resultsCountMirror) {
        resultsCountMirror.style.display = "";
        syncResultsCountMirror(tableName, resultsCountMirror);
    }
    if (sidebarFiltersHost) {
        sidebarFiltersHost.style.display = hasSelections ? "" : "none";
    }
    sidebarFiltersHosts.forEach((host) => {
        if (host !== sidebarFiltersHost) {
            host.style.display = "none";
        }
    });
    highlightActiveFilterSetChange(container, [...seenLabels]);
    // Keep category checkboxes and badges current at the shared selection
    // boundary, including tag removal and whole reset before a reply arrives.
    topControls.dispatchEvent(new CustomEvent("active-filters-updated"));
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
        if (keys.includes(ROW_GROUP_FILTER_KEY)) {
            await do_intelligent_search(tableName, String(params.search));
        } else {
            searchCache.filters = { ...(state.filters || {}) };
            await rerenderCachedSearchResults(tableName);
        }
        renderActiveFilters(tableName);
    } else {
        // Välitön UI-päivitys ennen async-refreshiä — tunnisteet päivittyvät heti
        renderActiveFilters(tableName);
        refreshTableUnified(tableName, { skipUrlParams: true });
    }
}

function removeSearch(tableName) {
    if (!clearCommittedDatasetSearch(tableName)) return;
    renderActiveFilters(tableName);
}
