// row_presentation_opener.js
// Opens the full or Page-sized image-first presentation chosen in the view picker.
// Bridges the row-target rule, the shared image-first opener and its history and permission gates.
// Exists so an explicit choice opens one current, permitted row and nothing stale.
//
// Article is not opened here: the split button hands it to the view picker's
// existing classic path unchanged. IFAV and Page open over the current listing,
// which stays the history origin, so Back, Close and Escape return to it.

import { getDatasetListingSignature } from "../../infinite_scroll/dataset_listing_filters.js";
import { getUnifiedTableState } from "../../state_stores/table_state_store.js";
import { getSelectedDataset } from "../../state_stores/dataset_selection_saver.js";
import { getLanguageWithBrowserFallback } from "../../state_stores/lang_preference_reader.js";
import { getTranslationForKey } from "../../lang/translation_handler.js";
import { showToast } from "../../../reusable_components/notifications/toast_notification_printer.js";
import { showArticleViewAccessDenied } from "../card_view/article_view_access.js";
import { IMAGE_FIRST_VIEW_KEY } from "../dataset_view_registry.js";
import {
    IMAGE_FIRST_PAGE_VIEW_KEY,
    beginRowPresentationRequest,
    canChooseRowPresentation,
    showRowPresentationFailed,
} from "./row_presentation_choice.js";
import { resolveRowPresentationTarget } from "./row_presentation_target.js";

const NO_RESULTS_KEY = "no_results";
const NO_RESULTS_COPY = Object.freeze({ fi: "Ei tuloksia", en: "No results", ch: "没有结果", yue: "沒有結果" });

function showNoRowsNotice() {
    const language = getLanguageWithBrowserFallback();
    const locale = language === "zh-HK" || language.startsWith("yue") ? "yue"
        : language.startsWith("zh") ? "ch" : language.slice(0, 2);
    const content = document.createElement("span");
    content.dataset.langKey = NO_RESULTS_KEY;
    content.textContent = getTranslationForKey(NO_RESULTS_KEY, { fallback: NO_RESULTS_COPY[locale] || NO_RESULTS_COPY.en });
    showToast({ content, level: "info" });
}

/**
 * @param {Object} options
 * @param {string} options.tableName
 * @param {string} options.viewKey image_first_view or image_first_page_view.
 * @param {() => boolean} [options.isRequestCurrent] the split button's ticket,
 *        issued before the lazy import; a direct caller gets a fresh one.
 * @returns {Promise<{status: string, rowId?: string|number}>} opened, empty,
 *          denied, unavailable, failed, cancelled, stale or unsupported.
 *          Nothing opens unless the status is "opened". Empty shows the
 *          no-results notice, denied the shared route denial; unavailable and
 *          failed show one generic notice; stale and cancelled stay silent.
 */
export async function openChosenRowPresentation({
    tableName,
    viewKey,
    isRequestCurrent = null,
    resolveTarget = resolveRowPresentationTarget,
    loadOpener = () => import("../card_view/image_first_view_opener.js"),
    notifyEmpty = showNoRowsNotice,
    notifyFailed = showRowPresentationFailed,
} = {}) {
    if (![IMAGE_FIRST_VIEW_KEY, IMAGE_FIRST_PAGE_VIEW_KEY].includes(viewKey) || !tableName) {
        return { status: "unsupported" };
    }
    // A later activation (Article included), another dataset or any address
    // change (Back, Forward, a link) supersedes this one before it opens anything.
    const requestIsCurrent = isRequestCurrent || beginRowPresentationRequest(tableName);
    if (!canChooseRowPresentation(tableName, viewKey)) {
        showArticleViewAccessDenied();
        return { status: "denied" };
    }
    const startAddress = location.href;
    const listingSignature = () => {
        const state = getUnifiedTableState(tableName) || {};
        return getDatasetListingSignature(tableName, state.filters, state.sort || {});
    };
    // The same signature guards the first answer, lazy imports, record loading,
    // rendering and the shared opener's final history commit.
    const startListingSignature = listingSignature();
    const isCurrent = () => requestIsCurrent()
        && location.href === startAddress
        && getSelectedDataset() === tableName
        && listingSignature() === startListingSignature;
    const fail = (status, rowId) => {
        if (!isCurrent()) return { status: "stale" };
        notifyFailed();
        return rowId == null ? { status } : { status, rowId };
    };

    const target = await resolveTarget(tableName, { isCurrent });
    if (!isCurrent()) return { status: "stale" };
    if (target?.rowId == null) {
        if (target?.status === "stale") return { status: "stale" };
        if (target?.status === "empty") {
            notifyEmpty();
            return { status: "empty" };
        }
        // A failed listing request or an embedded surface whose listing this
        // module cannot read: say it did not open instead of doing nothing.
        return fail(target?.status === "unsupported" ? "unsupported" : target?.status || "failed");
    }
    let denied = false;
    let rowUnavailable = false;
    try {
        const { openImageFirstView } = await loadOpener();
        if (!isCurrent()) return { status: "stale" };
        // The opener fetches the permitted record again with its current
        // fields; only the id travels from here.
        const result = await openImageFirstView({
            tableName,
            rowItem: { id: target.rowId },
            layout: viewKey === IMAGE_FIRST_PAGE_VIEW_KEY ? "page" : "image_first",
            presentationChoice: true,
            isCurrent,
            // The opener already showed the shared route denial; never add a second notice.
            onAccessDenied: () => { denied = true; },
            onRowUnavailable: () => { rowUnavailable = true; },
        });
        if (result) {
            return { status: "opened", rowId: target.rowId };
        }
        if (denied) return { status: "denied", rowId: target.rowId };
        if (rowUnavailable) return fail("unavailable", target.rowId);
        // Superseded, or the navigation pipeline stopped it (for example the
        // person kept unsaved changes): both are silent.
        return { status: isCurrent() ? "cancelled" : "stale", rowId: target.rowId };
    } catch (error) {
        if (error?.name === "AbortError") return { status: "stale" };
        console.warn("chosen row presentation could not be opened", error?.message || error);
        return fail("failed", target.rowId);
    }
}
