// browser_tab_title_writer.js
// Owns the browser tab title for every state the application reaches after the first page load.
// Bridges settled navigation, view selection, article open/close, search and history restoration
// with the one document.title the browser shows.
// The title opens with the words the application's own tab shows, so the browser tab and the
// tab bar name the same thing.
// Exists because the server only titles the initial HTML, so without an owner the tab kept
// describing whatever was last fully loaded.

import { hasLoadedTranslations, readTranslatedLabelOrEmpty } from "../../lang/translation_handler.js";
import {
    getCurrentSiteName,
    titleAlreadyOpensWithSiteName,
} from "../../state_stores/site_identity_reader.js";
import { getTableSpec } from "../../state_stores/table_specs_reader.js";
import { getSelectedDataset } from "../../state_stores/dataset_selection_saver.js";
import { getMainTabLangKey } from "../main_tabs/main_tab_lang_keys.js";
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
 * Produces "Article — Application tab — Site", "Application tab — Site" or the bare
 * site name, exactly as `seo_meta_builder.go` does for the initial HTML.
 *
 * The site part is left out when the application tab's own label already opens with
 * the site name, so a title such as "Serlog.com – Service catalog" names the site
 * once instead of twice. The dataset heading applies that same rule.
 */
export function composeBrowserTabTitle({
    articleTitle = "",
    tabTitle = "",
    siteName = "",
} = {}) {
    const readableTabTitle = String(tabTitle ?? "").trim();
    const readableSiteName = String(siteName ?? "").trim();
    const sitePart = titleAlreadyOpensWithSiteName(readableTabTitle, readableSiteName)
        ? ""
        : readableSiteName;

    return [String(articleTitle ?? "").trim(), readableTabTitle, sitePart]
        .filter(Boolean)
        .join(BROWSER_TAB_TITLE_SEPARATOR);
}

/**
 * Turns a raw dataset name into the readable fallback the server also uses
 * when the dataset has no translated tab label and no front-page title.
 */
export function humanizeDatasetNameForTitle(datasetName) {
    return String(datasetName || "")
        .replace(/_/g, " ")
        .replace(/\b\p{Ll}/gu, (letter) => letter.toLocaleUpperCase())
        .trim();
}

/**
 * Resolves which application tab the address describes: the dataset a dataset tab
 * opened, or the view name of a tab that is not a dataset, such as an administrator
 * page or the account view.
 * The URL path owns that identity, the same way it does on the server.
 *
 * @param {string} [pathname] Address to read; the current one by default.
 * @returns {{ name: string, isDataset: boolean }} Tab identity, empty when there is none.
 */
export function readBrowserTabIdentity(pathname = window.location.pathname) {
    const prefix = getPrefixFromPathname(pathname, DATASET_PREFIX);
    if (!prefix) {
        // The site root names no tab of its own, yet the application opens a dataset
        // tab there and that is the tab the person is looking at. The stored selection
        // is the application's own answer to which one, and only a dataset is ever
        // stored, so a custom view cannot arrive here.
        const restoredDataset = getSelectedDataset();
        return restoredDataset
            ? { name: restoredDataset, isDataset: true }
            : { name: "", isDataset: false };
    }
    const { name } = parseDeepLink(pathname.slice(prefix.length));
    if (!name) {
        return { name: "", isDataset: false };
    }
    // An administrator page is never a dataset, and neither is a custom view that
    // happens to sit on the dataset prefix.
    const isDataset = prefix !== ADMIN_PATH_PREFIX
        && (Boolean(getTableSpec(name)) || getSelectedDataset() === name);
    return { name, isDataset };
}

/**
 * Resolves the dataset name the tab title should describe, or "" when the person is
 * not on a dataset tab. Only a dataset can hold an open article.
 */
export function readBrowserTabTitleDatasetName(
    pathname = window.location.pathname
) {
    const { name, isDataset } = readBrowserTabIdentity(pathname);
    return isDataset ? name : "";
}

/**
 * Resolves the label the application's own tab bar shows for this tab, from the very
 * same language key it prints (`main_tab_lang_keys.js`), so the browser tab opens with
 * the words the person just clicked and follows the interface language in fi, en, ch
 * and yue.
 *
 * A dataset keeps a fallback chain for an installation that has not translated its tab
 * label: the dataset's front-page heading, its administrator-given display name, and
 * finally a readable form of its raw name — the same order the server uses.
 * A tab that is not a dataset has only its own key, because inventing a title out of a
 * URL segment would name the tab something the interface never calls it.
 */
function resolveTabTitleForBrowserTab({ name, isDataset }) {
    if (!name) {
        return "";
    }
    const tabLabel = readTranslatedLabelOrEmpty(getMainTabLangKey(name));
    if (!isDataset) {
        return tabLabel;
    }
    return tabLabel
        || readTranslatedLabelOrEmpty(`${name}_front_page`)
        || String(getTableSpec(name)?.display_name || "").trim()
        || humanizeDatasetNameForTitle(name);
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
    const identity = readBrowserTabIdentity();
    return composeBrowserTabTitle({
        articleTitle: readOpenArticleTitleForBrowserTab(
            identity.isDataset ? identity.name : ""
        ),
        tabTitle: resolveTabTitleForBrowserTab(identity),
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
