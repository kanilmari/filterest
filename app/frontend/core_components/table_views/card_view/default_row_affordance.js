// default_row_affordance.js
// Enables ordinary row controls for the presentation this dataset can actually open.
// A cold foreign link keeps its neutral address until the destination resolves its own settings.
import { readRowOpeningChoice, isRowPresentation } from "../row_presentation/row_presentation_choice.js";
import { bindArticleViewActivation, createArticleOpenerElement } from "./article_view_access.js";
import { bindLiveLinkAddress, withAddressLanguage } from "../../navigation/nav_engine/live_link_address.js";
import { DATASET_PREFIX } from "../../navigation/nav_engine/query_params.js";
import { buildCardUrl, buildSlug } from "./row_article_opener_helpers.js";

// Only the reader's own choice is written into a link. A dataset's or the
// site's default, and the classic Article, are what the plain row address
// opens anyway (Image_First_Article.md, "Plain row address"), so the link keeps
// the address a search engine indexes and the server names as canonical.
const PINNED_CHOICE_SOURCES = new Set(["user", "explicit"]);

export function canActivateRow(tableName) {
    const choice = readRowOpeningChoice(tableName);
    return choice.status === "pending" || choice.status === "resolved";
}

export function createRowOpenerElement(tag, tableName) {
    return createArticleOpenerElement(tag, () => canActivateRow(tableName));
}

export function bindRowActivation(element, tableName, activate, options = {}) {
    return bindArticleViewActivation(element, activate, { ...options, canOpen: () => canActivateRow(tableName) });
}

/** Pin the reader's own presentation for a copied link, middle-click or new tab. */
export function rowOpeningHref(href, tableName, choice = readRowOpeningChoice(tableName)) {
    const clean = new URL(href, location.href);
    // An explicit personal choice should also survive opening a link in a fresh tab.
    if (choice.status === "resolved" && PINNED_CHOICE_SOURCES.has(choice.source)) {
        clean.searchParams.set("view", choice.viewKey);
    } else if (isRowPresentation(clean.searchParams.get("view"))) clean.searchParams.delete("view");
    return clean.pathname + clean.search + clean.hash;
}

/**
 * The readable address of a row's article as a link gives it:
 * /{public dataset name}/{id}-{words}, with the page's address language. The
 * words are built from the article's title, as the article itself writes them
 * (row_article_opener.js) and the server judges them (resolveArticleDocument),
 * so the link is not redirected. List filters and views are left out.
 */
export function rowArticleLinkAddress(tableName, rowId, titleText) {
    return withAddressLanguage(buildCardUrl(DATASET_PREFIX, tableName, rowId, buildSlug(titleText)));
}

/**
 * Keeps a row link's address current while its card stays on the page.
 * @param {HTMLAnchorElement} link
 * @param {string | (() => string)} href - the row's address, or a reader of it
 * @param {string} tableName
 */
export function bindRowOpeningHref(link, href, tableName) {
    // A denied enhanced presentation must not disable the ordinary row link
    // produced by main. It only means that no view mode may be pinned.
    bindLiveLinkAddress(link, () => rowOpeningHref(typeof href === "function" ? href() : href, tableName));
}
