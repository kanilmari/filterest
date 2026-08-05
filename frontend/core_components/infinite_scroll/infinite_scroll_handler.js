// infinite_scroll_handler.js
// Manages per-table infinite scroll using IntersectionObserver, fetching more rows as the user scrolls.
// Bridges endpoint data fetching and table/card-view renderers with scroll sentinel lifecycle events.
// Exists to decouple scroll setup, teardown, and per-table state from rendering and data layers.

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

function isRowArticleOpen(tableName) {
    const wrapper = document.querySelector(`#${tableName}_card_view_container .card_view_wrapper`);
    return wrapper?.classList.contains("big-card-open") === true;
}

/**
 * Returns the scroll state for a given table, creating a fresh entry if needed.
 */
function getScrollState(tableName) {
    if (!scrollState.has(tableName)) {
        scrollState.set(tableName, {
            isLoading: false,
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

        if (event?.detail?.isOpen) {
            disconnectInfiniteScroll(tableName);
            return;
        }

        const currentView = localStorage.getItem(`${tableName}_view`) || "table";
        if (currentView === "card") {
            initializeInfiniteScroll(tableName, getScrollState(tableName).orientation || "vertical");
        }
    });
}

/**
 * Disconnects the infinite scroll observer for a table, stopping further
 * automatic data fetches. Used when intelligent search takes over rendering
 * to prevent normal data fetches from racing with search results.
 */
export function disconnectInfiniteScroll(tableName) {
    const state = getScrollState(tableName);
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
    const containerId = `${tableName}_${currentView}_view_container`;
    const container = document.getElementById(containerId);

    if (!container) {
        console.warn(`Ei löydy containeria: #${containerId}`);
        return;
    }

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

    if (currentView === "card") {
        const cardContainer = container.querySelector(".card_container");
        if (cardContainer) {
            sentinelParent = cardContainer;
            const collapsed = getUnifiedTableState(tableName)?.cardView?.collapsed;
            observerRoot = collapsed ? cardContainer : container;
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
        if (currentView === "card" && isRowArticleOpen(tableName)) {
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

//  * Varsinainen “hae lisää dataa” -funktio.
async function fetchMoreData(tableName, options = {}) {
    const {
        isInfiniteScroll = true,
        searchType = null,
        append = true,
    } = options;
    // BUG FIX: renamed to scrollSt/tableState to avoid variable shadowing.
    // Previously both were called "state", causing the observer disconnect
    // (line ~183) to reference the wrong object — unifiedTableState instead
    // of scrollState — so the observer was never disconnected when data
    // ran out, leading to an infinite fill-screen loop (~75 duplicate calls).
    const scrollSt = getScrollState(tableName);
    if (scrollSt.isLoading) return;
    scrollSt.isLoading = true;

    try {
        const tableState = getUnifiedTableState(tableName);
        const currentView = localStorage.getItem(`${tableName}_view`) || "table";
        if (isInfiniteScroll && currentView === "card" && isRowArticleOpen(tableName)) {
            if (scrollSt.observer) {
                scrollSt.observer.disconnect();
                scrollSt.observer = null;
            }
            return;
        }
        const offsetVal = isInfiniteScroll ? tableState.offset || 0 : 0;
        const filters = tableState.filters || {};
        if (searchType) filters.searchType = searchType;
        const sort_column = tableState.sort?.column || null;
        const sort_order = tableState.sort?.direction || null;

        const result = await fetchDatasetData({
            dataset_name: tableName,
            offset: offsetVal,
            sort_column,
            sort_order,
            filters,
            callerName: `fetchMoreData (${
                isInfiniteScroll ? "infinite scroll" : "search"
            })`,
            row_count: isInfiniteScroll ? scrollSt.lastRowCount : null,
            include_card_support: currentView === "card",
        });
        setResultsCount(tableName, result.row_count);
        scrollSt.lastRowCount = result.row_count;

        if (!result.data || result.data.length === 0) {
            // Kaikki rivit ladattu — pysäytetään infinite scroll kokonaan.
            // disconnect() + null estää myös fillScreenInterval-silmukan jatkumisen.
            if (isInfiniteScroll && scrollSt.observer) {
                scrollSt.observer.disconnect();
                scrollSt.observer = null;
                scrollSt.sentinel = null;
            }
            return;
        }

        if (isInfiniteScroll) {
            updateOffset(tableName, result.data.length);
        }

        appendDataToView(tableName, result.data, append);
    } catch (err) {
        console.warn("error fetching more data:", err);
    } finally {
        scrollSt.isLoading = false;
    }
}

export function appendDataToView(tableName, data, append = true) {
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
    } else if (currentView === "card") {
        const cardContainer = document.querySelector(
            `#${tableName}_card_view_container .card_container`
        );
        if (!cardContainer) {
            console.warn(
                `Korttinäkymän kontainer puuttuu: #${tableName}_card_view_container .card_container`
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
        appendDataToCardView(cardContainer, columns, data, tableName);
    } else if (["normal", "transposed", "ticket"].includes(currentView)) {
        const containerId = `${tableName}_${currentView}_view_container`;
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
