// infinite_scroll_handler.js
// Manages per-table infinite scroll using IntersectionObserver, fetching more rows as the user scrolls.
// Bridges endpoint data fetching and table/card-view renderers with scroll sentinel lifecycle events.
// Exists to decouple scroll setup, teardown, and per-table state from rendering and data layers.
// A committed text search travels with every page as an ordinary condition of
// the listing, so searching a dataset stays a way of browsing it.

import { appendLoadedDatasetRows, clearLoadedDatasetRows, filterLoadedDatasetDuplicates, getLoadedDatasetProjection } from "../table_views/dataset_loaded_rows.js";
import { getDatasetViewContainerId, getDatasetViewScrollDirection } from "../table_views/dataset_view_registry.js";
import { getParams } from "../navigation/nav_engine/query_params.js";

import { fetchDatasetData } from "../endpoints/endpoint_data_fetcher.js";
import { appendDataToTable } from "../table_views/table_view/table_row_printer.js";
import { appendDataToCardView } from "../table_views/card_view/card_view_printer.js";
import { setResultsCount } from "../../reusable_components/results_count/results_count_printer.js";

// Tuodaan unified-tila suoraan state storesta (vältetään kehäriippuvuus table_refresh_unified ↔ infinite_scroll)
import {
    getUnifiedTableState,
    setUnifiedTableState,
} from "../state_stores/table_state_store.js";

// Per-table scroll state: Map<tableName, { isLoading, observer, sentinel, lastRowCount }>
const scrollState = new Map();
let articleToggleListenerInstalled = false;

/**
 * Returns the scroll state for a given table, creating a fresh entry if needed.
 */
function getScrollState(tableName) {
    if (!scrollState.has(tableName)) {
        scrollState.set(tableName, {
            isLoading: false,
            generation: 0,
            observer: null,
            sentinel: null,
            lastRowCount: null,
            orientation: "vertical",
            fillScreenIntervalId: null,
            fillScreenTimeoutId: null,
        });
    }
    return scrollState.get(tableName);
}

function clearFillScreenTimers(tableName) {
    const state = getScrollState(tableName);
    if (state.fillScreenIntervalId) {
        clearInterval(state.fillScreenIntervalId);
        state.fillScreenIntervalId = null;
    }
    if (state.fillScreenTimeoutId) {
        clearTimeout(state.fillScreenTimeoutId);
        state.fillScreenTimeoutId = null;
    }
}

function syncTableInfiniteScrollSentinelWidth(tableName) {
    const state = getScrollState(tableName);
    if (!state.sentinel) {
        return;
    }

    const currentView = localStorage.getItem(`${tableName}_view`) || "table";
    if (currentView !== "table") {
        state.sentinel.style.width = "100%";
        state.sentinel.style.minWidth = "";
        return;
    }

    const container = document.getElementById(`${tableName}_table_view_container`);
    const table = container?.querySelector("table");
    const tableWidth = Math.max(
        Number(table?.scrollWidth) || 0,
        Number(table?.offsetWidth) || 0
    );
    const sentinelWidth = Math.max(Number(container?.clientWidth) || 0, tableWidth);

    state.sentinel.style.minWidth = "100%";
    state.sentinel.style.width = sentinelWidth > 0 ? `${Math.ceil(sentinelWidth)}px` : "100%";
}

function ensureArticleToggleListener() {
    if (articleToggleListenerInstalled) {
        return;
    }
    articleToggleListenerInstalled = true;
    document.addEventListener("big-card-toggle", (event) => {
        const tableName = String(event?.detail?.tableName || "").trim();
        if (!tableName) {
            return;
        }

        const currentView = localStorage.getItem(`${tableName}_view`) || "table";
        if (["card", "article_view"].includes(currentView)) {
            initializeInfiniteScroll(tableName, getScrollState(tableName).orientation || "vertical");
        }
    });
}

/**
 * Disconnects the infinite scroll observer for a table, stopping further
 * automatic data fetches. Used whenever the visible list is about to be
 * replaced, so a page still in flight cannot append rows to the new list.
 */
export function disconnectInfiniteScroll(tableName) {
    const state = getScrollState(tableName);
    state.generation += 1;
    clearFillScreenTimers(tableName);
    if (state.observer) {
        state.observer.disconnect();
        state.observer = null;
    }
    if (state.sentinel) {
        state.sentinel.remove();
        state.sentinel = null;
    }
    state.isLoading = false;
}

/**
 * Nollaa offsetin unifyed-tilasta esim. kun taulu latautuu uusilla filttereillä.
 */
