// row_presentation_target.js
// Decides which row the view picker's image-first presentations open.
// Bridges the open article, the dataset's listing conditions and a fresh first-page request.
// Exists so the split button never opens a row from old results or an arbitrary one.
//
// Rule: the row of the article already open in this dataset; otherwise the
// first row of the dataset's current listing, asked from the server now with
// the listing's own filters, committed search and sort. An empty listing opens
// nothing. The classic Article choice does not use this module: it keeps the
// existing view-selection path, which opens the first row of the list it draws.

import { fetchDatasetData } from "../../endpoints/endpoint_data_fetcher.js";
import { getDatasetListingFilters, getDatasetListingSignature } from "../../infinite_scroll/dataset_listing_filters.js";
import { getDatasetQueryAdapter } from "../../filterbar/dataset_surface_provider/dataset_query_adapter_registry.js";
import { getUnifiedTableState } from "../../state_stores/table_state_store.js";
import { getChosenDatasetView } from "../../state_stores/dataset_view_choice_saver.js";
import { ARTICLE_VIEW_KEY, resolveDatasetViewSelectionTarget } from "../dataset_view_registry.js";

/** The id of the row whose classic article is open in this dataset, or null. */
export function readActiveArticleRowId(tableName) {
    if (getChosenDatasetView(tableName) !== ARTICLE_VIEW_KEY) return null;
    const wrapper = document.getElementById(`${tableName}_article_view_container`)
        ?.querySelector(".card_view_wrapper.big-card-open");
    if (!wrapper) return null;
    const article = wrapper.querySelector(".active_row_article");
    const rowId = article?._row?.id ?? getUnifiedTableState(tableName)?.articleView?.expandedId;
    return rowId ?? null;
}

/**
 * Asks the server for the first row of the listing as it is now. The answer is
 * discarded when the listing's conditions or order changed while it was asked.
 *
 * @returns {Promise<{status: 'listing', rowId: string|number} | {status: 'empty'|'stale'|'failed'|'unsupported'}>}
 */
export async function fetchFirstListedRowId(tableName, { isCurrent = () => true, fetchRows = fetchDatasetData } = {}) {
    // Embedded dataset surfaces own their listing through an adapter this
    // module cannot read without drawing it.
    if (getDatasetQueryAdapter(tableName)) return { status: "unsupported" };
    const state = getUnifiedTableState(tableName) || {};
    const sort = state.sort || {};
    const signature = getDatasetListingSignature(tableName, state.filters, sort);
    const viewKey = resolveDatasetViewSelectionTarget(getChosenDatasetView(tableName) || "table");
    let result;
    try {
        result = await fetchRows({
            dataset_name: tableName,
            offset: 0,
            sort_column: sort.column ?? null,
            sort_order: sort.direction ?? null,
            filters: { ...getDatasetListingFilters(tableName, state.filters), limit: 1 },
            callerName: "rowPresentationFirstListedRow",
            view_key: viewKey,
        });
    } catch (error) {
        if (error?.name === "AbortError") return { status: "stale" };
        console.warn("row presentation listing request failed", error?.message || error);
        return { status: "failed" };
    }
    if (!isCurrent()) return { status: "stale" };
    const now = getUnifiedTableState(tableName) || {};
    if (getDatasetListingSignature(tableName, now.filters, now.sort || {}) !== signature) return { status: "stale" };
    if (!result || result.error || result.success === false) return { status: "failed" };
    const firstRow = (result.data || result.rows || []).find((row) => row?.id != null);
    return firstRow ? { status: "listing", rowId: firstRow.id } : { status: "empty" };
}

/** The open article's row, otherwise the current listing's first row. */
export async function resolveRowPresentationTarget(tableName, options = {}) {
    const activeRowId = readActiveArticleRowId(tableName);
    if (activeRowId != null) return { status: "active", rowId: activeRowId };
    return fetchFirstListedRowId(tableName, options);
}
