// dataset_search_response_reader.js
// Reads authorized streamed search packets without owning visible dataset state.
// Connects the shared endpoint pipeline to request-generation checks and NDJSON parsing.
// Cancels obsolete readers so delayed responses cannot escape into a newer search.

import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { getLanguageWithBrowserFallback } from "../../state_stores/lang_preference_reader.js";
import { ROW_GROUP_FILTER_KEY } from "../filter_list/row_group_facet_printer.js";

/**
 * Read one search through the usual permission, CSRF and session pipeline.
 * The interface language travels as the reader's language: the server searches
 * every content language regardless and only ranks matches in this one first.
 */
export async function* readDatasetSearchResponse(tableName, query, options, isCurrent) {
    let url_params = "&dataset=" + encodeURIComponent(tableName) + "&query=" + encodeURIComponent(query);
    const readerLanguage = getLanguageWithBrowserFallback();
    if (readerLanguage) url_params += "&lang=" + encodeURIComponent(readerLanguage);
    if (options.filters && Object.keys(options.filters).length) {
        url_params += "&filters=" + encodeURIComponent(JSON.stringify(options.filters));
    }
    if (options.rowGroupSlug) url_params += "&" + ROW_GROUP_FILTER_KEY + "=" + encodeURIComponent(options.rowGroupSlug);
    if (["card", "article_view", "product_card"].includes(options.view)) url_params += "&include_card_support=1";
    if (options.useLocation && typeof options.gps?.lat === "number" && typeof options.gps?.lon === "number") {
        url_params += "&gps=" + encodeURIComponent(options.gps.lat + "," + options.gps.lon);
    }
    const { signal } = options;
    if (signal?.aborted) return;
    const response = await endpoint_router("getIntelligentResultsStream", {
        url_params, headers: { Accept: "application/x-ndjson" }, stream: true,
        ...(signal === undefined ? {} : { signal }),
        ...(options.suppressAuthRedirect ? { suppressAuthRedirect: true } : {}),
        ...(options.suppressErrorToast ? { suppressErrorToast: true } : {}),
    });
    const reader = response.body.getReader();
    let finished = false;
    let cancellation = null;
    const cancel = () => {
        cancellation ||= Promise.resolve(reader.cancel()).catch(() => undefined);
        return cancellation;
    };
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) void cancel();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
        while (isCurrent() && !signal?.aborted) {
            const { value, done } = await reader.read();
            if (!isCurrent() || signal?.aborted) return;
            buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = done ? "" : lines.pop();
            for (const line of lines) {
                if (!isCurrent() || signal?.aborted) return;
                if (!line.trim()) continue;
                let packet;
                try { packet = JSON.parse(line); }
                catch { console.warn("[dataset_search] skipping malformed search packet"); continue; }
                yield packet;
            }
            if (done) { finished = true; return; }
        }
    } finally {
        signal?.removeEventListener("abort", cancel);
        if (!finished) await cancel();
        reader.releaseLock?.();
    }
}
