// dataset_search_executor.js
// Runs one dataset search and arranges the three groups of results it produces.
// Bridges the dataset's own listing, the streamed AI answer and the other
// datasets' groups with the active view, its notices and its results counter.
//
// Searching a dataset is a way of browsing it. The dataset's own matches are
// therefore ordinary listing rows: the server counts and pages them, endless
// scrolling stays connected, and this module never holds them back. Only the
// AI group and the other datasets' groups belong to the search itself, and they
// are placed after the dataset's own rows in that order.

import { reloadDatasetRowsFromListing } from "../../infinite_scroll/infinite_scroll_handler.js";
import { appendDataToTable } from "../../table_views/table_view/table_row_printer.js";
import { appendDataToCardView } from "../../table_views/card_view/card_view_printer.js";
import { getUnifiedTableState, setUnifiedTableState } from "../../state_stores/table_state_store.js";
import { createSupplementalDatasetSearch } from "./supplemental_dataset_search.js";
import { readDatasetSearchResponse } from "./dataset_search_response_reader.js";
import { getTranslationForKey } from "../../lang/translation_handler.js";
import { getLanguageWithBrowserFallback } from "../../state_stores/lang_preference_reader.js";
import {
    clearRowGroupFacets,
} from "../filter_list/row_group_facet_printer.js";
import { initSearchCache } from "./dataset_search_executor_helpers.js";
import { claimFirstListedRow, getArticleStateKey } from "../../table_views/card_view/first_listed_row.js";
import {
    clearSearchResultsCount,
    getCurrentSearchView,
    getPrimaryCardContainer,
    getSearchAiHostId,
    getSearchFilterContext,
    getSearchPresentationRows,
    getSearchResultsFlowContainer,
    getSearchStageContainer,
    getSearchViewContainer,
    isCurrentSearchCache,
    ongoingSearchResultsStore,
    removeSearchNotice,
    showsSearchAiGroup,
    setSearchDatasetMatchCount,
    syncSearchResultsCount,
} from "./dataset_search_runtime_state.js";

import { getDatasetQueryAdapter } from '../dataset_surface_provider/dataset_query_adapter_registry.js';

export const _ongoingSearchResults = ongoingSearchResultsStore;

// The two messages that divide the result groups from one another.
const NO_DATASET_MATCHES_NOTICE = "text_search_no_results";
const AI_GROUP_NOTICE = "see_also";
const NOTICE_FALLBACK_TEXTS = {
    [NO_DATASET_MATCHES_NOTICE]: {
        fi: "Tekstihaku ei löytänyt tuloksia",
        en: "Text search returned no results",
    },
    [AI_GROUP_NOTICE]: {
        fi: "Katso myös",
        en: "See also",
    },
};

/** Show one stage message in the reader's own language. */
function insertLocalizedNotice(tableName, langKey) {
    const texts = NOTICE_FALLBACK_TEXTS[langKey] || {};
    const isFinnish = String(getLanguageWithBrowserFallback()).toLowerCase().startsWith("fi");
    const fallback = (isFinnish ? texts.fi : texts.en) || texts.en || "";
    insertNotice(tableName, langKey, getTranslationForKey(langKey, { fallback }) || fallback);
}

async function renderRowsIntoTarget(
    tableName,
    targetHost,
    rows,
    columns,
    dataTypes,
    expectedCache
) {
    if (!targetHost || !isCurrentSearchCache(tableName, expectedCache)) {
        return false;
    }

    if (
        targetHost.classList?.contains("card_container") ||
        targetHost.classList?.contains("search-ai-results-card-container")
    ) {
        const renderOptions = { viewKey: getCurrentSearchView(tableName), dataTypes };
        // Card construction awaits metadata and image work. Build into a
        // detached host so a replaced search cannot append its old rows after
        // the newer search has already cleared and repopulated the live view.
        const stagingHost = document.createElement("div");
        stagingHost.className = targetHost.className;
        await appendDataToCardView(stagingHost, columns, rows, tableName, renderOptions);
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
        getSearchViewContainer(tableName)?.querySelectorAll(".card[data-id]") || []
    ).find((card) => String(card.dataset.id) === String(rowId)) || null;
}

/**
 * Open the first match when the card or article view is waiting for one.
 * Which row that is follows the one shared rule: the first row of the list the
 * search has just drawn, which is the searched listing.
 */
