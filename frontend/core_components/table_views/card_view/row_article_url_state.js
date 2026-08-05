// row_article_url_state.js
// Builds the query-string state used by row article deep links.
// Bridges dataset search/view URL params with the shared row article opener.
// Exists so article deep links preserve the active search while marking the view as article.

import { getParams, setParams } from "../../navigation/nav_engine/query_params.js";

export function buildRowArticleQueryString(tableName) {
    const params = {
        ...getParams(tableName),
        view: "article",
    };
    setParams(tableName, params);

    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
            searchParams.set(key, value);
        }
    });
    const query = searchParams.toString();
    return query ? `?${query}` : "";
}
