// row_presentation_choice.js
// Remembers which row presentation the view picker's Article split button opens.
// Bridges the article presentation contract, the viewer's route grants and this tab's session storage.
// Exists so the split button's caption, menu check mark and primary click all read one choice.
// It also issues the tab-wide request ticket: this module loads with the
// toolbar, so a choice is recorded before any lazy opener import starts.
//
// Article, full image-first (IFAV) and Page-sized image-first are row
// presentations, not dataset renderers: only Article is also a dataset view.
// The choice is per dataset and per browser tab (sessionStorage), survives
// toolbar rebuilds and reloads, and never changes a server-side default.

import { HISTORY_ENTRY_ID } from "../../navigation/nav_engine/history_entry_state.js";
import { getApplicationAddressWriteRevision } from "../../navigation/nav_engine/address_write_revision.js";
import { getSelectedDataset } from "../../state_stores/dataset_selection_saver.js";
import { VIEW_DEACTIVATE_EVENT } from "../../../reusable_components/view_lifecycle_events.js";
import { canOpenArticleView } from "../card_view/article_view_access.js";
import { getTranslationForKey } from "../../lang/translation_handler.js";
import { getLanguageWithBrowserFallback } from "../../state_stores/lang_preference_reader.js";
import { getVerifiedSessionIdentity, subscribeToSessionGeneration, subscribeToVerifiedSessionIdentity } from "../../auth/session_generation_store.js";
import { datasetAppearanceState, ROW_OPENING_DEFAULTS_CHANGED } from "../dataset_appearance_state.js";
import { readTabSessionValue, writeTabSessionValue, removeTabSessionValue } from "../../state_stores/tab_session_storage.js";
import { showToast } from "../../../reusable_components/notifications/toast_notification_printer.js";
import {
    ARTICLE_VIEW_KEY,
    IMAGE_FIRST_VIEW_KEY,
    getDatasetViewLabelForLanguage,
} from "../dataset_view_registry.js";

export const IMAGE_FIRST_PAGE_VIEW_KEY = "image_first_page_view";
export const DEFAULT_ROW_PRESENTATION = ARTICLE_VIEW_KEY;
/** Language key of the chevron's and the menu's accessible name (seeded in 20261015000018). */
export const ROW_PRESENTATION_MENU_LANG_KEY = "article_presentations_title";

const CHOICE_KEY_SUFFIX = "_row_presentation";
const pageChoiceKeys = new Set();
const documentChoiceKeys = new Set();

// Built-in copy keeps a site without the reviewed rows readable; reviewed
// runtime translations stay authoritative through getTranslationForKey.
const PAGE_COPY = Object.freeze({
    fi: "Sivukokoinen kuvapainotteinen artikkeli",
    en: "Page-sized image-first article",
    ch: "页面大小的图片优先文章",
    yue: "頁面大小嘅圖片優先文章",
});
// Existing generic key (seeded in 20260817000008); it names no row and no reason.
export const ROW_PRESENTATION_FAILED_KEY = "load_failed";
const FAILED_COPY = Object.freeze({
    fi: "Lataus epäonnistui.",
    en: "Loading failed.",
    ch: "加载失败。",
    yue: "載入失敗。",
});
const MENU_COPY = Object.freeze({
    fi: "Artikkelin esitystavat",
    en: "Article presentations",
    ch: "文章展示方式",
    yue: "文章展示方式",
});

/** The three presentations in menu order. */
export const ROW_PRESENTATIONS = Object.freeze([
    Object.freeze({ viewKey: ARTICLE_VIEW_KEY, langKey: "view_article" }),
    Object.freeze({ viewKey: IMAGE_FIRST_VIEW_KEY, langKey: "view_image_first" }),
    Object.freeze({ viewKey: IMAGE_FIRST_PAGE_VIEW_KEY, langKey: "article_presentations_page" }),
]);

function pickLocale(copy, language) {
    const normalized = String(language || "").trim().toLowerCase().replaceAll("_", "-");
    if (normalized.startsWith("fi")) return copy.fi;
    if (normalized.startsWith("yue") || normalized.startsWith("zh-hk")) return copy.yue;
    if (normalized.startsWith("ch") || normalized.startsWith("zh")) return copy.ch;
    return copy.en;
}

export function isRowPresentation(viewKey) {
    return ROW_PRESENTATIONS.some((presentation) => presentation.viewKey === viewKey);
}

export function getRowPresentationLangKey(viewKey) {
    return ROW_PRESENTATIONS.find((presentation) => presentation.viewKey === viewKey)?.langKey || "";
}