export function resetOffset(tableName) {
    const state = getUnifiedTableState(tableName);
    state.offset = 0;
    setUnifiedTableState(tableName, state);
    // Nollataan cachettu rivimäärä jotta seuraava erä tekee uuden COUNT(*)
    const scrollSt = getScrollState(tableName);
    scrollSt.lastRowCount = null;
    scrollSt.generation += 1;
    scrollSt.isLoading = false;
}

/**
 * Inkrementoi offsetia unifyed-tilassa ladatun datan määrällä.
 */
export function updateOffset(tableName, loadedCount) {
    const state = getUnifiedTableState(tableName);
    const oldOffset = state.offset || 0;
    state.offset = oldOffset + loadedCount;
    // console.log('infinite_scroll.js: updateOffset kutsuu funktiota setUnifiedTableState arvoilla tableName:', tableName, 'state:', state);
    setUnifiedTableState(tableName, state);
}

/**
 * Seeds the cached row count for a freshly rendered dataset view so the first
 * infinite-scroll batch can skip a redundant COUNT(*) query.
 */
export function seedInfiniteScrollRowCount(tableName, rowCount) {
    const scrollSt = getScrollState(tableName);
    if (Number.isFinite(rowCount) && rowCount >= 0) {
        scrollSt.lastRowCount = rowCount;
        return;
    }
    scrollSt.lastRowCount = null;
}

/**
 * Alustaa infinite scroll -toiminnon taululle `tableName`.
 * Käyttää IntersectionObserveria. Kun containerin lopussa oleva
 * sentinel-elementti tulee näkyviin, haetaan lisää dataa offsetin mukaan.
 *
 * @param {string} tableName   Minkä “taulun” scrollille varaus
 * @param {string} orientation 'vertical' tai 'horizontal'
 */
export function initializeInfiniteScroll(tableName, orientation = "vertical") {
    ensureArticleToggleListener();
    const datasetName = tableName;
    const currentView = localStorage.getItem(`${datasetName}_view`) || "table";
    const containerId = `${tableName}_${currentView === "article_view" ? "article" : currentView}_view_container`;
    const container = document.getElementById(containerId);

    if (!container) {
        console.warn(`Ei löydy containeria: #${containerId}`);
        return;
    }

    disconnectInfiniteScroll(tableName);
    const state = getScrollState(tableName);
    state.orientation = orientation;
    clearFillScreenTimers(tableName);

    // Jos observer on olemassa, tuhotaan se ensin (estää tuplahavainnoinnin)
    if (state.observer) {
        state.observer.disconnect();
        state.observer = null;
    }

    // Luodaan sentinel-elementti
    state.sentinel = document.createElement("div");
    state.sentinel.id = `${tableName}_infinite_scroll_sentinel`;
    state.sentinel.style.height = "1px";
    state.sentinel.style.width = "100%";
    // state.sentinel.style.marginBottom = "-1px";
    state.sentinel.style.visibility = "hidden";

    let observerRoot = container;
    let sentinelParent = container;

    if (["card", "article_view"].includes(currentView)) {
        const cardContainer = container.querySelector(".card_container");
        if (cardContainer) {
            sentinelParent = cardContainer;
            const collapsed = getUnifiedTableState(tableName)?.[currentView === "article_view" ? "articleView" : "cardView"]?.collapsed;
            observerRoot = collapsed || cardContainer.closest(".big-card-open") ? cardContainer : container;
        }
    }

    sentinelParent.appendChild(state.sentinel);
    syncTableInfiniteScrollSentinelWidth(tableName);

    state.observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    fetchMoreData(tableName);
                }
            });
        },
        {
            root: observerRoot,
            // Määritellään margin sen mukaan, halutaanko pysty- vai vaakavieritystä
            rootMargin:
                orientation === "vertical"
                    ? "0px 0px 100px 0px"
                    : "0px 100px 0px 0px",
            threshold: 0.0,
        }
    );

    state.observer.observe(state.sentinel);

    // Fill-screen: jos sisältö ei täytä näyttöä (esim. 20 riviä < näyttö),
    // IntersectionObserver ei laukea uudelleen koska sentinel pysyy visible.
    // Ladataan lisää dataa toistuvasti kunnes container on scrollattavissa
    // tai data loppuu. 150ms viive per erä että DOM ehtii päivittyä.
    const fillScreenInterval = setInterval(async () => {
        // Jos observer on purettu (data loppui), lopetetaan
        if (!state.observer || !state.sentinel) {
            clearInterval(fillScreenInterval);
            state.fillScreenIntervalId = null;
            return;
        }
        // Tarkistetaan onko container jo scrollattavissa
        const scrollable = observerRoot
            ? observerRoot.scrollHeight > observerRoot.clientHeight
            : document.documentElement.scrollHeight > window.innerHeight;
        if (scrollable || state.isLoading) {
            clearInterval(fillScreenInterval);
            state.fillScreenIntervalId = null;
            return;
        }
        // Haetaan lisää dataa
        await fetchMoreData(tableName);
        // Jos fetchMoreData ei saanut dataa, observer disconnectoitui
        if (!state.observer || !state.sentinel) {
            clearInterval(fillScreenInterval);
            state.fillScreenIntervalId = null;
        }
    }, 150);
    state.fillScreenIntervalId = fillScreenInterval;

    // Turvakatkaisu: lopetetaan fill-screen 10 sekunnin jälkeen
    state.fillScreenTimeoutId = setTimeout(() => {
        clearInterval(fillScreenInterval);
        state.fillScreenIntervalId = null;
        state.fillScreenTimeoutId = null;
    }, 10000);
}

