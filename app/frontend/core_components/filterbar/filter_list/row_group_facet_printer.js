// row_group_facet_printer.js
// Renders localized row-group facets and applies group selections as a normal dataset filter.
// Bridges get-results facet metadata, unified table state, route params, and shared view refreshes.
// Exists so every dataset view shares the same accessible category panel and selection boundary.

import {
    bindDatasetLanguageRenderer,
    resolveDatasetDisplayValue,
} from "../../table_views/dataset_value_localizer.js";
import {
    getUnifiedTableState,
    setUnifiedTableState,
} from "../../state_stores/table_state_store.js";
import {
    getParams,
    setParams,
    updateURL,
} from "../../navigation/nav_engine/query_params.js";

import { getTranslationForKey } from "../../lang/translation_handler.js";
import { updateDatasetAddress } from "../../navigation/nav_engine/dataset_address_writer.js";
import { renderActiveFilters } from "./active_filter_tag_printer.js";
import { adoptResolvedSearchRowGroupSelection, getSearchFilterContext } from "../text_search/dataset_search_runtime_state.js";
import { rekeyLoadedDatasetRows } from "../../table_views/dataset_loaded_rows.js";

import { ROW_GROUP_FILTER_KEY, ROW_GROUP_MODE_KEY, parseRowGroupModes, serializeRowGroupModes } from "./row_group_filter_contract.js";
export { ROW_GROUP_FILTER_KEY, ROW_GROUP_MODE_KEY } from "./row_group_filter_contract.js";
import { createRowGroupFacetCard } from "./row_group_facet_card_builder.js";
import { buildActiveFilterChip } from "./active_filter_chip_builder.js";
const SELECTION_LIMIT = 20;
const facetsByTable = new Map();
const SAFE_ROW_GROUP_SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function normalizeFacet(facet) {
    const id = Number(facet?.id);
    const slug = String(facet?.slug || "").trim();
    const rowCount = Number(facet?.row_count);
    if (
        !Number.isSafeInteger(id)
        || id <= 0
        || !SAFE_ROW_GROUP_SLUG.test(slug)
        || !Number.isSafeInteger(rowCount)
        || rowCount < 0
    ) {
        return null;
    }
    return {
        id,
        slug,
        title: facet?.title ?? null,
        row_count: rowCount,
        selected: facet?.selected === true,
        mode: facet?.mode === "all" ? "all" : "any",
        zero_hit: facet?.zero_hit === true,
        heading: normalizeHeading(facet?.heading),
    };
}

function normalizeHeading(heading) {
    const id = Number(heading?.id);
    const slug = String(heading?.slug || "").trim();
    if (!Number.isSafeInteger(id) || id <= 0 || !SAFE_ROW_GROUP_SLUG.test(slug)) return null;
    return {
        id, slug, title: heading.title ?? null,
        is_single: heading.is_single === true,
        sort_order: Number.isSafeInteger(heading.sort_order) ? heading.sort_order : 0,
    };
}

// The payload orders values; group without losing that order and sort headings
// explicitly so legacy untitled values stay together even in additive payloads.
function groupFacetsByHeading(facets) {
    const groups = new Map();
    for (const facet of facets) {
        const key = facet.heading?.id ?? null;
        if (!groups.has(key)) groups.set(key, { heading: facet.heading, values: [] });
        groups.get(key).values.push(facet);
    }
    return [...groups.values()].sort((a, b) =>
        (a.heading?.sort_order ?? 0) - (b.heading?.sort_order ?? 0)
        || (a.heading?.id ?? 0) - (b.heading?.id ?? 0));
}

function getFacetHostId(tableName) {
    return `${tableName}_row_group_facets`;
}

function getFacetFallbackTitle(slug) {
    return slug.replaceAll("_", " ").replaceAll("-", " ");
}

export function clearRowGroupFacets(tableName) {
    const host = document.getElementById(getFacetHostId(tableName));
    host?.disposeRowGroupPanel?.();
    host?.remove();
}

function getSelectedSlugs(tableName) {
    const value = getUnifiedTableState(tableName)?.filters?.[ROW_GROUP_FILTER_KEY] || "";
    return [...new Set(String(value).split(",").map(slug => slug.trim()).filter(slug => SAFE_ROW_GROUP_SLUG.test(slug)))].sort();
}

function getSelectedModes(tableName) {
    return parseRowGroupModes(String(getUnifiedTableState(tableName)?.filters?.[ROW_GROUP_MODE_KEY] || "")) || {};
}