/** The presentation's caption in the current UI language. */
export function getRowPresentationLabel(viewKey, language = getLanguageWithBrowserFallback()) {
    const fallback = viewKey === IMAGE_FIRST_PAGE_VIEW_KEY
        ? pickLocale(PAGE_COPY, language)
        : getDatasetViewLabelForLanguage(viewKey, language);
    return getTranslationForKey(getRowPresentationLangKey(viewKey), { fallback });
}

export function getUseRowPresentationDefaultLabel(language = getLanguageWithBrowserFallback()) {
    const fallback = pickLocale({ fi: "Käytä oletusta", en: "Use default", ch: "使用默认设置", yue: "使用預設" }, language);
    return getTranslationForKey("row_presentation_use_default", { fallback });
}

export function getRowPresentationMenuLabel(language = getLanguageWithBrowserFallback()) {
    return getTranslationForKey(ROW_PRESENTATION_MENU_LANG_KEY, { fallback: pickLocale(MENU_COPY, language) });
}

/**
 * Whether this viewer may open a presentation from the dataset's view picker.
 * Article and IFAV need the Article grant; Page has its own route. A dataset
 * whose default view is Article grants nothing here: the classic row opener
 * and the dataset renderer both refuse Article without the grant, so offering
 * it would only lead to a denial. The picker's own default-view exemption in
 * selectDatasetView is unchanged for its other callers. Nothing is widened, so
 * a Page-only reader never reaches the classic gate's paths.
 */
export function canChooseRowPresentation(tableName, viewKey) {
    return isRowPresentation(viewKey) && canOpenArticleView(viewKey);
}

export function listPermittedRowPresentations(tableName) {
    return ROW_PRESENTATIONS.map((presentation) => presentation.viewKey)
        .filter((viewKey) => canChooseRowPresentation(tableName, viewKey));
}

function buildChoiceKey(tableName) {
    return `${tableName}${CHOICE_KEY_SUFFIX}`;
}

/** The stored choice, or null when this tab has not chosen for the dataset. */
export function getStoredRowPresentation(tableName) {
    const key = buildChoiceKey(tableName);
    const stored = readTabSessionValue(key);
    const viewer = getVerifiedSessionIdentity();
    // Before verification only this document's own choices can be used. A
    // persisted owner is a comparison value, never proof of the current user.
    if (viewer === null) return documentChoiceKeys.has(key) && isRowPresentation(stored) ? stored : null;
    if (readTabSessionValue(`${key}_owner`) !== String(viewer)) {
        resetRowPresentationChoice(tableName);
        return null;
    }
    return isRowPresentation(stored) ? stored : null;
}

export function setRowPresentationChoice(tableName, viewKey) {
    if (!tableName || !isRowPresentation(viewKey)) return;
    const key = buildChoiceKey(tableName);
    pageChoiceKeys.add(key);
    documentChoiceKeys.add(key);
    writeTabSessionValue(key, viewKey);
    const viewer = getVerifiedSessionIdentity();
    if (viewer === null) removeTabSessionValue(`${key}_owner`);
    else writeTabSessionValue(`${key}_owner`, viewer);
}

/** Removing the user's override restores inheritance, including the page-memory fallback. */
export function resetRowPresentationChoice(tableName) {
    if (!tableName) return;
    const key = buildChoiceKey(tableName);
    removeTabSessionValue(key);
    removeTabSessionValue(`${key}_owner`);
    pageChoiceKeys.delete(key);
    documentChoiceKeys.delete(key);
}

/** Synchronous resolution for controls and links. A missing authorized snapshot is pending. */
export function readRowOpeningChoice(tableName, {
    viewKey = null, useTabChoice = true, permitted = listPermittedRowPresentations(tableName),
    defaults = datasetAppearanceState.savedRowDefaults(tableName),
} = {}) {
    const denied = { status: "denied", viewKey: null, source: null };
    const chosen = (value, source) => ({ status: "resolved", viewKey: value, source });
    if (!tableName || !permitted.length) return denied;
    if (viewKey !== null) return permitted.includes(viewKey) ? chosen(viewKey, "explicit") : denied;
    const stored = useTabChoice && getStoredRowPresentation(tableName);
    if (permitted.includes(stored)) return chosen(stored, "user");
    if (!defaults) return { status: "pending", viewKey: null, source: null };
    if (permitted.includes(defaults.dataset)) return chosen(defaults.dataset, "dataset");
    if (permitted.includes(defaults.site)) return chosen(defaults.site, "site");
    return permitted.includes(DEFAULT_ROW_PRESENTATION) ? chosen(DEFAULT_ROW_PRESENTATION, "classic") : denied;
}

let requestGeneration = 0;