async function openFirstListedMatch(tableName, cache) {
    const viewKey = getCurrentSearchView(tableName);
    const isCurrent = () => isCurrentSearchCache(tableName, cache)
        && getCurrentSearchView(tableName) === viewKey;
    if (!["card", "article_view"].includes(viewKey) || !isCurrent()) return;

    const { openRowArticleView } = await import(
        "../../table_views/card_view/row_article_opener.js"
    );
    if (!isCurrent()) return;
    const firstRow = claimFirstListedRow(tableName, viewKey, cache.data);
    if (!firstRow) return;
    await openRowArticleView(firstRow, tableName, findRenderedCardForRow(tableName, firstRow), { isCurrent });
}

/**
 * Take one AI answer into the search, in the order the server ranked it.
 * The server leaves out every row the dataset's own listing shows for the same
 * search, so these rows are never met again further down the list; only a row
 * the AI group already holds is skipped here.
 */
function acceptAiRows(cache, packet) {
    if (packet?.filters_applied === true) cache.serverFiltersApplied = true;
    if (Array.isArray(packet?.columns) && packet.columns.length) cache.columns = packet.columns;
    cache.types = { ...(cache.types || {}), ...(packet?.types || {}) };
    const held = new Set(cache.aiData.filter((row) => row?.id != null).map((row) => String(row.id)));
    for (const row of Array.isArray(packet?.data) ? packet.data : []) {
        if (row?.id != null) {
            if (held.has(String(row.id))) continue;
            held.add(String(row.id));
        }
        cache.aiData.push(row);
    }
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
        const resultsFlow = getSearchResultsFlowContainer(tableName, currentView);
        if (!resultsFlow) return;
        const aiCardContainer = resultsFlow.querySelector(
            `#${getSearchAiHostId(tableName, currentView)}`
        );
        if (aiCardContainer) {
            resultsFlow.insertBefore(notice, aiCardContainer);
            return;
        }

        // Current-dataset cards, any search notice, the AI group and finally
        // the other-dataset group must share the same sidebar scroll flow.
        // The supplemental controller re-appends itself last after this.
        resultsFlow.appendChild(notice);
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
    const aiHostId = getSearchAiHostId(tableName, "table");
    container.querySelector(`#${aiHostId}`)?.remove();

    const columns = JSON.parse(primaryTable.dataset.columns || "[]");
    const dataTypes = JSON.parse(primaryTable.dataset.dataTypes || "{}");

    const table = document.createElement("table");
    table.classList.add("table_from_db", "search-ai-results-table");
    table.id = aiHostId;
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

    const resultsFlow = getSearchResultsFlowContainer(tableName, currentView);
    if (!resultsFlow || !getPrimaryCardContainer(tableName)) return null;

    const existing = resultsFlow.querySelector(
        `#${getSearchAiHostId(tableName, currentView)}`
    );
    if (existing) return existing;

    const cardContainer = document.createElement("div");
    cardContainer.classList.add("search-ai-results-card-container");
    cardContainer.id = getSearchAiHostId(tableName, currentView);

    const supplementalResults = resultsFlow.querySelector(
        ":scope > .supplemental-dataset-results"
    );
    if (supplementalResults) {
        resultsFlow.insertBefore(cardContainer, supplementalResults);
    } else {
        resultsFlow.appendChild(cardContainer);
    }

    return cardContainer;
}

function createSecondSearchResultsHost(tableName) {
    const currentView = getCurrentSearchView(tableName);
    if (!showsSearchAiGroup(currentView)) return null;
    return currentView === "table"
        ? createSecondSearchTable(tableName)
        : createSecondSearchCardContainer(tableName);
}

/** Remove the search's own AI group and stage notices from the view now shown. */
function removeSearchGroups(tableName, currentView = getCurrentSearchView(tableName)) {
    const stageContainer = getSearchStageContainer(tableName, currentView);
    if (!stageContainer) return;
    stageContainer.querySelector(`#${getSearchAiHostId(tableName, currentView)}`)?.remove();
    stageContainer.querySelectorAll(".search-stage-notice").forEach((el) => el.remove());
}

/**
 * Put the search's own groups after the dataset's rows in the view now shown:
 * the notice for a search without matches, the AI group under its own notice,
 * and the other datasets last, and bring the counter in step with them. A
 * search calls this when its listing has answered and again when the AI answer
 * arrives; a view rebuild calls it once. A view with no place for a separate
 * group shows only the dataset's own rows.
 */
