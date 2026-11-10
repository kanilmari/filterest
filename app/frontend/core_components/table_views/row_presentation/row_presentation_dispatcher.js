// Resolves ordinary row openings against the target dataset's authorized settings.
// A configured presentation is never used to grant permission or substitute another row.
import { datasetAppearanceState } from "../dataset_appearance_state.js";
import { fetchDatasetData } from "../../endpoints/endpoint_data_fetcher.js";
import { showArticleViewAccessDenied } from "../card_view/article_view_access.js";
import {
    beginRowPresentationRequest, canChooseRowPresentation, DEFAULT_ROW_PRESENTATION,
    IMAGE_FIRST_PAGE_VIEW_KEY, listPermittedRowPresentations, readRowOpeningChoice, showRowPresentationFailed,
} from "./row_presentation_choice.js";

const outcome = status => ({ status, viewKey: null, source: null });

/** Read an authorized appearance snapshot on cold direct links and foreign-dataset links. */
export async function resolveRowOpening(tableName, { rowId = null, viewKey = null, useTabChoice = true, isCurrent = () => true,
    permitted: targetGrants = null } = {}) {
    if (!isCurrent()) return outcome("stale");
    // A target-specific grant can narrow the viewer's grants, including after a cold read.
    const allowed = () => listPermittedRowPresentations(tableName).filter(key => !targetGrants || targetGrants.includes(key));
    const choose = () => readRowOpeningChoice(tableName, { viewKey, useTabChoice, permitted: allowed() });
    const decision = choose();
    if (decision.status !== "pending") return decision;

    const token = datasetAppearanceState.capture(tableName);
    const permitted = allowed();
    // Full IFAV shares Article's projection. Page-only readers use their own route.
    const projection = permitted.includes(DEFAULT_ROW_PRESENTATION) ? DEFAULT_ROW_PRESENTATION : IMAGE_FIRST_PAGE_VIEW_KEY;
    if (!permitted.includes(projection)) return outcome("denied");
    try {
        const response = await fetchDatasetData({
            dataset_name: tableName, view_key: projection, row_count: 0,
            filters: rowId == null ? { limit: 1 } : { id: rowId, limit: 1 }, callerName: "rowOpeningDefaults",
        });
        if (!isCurrent() || !datasetAppearanceState.isCurrent(token)) return outcome("stale");
        if (response?.error || !response?.dataset_appearance
            || (rowId != null && !response.data?.some(item => String(item.id) === String(rowId)))) {
            return outcome("failed");
        }
        if (!datasetAppearanceState.accept(tableName, response.dataset_appearance, { token, isCurrent })) {
            // A newer authorized response can legitimately win the race.
            if (!isCurrent() || !datasetAppearanceState.isCurrent(token)) return outcome("stale");
        }
        const resolved = choose();
        return resolved.status === "pending" ? outcome("failed") : resolved;
    } catch (error) {
        return outcome(!isCurrent() || error?.name === "AbortError" ? "stale" : "failed");
    }
}

/** Dispatch the exact row. Explicit links never write a tab preference. */
export async function openDefaultRowPresentation(rowItem, tableName, selectedCard = null, {
    viewKey = null, isCurrent: callerIsCurrent = () => true, restoringHistory = false, openClassic = null, search,
} = {}) {
    if (rowItem?.id == null || !tableName) return outcome("failed");
    const ticket = beginRowPresentationRequest(tableName);
    const isCurrent = () => ticket() && callerIsCurrent();
    const decision = await resolveRowOpening(tableName, { viewKey, rowId: rowItem.id, isCurrent });
    if (!isCurrent()) return outcome("stale");
    if (decision.status === "denied") showArticleViewAccessDenied();
    if (decision.status === "failed") showRowPresentationFailed();
    if (decision.status !== "resolved") return decision;
    try {
        if (decision.viewKey === DEFAULT_ROW_PRESENTATION) {
            const open = openClassic || (await import("../card_view/row_article_opener.js")).openRowArticleView;
            if (!isCurrent()) return outcome("stale");
            if (!canChooseRowPresentation(tableName, decision.viewKey)) {
                showArticleViewAccessDenied();
                return outcome("denied");
            }
            await open(rowItem, tableName, selectedCard, { isCurrent, withOwnAddressWrite: ticket.withOwnAddressWrite,
                isLatestRequest: () => ticket.isLatestRequest() && callerIsCurrent() });
            return { ...decision, status: "dispatched" }; // Classic owns its final navigation outcome.
        }
        const { openImageFirstView } = await import("../card_view/image_first_view_opener.js");
        if (!isCurrent()) return outcome("stale");
        let status = "cancelled";
        const opened = await openImageFirstView({
            tableName, rowItem: { id: rowItem.id }, selectedCard, presentationChoice: true,
            layout: decision.viewKey === IMAGE_FIRST_PAGE_VIEW_KEY ? "page" : "image_first",
            isCurrent, restoringHistory, search,
            onAccessDenied: () => { status = "denied"; },
            onRowUnavailable: () => { status = "failed"; },
        });
        if (opened) return { ...decision, status: "opened" };
        if (!isCurrent()) return outcome("stale");
        if (status === "failed") showRowPresentationFailed();
        return outcome(status);
    } catch (error) {
        if (!isCurrent() || error?.name === "AbortError") return outcome("stale");
        showRowPresentationFailed();
        return outcome("failed");
    }
}
