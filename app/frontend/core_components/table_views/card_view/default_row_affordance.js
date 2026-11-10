// default_row_affordance.js
// Enables ordinary row controls for the presentation this dataset can actually open.
// A cold foreign link keeps its neutral address until the destination resolves its own settings.
import { readRowOpeningChoice, isRowPresentation } from "../row_presentation/row_presentation_choice.js";
import { bindArticleViewActivation, createArticleOpenerElement } from "./article_view_access.js";

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

/** Pin a known mode for a copied link, middle-click or new tab, using the target's settings. */
export function rowOpeningHref(href, tableName, choice = readRowOpeningChoice(tableName)) {
    const clean = new URL(href, location.href);
    // An explicit personal choice should also survive opening a link in a fresh tab.
    if (choice.status === "resolved") clean.searchParams.set("view", choice.viewKey);
    else if (isRowPresentation(clean.searchParams.get("view"))) clean.searchParams.delete("view");
    return clean.pathname + clean.search + clean.hash;
}

/** Refresh native link semantics when a retained card regains focus or its link is used. */
export function bindRowOpeningHref(link, href, tableName) {
    const refresh = () => {
        const choice = readRowOpeningChoice(tableName);
        // A denied enhanced presentation must not disable the ordinary row
        // link produced by main. It only means that no view mode may be pinned.
        link.href = rowOpeningHref(href, tableName, choice);
    };
    refresh();
    for (const type of ["focus", "pointerdown", "contextmenu", "click"]) {
        link.addEventListener(type, refresh);
    }
}
