// row_group_facet_printer.js
// Renders localized row-group facets and applies group selections as a normal dataset filter.
// Bridges get-results facet metadata, unified table state, route params, and shared view refreshes.
// Exists so every dataset view gets the same safe, centered group-filter controls.

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

export const ROW_GROUP_FILTER_KEY = "row_group";
const VISIBLE_FACET_LIMIT = 12;
const VISIBLE_HEADING_LIMIT = 3;
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
        || (rowCount === 0 && facet?.selected !== true)
    ) {
        return null;
    }
    return {
        id,
        slug,
        title: facet?.title ?? null,
        row_count: rowCount,
        selected: facet?.selected === true,
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
    document.getElementById(getFacetHostId(tableName))?.remove();
}

function getSelectedSlugs(tableName) {
    const value = getUnifiedTableState(tableName)?.filters?.[ROW_GROUP_FILTER_KEY] || "";
    return [...new Set(String(value).split(",").map(slug => slug.trim()).filter(slug => SAFE_ROW_GROUP_SLUG.test(slug)))].sort();
}

function filterSignature(filters) {
    return JSON.stringify(Object.entries(filters || {}).sort(([a], [b]) => a.localeCompare(b)));
}

// Only a current successful first page can resolve the selection. Selected
// values (including zero counts) precede the server's cap, so none are lost.
// This records the answer without resetting paging or starting another fetch.
function reconcileResolvedRowGroupSelection(tableName, facets, isCurrent) {
    const selection = [...new Set(facets.filter(facet => facet.selected).map(facet => facet.slug))].sort().join(",");
    const state = getUnifiedTableState(tableName);
    const params = getParams(tableName);
    if ((state.filters?.[ROW_GROUP_FILTER_KEY] || "") === selection
        && (params[ROW_GROUP_FILTER_KEY] || "") === selection) return false;

    const previousSearchContext = getSearchFilterContext(tableName);
    const filters = { ...(state.filters || {}) };
    if (selection) {
        filters[ROW_GROUP_FILTER_KEY] = selection;
        params[ROW_GROUP_FILTER_KEY] = selection;
    } else {
        delete filters[ROW_GROUP_FILTER_KEY];
        delete params[ROW_GROUP_FILTER_KEY];
    }
    setUnifiedTableState(tableName, { filters });
    setParams(tableName, params);
    // The answer describes the same search and rows under the server's resolved
    // selection. Adopt it synchronously before either owner checks its signature.
    adoptResolvedSearchRowGroupSelection(tableName, previousSearchContext);
    rekeyLoadedDatasetRows(tableName, state.filters);
    // The address owner replaces the settled entry and keeps article paths,
    // hashes and navigation state. Its microtask also rejects a later departure.
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
    return applyRowGroupSelection(tableName, []);
}

async function applyRowGroupSelection(tableName, selection) {
    const filters = { ...(getUnifiedTableState(tableName).filters || {}) };
    if (selection.length) {
        filters[ROW_GROUP_FILTER_KEY] = selection.join(",");
    } else {
        delete filters[ROW_GROUP_FILTER_KEY];
    }
    setUnifiedTableState(tableName, { filters, offset: 0 });

    const params = getParams(tableName);
    delete params.offset;
    if (selection.length) {
        params[ROW_GROUP_FILTER_KEY] = selection.join(",");
    } else {
        delete params[ROW_GROUP_FILTER_KEY];
    }
    setParams(tableName, params);
    updateURL(tableName, params);

    // Search reloads replace rows only, so update tags at the selection boundary too.
    const { renderActiveFilters } = await import("./active_filter_tag_printer.js");
    renderActiveFilters(tableName);
    const { refreshTableUnified } = await import(
        "../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js"
    );
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
        const item = document.createElement("div");
        item.classList.add("active-filter-item");
        item.dataset.testid = "active-filter-item";
        item.dataset.rowGroupTable = tableName;
        item.dataset.rowGroupSlug = slug;
        const button = document.createElement("button");
        button.type = "button";
        button.classList.add("remove-active-filter");
        button.dataset.testid = "active-filter-remove";
        button.textContent = "×";
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            void toggleRowGroupFacet(tableName, slug);
        });
        const label = document.createElement("span");
        label.classList.add("row-group-filter-label");
        item.append(button, label);
        container.appendChild(item);
        bindRowGroupTagLabel(item, tableName, slug);
    }
    return slugs;
}

/**
 * Render first-page counts in the existing host, also for a searched listing.
 * A selected value with no matches stays available for removal.
 * Request owners opt into selection reconciliation only for a successful first
 * page and pass their freshness check and original filters. Cached renders
 * and omitted payloads cannot resolve or clear a selection.
 */
