// row_article_data_fetcher.js
// Fetches one freshly authorized row for the expanded article presentation.
// Bridges a small-card row preview and the independent article field projection.
// Exists so card field choices never remove permitted article fields such as description.
import { fetchDatasetData } from "../../endpoints/endpoint_data_fetcher.js";

export const ROW_ARTICLE_VIEW_KEY = "article";

/**
 * Re-fetch one row through get-results before rendering the expanded article.
 * The backend applies current row and column permissions to this independent
 * projection. A missing result is therefore an authorization/lifecycle signal,
 * not a reason to reuse a stale card projection.
 */
export async function fetchPermittedRowArticleData({
    tableName,
    rowItem,
    requestRows = fetchDatasetData,
} = {}) {
    const normalizedTableName = String(tableName || "").trim();
    if (!normalizedTableName) {
        throw new Error("row article fetch requires a dataset name");
    }

    const rowID = rowItem?.id;
    if (rowID === null || rowID === undefined || String(rowID).trim() === "") {
        // Unsaved/local previews have no stable row that the server could
        // authorize again. Preserve the existing local-only behavior.
        return rowItem;
    }

    const response = await requestRows({
        dataset_name: normalizedTableName,
        filters: { id: rowID },
        view_key: ROW_ARTICLE_VIEW_KEY,
        callerName: "openRowArticleView",
    });
    const rows = Array.isArray(response?.data) ? response.data : [];
    const authorizedRow = rows.find((candidate) => String(candidate?.id) === String(rowID));
    if (!authorizedRow) {
        throw new Error("row article is no longer available");
    }
    return authorizedRow;
}
