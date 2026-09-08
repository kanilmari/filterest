// dataset_search_response_reader.js
// Reads authorized streamed search packets without owning visible dataset state.
// Connects the shared endpoint pipeline to request-generation checks and NDJSON parsing.
// Cancels obsolete readers so delayed responses cannot escape into a newer search.

import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { ROW_GROUP_FILTER_KEY } from "../filter_list/row_group_facet_printer.js";

/** Read one search through the usual permission, CSRF and session pipeline. */
export async function* readDatasetSearchResponse(tableName, query, options, isCurrent) {
    let url_params = "&dataset=" + encodeURIComponent(tableName) + "&query=" + encodeURIComponent(query);
    if (options.filters && Object.keys(options.filters).length) {
        url_params += "&filters=" + encodeURIComponent(JSON.stringify(options.filters));
    }
    if (options.rowGroupSlug) url_params += "&" + ROW_GROUP_FILTER_KEY + "=" + encodeURIComponent(options.rowGroupSlug);
    if (["card", "article_view", "product_card"].includes(options.view)) url_params += "&include_card_support=1";
    if (options.useLocation && typeof options.gps?.lat === "number" && typeof options.gps?.lon === "number") {
        url_params += "&gps=" + encodeURIComponent(options.gps.lat + "," + options.gps.lon);
    }
    const response = await endpoint_router("getIntelligentResultsStream", {
        url_params, headers: { Accept: "application/x-ndjson" }, stream: true,
    });
    const reader = response.body.getReader();
    let finished = false;
    const decoder = new TextDecoder();
    let buffer = "";
    try {
        while (isCurrent()) {
            const { value, done } = await reader.read();
            if (!isCurrent()) return;
            buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = done ? "" : lines.pop();
            for (const line of lines) {
                if (!isCurrent()) return;
                if (!line.trim()) continue;
                let packet;
                try { packet = JSON.parse(line); }
                catch { console.warn("[dataset_search] skipping malformed search packet"); continue; }
                yield packet;
            }
            if (done) { finished = true; return; }
        }
    } finally {
        if (!finished) await reader.cancel();
        reader.releaseLock?.();
    }
}