/** Set a heading preference through the same apply boundary as checkbox changes. */
export async function setRowGroupMatchMode(tableName, headingID, mode) {
    const id = Number(headingID);
    if (!Number.isSafeInteger(id) || id < 0 || !["any", "all"].includes(mode)) return false;
    const facet = facetsByTable.get(tableName)?.find(value => (value.heading?.id ?? 0) === id);
    if (!facet || (mode === "all" && facet.heading?.is_single)) return false;
    const modes = { ...getSelectedModes(tableName) };
    if (mode === "all") {
        if (!modes[id] && Object.keys(modes).length >= 20) return false;
        modes[id] = mode;
    } else delete modes[id];
    return applyRowGroupSelection(tableName, getSelectedSlugs(tableName), modes);
}

function filterSignature(filters) {
    return JSON.stringify(Object.entries(filters || {}).sort(([a], [b]) => a.localeCompare(b)));
}

// Only complete resolved first-page state owns reconciliation. Capped facets
// cannot remove hidden selections or mode-only preferences. Adopt both controls
// atomically into the current search/listing caches without fetching again.
function reconcileResolvedRowGroupSelection(tableName, resolved, isCurrent) {
    if (!Array.isArray(resolved?.slugs) || !resolved?.modes || typeof resolved.modes !== "object") return false;
    const selection = [...new Set(resolved.slugs.filter(slug => SAFE_ROW_GROUP_SLUG.test(slug)))].sort().join(",");
    const modes = serializeRowGroupModes(resolved.modes);
    const state = getUnifiedTableState(tableName);
    const params = getParams(tableName);
    const controls = { [ROW_GROUP_FILTER_KEY]: selection, [ROW_GROUP_MODE_KEY]: modes };
    if (Object.entries(controls).every(([key, value]) => (state.filters?.[key] || "") === value && (params[key] || "") === value)) return false;
    const previousSearchContext = getSearchFilterContext(tableName);
    const filters = { ...(state.filters || {}) };
    for (const [key, value] of Object.entries(controls)) {
        if (value) { filters[key] = value; params[key] = value; }
        else { delete filters[key]; delete params[key]; }
    }
    setUnifiedTableState(tableName, { filters });
    setParams(tableName, params);
    adoptResolvedSearchRowGroupSelection(tableName, previousSearchContext);
    rekeyLoadedDatasetRows(tableName, state.filters);
    const committedFilters = filterSignature(filters);
    void updateDatasetAddress({ dataset: tableName, isCurrent: () => isCurrent()
        && filterSignature(getUnifiedTableState(tableName).filters) === committedFilters });
    return true;
}

export async function toggleRowGroupFacet(tableName, requestedSlug) {
    const slug = String(requestedSlug || "").trim();
    if (!SAFE_ROW_GROUP_SLUG.test(slug)) return false;
    const selection = new Set(getSelectedSlugs(tableName));
    if (selection.has(slug)) {
        selection.delete(slug);
    } else {
        if (selection.size >= SELECTION_LIMIT) return false;
        selection.add(slug);
    }
    return applyRowGroupSelection(tableName, [...selection].sort());
}

// Clearing and individual toggles share the same state, URL and search refresh boundary.
export async function clearRowGroupSelection(tableName) {
    return applyRowGroupSelection(tableName, [], {});
}

async function applyRowGroupSelection(tableName, selection, modes = getSelectedModes(tableName)) {
    const modeValue = serializeRowGroupModes(modes);
    const filters = { ...(getUnifiedTableState(tableName).filters || {}) };
    if (selection.length) {
        filters[ROW_GROUP_FILTER_KEY] = selection.join(",");
    } else {
        delete filters[ROW_GROUP_FILTER_KEY];
    }
    if (modeValue) filters[ROW_GROUP_MODE_KEY] = modeValue;
    else delete filters[ROW_GROUP_MODE_KEY];
    setUnifiedTableState(tableName, { filters, offset: 0 });

    const params = getParams(tableName);
    delete params.offset;
    if (selection.length) {
        params[ROW_GROUP_FILTER_KEY] = selection.join(",");
    } else {
        delete params[ROW_GROUP_FILTER_KEY];
    }
    if (modeValue) params[ROW_GROUP_MODE_KEY] = modeValue;
    else delete params[ROW_GROUP_MODE_KEY];
    setParams(tableName, params);
    updateURL(tableName, params);

    // Search reloads replace rows only, so update tags at the selection boundary too.
    const { renderActiveFilters } = await import("./active_filter_tag_printer.js");
    renderActiveFilters(tableName);
    const { refreshTableUnified, invalidateTableRefresh } = await import(
        "../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js"
    );
    invalidateTableRefresh(tableName);
    const { resetOffset, disconnectInfiniteScroll } = await import("../../infinite_scroll/infinite_scroll_handler.js");
    disconnectInfiniteScroll(tableName);
    resetOffset(tableName);
    const committedSearchTerm = String(params.search || "").trim();
    if (committedSearchTerm) {
        const { do_intelligent_search } = await import(
            "../text_search/dataset_search_executor.js"
        );
        await do_intelligent_search(tableName, committedSearchTerm);
        return true;
    }
    await refreshTableUnified(tableName, { skipUrlParams: true });
    return true;
}

