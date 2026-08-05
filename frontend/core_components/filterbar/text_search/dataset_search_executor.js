// dataset_search_executor.js
// Runs streaming intelligent search, appends rows to active views, and keeps results counters in sync.
// Bridges text and AI search phases, inserting stage notices and rendering each phase into separate tables.
// Exists to isolate streaming execution and UI-update behaviour from component building.

import { appendDataToView, disconnectInfiniteScroll } from "../../infinite_scroll/infinite_scroll_handler.js";
import { appendDataToTable } from "../../table_views/table_view/table_row_printer.js";
import { appendDataToCardView } from "../../table_views/card_view/card_view_printer.js";
import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { setResultsCount } from "../../../reusable_components/results_count/results_count_printer.js";
import { getActiveFiltersSnapshot } from "./dataset_search_state_reader.js";
import {
    countVisibleRows,
    deduplicateRows,
    filterRows,
    initSearchCache,
    sortRows,
} from "./dataset_search_executor_helpers.js";

export const _ongoingSearchResults = {};
const SEARCH_BREAKDOWN_MODE = "search-breakdown";

function getCurrentSearchView(tableName) {
    return localStorage.getItem(`${tableName}_view`) || "table";
}

function getSearchViewContainer(tableName, currentView = getCurrentSearchView(tableName)) {
    return document.getElementById(`${tableName}_${currentView}_view_container`);
}

function getSearchStageContainer(tableName, currentView = getCurrentSearchView(tableName)) {
    if (currentView === "card") {
        return document.querySelector(
            `#${tableName}_card_view_container .card_sidebar_panel`
        );
    }

    return getSearchViewContainer(tableName, currentView);
}

function getPrimaryCardContainer(tableName) {
    return (
        document.querySelector(
            `#${tableName}_card_view_container .card_sidebar_panel > .card_container`
        ) ||
        document.querySelector(`#${tableName}_card_view_container .card_container`)
    );
}

function getSearchAiHostId(tableName, currentView = getCurrentSearchView(tableName)) {
    if (currentView === "card") {
        return `${tableName}_search_ai_cards`;
    }

    if (currentView === "table") {
        return `${tableName}_search_ai_table`;
    }

    return `${tableName}_search_ai_host`;
}

function removeNotice(tableName, langKey) {
    const currentView = getCurrentSearchView(tableName);
    const stageContainer = getSearchStageContainer(tableName, currentView);
    if (!stageContainer) return;

    const existing = stageContainer.querySelectorAll(
        `.search-stage-notice[data-lang-key="${langKey}"]`
    );
    existing.forEach((el) => {
        if (el.closest("tr")) {
            el.closest("tr").remove();
        } else {
            el.remove();
        }
    });
}

function getVisibleSearchCounts(tableName, cache = _ongoingSearchResults[tableName]) {
    const searchCache = cache || initSearchCache();

    return {
        textCount: countVisibleRows(
            searchCache.data,
            searchCache.filters,
            tableName,
            searchCache.types
        ),
        aiCount: countVisibleRows(
            searchCache.aiData,
            searchCache.filters,
            tableName,
            searchCache.types
        ),
    };
}

function buildSearchResultsCountPayload(tableName, cache = _ongoingSearchResults[tableName]) {
    return {
        mode: SEARCH_BREAKDOWN_MODE,
        ...getVisibleSearchCounts(tableName, cache),
    };
}

function syncSearchResultsCount(tableName, cache = _ongoingSearchResults[tableName]) {
    setResultsCount(tableName, buildSearchResultsCountPayload(tableName, cache));
}

async function renderRowsIntoTarget(tableName, targetHost, rows, columns, dataTypes) {
    if (!targetHost) {
        appendDataToView(tableName, rows, true);
        return;
    }

    if (
        targetHost.classList?.contains("card_container") ||
        targetHost.classList?.contains("search-ai-results-card-container")
    ) {
        await appendDataToCardView(targetHost, columns, rows, tableName);
        return;
    }

    appendDataToTable(targetHost, rows, columns, dataTypes, tableName);
}

function findRenderedCardForRow(tableName, row) {
    const rowId = row?.id;
    if (rowId == null) {
        return null;
    }

    return Array.from(
        document.querySelectorAll(`#${tableName}_card_view_container .card[data-id]`)
    ).find((card) => String(card.dataset.id) === String(rowId)) || null;
}

