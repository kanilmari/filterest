// browser_tab_title_writer.js
// Owns the browser tab title for every state the application reaches after the first page load.
// Bridges settled navigation, view selection, article open/close, search and history restoration
// with the one document.title the browser shows.
// Exists because the server only titles the initial HTML, so without an owner the tab kept
// describing whatever was last fully loaded.

import { hasLoadedTranslations, readTranslatedLabelOrEmpty } from "../../lang/translation_handler.js";
import {
    getCurrentSiteName,
    titleAlreadyOpensWithSiteName,
} from "../../state_stores/site_identity_reader.js";
import { getTableSpec } from "../../state_stores/table_specs_reader.js";
import { getSelectedDataset } from "../../state_stores/dataset_selection_saver.js";
import { DATASET_PREFIX } from "./query_params.js";
import { getPrefixFromPathname, parseDeepLink } from "./history_navigation_handler_helpers.js";

/** Same separator the server uses when it builds the first-load title. */
const BROWSER_TAB_TITLE_SEPARATOR = " — ";

const ADMIN_PATH_PREFIX = "/admin/";

let latestTitleRequest = null;
/** The server owns the title until this module has written it once. */
let hasWrittenBrowserTabTitle = false;
let languageChangeObserver = null;

/**
 * Joins the parts of a tab title in the server's order and drops empty parts.
 * Produces "Article — Dataset — Site", "Dataset — Site" or the bare site name,
 * exactly as `seo_meta_builder.go` does for the initial HTML.
 *
 * The site part is left out when the dataset's own title already opens with the
 * site name, so a stored title such as "Serlog.com – Service catalog" names the
 * site once instead of twice. The dataset heading applies that same rule.
 */
export function composeBrowserTabTitle({
    articleTitle = "",
    datasetTitle = "",
    siteName = "",
} = {}) {
    const readableDatasetTitle = String(datasetTitle ?? "").trim();
    const readableSiteName = String(siteName ?? "").trim();
    const sitePart = titleAlreadyOpensWithSiteName(readableDatasetTitle, readableSiteName)
        ? ""
        : readableSiteName;

    return [String(articleTitle ?? "").trim(), readableDatasetTitle, sitePart]
        .filter(Boolean)
        .join(BROWSER_TAB_TITLE_SEPARATOR);
}

/**
 * Turns a raw dataset name into the readable fallback the server also uses
 * when the dataset has no translated front-page title.
 */
export function humanizeDatasetNameForTitle(datasetName) {
    return String(datasetName || "")
        .replace(/_/g, " ")
        .replace(/\b\p{Ll}/gu, (letter) => letter.toLocaleUpperCase())
        .trim();
}

/**
 * Resolves the dataset name the tab title should describe.
 * The URL path owns that identity, the same way it does on the server, so a
 * custom view or an administrator page yields no dataset and only the site name.
 */
export function readBrowserTabTitleDatasetName(
    pathname = window.location.pathname
) {
    const prefix = getPrefixFromPathname(pathname, DATASET_PREFIX);
    if (!prefix || prefix === ADMIN_PATH_PREFIX) {
        return "";
    }
    const { name } = parseDeepLink(pathname.slice(prefix.length));
    if (!name) {
        return "";
    }
    // Only a real dataset gets a dataset title; custom views are not datasets.
    const isKnownDataset = Boolean(getTableSpec(name)) || getSelectedDataset() === name;
    return isKnownDataset ? name : "";
}

/**
 * Resolves the dataset title from the same translated copy the interface shows,
 * so the tab follows the chosen interface language in fi, en, ch and yue.
 */
function resolveDatasetTitleForBrowserTab(datasetName) {
    if (!datasetName) {
        return "";
    }
    return readTranslatedLabelOrEmpty(`${datasetName}_front_page`)
        || readTranslatedLabelOrEmpty(datasetName)
        || String(getTableSpec(datasetName)?.display_name || "").trim()
        || humanizeDatasetNameForTitle(datasetName);
}

