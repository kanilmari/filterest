// dataset_search_executor.js
// Runs streaming intelligent search, appends rows to active views, and keeps results counters in sync.
// Bridges text and AI search phases, inserting stage notices and rendering each phase into separate tables.
// Exists to isolate streaming execution and UI-update behaviour from component building.

import { appendDataToView, disconnectInfiniteScroll } from "../../infinite_scroll/infinite_scroll_handler.js";
import { appendDataToTable } from "../../table_views/table_view/table_row_printer.js";
import { appendDataToCardView } from "../../table_views/card_view/card_view_printer.js";
import { getUnifiedTableState, setUnifiedTableState } from "../../state_stores/table_state_store.js";
import { readDatasetSearchResponse } from "./dataset_search_response_reader.js";
import { getTranslationForKey } from "../../lang/translation_handler.js";
import { getLanguageWithBrowserFallback } from "../../state_stores/lang_preference_reader.js";
import {
    clearRowGroupFacets,
} from "../filter_list/row_group_facet_printer.js";
import {
    deduplicateRows,
    filterRows,
    initSearchCache,
} from "./dataset_search_executor_helpers.js";
import {
    getCurrentSearchView,
    getPrimaryCardContainer,
    getSearchAiHostId,
    getSearchFilterContext,
    getSearchStageContainer,
    getSearchViewContainer,
    getVisibleSearchCounts,
    isCurrentSearchCache,
    ongoingSearchResultsStore,
    removeSearchNotice,
    syncSearchResultsCount,
    syncSearchPresentationFilters,
    getSearchPresentationRows,
} from "./dataset_search_runtime_state.js";

export const _ongoingSearchResults = ongoingSearchResultsStore;

async function renderRowsIntoTarget(
    tableName,
    targetHost,
    rows,
    columns,
    dataTypes,
    expectedCache = null
) {
    if (!isCurrentSearchCache(tableName, expectedCache)) {
        return false;
    }
    if (!targetHost) {
        appendDataToView(tableName, rows, true);
        return true;
    }

    if (
        targetHost.classList?.contains("card_container") ||
        targetHost.classList?.contains("search-ai-results-card-container")
    ) {
        if (!expectedCache) {
            await appendDataToCardView(targetHost, columns, rows, tableName);
            return true;
        }

        // Card construction awaits metadata and image work. Build into a
        // detached host so a replaced search cannot append its old rows after
        // the newer search has already cleared and repopulated the live view.
        const stagingHost = document.createElement("div");
        stagingHost.className = targetHost.className;
        await appendDataToCardView(stagingHost, columns, rows, tableName);
        if (!isCurrentSearchCache(tableName, expectedCache)) {
            return false;
        }

        const fragment = document.createDocumentFragment();
        fragment.append(...Array.from(stagingHost.childNodes));
        const sentinel = targetHost.querySelector(
            `#${tableName}_infinite_scroll_sentinel`
        );
        targetHost.insertBefore(fragment, sentinel || null);
        return true;
    }

    appendDataToTable(targetHost, rows, columns, dataTypes, tableName);
    return true;
}

function findRenderedCardForRow(tableName, row) {
    const rowId = row?.id;
    if (rowId == null) {
        return null;
    }

    return Array.from(
        document.querySelectorAll(`#${tableName}_${getCurrentSearchView(tableName)}_view_container .card[data-id]`)
    ).find((card) => String(card.dataset.id) === String(rowId)) || null;
}

async function openFirstPendingSearchArticle(
    tableName,
    rowsToRender,
    expectedCache = null
) {
    const expectedView = getCurrentSearchView(tableName);
    const isCurrent = () => isCurrentSearchCache(tableName, expectedCache)
        && getCurrentSearchView(tableName) === expectedView;
    if (!isCurrent()) {
        return;
    }
    if (!["card", "article_view"].includes(getCurrentSearchView(tableName))) {
        return;
    }
    if (!Array.isArray(rowsToRender) || rowsToRender.length === 0) {
        return;
    }

    if (!isCurrent()) {
        return;
    }
    const state = getUnifiedTableState(tableName);
    const stateKey = getCurrentSearchView(tableName) === "article_view" ? "articleView" : "cardView";
    const cardState = state?.[stateKey] || {};
    if (
        expectedCache?.complete === false ||
        !cardState.pendingAutoOpenFirstSearchResult ||
        cardState.collapsed !== true ||
        cardState.expandedId != null
    ) {
        return;
    }

    const firstRow = rowsToRender.find((row) => row?.id != null) || rowsToRender[0];
    if (!firstRow) {
        return;
    }

    const { openRowArticleView } = await import(
        "../../table_views/card_view/row_article_opener.js"
    );
    if (!isCurrent()) {
        return;
    }

    setUnifiedTableState(tableName, {
        [stateKey]: {
            ...cardState,
            collapsed: true,
            expandedId: firstRow.id ?? null,
            pendingAutoOpenFirstSearchResult: false,
        },
    });
    const selectedCard = findRenderedCardForRow(tableName, firstRow);
    await openRowArticleView(firstRow, tableName, selectedCard, { isCurrent });
}