function getFacetTitle(facet, language) {
    return resolveDatasetDisplayValue(facet?.title, { is_multilingual: true }, language)
        || getFacetFallbackTitle(facet.slug);
}

function bindRowGroupTagLabel(item, tableName, slug) {
    bindDatasetLanguageRenderer(item, (language) => {
        const facet = facetsByTable.get(tableName)?.find(value => value.slug === slug) || { slug };
        const headingTitle = facet.heading ? getFacetTitle(facet.heading, language) : getTranslationForKey("filters");
        const label = `${headingTitle}: ${getFacetTitle(facet, language)}`;
        item.querySelector(".row-group-filter-label").textContent = label;
        item.querySelector("button").setAttribute("aria-label", `${getTranslationForKey("remove")}: ${label}`);
    });
}

/** Print one removable tag per value in the existing active-filter container. */
export function renderRowGroupFilterTags(tableName, container) {
    const slugs = getSelectedSlugs(tableName);
    for (const slug of slugs) {
        const label = document.createElement("span");
        label.classList.add("row-group-filter-label");
        const { item } = buildActiveFilterChip({ label, onRemove: () => toggleRowGroupFacet(tableName, slug) });
        item.dataset.rowGroupTable = tableName;
        item.dataset.rowGroupSlug = slug;
        container.appendChild(item);
        bindRowGroupTagLabel(item, tableName, slug);
    }
    return slugs;
}

/**
 * Render first-page counts in the existing host, also for a searched listing.
 * Every readable value stays selectable when it has no matches.
 * Request owners opt into selection reconciliation only for a successful first
 * page and pass their freshness check and original filters. Cached renders
 * and omitted payloads cannot resolve or clear a selection.
 */
export function renderRowGroupFacets(
    tableName,
    rawFacets,
    { onToggle = toggleRowGroupFacet, onClear = clearRowGroupSelection, onModeChange = setRowGroupMatchMode,
        authoritative = false, isCurrent = () => true, requestFilters = null, resolvedSelection = null } = {}
) {
    const previousHost = document.getElementById(getFacetHostId(tableName));
    // A click can change filters before its asynchronous refresh starts. The
    // response must still match what it requested, as well as its generation.
    if (!isCurrent() || (requestFilters !== null
        && filterSignature(getUnifiedTableState(tableName).filters) !== filterSignature(requestFilters))) return previousHost;
    const facets = Array.isArray(rawFacets) ? rawFacets.map(normalizeFacet).filter(Boolean) : [];
    facetsByTable.set(tableName, facets);
    const selectionChanged = authoritative
        && reconcileResolvedRowGroupSelection(tableName, resolvedSelection, isCurrent);
    // Refresh existing tag labels too, including tags in an open article sidebar.
    if (selectionChanged) renderActiveFilters(tableName);
    else document.querySelectorAll("[data-row-group-table]").forEach(item => {
        if (item.dataset.rowGroupTable === tableName) bindRowGroupTagLabel(item, tableName, item.dataset.rowGroupSlug);
    });
    const topControls = document.getElementById(`${tableName}_card_top_controls`);
    if (!topControls || facets.length === 0) { clearRowGroupFacets(tableName); return null; }

    let host = previousHost;
    if (!host) {
        host = document.createElement("div");
        host.id = getFacetHostId(tableName);
        host.classList.add("row-group-facets");
        host.dataset.testid = "row-group-facets";
        host.dataset.ariaLabelLangKey = "row_group_categories";
        host.setAttribute("role", "region");
        topControls.insertBefore(host, topControls.querySelector(".active_filters, .results_count"));
        host.rowGroupCard = createRowGroupFacetCard({
            host, topControls, tableName, getSelectedSlugs, getSelectedModes, getFacetTitle,
        });
    }
    host.rowGroupCard.update(groupFacetsByHeading(facets), { onToggle, onClear, onModeChange });
    return host;
}