/**
 * Reads the open article's own heading, exactly as the person reads it on screen.
 * Returns an empty string when no article is open, which drops the article part.
 */
function readOpenArticleTitleForBrowserTab(datasetName) {
    if (!datasetName) {
        return "";
    }
    const datasetContainer = document.getElementById(`${datasetName}_container`);
    if (!datasetContainer) {
        return "";
    }
    const openArticle = datasetContainer.querySelector(
        ".active_row_article, .active_big_card"
    );
    if (!openArticle) {
        return "";
    }
    const heading = openArticle.querySelector(".big_card_header_value")
        || openArticle.querySelector(".big_card_header");
    return String(heading?.textContent || "").trim();
}

/** Resolves the whole title from the state the application is in right now. */
function resolveBrowserTabTitle() {
    const datasetName = readBrowserTabTitleDatasetName();
    return composeBrowserTabTitle({
        articleTitle: readOpenArticleTitleForBrowserTab(datasetName),
        datasetTitle: resolveDatasetTitleForBrowserTab(datasetName),
        siteName: getCurrentSiteName(),
    });
}

function writeResolvedBrowserTabTitle(expectedDataset) {
    const datasetName = readBrowserTabTitleDatasetName();
    // A late answer about a dataset the person already left must not relabel
    // the newer state it would land on.
    if (expectedDataset && datasetName && expectedDataset !== datasetName) {
        return false;
    }
    // Before translations arrive the readable copy is not available yet, and the
    // server's own first-load title is still the better one.
    if (!hasWrittenBrowserTabTitle && !hasLoadedTranslations()) {
        return false;
    }
    const nextTitle = resolveBrowserTabTitle();
    if (!nextTitle) {
        return false;
    }
    hasWrittenBrowserTabTitle = true;
    if (document.title === nextTitle) {
        return false;
    }
    document.title = nextTitle;
    return true;
}

/**
 * Asks this module to retitle the browser tab for a settled state.
 *
 * The write happens on the next microtask so the boundary's own synchronous DOM
 * work (for example connecting the opened article) is finished first, and so
 * several boundaries inside one transition produce a single title. Only the
 * newest request writes: an older asynchronous completion is dropped.
 *
 * @param {{ dataset?: string|null }} [options] Dataset the caller was settling,
 *        used only to recognise and drop a stale completion.
 * @returns {Promise<boolean>} Resolves true when this request wrote the title.
 */
export function updateBrowserTabTitle({ dataset = null } = {}) {
    startBrowserTabTitleOwnership();
    const request = { dataset };
    latestTitleRequest = request;
    return Promise.resolve().then(() => {
        if (latestTitleRequest !== request) {
            return false;
        }
        latestTitleRequest = null;
        return writeResolvedBrowserTabTitle(request.dataset);
    });
}

function handleRowArticleToggle(event) {
    void updateBrowserTabTitle({ dataset: event?.detail?.tableName || null });
}

function handleInterfaceLanguageChanged() {
    // Only once this module already owns the title; the first load keeps the
    // server's own translated title.
    if (!hasWrittenBrowserTabTitle) {
        return;
    }
    void updateBrowserTabTitle();
}

/**
 * Subscribes the title owner to the two boundaries that announce themselves
 * instead of calling in: an article opening or closing, and the interface
 * language changing. Safe to call more than once.
 *
 * It runs on the first title request rather than while this module is being
 * evaluated, so a shared import cycle can never leave a subscription unbound.
 */
function startBrowserTabTitleOwnership() {
    if (languageChangeObserver) {
        return;
    }
    document.addEventListener("row-article-toggle", handleRowArticleToggle);
    languageChangeObserver = new MutationObserver(handleInterfaceLanguageChanged);
    languageChangeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["lang"],
    });
}

/** Test-only reset of the ownership state this module keeps between writes. */
export function resetBrowserTabTitleOwnershipForTests() {
    latestTitleRequest = null;
    hasWrittenBrowserTabTitle = false;
    document.removeEventListener("row-article-toggle", handleRowArticleToggle);
    languageChangeObserver?.disconnect();
    languageChangeObserver = null;
}