export async function update_table_ui(tableName, incoming, targetTable, expectedCache = null) {
    const inColumns = Array.isArray(incoming?.columns) ? incoming.columns : [];
    const inData = Array.isArray(incoming?.data) ? incoming.data : [];
    const incomingTypes = incoming?.types || {};
    let cache = _ongoingSearchResults[tableName];
    if (expectedCache && cache !== expectedCache) {
        return 0;
    }
    if (!cache) {
        cache = initSearchCache();
        _ongoingSearchResults[tableName] = cache;
    }

    if (incoming?.filters_applied === true) cache.serverFiltersApplied = true;
    syncSearchPresentationFilters(tableName, cache);
    cache.types = { ...(cache.types || {}), ...incomingTypes };
    if (inColumns.length) cache.columns = inColumns;

    // Determine which data pool to deduplicate against (text vs AI)
    const isAi = incoming?.stage === "ai" || Boolean(targetTable);
    const dataPool = isAi ? cache.aiData : cache.data;

    const rawNewRows = deduplicateRows(
        cache.data,
        cache.aiData,
        inData,
        cache.columns
    );
    if (rawNewRows.length) {
        dataPool.push(...rawNewRows);
    }

    const rowsToRender = getSearchPresentationRows(tableName, cache, rawNewRows);

    if (targetTable) {
        // Render directly into the specified secondary results host (AI results).
        const columns = cache.columns;
        const dataTypes = cache.types;
        const committed = await renderRowsIntoTarget(
            tableName,
            targetTable,
            rowsToRender,
            columns,
            dataTypes,
            expectedCache
        );
        if (!committed) return 0;
    } else {
        // Default: render into the primary table via appendDataToView
        const isFirstRender = cache.renderedOnce !== true;
        if (["card", "article_view"].includes(getCurrentSearchView(tableName))) {
            const committed = await renderRowsIntoTarget(
                tableName,
                getPrimaryCardContainer(tableName),
                rowsToRender,
                cache.columns,
                cache.types,
                expectedCache
            );
            if (!committed) return 0;
        } else {
            if (!isCurrentSearchCache(tableName, expectedCache)) return 0;
            appendDataToView(tableName, rowsToRender, !isFirstRender ? true : false);
        }
        cache.renderedOnce = true;
    }

    if (!isCurrentSearchCache(tableName, expectedCache)) return 0;
    if (!isAi) await openFirstPendingSearchArticle(tableName, rowsToRender, expectedCache);
    if (!isCurrentSearchCache(tableName, expectedCache)) return 0;
    syncSearchResultsCount(tableName, cache);
    return rowsToRender.length;
}

/**
 * Insert a notice element between search result sections.
 * For table view: creates a <div> after the table (not a <tr> inside tbody),
 * so it doesn't break row indexing or editing.
 */
export function insertNotice(tableName, langKey, fallbackText) {
    const currentView = getCurrentSearchView(tableName);
    const stageContainer = getSearchStageContainer(tableName, currentView);
    if (!stageContainer) return;

    // Remove any previous notice with the same langKey to prevent duplicates.
    removeSearchNotice(tableName, langKey);

    const notice = document.createElement("div");
    notice.classList.add("search-stage-notice");
    notice.dataset.langKey = langKey;
    notice.setAttribute("role", "status");
    notice.textContent = fallbackText;

    // Explain relaxed user filters before their results, including the card
    // sidebar count. Text/AI stage notices keep their existing section positions.
    if (langKey === "search_results_without_filters") {
        stageContainer.prepend(notice);
        return;
    }

    if (currentView === "table") {
        const aiTable = stageContainer.querySelector(
            `#${getSearchAiHostId(tableName, currentView)}`
        );
        if (aiTable) {
            stageContainer.insertBefore(notice, aiTable);
            return;
        }

        stageContainer.appendChild(notice);
    } else if (["card", "article_view"].includes(currentView)) {
        const primaryCardContainer = getPrimaryCardContainer(tableName);
        const aiCardContainer = stageContainer.querySelector(
            `#${getSearchAiHostId(tableName, currentView)}`
        );
        if (aiCardContainer) {
            stageContainer.insertBefore(notice, aiCardContainer);
            return;
        }

        if (primaryCardContainer?.nextSibling) {
            stageContainer.insertBefore(notice, primaryCardContainer.nextSibling);
            return;
        }

        stageContainer.appendChild(notice);
        return;
    }

    const sentinel = stageContainer.querySelector(
        `#${tableName}_infinite_scroll_sentinel`
    );
    if (sentinel) {
        stageContainer.insertBefore(notice, sentinel);
    } else {
        stageContainer.appendChild(notice);
    }
}

