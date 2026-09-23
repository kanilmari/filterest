// row_article_url_state.js
// Builds the query-string state used by row article deep links.
// Bridges dataset search/view URL params with the shared row article opener.
// Exists so article deep links preserve the active search while marking the view as article.

import { getParams, setParams } from "../../navigation/nav_engine/query_params.js";
import { serializeDatasetQuery } from "../../navigation/nav_engine/dataset_address_writer.js";

export function buildRowArticleQueryString(tableName) {
    const params = {
        ...getParams(tableName),
        view: "article_view",
    };
    setParams(tableName, params);
    // The dataset address owner spells every dataset query; this link is one of them.
    return serializeDatasetQuery(params);
}