/**
 * Loads the dataset's own rows again from the beginning and reconnects endless
 * scrolling to them. A committed search is carried into that request like any
 * other condition, so the first page, the row count and every later page all
 * describe the same set of matches.
 *
 * @param {string} tableName
 * @param {{ isCurrent?: () => boolean }} [options] caller's own freshness check,
 *        so a replaced search cannot commit its rows after a newer one.
 * @returns {Promise<Object|null>} the listing's answer, or null if it was abandoned.
 */
export async function reloadDatasetRowsFromListing(tableName, { isCurrent } = {}) {
    disconnectInfiniteScroll(tableName);
    resetOffset(tableName);
    const result = await fetchMoreData(tableName, { replace: true, isCurrent });
    if (isCurrent && !isCurrent()) return result;
    const currentView = localStorage.getItem(`${tableName}_view`) || "table";
    initializeInfiniteScroll(tableName, getDatasetViewScrollDirection(currentView));
    return result;
}

//  * Varsinainen “hae lisää dataa” -funktio.
//  * replace=true aloittaa listauksen alusta ja korvaa näkyvät rivit;
//  * muuten haetaan seuraava sivu nykyisen offsetin jälkeen.
async function fetchMoreData(tableName, { replace = false, isCurrent: callerIsCurrent = null } = {}) {
    // BUG FIX: renamed to scrollSt/tableState to avoid variable shadowing.
    // Previously both were called "state", causing the observer disconnect
    // (line ~183) to reference the wrong object — unifiedTableState instead
    // of scrollState — so the observer was never disconnected when data
    // ran out, leading to an infinite fill-screen loop (~75 duplicate calls).
    const scrollSt = getScrollState(tableName);
    if (scrollSt.isLoading) return null;
    scrollSt.isLoading = true;
    const generation = scrollSt.generation;

    try {
        const tableState = getUnifiedTableState(tableName);
        const currentView = localStorage.getItem(`${tableName}_view`) || "table";
        const container = document.getElementById(getDatasetViewContainerId(currentView, tableName));
        const isCurrent = () => scrollSt.generation === generation
            && (localStorage.getItem(tableName + "_view") || "table") === currentView
            && document.getElementById(getDatasetViewContainerId(currentView, tableName)) === container
            && container?.isConnected
            && (!callerIsCurrent || callerIsCurrent());
        const offsetVal = replace ? 0 : tableState.offset || 0;
        // The committed search is one more condition of this listing, next to
        // the selected filters, so it is sent with every page.
        const committedSearch = String(getParams(tableName)?.search || "").trim();
        const filters = {
            ...(tableState.filters || {}),
            ...(committedSearch ? { search: committedSearch } : {}),
        };
        const sort_column = tableState.sort?.column || null;
        const sort_order = tableState.sort?.direction || null;

        const result = await fetchDatasetData({
            dataset_name: tableName,
            offset: offsetVal,
            sort_column,
            sort_order,
            filters,
            callerName: `fetchMoreData (${replace ? "reload" : "infinite scroll"})`,
            row_count: replace ? null : scrollSt.lastRowCount,
            include_card_support: ["card", "article_view"].includes(currentView),
            view_key: getLoadedDatasetProjection(container, tableName) || currentView,
        });
        if (!isCurrent()) return null;
        setResultsCount(tableName, result.row_count);
        scrollSt.lastRowCount = result.row_count;

        if (!result.data || result.data.length === 0) {
            // A reload still has to empty the view: an answer with no rows is
            // the result, not a reason to leave the previous rows on screen.
            if (replace) await appendDataToView(tableName, [], false, { isCurrent, dataTypes: result.types });
            // Kaikki rivit ladattu — pysäytetään infinite scroll kokonaan.
            // disconnect() + null estää myös fillScreenInterval-silmukan jatkumisen.
            if (!replace && scrollSt.observer) {
                scrollSt.observer.disconnect();
                scrollSt.observer = null;
                scrollSt.sentinel?.remove();
                scrollSt.sentinel = null;
            }
            return result;
        }

        const rows = replace
            ? result.data
            : filterLoadedDatasetDuplicates(container, tableName, result.data);
        await appendDataToView(tableName, rows, !replace, { isCurrent, dataTypes: result.types });
        if (!isCurrent()) return result;
        // A replaced list no longer continues the remembered row prefix, so the
        // article navigation must not inherit rows that are no longer on screen.
        if (replace) clearLoadedDatasetRows(container);
        updateOffset(tableName, result.data.length);
        appendLoadedDatasetRows(container, tableName, rows, getUnifiedTableState(tableName).offset);
        if (!replace && Number.isFinite(result.row_count)
            && getUnifiedTableState(tableName).offset >= result.row_count) {
            disconnectInfiniteScroll(tableName);
        }
        return result;
    } catch (err) {
        console.warn("error fetching more data:", err);
        return null;
    } finally {
        if (scrollSt.generation === generation) scrollSt.isLoading = false;
    }
}