export function renderRowGroupFacets(
    tableName,
    rawFacets,
    { onToggle = toggleRowGroupFacet, onClear = clearRowGroupSelection,
        authoritative = false, isCurrent = () => true, requestFilters = null } = {}
) {
    const previousHost = document.getElementById(getFacetHostId(tableName));
    // A click can change filters before its asynchronous refresh starts. The
    // response must still match what it requested, as well as its generation.
    if (!isCurrent() || (requestFilters !== null
        && filterSignature(getUnifiedTableState(tableName).filters) !== filterSignature(requestFilters))) return previousHost;
    let expanded = previousHost?.dataset.expanded === "true";
    const focusedSlug = previousHost?.contains(document.activeElement)
        ? document.activeElement?.dataset.rowGroupSlug : null;
    clearRowGroupFacets(tableName);
    const facets = Array.isArray(rawFacets) ? rawFacets.map(normalizeFacet).filter(Boolean) : [];
    facetsByTable.set(tableName, facets);
    const selectionChanged = authoritative && Array.isArray(rawFacets)
        && reconcileResolvedRowGroupSelection(tableName, facets, isCurrent);
    // Active tags are printed before facets by the shared view. Refresh their
    // labels now, including tags in an open article's sidebar.
    if (selectionChanged) renderActiveFilters(tableName);
    else document.querySelectorAll("[data-row-group-table]").forEach(item => {
        if (item.dataset.rowGroupTable === tableName) bindRowGroupTagLabel(item, tableName, item.dataset.rowGroupSlug);
    });
    const topControls = document.getElementById(`${tableName}_card_top_controls`);
    if (!topControls || facets.length === 0) return null;

    const host = document.createElement("div");
    host.id = getFacetHostId(tableName);
    host.classList.add("row-group-facets");
    host.dataset.testid = "row-group-facets";
    host.dataset.ariaLabelLangKey = "row_group_categories";
    host.setAttribute("role", "region");
    topControls.appendChild(host);

    bindDatasetLanguageRenderer(host, (chosenLanguage) => {
        const render = () => {
            const activeSlugs = new Set(getSelectedSlugs(tableName));
            host.setAttribute("aria-label", getTranslationForKey("row_group_categories"));
            host.dataset.expanded = String(expanded);
            host.replaceChildren();

            const ribbonTitle = document.createElement("div");
            ribbonTitle.classList.add("row-group-facets__title");
            ribbonTitle.dataset.langKey = "row_group_categories";
            ribbonTitle.textContent = getTranslationForKey("row_group_categories");
            host.appendChild(ribbonTitle);
            const groups = groupFacetsByHeading(facets);
            const isSelected = facet => activeSlugs.has(facet.slug) || facet.selected;
            // A selected heading or value remains reachable when collapsed.
            groups.filter((group, index) => expanded || index < VISIBLE_HEADING_LIMIT || group.values.some(isSelected))
                .forEach(({ heading, values }) => {
                    const group = document.createElement("div");
                    group.classList.add("row-group-facet-group");
                    group.setAttribute("role", "group");
                    group.dataset.headingId = String(heading?.id ?? "");
                    const headingTitle = heading ? getFacetTitle(heading, chosenLanguage) : getTranslationForKey("filters");
                    group.setAttribute("aria-label", headingTitle);
                    if (heading) {
                        const title = document.createElement("div");
                        title.classList.add("row-group-facet-group__title");
                        title.textContent = headingTitle;
                        group.appendChild(title);
                    }
                    values.filter((facet, index) => expanded || index < VISIBLE_FACET_LIMIT || isSelected(facet))
                        .forEach((facet) => {
                            const title = getFacetTitle(facet, chosenLanguage);
                            const button = document.createElement("button");
                            button.type = "button";
                            button.classList.add("row-group-facet-chip");
                            button.classList.toggle("row-group-facet-chip--active", activeSlugs.has(facet.slug));
                            button.dataset.rowGroupSlug = facet.slug;
                            button.dataset.testid = "row-group-facet-chip";
                            button.setAttribute("aria-pressed", String(activeSlugs.has(facet.slug)));
                            button.setAttribute("aria-label", `${title}: ${facet.row_count}`);
                            button.disabled = !activeSlugs.has(facet.slug) && activeSlugs.size >= SELECTION_LIMIT;

                            const label = document.createElement("span");
                            label.classList.add("row-group-facet-chip__label");
                            label.textContent = title;
                            const count = document.createElement("span");
                            count.classList.add("row-group-facet-chip__count");
                            count.textContent = String(facet.row_count);
                            count.setAttribute("aria-hidden", "true");
                            button.append(label, count);
                            button.addEventListener("click", () => runSelection(() => onToggle(tableName, facet.slug)));
                            group.appendChild(button);
                        });
                    host.appendChild(group);
                });

            if (groups.length > VISIBLE_HEADING_LIMIT || groups.some(group => group.values.length > VISIBLE_FACET_LIMIT)) {
                const more = createActionButton(expanded ? "show_less" : "show_more");
                more.setAttribute("aria-expanded", String(expanded));
                more.addEventListener("click", () => {
                    expanded = !expanded;
                    render();
                    host.querySelector('[aria-expanded]')?.focus();
                });
                host.appendChild(more);
            }
            if (activeSlugs.size) {
                const clear = createActionButton("clear_selections");
                clear.addEventListener("click", () => runSelection(() => onClear(tableName)));
                host.appendChild(clear);
            }
        };
        render();
    });
    if (focusedSlug) {
        [...host.querySelectorAll("[data-row-group-slug]")].find(button => button.dataset.rowGroupSlug === focusedSlug)?.focus();
    }

    async function runSelection(action) {
        if (host.getAttribute("aria-busy") === "true") return;
        host.setAttribute("aria-busy", "true");
        try {
            await action();
        } finally {
            host.removeAttribute("aria-busy");
        }
    }
    return host;
}

function createActionButton(key) {
    const button = document.createElement("button");
    button.type = "button";
    button.classList.add("row-group-facet-chip");
    button.dataset.langKey = key;
    button.textContent = getTranslationForKey(key);
    return button;
}