/**
 * Creates a second search results table (for AI/embedding results) without
 * column header names, matching the column structure of the primary table.
 * Returns the <table> element, or null if not in table view.
 */
function createSecondSearchTable(tableName) {
    const currentView = localStorage.getItem(`${tableName}_view`) || "table";
    if (currentView !== "table") return null;

    const container = document.getElementById(
        `${tableName}_table_view_container`
    );
    if (!container) return null;

    const primaryTable = container.querySelector("table");
    if (!primaryTable) return null;

    // Remove previous second table if it exists
    const oldTable = container.querySelector(`#${tableName}_search_ai_table`);
    if (oldTable) oldTable.remove();

    const columns = JSON.parse(primaryTable.dataset.columns || "[]");
    const dataTypes = JSON.parse(primaryTable.dataset.dataTypes || "{}");

    const table = document.createElement("table");
    table.classList.add("table_from_db", "search-ai-results-table");
    table.id = `${tableName}_search_ai_table`;
    table.dataset.columns = JSON.stringify(columns);
    table.dataset.dataTypes = JSON.stringify(dataTypes);

    // Create colgroup matching primary table
    const colgroup = document.createElement("colgroup");
    // Numbering column
    const numberingCol = document.createElement("col");
    colgroup.appendChild(numberingCol);
    // Checkbox column
    const checkboxCol = document.createElement("col");
    colgroup.appendChild(checkboxCol);
    // Data columns
    columns.forEach(() => {
        colgroup.appendChild(document.createElement("col"));
    });
    table.appendChild(colgroup);

    // Empty thead (no column names, as requested by ticket)
    const thead = document.createElement("thead");
    table.appendChild(thead);

    // Empty tbody for data
    const tbody = document.createElement("tbody");
    tbody.id = `${tableName}_search_ai_table_body`;
    table.appendChild(tbody);

    container.appendChild(table);
    return table;
}

function createSecondSearchCardContainer(tableName) {
    const currentView = getCurrentSearchView(tableName);
    if (!["card", "article_view"].includes(currentView)) return null;

    const sidebarPanel = getSearchStageContainer(tableName, currentView);
    const primaryCardContainer = getPrimaryCardContainer(tableName);
    if (!sidebarPanel || !primaryCardContainer) return null;

    const existing = sidebarPanel.querySelector(
        `#${getSearchAiHostId(tableName, currentView)}`
    );
    if (existing) return existing;

    const cardContainer = document.createElement("div");
    cardContainer.classList.add("card_container", "search-ai-results-card-container");
    cardContainer.id = getSearchAiHostId(tableName, currentView);

    if (primaryCardContainer.nextSibling) {
        sidebarPanel.insertBefore(cardContainer, primaryCardContainer.nextSibling);
    } else {
        sidebarPanel.appendChild(cardContainer);
    }

    return cardContainer;
}

function createSecondSearchResultsHost(tableName) {
    const currentView = getCurrentSearchView(tableName);
    if (currentView === "table") {
        return createSecondSearchTable(tableName);
    }

    if (["card", "article_view"].includes(currentView)) {
        return createSecondSearchCardContainer(tableName);
    }

    return null;
}

/**
 * Cleans up the second search table and notice divs from a previous search.
 */
