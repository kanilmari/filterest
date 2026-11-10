// Resolve a row URL before the boot or popstate handler changes the backing collection.
// A recorded presentation belongs to this row's history entry; a list view describes its backdrop.
import { getHistoryDatasetView } from "./history_entry_state.js";
import { resolveDatasetDefaultView } from "../../table_views/dataset_default_view.js";
import { hasRoutePermission } from "../../route_permission_checker.js";
import { getDatasetViewPermissionRoute, isRenderableDatasetView, resolveDatasetViewSelectionTarget } from "../../table_views/dataset_view_registry.js";
import { isRowPresentation, showRowPresentationFailed } from "../../table_views/row_presentation/row_presentation_choice.js";
import { resolveRowOpening } from "../../table_views/row_presentation/row_presentation_dispatcher.js";
import { showArticleViewAccessDenied } from "../../table_views/card_view/article_view_access.js";

export async function resolveRowAddress(tableName, rowId, requestedView, isCurrent) {
    const saved = history.state;
    let viewKey = resolveDatasetViewSelectionTarget(requestedView);
    if (!isRowPresentation(viewKey)) {
        const image = saved?.imageFirstView;
        if (saved?.bigCard && saved.dataset === tableName && String(saved.rowId) === String(rowId)) {
            viewKey = "article_view";
        } else if (image?.dataset === tableName && String(image.rowId) === String(rowId)) {
            viewKey = image.viewKey;
        } else {
            viewKey = getHistoryDatasetView(tableName);
        }
    }
    const explicit = isRowPresentation(viewKey) ? viewKey : null;
    const choice = await resolveRowOpening(tableName, { rowId, viewKey: explicit, isCurrent });
    if (!isCurrent()) return { status: "stale" };
    if (choice.status === "denied") showArticleViewAccessDenied();
    if (choice.status === "failed" || choice.status === "stale") showRowPresentationFailed();
    return choice;
}

/** Restore a permitted collection when the requested row disappeared during its lookup. */
export function rowBackingCollection(tableName, preferred) {
    const datasetDefault = resolveDatasetDefaultView(tableName);
    return [preferred, datasetDefault, "card", "table", "normal", "calendar", "product_card", "transposed"]
        .find(view => isRenderableDatasetView(view) && !isRowPresentation(view)
            && (view === datasetDefault || hasRoutePermission(getDatasetViewPermissionRoute(view)))) || null;
}