async function openFirstPendingSearchArticle(tableName, rowsToRender) {
    if (getCurrentSearchView(tableName) !== "card") {
        return;
    }
    if (!Array.isArray(rowsToRender) || rowsToRender.length === 0) {
        return;
    }

    const { getUnifiedTableState, setUnifiedTableState } = await import(
        "../../state_stores/table_state_store.js"
    );
    const state = getUnifiedTableState(tableName);
    const cardState = state?.cardView || {};
    if (
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

    setUnifiedTableState(tableName, {
        cardView: {
            ...cardState,
            collapsed: true,
            expandedId: firstRow.id ?? null,
            pendingAutoOpenFirstSearchResult: false,
        },
    });
    const selectedCard = findRenderedCardForRow(tableName, firstRow);
    const { openRowArticleView } = await import(
        "../../table_views/card_view/row_article_opener.js"
    );
    await openRowArticleView(firstRow, tableName, selectedCard);
}

export async function update_table_ui(tableName, incoming, targetTable) {
    const inColumns = Array.isArray(incoming?.columns) ? incoming.columns : [];
    const inData = Array.isArray(incoming?.data) ? incoming.data : [];
    const incomingTypes = incoming?.types || {};
    let cache = _ongoingSearchResults[tableName];
    if (!cache) {
        cache = initSearchCache();
        _ongoingSearchResults[tableName] = cache;
    }

    cache.filters = getActiveFiltersSnapshot(tableName);
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

    const rowsToRender = filterRows(
        rawNewRows,
        cache.filters,
        tableName,
        cache.types
    );

    if (targetTable) {
        // Render directly into the specified secondary results host (AI results).
        const columns = cache.columns;
        const dataTypes = cache.types;
        await renderRowsIntoTarget(
            tableName,
            targetTable,
            rowsToRender,
            columns,
            dataTypes
        );
    } else {
        // Default: render into the primary table via appendDataToView
        const isFirstRender = cache.renderedOnce !== true;
        appendDataToView(tableName, rowsToRender, !isFirstRender ? true : false);
        cache.renderedOnce = true;
    }

    await openFirstPendingSearchArticle(tableName, rowsToRender);
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
    removeNotice(tableName, langKey);

    const notice = document.createElement("div");
    notice.classList.add("search-stage-notice");
    notice.dataset.langKey = langKey;
    notice.textContent = fallbackText;

    if (currentView === "table") {
        const aiTable = stageContainer.querySelector(
            `#${getSearchAiHostId(tableName, currentView)}`
        );
        if (aiTable) {
            stageContainer.insertBefore(notice, aiTable);
            return;
        }

        stageContainer.appendChild(notice);
    } else if (currentView === "card") {
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
    if (currentView !== "card") return null;

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

    if (currentView === "card") {
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
    if (currentView === "card") {
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

export async function rerenderCachedSearchResults(tableName) {
    const cache = _ongoingSearchResults[tableName];
    if (!cache) return;

    cache.filters = getActiveFiltersSnapshot(tableName);
    cleanupSearchArtifacts(tableName);

    const visibleTextRows = filterRows(
        cache.data,
        cache.filters,
        tableName,
        cache.types
    );
    const visibleAiRows = filterRows(
        cache.aiData,
        cache.filters,
        tableName,
        cache.types
    );

    appendDataToView(tableName, visibleTextRows, false);
    cache.renderedOnce = true;

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
                cache.types
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

    syncSearchResultsCount(tableName, cache);
}

export function getCachedSearchResultForRender(tableName) {
    const cache = _ongoingSearchResults[tableName];
    if (!cache) {
        return null;
    }

    const filters = getActiveFiltersSnapshot(tableName);
    cache.filters = filters;
    const visibleTextRows = filterRows(
        cache.data,
        filters,
        tableName,
        cache.types
    );
    const visibleAiRows = filterRows(
        cache.aiData,
        filters,
        tableName,
        cache.types
    );
    const data = [...visibleTextRows, ...visibleAiRows];

    return {
        columns: Array.isArray(cache.columns) ? [...cache.columns] : [],
        data,
        types: { ...(cache.types || {}) },
        row_count: data.length,
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
    if (!cache || !column || !["ASC", "DESC"].includes(direction)) {
        return false;
    }

    cache.data = sortRows(cache.data, column, direction, cache.types);
    cache.aiData = sortRows(cache.aiData, column, direction, cache.types);
    await rerenderCachedSearchResults(tableName);
    return true;
}

export async function do_intelligent_search(tableName, userQuery, opts = {}) {
    if (!userQuery.trim()) return;
    const { useLocation = false, gps = null } = opts;
    // Stop infinite scroll to prevent normal data fetches from racing
    // with streamed search results (causes table flickering on F5).
    disconnectInfiniteScroll(tableName);
    // Clean up artifacts from any previous search
    cleanupSearchArtifacts(tableName);
    _ongoingSearchResults[tableName] = initSearchCache();
    _ongoingSearchResults[tableName].filters = getActiveFiltersSnapshot(tableName);
    syncSearchResultsCount(tableName, _ongoingSearchResults[tableName]);
    // Use endpoint_router with stream: true
    const currentView = getCurrentSearchView(tableName);
    let url_params =
        `&dataset=${encodeURIComponent(tableName)}` +
        `&query=${encodeURIComponent(userQuery)}`;
    if (["card", "product_card"].includes(currentView)) {
        url_params += "&include_card_support=1";
    }

    if (
        useLocation &&
        gps &&
        typeof gps.lat === "number" &&
        typeof gps.lon === "number"
    ) {
        url_params += `&gps=${encodeURIComponent(`${gps.lat},${gps.lon}`)}`;
    }
    try {
        const resp = await endpoint_router("getIntelligentResultsStream", {
            url_params,
            headers: { Accept: "application/x-ndjson" },
            stream: true,
        });

        const reader = resp.body.getReader();
        const TextDecoderCtor = globalThis?.TextDecoder;
        if (typeof TextDecoderCtor !== "function") {
            throw new Error("TextDecoder API is not available in this environment");
        }
        const textDecoder = new TextDecoderCtor();
        let partialBuffer = "";
        let noTextNoticeInserted = false;
        let embedNoticeInserted = false;
        let aiHost = null;

        const syncTextNoResultsNotice = () => {
            const { textCount } = getVisibleSearchCounts(tableName);
            if (textCount > 0) {
                removeNotice(tableName, "text_search_no_results");
                noTextNoticeInserted = false;
                return textCount;
            }

            return textCount;
        };

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            partialBuffer += textDecoder.decode(value, { stream: true });
            const lines = partialBuffer.split("\n");
            partialBuffer = lines.pop();
            for (const line of lines) {
                if (!line.trim()) continue;
                let parsed;
                try {
                    parsed = JSON.parse(line);
                } catch (_jsonErr) {
                    console.warn("[dataset_search] skipping malformed JSON line", line);
                    continue;
                }
                if (parsed.stage === "ai") {
                    // AI results go into the second results host when the view supports it.
                    if (!aiHost) {
                        aiHost = createSecondSearchResultsHost(tableName);
                    }
                    const appendedCount = await update_table_ui(tableName, parsed, aiHost);
                    const visibleTextCount = syncTextNoResultsNotice();
                    if (appendedCount > 0) {
                        if (aiHost && visibleTextCount === 0 && !noTextNoticeInserted) {
                            insertNotice(
                                tableName,
                                "text_search_no_results",
                                "Text search returned no results"
                            );
                            noTextNoticeInserted = true;
                        }

                        if (aiHost && !embedNoticeInserted) {
                            insertNotice(tableName, "see_also", "See also");
                            embedNoticeInserted = true;
                        }
                    } else if (aiHost && !embedNoticeInserted) {
                        aiHost.remove();
                        aiHost = null;
                    }
                } else {
                    // Text results go into the primary table
                    await update_table_ui(tableName, parsed, null);
                    syncTextNoResultsNotice();
                }
            }
        }
        const visibleTextCount = syncTextNoResultsNotice();
        if (visibleTextCount === 0 && !noTextNoticeInserted) {
            insertNotice(
                tableName,
                "text_search_no_results",
                "Text search returned no results"
            );
        }
    } catch (e) {
        console.warn("do_intelligent_search (stream) error:", e);
    }
}

export const ongoingSearchResults = _ongoingSearchResults;