export function appendDataToView(tableName, data, append = true, { isCurrent, dataTypes } = {}) {
    const datasetName = tableName;
    const currentView = localStorage.getItem(`${datasetName}_view`) || "table";

    if (currentView === "table") {
        const table = document.querySelector(
            `#${tableName}_table_view_container table`
        );
        if (!table) {
            console.warn(
                `Tauluelementti puuttuu: #${tableName}_table_view_container table`
            );
            return;
        }
        const columns = JSON.parse(table.dataset.columns);
        const dataTypes = JSON.parse(table.dataset.dataTypes);

        if (!append) {
            const tbody = table.querySelector('tbody');
            if (tbody) {
                tbody.innerHTML = '';
            } else {
                table.appendChild(document.createElement('tbody'));
            }
        }
        appendDataToTable(table, data, columns, dataTypes, tableName);
        syncTableInfiniteScrollSentinelWidth(tableName);
    } else if (["card", "article_view"].includes(currentView)) {
        const cardContainer = document.querySelector(
            `#${tableName}_${currentView === "article_view" ? "article" : "card"}_view_container .card_container`
        );
        if (!cardContainer) {
            console.warn(
                `Korttinäkymän kontainer puuttuu: #${tableName}_${currentView === "article_view" ? "article" : "card"}_view_container .card_container`
            );
            return;
        }
        const columns =
            JSON.parse(localStorage.getItem(`${tableName}_columns`)) || [];

        if (!append) {
            Array.from(cardContainer.children).forEach((child) => {
                if (!child.classList.contains("card_top_controls")) {
                    child.remove();
                }
            });
        }
        return appendDataToCardView(cardContainer, columns, data, tableName,
            ...(isCurrent || dataTypes ? [{ isCurrent, dataTypes }] : []));
    } else if (["normal", "transposed", "ticket"].includes(currentView)) {
        const containerId = `${tableName}_${currentView === "article_view" ? "article" : currentView}_view_container`;
        const container = document.getElementById(containerId);
        if (!container) {
            console.warn(`Kontainer puuttuu: #${containerId}`);
            return;
        }
        const tableComponentRoot = container.querySelector(
            ".table-component-root"
        );
        if (tableComponentRoot && tableComponentRoot.tableComponentInstance) {
            if (append) {
                tableComponentRoot.tableComponentInstance.appendData(data);
            } else {
                tableComponentRoot.tableComponentInstance.setData(data); // Korvaa data
            }
        } else {
            console.warn(
                `TableComponent ei löydy (tableName: ${tableName}, view: ${currentView}).`
            );
        }
    }
}

/** Retains only pagination context, never an observer or pending request. */
export function captureInfiniteScrollState(tableName) {
    const { lastRowCount, orientation, isLoading } = getScrollState(tableName);
    return { lastRowCount, orientation, isLoading };
}

export function resumeInfiniteScrollState(tableName, snapshot) {
    const state = getScrollState(tableName);
    state.lastRowCount = snapshot.lastRowCount;
    initializeInfiniteScroll(tableName, snapshot.orientation);
}