function cleanupSearchArtifacts(tableName) {
    const currentView = getCurrentSearchView(tableName);
    const stageContainer = getSearchStageContainer(tableName, currentView);
    if (stageContainer) {
        const oldAiHost = stageContainer.querySelector(
            `#${getSearchAiHostId(tableName, currentView)}`
        );
        if (oldAiHost) oldAiHost.remove();
        stageContainer
            .querySelectorAll(".search-stage-notice")
            .forEach((el) => el.remove());
    }

    if (currentView === "table") {
        const container = getSearchViewContainer(tableName, currentView);
        const primaryTable = container?.querySelector("table");
        if (primaryTable) {
            const tbody = primaryTable.querySelector("tbody");
            if (tbody) tbody.replaceChildren();
        }
    }

    // Clear card view container
    if (["card", "article_view"].includes(currentView)) {
        const cardContainer = getPrimaryCardContainer(tableName);
        if (cardContainer) {
            // Remove cards but keep the sentinel
            const sentinel = cardContainer.querySelector(
                `#${tableName}_infinite_scroll_sentinel`
            );
            cardContainer.replaceChildren();
            if (sentinel) cardContainer.appendChild(sentinel);
        }
    }
}

export async function rerenderCachedSearchResults(tableName, expectedCache = null) {
    const cache = _ongoingSearchResults[tableName];
    if (!cache || !isCurrentSearchCache(tableName, expectedCache)) return;
    if (cache.serverFiltersApplied && getSearchFilterContext(tableName).signature !== cache.filterSignature) {
        await do_intelligent_search(tableName, cache.query, cache.searchOptions || {});
        return;
    }

    syncSearchPresentationFilters(tableName, cache);
    cleanupSearchArtifacts(tableName);

    const visibleTextRows = getSearchPresentationRows(tableName, cache, cache.data);
    const visibleAiRows = getSearchPresentationRows(tableName, cache, cache.aiData);

    if (["card", "article_view"].includes(getCurrentSearchView(tableName))) {
        if (!await renderRowsIntoTarget(tableName, getPrimaryCardContainer(tableName), visibleTextRows, cache.columns, cache.types, cache)) return;
    } else {
        appendDataToView(tableName, visibleTextRows, false);
    }
    cache.renderedOnce = true;
    if (cache.fallbackWithoutFilters) {
        const fi = String(getLanguageWithBrowserFallback()).toLowerCase().startsWith("fi");
        const fallback = fi
            ? "Valituilla suodattimilla ei löytynyt tekstiosumia. Näytetään tulokset ilman suodattimia. Valinnat säilyvät seuraavaa hakua varten."
            : "No text matches with the selected filters. Showing results without filters. Your selections are kept for the next search.";
        insertNotice(tableName, "search_results_without_filters", getTranslationForKey("search_results_without_filters", { fallback }) || fallback);
    }

    const aiHost = createSecondSearchResultsHost(tableName);
    const supportsSeparateAiSection = Boolean(aiHost);

    if (visibleAiRows.length > 0) {
        if (supportsSeparateAiSection) {
            if (visibleTextRows.length === 0) {
                insertNotice(
                    tableName,
                    "text_search_no_results",
                    "Text search returned no results"
                );
            }
            insertNotice(tableName, "see_also", "See also");
            await renderRowsIntoTarget(
                tableName,
                aiHost,
                visibleAiRows,
                cache.columns,
                cache.types,
                cache
            );
        } else {
            appendDataToView(tableName, visibleAiRows, visibleTextRows.length > 0);
        }
    } else if (visibleTextRows.length === 0) {
        insertNotice(
            tableName,
            "text_search_no_results",
            "Text search returned no results"
        );
    }

    if (!isCurrentSearchCache(tableName, cache)) return;
    await openFirstPendingSearchArticle(tableName, visibleTextRows, cache);
    if (isCurrentSearchCache(tableName, cache)) syncSearchResultsCount(tableName, cache);
}

export function getCachedSearchResultForRender(tableName, { query = null } = {}) {
    const cache = _ongoingSearchResults[tableName];
    if (!cache || (query !== null && cache.query !== String(query).trim())
        || (cache.serverFiltersApplied && getSearchFilterContext(tableName).signature !== cache.filterSignature)) {
        return null;
    }

    syncSearchPresentationFilters(tableName, cache);
    const visibleTextRows = getSearchPresentationRows(tableName, cache, cache.data);
    const visibleAiRows = getSearchPresentationRows(tableName, cache, cache.aiData);
    const data = [...visibleTextRows, ...visibleAiRows];

    return {
        columns: Array.isArray(cache.columns) ? [...cache.columns] : [],
        data,
        types: { ...(cache.types || {}) },
        row_count: data.length,
        complete: cache.complete !== false,
        requestIdentity: cache,
        isCurrent: () => isCurrentSearchCache(tableName, cache),
    };
}