function collectChoiceKeys() {
    const keys = new Set(pageChoiceKeys);
    try {
        for (let index = 0; index < sessionStorage.length; index += 1) {
            const key = sessionStorage.key(index);
            if (key?.endsWith(CHOICE_KEY_SUFFIX)) keys.add(key);
        }
    } catch { /* A blocked store keeps this document's writes in page memory. */ }
    return keys;
}

// Standalone sign-in may never load this module. Check retained owners when
// bootstrap (or resume) confirms the actual viewer, including the guest id.
subscribeToVerifiedSessionIdentity(viewer => {
    for (const key of collectChoiceKeys()) {
        if (readTabSessionValue(`${key}_owner`) !== String(viewer)) {
            resetRowPresentationChoice(key.slice(0, -CHOICE_KEY_SUFFIX.length));
        }
    }
    // Identity can arrive after the toolbar; refresh captions and check marks
    // when the pending choice becomes usable or is discarded.
    document.dispatchEvent(new CustomEvent(ROW_OPENING_DEFAULTS_CHANGED));
});

// Login and account switches can be broadcast while this tab remains open.
// Preserve independent tab choices on ordinary focus/visibility changes.
subscribeToSessionGeneration(reason => {
    if (["blur", "focus", "suspend", "resume", "restore"].includes(reason)) return;
    requestGeneration += 1;
    // Bootstrap has not verified the viewer yet. Retain storage for a possible
    // same-user reload, but require an owner match on the next read. Forget the
    // same-document exemption, including during an in-page bootstrap.
    if (reason === "bootstrap") { documentChoiceKeys.clear(); return; }
    for (const key of collectChoiceKeys()) {
        removeTabSessionValue(key);
        removeTabSessionValue(`${key}_owner`);
    }
    pageChoiceKeys.clear();
    documentChoiceKeys.clear();
    document.dispatchEvent(new CustomEvent(ROW_OPENING_DEFAULTS_CHANGED));
});

// These existing navigation events end pending activations permanently, even
// when Back returns to the very same entry before an asynchronous answer.
window.addEventListener("popstate", () => { requestGeneration += 1; });
let viewDeactivationRevision = 0;
document.addEventListener(VIEW_DEACTIVATE_EVENT, () => {
    viewDeactivationRevision += 1;
}, { capture: true });

/**
 * Captures an activation before any lazy import. A newer activation anywhere
 * in this tab, any application address write, a history move or view deactivation
 * ends it for good. The write revision also detects same-address replacements
 * and round trips made entirely between asynchronous guard checks. The entry,
 * address and selection checks also cover changes before rendering deactivates
 * the originating view; a failed check can never become true again.
 */
export function beginRowPresentationRequest(_tableName) {
    const generation = ++requestGeneration;
    let addressWriteRevision = getApplicationAddressWriteRevision();
    let address = location.href;
    let entryId = history.state?.[HISTORY_ENTRY_ID] ?? null;
    let dataset = getSelectedDataset();
    let viewRevision = viewDeactivationRevision;
    let current = true;
    const isCurrent = () => {
        current = current && generation === requestGeneration
            && viewRevision === viewDeactivationRevision
            && getApplicationAddressWriteRevision() === addressWriteRevision
            && location.href === address
            && (history.state?.[HISTORY_ENTRY_ID] ?? null) === entryId
            && getSelectedDataset() === dataset;
        return current;
    };
    // During the listing's own navigation its address is legitimately
    // changing. A newer activation or a history/session change still wins.
    isCurrent.isLatestRequest = () => current && generation === requestGeneration;
    // The caller owns origin stamping, deferred address settlement and the
    // dataset transition before its explicit article open. Adopt their writes
    // when they finish; a newer request, history move or failed guard still wins.
    // View revisions are ticket-local: an older pending transition must never
    // suppress deactivation of a newer request elsewhere in the document.
    isCurrent.withOwnAddressWrite = write => {
        if (!isCurrent()) return null;
        const adopt = () => {
            if (!current || generation !== requestGeneration) return;
            addressWriteRevision = getApplicationAddressWriteRevision();
            address = location.href;
            entryId = history.state?.[HISTORY_ENTRY_ID] ?? null;
            dataset = getSelectedDataset();
            viewRevision = viewDeactivationRevision;
        };
        const result = write();
        if (result?.then) return Promise.resolve(result).finally(adopt);
        adopt();
        return result;
    };
    return isCurrent;
}

/** One generic, localized notice for an opening that could not finish. Names no row. */
export function showRowPresentationFailed(language = getLanguageWithBrowserFallback()) {
    const content = document.createElement("span");
    content.dataset.langKey = ROW_PRESENTATION_FAILED_KEY;
    content.textContent = getTranslationForKey(ROW_PRESENTATION_FAILED_KEY, { fallback: pickLocale(FAILED_COPY, language) });
    showToast({ content, level: "warning" });
}