async function placeSearchGroups(tableName, cache) {
    if (!isCurrentSearchCache(tableName, cache)) return false;
    removeSearchGroups(tableName);
    if (cache.complete && cache.data.length === 0) {
        insertLocalizedNotice(tableName, NO_DATASET_MATCHES_NOTICE);
    }
    const aiRows = getSearchPresentationRows(tableName, cache, cache.aiData);
    const aiHost = aiRows.length ? createSecondSearchResultsHost(tableName) : null;
    if (aiHost) {
        const committed = await renderRowsIntoTarget(
            tableName, aiHost, aiRows, cache.columns, cache.types, cache
        );
        if (!committed) return false;
        insertLocalizedNotice(tableName, AI_GROUP_NOTICE);
    }
    if (!isCurrentSearchCache(tableName, cache)) return false;
    syncSearchResultsCount(tableName, cache);
    cache.supplemental?.place();
    return true;
}

/**
 * Clears a previous search's groups and the dataset's rows before a new one.
 */
function cleanupSearchArtifacts(tableName) {
    const currentView = getCurrentSearchView(tableName);
    removeSearchGroups(tableName, currentView);

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

/**
 * Load the dataset's own matches from its ordinary listing and show them.
 * The listing answers with the true number of matches and stays connected to
 * endless scrolling, so the reader can browse every match instead of a top few.
 */
async function loadDatasetMatches(tableName, cache, isCurrent) {
    let result = await reloadDatasetRowsFromListing(tableName, { isCurrent });
    if (!isCurrent()) return false;
    // A URL-seeded search can begin while the route's first ordinary view
    // build is still replacing its container. That invalidates the listing
    // reload even though its server answer was correct. Once the build has
    // settled, one fresh reload attaches the same answer to the live panel.
    if (!result) {
        result = await reloadDatasetRowsFromListing(tableName, { isCurrent });
    }
    if (!isCurrent() || !result) return false;

    const rows = Array.isArray(result?.data) ? result.data : [];
    if (Array.isArray(result?.columns) && result.columns.length) cache.columns = result.columns;
    cache.types = { ...(cache.types || {}), ...(result?.types || {}) };
    // Only the rows the search itself put on screen are remembered here. Later
    // pages belong to the listing, which renders and counts them on its own.
    cache.data = rows;
    setSearchDatasetMatchCount(cache, result?.row_count);
    return true;
}

/**
 * Read the streamed answer for its AI stage only and show it under the
 * dataset's own matches. The streamed text stage is a separate top-few answer
 * to the same question and would only repeat rows the listing already has.
 */
async function streamAiSearchResults(tableName, cache, context, opts, isCurrent) {
    const requestOptions = {
        ...opts,
        filters: Object.fromEntries(
            Object.entries(context.clientFilters).map(([key, value]) => [key, String(value)])
        ),
        rowGroupSlug: context.rowGroupSlug,
        view: getCurrentSearchView(tableName),
    };

    for await (const packet of readDatasetSearchResponse(tableName, cache.query, requestOptions, isCurrent)) {
        if (!isCurrent()) return;
        if (packet.stage !== "ai") continue;
        acceptAiRows(cache, packet);
        await placeSearchGroups(tableName, cache);
    }
}

/**
 * Show the current search again after something it depends on changed.
 * The dataset's own rows live in the server's listing now, so a changed filter,
 * sort or language means asking for them again rather than re-arranging a page
 * that is already in the browser.
 */
export async function rerenderCachedSearchResults(tableName, expectedCache = null) {
    const cache = _ongoingSearchResults[tableName];
    if (!cache?.query || !isCurrentSearchCache(tableName, expectedCache)) return;
    await do_intelligent_search(tableName, cache.query, cache.searchOptions || {});
}

/** The search that still answers this query under the filters now selected. */
function getCommittedSearchCache(tableName, query = null) {
    const cache = _ongoingSearchResults[tableName];
    if (!cache || (query !== null && cache.query !== String(query).trim())
        || getSearchFilterContext(tableName).signature !== cache.filterSignature) {
        return null;
    }
    return cache;
}

/**
 * Let a caller that rebuilds the whole dataset view keep the committed search.
 * Rebuilding a view does not ask the search again: the dataset's rows come from
 * its listing, which carries the search as a condition and keeps paging it like
 * any other listing. The search contributes only what it alone owns, placed
 * again from the answers it already received.
 *
 * @returns {{ isCurrent: () => boolean, place: (options?: { rowCount?: number }) => Promise<boolean> } | null}
 *          null when no search answers this query under the selected filters.
 *          `isCurrent` turns false once a newer run of the search replaces it.
 */
export function getSearchGroupsForViewRebuild(tableName, { query = null } = {}) {
    const cache = getCommittedSearchCache(tableName, query);
    if (!cache) return null;
    return {
        isCurrent: () => isCurrentSearchCache(tableName, cache),
        // The rebuilt listing has just counted the matches afresh.
        place: ({ rowCount } = {}) => {
            if (Number.isFinite(rowCount)) setSearchDatasetMatchCount(cache, rowCount);
            return placeSearchGroups(tableName, cache);
        },
    };
}

/** Whether a search currently owns what this dataset is showing. */
export function hasCachedSearchResults(tableName) {
    return Boolean(_ongoingSearchResults[tableName]?.query);
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

    // Sorting reorders every match, not only the page in the browser, so the
    // listing is asked again with the selection that is now in effect.
    await rerenderCachedSearchResults(tableName, cache);
    return true;
}

/** Let the article view know it should open the first match once it arrives. */
function awaitFirstSearchResultInArticleView(tableName) {
    const currentView = getCurrentSearchView(tableName);
    if (!["card", "article_view"].includes(currentView)) return;
    const stateKey = getArticleStateKey(currentView);
    const articleState = getUnifiedTableState(tableName)?.[stateKey];
    if (!articleState?.collapsed) return;
    setUnifiedTableState(tableName, {
        [stateKey]: {
            ...articleState, expandedId: null,
            pendingAutoOpenFirstSearchResult: true, pendingAutoOpenFirstRenderedResult: false,
        },
    });
}

/**
 * Run one search and arrange its three groups of results.
 * First the dataset's own matches from its listing, browsable to the last one;
 * then the AI group; then the other datasets' groups. A new cache identity
 * invalidates every delayed answer, render and article open from an older one.
 */
export async function do_intelligent_search(tableName, userQuery, opts = {}) {
    const adapter = getDatasetQueryAdapter(tableName);
    if (adapter) return adapter.refresh({ search: userQuery.trim() });
    const query = userQuery.trim();
    if (!query) return;
    clearRowGroupFacets(tableName);
    const context = getSearchFilterContext(tableName);
    const executionSignature = `${context.signature}\n${JSON.stringify(opts)}`;
    const runningCache = _ongoingSearchResults[tableName];
    // The filter bar, shared top bar and article hero can all initialize from
    // the same URL. They are synchronized controls, not three search engines:
    // let the first request own the result list instead of racing identical
    // reloads against one another.
    if (runningCache?.query === query
        && runningCache.executionSignature === executionSignature
        && runningCache.executionPromise) {
        return runningCache.executionPromise;
    }
    cleanupSearchArtifacts(tableName);
    // A different question starts from its first result; the same question
    // asked again, after a changed filter or sort, leaves the reader where
    // they already are.
    const isNewQuestion = _ongoingSearchResults[tableName]?.query !== query;
    _ongoingSearchResults[tableName]?.supplemental?.destroy();
    const cache = initSearchCache();
    Object.assign(cache, {
        query, filterSignature: context.signature,
        // The selected filters reach the dataset's rows through the listing's
        // own query, so its rows are never filtered a second time here.
        filters: context.clientFilters, complete: false,
        searchOptions: opts, serverFiltersApplied: false, executionSignature,
    });
    _ongoingSearchResults[tableName] = cache;
    // The previous search's AI number describes rows that are already gone.
    clearSearchResultsCount(tableName);
    // Withdraw the unfiltered listing's old number immediately. Until the
    // searched listing replies, zero current-dataset matches are known; other
    // datasets load independently and never get a chance to fill this count.
    syncSearchResultsCount(tableName, cache);
    if (isNewQuestion) awaitFirstSearchResultInArticleView(tableName);
    const isCurrent = () => isCurrentSearchCache(tableName, cache);
    cache.supplemental = createSupplementalDatasetSearch(tableName, cache.query, {
        isCurrent, getContainer: () => getSearchResultsFlowContainer(tableName),
    });

    const executionPromise = (async () => {
        try {
            const listingLoaded = await loadDatasetMatches(tableName, cache, isCurrent);
            if (!isCurrent() || !listingLoaded) return;
            // The dataset's own answer is complete as soon as its listing replies;
            // the AI group arrives afterwards and adds to it.
            cache.complete = true;
            syncSearchResultsCount(tableName, cache);
            await placeSearchGroups(tableName, cache);
            if (!isCurrent()) return;
            await openFirstListedMatch(tableName, cache);
            if (!isCurrent()) return;
            await streamAiSearchResults(tableName, cache, context, opts, isCurrent);
        } catch (error) {
            if (isCurrent()) console.warn("do_intelligent_search failed:", error);
        } finally {
            if (isCurrent()) cache.executionPromise = null;
        }
    })();
    cache.executionPromise = executionPromise;
    return executionPromise;
}

export const ongoingSearchResults = _ongoingSearchResults;
