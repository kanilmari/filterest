// dataset_address_writer.js
// Owns the outgoing browser address of a dataset: it serialises every dataset URL the
// application writes, and reconciles that address with the state a settled render or a
// completed history restoration actually left on screen.
// Bridges the remembered per-dataset view, the cached query parameters and the History API.
// Exists because three stores answered "which view is showing" separately, so a closed
// article or a permission fallback could leave view=article_view, and sometimes a row path,
// in an address that no longer described the page.

import { writeHistoryEntry, rememberHistoryDatasetView } from "./history_entry_state.js";
import { buildDatasetPath, getInternalDatasetName } from "./dataset_aliases.js";
import { getParams, setParams, normalizePath, DATASET_PREFIX } from "./query_params.js";
import { getPrefixFromPathname, parseDeepLink } from "./history_navigation_handler_helpers.js";
import { isImageFirstViewURL } from "./image_first_view_history.js";
import { getUnifiedTableState } from "../../state_stores/table_state_store.js";
import {
    isArticleDatasetView,
    resolveDatasetViewSelectionTarget,
} from "../../table_views/dataset_view_registry.js";

/** Navigation-owned history fields that describe an open article. */
const ARTICLE_HISTORY_FIELDS = ["articleReturnAvailable", "articleOriginEntry"];

let latestAddressRequest = null;

/**
 * Serialises dataset query parameters exactly as every dataset URL has always
 * carried them: declared order, empty values dropped.
 *
 * Exported so a caller that has to build a dataset URL of its own, such as the
 * article opener's row link, spells the query the same way this owner does.
 */
export function serializeDatasetQuery(params = {}) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
            searchParams.set(key, value);
        }
    });
    const query = searchParams.toString();
    return query ? `?${query}` : "";
}

/**
 * Lets the entry being left behind remember the view it was showing, so a later
 * Back can restore that presentation even from an address without a view.
 */
function rememberVisibleDatasetHistoryView() {
    const path = normalizePath(location.pathname);
    const prefix = path.startsWith("/admin/") ? "/admin/" : DATASET_PREFIX;
    const dataset = getInternalDatasetName(path.slice(prefix.length));
    // A row URL or another route must not inherit a hidden dataset's view.
    if (!dataset || dataset.includes("/") || buildDatasetPath(dataset, prefix) !== path) return;
    const root = document.getElementById(`${dataset}_container`);
    const view = root?.querySelector(".tab_parts_container")?.dataset.view;
    if (!root?.isConnected || root.classList.contains("hidden")
        || getComputedStyle(root).display === "none" || !view) return;
    const hasVisibleResults = [...root.querySelectorAll(".scrollable_content")]
        .some((host) => host.childElementCount > 0 && !host.hidden && getComputedStyle(host).display !== "none");
    if (hasVisibleResults) rememberHistoryDatasetView(dataset, view);
}

/**
 * Writes one dataset address and the cached parameters that belong to it.
 *
 * This is the single serialisation point for every dataset URL the application
 * produces; `updateURL` in query_params.js is its public name and delegates here,
 * so a caller never has to remember a separate reconciliation step.
 *
 * @param {string} dataset Internal dataset name.
 * @param {Object} params Query parameters to cache and serialise.
 * @param {string} [prefix] Route prefix such as "/" or "/admin/".
 * @param {{pathOverride?: string, state?: Object, replace?: boolean}} [options]
 */
export function writeDatasetAddress(dataset, params = {}, prefix = DATASET_PREFIX, options = {}) {
    setParams(dataset, params);
    const targetPath = typeof options.pathOverride === "string" && options.pathOverride
        ? normalizePath(options.pathOverride)
        : buildDatasetPath(dataset, prefix);
    const newUrl = `${targetPath}${serializeDatasetQuery(params)}`;
    const currentUrl = window.location.pathname + window.location.search;
    const state = options.state === undefined ? {} : options.state;
    const replace = Boolean(options.replace || currentUrl === newUrl);
    if (!replace) rememberVisibleDatasetHistoryView();
    writeHistoryEntry(newUrl, state, { replace });
}

/**
 * Reads the view that is actually showing for a dataset.
 *
 * The remembered per-dataset choice is the settled answer rather than a request:
 * `generate_table` writes the permission- and capability-corrected view back to
 * that same key before it renders, so a fallback is already reflected here.
 * An unwritten key means nothing has rendered yet, and the address is left alone.
 */
function readEffectiveDatasetView(dataset) {
    const storedView = localStorage.getItem(`${dataset}_view`);
    return storedView ? resolveDatasetViewSelectionTarget(storedView) : "";
}

/**
 * Reads the row the article presentation currently holds open, or null.
 * An article view with no open row is a legitimate state, not a wrong view.
 */
function readOpenArticleRowId(dataset) {
    const articleState = getUnifiedTableState(dataset)?.articleView || {};
    if (articleState.collapsed !== true) return null;
    const rowId = articleState.expandedId;
    return rowId === null || rowId === undefined || rowId === "" ? null : String(rowId);
}