export function hasCachedSearchResults(tableName) {
    const cache = _ongoingSearchResults[tableName];
    if (!cache) {
        return false;
    }

    return (
        (Array.isArray(cache.data) && cache.data.length > 0) ||
        (Array.isArray(cache.aiData) && cache.aiData.length > 0)
    );
}

export async function sortCachedSearchResults(
    tableName,
    { sortColumn = "", sortOrder = "" } = {}
) {
    const cache = _ongoingSearchResults[tableName];
    const column = String(sortColumn || "").trim();
    const direction = String(sortOrder || "").trim().toUpperCase();
    if (!cache || (column && !["ASC", "DESC"].includes(direction))) {
        return false;
    }

    // Keep cache order as original relevance; sort only the rendered projection.
    await rerenderCachedSearchResults(tableName, cache);
    return true;
}


/**
 * Search selected filters first, then show authorized text matches without them.
 * The fallback owns only presentation state; selected filters and URL stay intact.
 * A new cache identity invalidates every delayed stream, fallback and article open.
 */
export async function do_intelligent_search(tableName, userQuery, opts = {}) {
    if (!userQuery.trim()) return;
    clearRowGroupFacets(tableName);
    disconnectInfiniteScroll(tableName);
    cleanupSearchArtifacts(tableName);
    const context = getSearchFilterContext(tableName);
    const cache = initSearchCache();
    Object.assign(cache, {
        query: userQuery.trim(), filterSignature: context.signature,
        filters: context.clientFilters, complete: false, fallbackWithoutFilters: false,
        searchOptions: opts, serverFiltersApplied: false,
    });
    _ongoingSearchResults[tableName] = cache;
    const stateKey = getCurrentSearchView(tableName) === "article_view" ? "articleView" : "cardView";
    const articleState = getUnifiedTableState(tableName)?.[stateKey];
    if (["card", "article_view"].includes(getCurrentSearchView(tableName)) && articleState?.collapsed) {
        setUnifiedTableState(tableName, { [stateKey]: {
            ...articleState, expandedId: null,
            pendingAutoOpenFirstSearchResult: true, pendingAutoOpenFirstRenderedResult: false,
        } });
    }
    syncSearchResultsCount(tableName, cache);
    const isCurrent = () => isCurrentSearchCache(tableName, cache);
    const requestOptions = { ...opts, filters: Object.fromEntries(Object.entries(context.clientFilters).map(([key, value]) => [key, String(value)])), rowGroupSlug: context.rowGroupSlug, view: getCurrentSearchView(tableName) };
    try {
        for await (const packet of readDatasetSearchResponse(tableName, cache.query, requestOptions, isCurrent)) {
            if (!isCurrent()) return;
            const aiHost = packet.stage === "ai" ? createSecondSearchResultsHost(tableName) : null;
            await update_table_ui(tableName, packet, aiHost, cache);
        }
        if (!isCurrent()) return;
        const hasFilters = Object.keys(context.clientFilters).length > 0 || Boolean(context.rowGroupSlug);
        const visibleText = cache.serverFiltersApplied ? cache.data : filterRows(cache.data, context.clientFilters, tableName, cache.types);
        if (hasFilters && visibleText.length === 0) {
            // Membership is a user-selected classification. Both requests retain
            // the same actor, route permission, row policy and server-side RLS.
            if (cache.serverFiltersApplied || context.rowGroupSlug) {
                const candidate = initSearchCache();
                for await (const packet of readDatasetSearchResponse(
                    tableName, cache.query, { ...requestOptions, rowGroupSlug: "", filters: {} }, isCurrent
                )) {
                    const rows = deduplicateRows(candidate.data, candidate.aiData, packet.data, packet.columns);
                    (packet.stage === "ai" ? candidate.aiData : candidate.data).push(...rows);
                    if (packet.columns?.length) candidate.columns = packet.columns;
                    candidate.types = { ...candidate.types, ...packet.types };
                }
                if (!isCurrent()) return;
                if (candidate.data.length > 0 && getSearchFilterContext(tableName).signature === context.signature) {
                    Object.assign(cache, {
                        data: candidate.data, aiData: candidate.aiData,
                        columns: candidate.columns, types: candidate.types,
                        fallbackWithoutFilters: true, serverFiltersApplied: true,
                    });
                }
            }
        }
        if (!isCurrent()) return;
        cache.complete = true;
        await rerenderCachedSearchResults(tableName, cache);
    } catch (error) {
        if (isCurrent()) console.warn("do_intelligent_search failed:", error);
    }
}

export const ongoingSearchResults = _ongoingSearchResults;
