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
        item.append(label, button);
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
    const panelState = previousHost?.rowGroupPanelState
        || { expanded: false, openHeading: null, searches: new Map() };
    const previousFocus = capturePanelFocus(previousHost);
    clearRowGroupFacets(tableName);
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
    if (!topControls || facets.length === 0) return null;

    const host = document.createElement("div");
    host.id = getFacetHostId(tableName);
    host.classList.add("row-group-facets");
    host.dataset.testid = "row-group-facets";
    host.dataset.ariaLabelLangKey = "row_group_categories";
    host.setAttribute("role", "region");
    // The shared view owns placement; searched refreshes reuse that same slot.
    topControls.insertBefore(host, topControls.querySelector(".active_filters, .results_count"));
    host.rowGroupPanelState = panelState;
    const groups = groupFacetsByHeading(facets);
    const headingKey = group => String(group.heading?.id ?? "legacy");
    if (!groups.some(group => headingKey(group) === panelState.openHeading)) panelState.openHeading = null;
    let chosenLanguage;

    function closePanel() {
        const wasOpen = panelState.openHeading;
        // A later heading can be visible only because it is open. Keep its
        // return-focus button available after the last selection is removed.
        const closingIndex = groups.findIndex(group => headingKey(group) === wasOpen);
        const selected = new Set(getSelectedSlugs(tableName));
        if (closingIndex >= VISIBLE_HEADING_LIMIT
            && !groups[closingIndex].values.some(facet => selected.has(facet.slug))) panelState.expanded = true;
        panelState.openHeading = null;
        render();
        [...host.querySelectorAll("[data-heading-id]")]
            .find(button => button.dataset.headingId === wasOpen)?.focus();
    }

    function updateEmptyHint() {
        const counter = topControls.querySelector(".results_count[data-result-count]")
            || document.getElementById(`${tableName}_results_count`);
        const count = counter?.dataset.resultCount;
        const hint = host.querySelector(".row-group-facets__empty-hint");
        if (hint) hint.hidden = count !== "0" || getSelectedSlugs(tableName).length === 0;
    }
    const primaryCount = document.getElementById(`${tableName}_results_count`);
    topControls.addEventListener("results-count-updated", updateEmptyHint);
    topControls.addEventListener("active-filters-updated", render);
    primaryCount?.addEventListener("results-count-updated", updateEmptyHint);
    host.disposeRowGroupPanel = () => {
        topControls.removeEventListener("results-count-updated", updateEmptyHint);
        topControls.removeEventListener("active-filters-updated", render);
        primaryCount?.removeEventListener("results-count-updated", updateEmptyHint);
    };
    host.addEventListener("keydown", event => {
        if (event.key === "Escape" && panelState.openHeading
            && host.querySelector(".row-group-facet-panel")?.contains(event.target)) {
            event.preventDefault();
            closePanel();
        }
    });

    function render() {
        const focus = capturePanelFocus(host);
        const activeSlugs = new Set(getSelectedSlugs(tableName));
        const activeModes = getSelectedModes(tableName);
        host.setAttribute("aria-label", getTranslationForKey("row_group_categories"));
        host.dataset.expanded = String(panelState.expanded);
        host.replaceChildren();

        const title = createPanelText("h2", "row_group_categories", "row-group-facets__title");
        const guidance = createPanelText("p", "row_group_categories_modes_hint", "row-group-facets__guidance");
        host.append(title, guidance);
        const headings = document.createElement("div");
        headings.className = "row-group-facet-headings";
        host.appendChild(headings);
        groups.filter((group, index) => panelState.expanded || index < VISIBLE_HEADING_LIMIT
            || group.values.some(facet => activeSlugs.has(facet.slug))
            || headingKey(group) === panelState.openHeading).forEach(group => {
            const key = headingKey(group);
            const button = document.createElement("button");
            button.type = "button";
            button.className = "row-group-facet-heading";
            button.id = `${host.id}_heading_${key}`;
            button.dataset.headingId = key;
            button.dataset.rowGroupFocus = `heading:${key}`;
            button.dataset.testid = "row-group-facet-heading";
            button.setAttribute("aria-expanded", String(panelState.openHeading === key));
            button.setAttribute("aria-controls", `${host.id}_panel`);
            const label = document.createElement("span");
            label.textContent = group.heading ? getFacetTitle(group.heading, chosenLanguage) : getTranslationForKey("filters");
            button.appendChild(label);
            const selectedCount = group.values.filter(facet => activeSlugs.has(facet.slug)).length;
            button.classList.toggle("has-selection", selectedCount > 0);
            if (selectedCount) {
                const badge = document.createElement("span");
                badge.className = "row-group-facet-heading__badge";
                badge.textContent = String(selectedCount);
                badge.setAttribute("aria-label", `${selectedCount} ${getTranslationForKey("row_group_selected_count")}`);
                button.appendChild(badge);
            }
            const caret = document.createElement("span");
            caret.setAttribute("aria-hidden", "true");
            caret.textContent = panelState.openHeading === key ? "▴" : "▾";
            button.appendChild(caret);
            button.addEventListener("click", () => {
                panelState.openHeading = panelState.openHeading === key ? null : key;
                render();
                host.querySelector(`#${button.id}`)?.focus();
            });
            headings.appendChild(button);
        });
        if (groups.length > VISIBLE_HEADING_LIMIT) {
            const more = createActionButton(panelState.expanded ? "show_less" : "show_more");
            more.dataset.rowGroupFocus = "more";
            more.setAttribute("aria-expanded", String(panelState.expanded));
            more.addEventListener("click", () => {
                panelState.expanded = !panelState.expanded;
                render();
                host.querySelector('[data-row-group-focus="more"]')?.focus();
            });
            headings.appendChild(more);
        }

        const panel = document.createElement("div");
        panel.className = "row-group-facet-panel";
        panel.id = `${host.id}_panel`;
        panel.hidden = panelState.openHeading === null;
        host.appendChild(panel);
        const group = groups.find(value => headingKey(value) === panelState.openHeading);
        if (group) {
            const key = headingKey(group);
            const panelHeading = document.createElement("div");
            panelHeading.className = "row-group-facet-panel__head";
            const heading = document.createElement("h3");
            heading.id = `${panel.id}_title`;
            heading.textContent = group.heading ? getFacetTitle(group.heading, chosenLanguage) : getTranslationForKey("filters");
            // A cross like the selected-filter tags; the translated word stays its accessible name and tooltip.
            const close = document.createElement("button");
            close.type = "button";
            close.className = "row-group-facet-action row-group-facet-panel__close";
            close.dataset.ariaLabelLangKey = "close";
            close.dataset.titleLangKey = "close";
            close.setAttribute("aria-label", getTranslationForKey("close"));
            close.title = getTranslationForKey("close");
            close.textContent = "×";
            close.dataset.rowGroupFocus = "close";
            close.addEventListener("click", closePanel);
            panelHeading.append(heading, close);
            const mode = activeModes[group.heading?.id ?? 0] || "any";
            const hint = createPanelText("p", group.heading?.is_single ? "row_group_single_value_hint"
                : mode === "all" ? "row_group_match_all_hint" : "row_group_match_any_hint", "row-group-facet-panel__hint");
            hint.id = `${panel.id}_hint`;
            panel.setAttribute("role", "group");
            panel.setAttribute("aria-labelledby", heading.id);
            panel.setAttribute("aria-describedby", hint.id);
            panel.appendChild(panelHeading);
            if (!group.heading?.is_single) {
                const fieldset = document.createElement("fieldset");
                fieldset.className = "row-group-facet-mode";
                fieldset.setAttribute("aria-describedby", hint.id);
                fieldset.appendChild(createPanelText("legend", "row_group_match_mode", "row-group-facet-mode__legend"));
                for (const value of ["any", "all"]) {
                    const label = document.createElement("label");
                    const radio = document.createElement("input");
                    radio.type = "radio";
                    radio.name = `${host.id}_mode_${key}`;
                    radio.value = value;
                    radio.checked = mode === value;
                    radio.dataset.rowGroupFocus = `mode:${key}:${value}`;
                    radio.dataset.testid = "row-group-match-mode";
                    radio.setAttribute("aria-describedby", hint.id);
                    radio.addEventListener("change", () => {
                        if (radio.checked) runSelection(() => onModeChange(tableName, group.heading?.id ?? 0, value));
                    });
                    label.append(radio, createPanelText("span", `row_group_match_${value}`, ""));
                    fieldset.appendChild(label);
                }
                panel.appendChild(fieldset);
            }
            const search = document.createElement("input");
            search.type = "search";
            search.className = "row-group-facet-panel__search";
            search.dataset.testid = "row-group-facet-search";
            search.dataset.rowGroupFocus = `search:${key}`;
            search.value = panelState.searches.get(key) || "";
            search.placeholder = getTranslationForKey("search");
            search.setAttribute("aria-label", `${heading.textContent}: ${getTranslationForKey("search")}`);
            const list = document.createElement("ul");
            list.className = "row-group-facet-values";
            const empty = createPanelText("p", "row_group_no_name_matches", "row-group-facet-panel__hint");
            empty.setAttribute("role", "status");
            function renderValues() {
                list.replaceChildren();
                const query = search.value.trim().toLocaleLowerCase(chosenLanguage);
                group.values.filter(facet => getFacetTitle(facet, chosenLanguage).toLocaleLowerCase(chosenLanguage).includes(query))
                    .forEach(facet => {
                        const item = document.createElement("li");
                        const label = document.createElement("label");
                        label.className = "row-group-facet-value";
                        label.classList.toggle("is-zero-hit", facet.zero_hit);
                        const checkbox = document.createElement("input");
                        checkbox.type = "checkbox";
                        checkbox.dataset.rowGroupSlug = facet.slug;
                        checkbox.dataset.rowGroupFocus = `value:${facet.slug}`;
                        checkbox.dataset.testid = "row-group-facet-checkbox";
                        checkbox.checked = activeSlugs.has(facet.slug);
                        checkbox.disabled = !checkbox.checked && activeSlugs.size >= SELECTION_LIMIT;
                        checkbox.setAttribute("aria-describedby", hint.id);
                        checkbox.setAttribute("aria-label", `${getFacetTitle(facet, chosenLanguage)}: ${facet.row_count}`);
                        const name = document.createElement("span");
                        name.className = "row-group-facet-value__name";
                        name.textContent = getFacetTitle(facet, chosenLanguage);
                        const count = document.createElement("span");
                        count.className = "row-group-facet-value__count";
                        count.textContent = String(facet.row_count);
                        count.setAttribute("aria-hidden", "true");
                        checkbox.addEventListener("change", () => runSelection(() => onToggle(tableName, facet.slug)));
                        label.append(checkbox, name, count);
                        item.appendChild(label);
                        list.appendChild(item);
                    });
                empty.hidden = list.childElementCount > 0;
            }
            search.addEventListener("input", () => {
                panelState.searches.set(key, search.value);
                renderValues();
            });
            search.addEventListener("search", () => {
                panelState.searches.set(key, search.value);
                renderValues();
            });
            panel.append(hint, search, list, empty);
            renderValues();
        }
        if (activeSlugs.size >= SELECTION_LIMIT) {
            host.appendChild(createPanelText("p", "row_group_selection_limit", "row-group-facet-panel__hint"));
        }
        if (activeSlugs.size || Object.keys(activeModes).length) {
            const clear = createActionButton("clear_selections");
            clear.dataset.rowGroupFocus = "clear-categories";
            clear.addEventListener("click", () => runSelection(() => onClear(tableName)));
            host.appendChild(clear);
        }
        const emptyHint = createPanelText("p", "row_group_no_results_hint", "row-group-facets__empty-hint");
        emptyHint.setAttribute("role", "status");
        host.appendChild(emptyHint);
        updateEmptyHint();
        restorePanelFocus(host, focus);
    }

    bindDatasetLanguageRenderer(host, language => {
        chosenLanguage = language;
        render();
    });
    restorePanelFocus(host, previousFocus);

    async function runSelection(action) {
        if (host.getAttribute("aria-busy") === "true") { render(); return; }
        host.setAttribute("aria-busy", "true");
        try {
            await action();
        } finally {
            host.removeAttribute("aria-busy");
            if (host.isConnected) render();
        }
    }
    return host;
}

function createPanelText(tag, key, className) {
    const element = document.createElement(tag);
    element.className = className;
    element.dataset.langKey = key;
    element.textContent = getTranslationForKey(key);
    return element;
}

function createActionButton(key) {
    const button = createPanelText("button", key, "row-group-facet-action");
    button.type = "button";
    return button;
}

// Rebuilds happen on language changes and first-page refreshes; retain the
// disclosure, local query, caret, focused control and list scroll position.
function capturePanelFocus(host) {
    const active = document.activeElement;
    return {
        key: host?.contains(active) ? active.dataset.rowGroupFocus : null,
        start: active?.selectionStart,
        end: active?.selectionEnd,
        scrollTop: host?.querySelector(".row-group-facet-values")?.scrollTop || 0,
    };
}

function restorePanelFocus(host, focus) {
    const list = host.querySelector(".row-group-facet-values");
    if (list) list.scrollTop = focus?.scrollTop || 0;
    const target = [...host.querySelectorAll("[data-row-group-focus]")]
        .find(element => element.dataset.rowGroupFocus === focus?.key);
    target?.focus();
    if (target?.type === "search" && focus.start != null) target.setSelectionRange(focus.start, focus.end);
}