/** Tells whether a pathname is already this row's own address, slug included. */
function isAddressOfRow(pathname, datasetPath, rowId) {
    return pathname === `${datasetPath}/${rowId}`
        || pathname.startsWith(`${datasetPath}/${rowId}-`);
}

/**
 * Keeps a hash the browser itself produced, such as an anchor inside an article,
 * and drops anything that could change what the address means.
 */
function readValidAddressHash() {
    const hash = window.location.hash;
    if (!hash || hash === "#") return "";
    return /^#[^\s"'<>\\^`{|}]*$/.test(hash) ? hash : "";
}

/**
 * Rebuilds the navigation-owned history fields for the settled state, because
 * `writeHistoryEntry` clears them before it merges in whatever it is given.
 */
function buildSettledHistoryState(dataset, openRowId) {
    if (!openRowId) {
        return { bigCard: false, dataset };
    }
    const currentState = history.state || {};
    const settled = { bigCard: true, dataset, rowId: openRowId };
    for (const field of ARTICLE_HISTORY_FIELDS) {
        if (currentState[field] !== undefined) settled[field] = currentState[field];
    }
    return settled;
}

/** Tells whether the current entry already describes this open or closed article. */
function historyStateDescribes(dataset, openRowId) {
    const currentState = history.state || {};
    if (openRowId) {
        return currentState.bigCard === true
            && currentState.dataset === dataset
            && String(currentState.rowId) === openRowId;
    }
    return currentState.bigCard !== true
        && currentState.rowId === undefined
        && (currentState.dataset === undefined || currentState.dataset === dataset);
}

function writeSettledDatasetAddress(expectedDataset) {
    const pathname = normalizePath(window.location.pathname);
    const prefix = getPrefixFromPathname(pathname, DATASET_PREFIX);
    if (!prefix) return false;
    const { name: addressDataset } = parseDeepLink(pathname.slice(prefix.length));
    if (!addressDataset) return false;
    // A late answer about a dataset the person already left must not rewrite the
    // newer address it would land on.
    if (expectedDataset && expectedDataset !== addressDataset) return false;
    const dataset = expectedDataset || addressDataset;
    // The image-first article owns its own address, its row and its image hash.
    if (isImageFirstViewURL()) return false;

    const effectiveView = readEffectiveDatasetView(dataset);
    if (!effectiveView) return false;
    const openRowId = isArticleDatasetView(effectiveView) ? readOpenArticleRowId(dataset) : null;

    const datasetPath = buildDatasetPath(dataset, prefix);
    // Card, table and list describe the dataset itself; only an open article
    // keeps a row path, and it keeps the readable one the opener already wrote.
    const targetPath = openRowId
        ? (isAddressOfRow(pathname, datasetPath, openRowId) ? pathname : `${datasetPath}/${openRowId}`)
        : datasetPath;

    // Unrelated search, filter and sort parameters are the person's, not ours.
    const params = { ...getParams(dataset), view: effectiveView };
    // The cache and the address are one decision, so they are written together
    // even when the address itself already happens to be correct.
    setParams(dataset, params);

    const nextUrl = `${targetPath}${serializeDatasetQuery(params)}${readValidAddressHash()}`;
    const currentUrl = pathname + window.location.search + window.location.hash;
    if (currentUrl === nextUrl && historyStateDescribes(dataset, openRowId)) return false;
    // Replacing keeps the entry's identity, so reconciliation never adds a step
    // the person has to press Back through.
    writeHistoryEntry(nextUrl, buildSettledHistoryState(dataset, openRowId), { replace: true });
    return true;
}

/**
 * Asks this module to describe a settled dataset state in the browser address.
 *
 * Call it where rendering or history restoration has actually finished, not from
 * the control that started it: a click's own microtask is not proof that the view
 * refreshed or that an article finished opening.
 *
 * The write happens on the next microtask so one transition's boundaries produce a
 * single address, and only the newest request writes. A caller that can be
 * superseded passes `isCurrent` and its aborted navigation is dropped.
 *
 * @param {{dataset?: string|null, isCurrent?: (() => boolean)|null}} [options]
 * @returns {Promise<boolean>} Resolves true when this request wrote the address.
 */
export function updateDatasetAddress({ dataset = null, isCurrent = null } = {}) {
    const request = { dataset, isCurrent };
    latestAddressRequest = request;
    return Promise.resolve().then(() => {
        if (latestAddressRequest !== request) return false;
        latestAddressRequest = null;
        if (typeof request.isCurrent === "function" && request.isCurrent() === false) return false;
        return writeSettledDatasetAddress(request.dataset);
    });
}

/** Test-only reset of the coalescing state this module keeps between writes. */
export function resetDatasetAddressOwnershipForTests() {
    latestAddressRequest = null;
}
