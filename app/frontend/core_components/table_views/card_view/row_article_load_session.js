// row_article_load_session.js
// Request-session cache for row article child/media loading.
// Bridges row-article callers and backend endpoints with per-open dedupe and refresh control.
// Exists to stop one article-open lifecycle from firing the same child/media requests multiple times.

import { endpoint_router } from "../../endpoints/endpoint_router.js";

const ALL_CHILD_TABLES_CACHE_KEY = "__all__";

function normalizeChildTableCacheKey(childTable = "") {
    const trimmedChildTable = String(childTable || "").trim();
    return trimmedChildTable || ALL_CHILD_TABLES_CACHE_KEY;
}

export function createRowArticleLoadSession({
    tableName,
    rowId,
    requestFn = endpoint_router,
    canFetchLinkingStatus = true,
} = {}) {
    const dynamicChildrenCache = new Map();
    const linkingStatusCache = new Map();

    const invalidateDynamicChildren = ({ childTable = "" } = {}) => {
        const normalizedChildTable = String(childTable || "").trim();
        if (!normalizedChildTable) {
            dynamicChildrenCache.clear();
            return;
        }

        dynamicChildrenCache.delete(normalizeChildTableCacheKey(normalizedChildTable));
        dynamicChildrenCache.delete(ALL_CHILD_TABLES_CACHE_KEY);
    };

    const fetchDynamicChildren = ({
        childTable = "",
        forceRefresh = false,
    } = {}) => {
        const normalizedChildTable = String(childTable || "").trim();
        const cacheKey = normalizeChildTableCacheKey(normalizedChildTable);

        if (forceRefresh) {
            invalidateDynamicChildren({ childTable: normalizedChildTable });
        } else if (dynamicChildrenCache.has(cacheKey)) {
            return dynamicChildrenCache.get(cacheKey);
        }

        const requestPromise = requestFn("fetchDynamicChildren", {
            method: "POST",
            url_params: `?dataset=${tableName}`,
            body_data: {
                parent_dataset: tableName,
                parent_pk_value: String(rowId),
                ...(normalizedChildTable ? { child_table: normalizedChildTable } : {}),
            },
        }).catch((err) => {
            if (dynamicChildrenCache.get(cacheKey) === requestPromise) {
                dynamicChildrenCache.delete(cacheKey);
            }
            throw err;
        });

        dynamicChildrenCache.set(cacheKey, requestPromise);
        return requestPromise;
    };

    const fetchCombinedLinkingStatus = ({
        forceRefresh = false,
    } = {}) => {
        if (!canFetchLinkingStatus) {
            return Promise.resolve({ image: null, attachment: null });
        }

        const cacheKey = "combined";
        if (forceRefresh) {
            linkingStatusCache.delete(cacheKey);
        } else if (linkingStatusCache.has(cacheKey)) {
            return linkingStatusCache.get(cacheKey);
        }

        const requestPromise = requestFn("assetLinkingStatus", {
            url_params: `?table=${encodeURIComponent(tableName)}`,
        }).then((payload) => ({
            image: Array.isArray(payload?.image_asset_linkings)
                ? payload.image_asset_linkings[0] || null
                : null,
            attachment: Array.isArray(payload?.attachment_asset_linkings)
                ? payload.attachment_asset_linkings[0] || null
                : null,
        })).catch((err) => {
            if (linkingStatusCache.get(cacheKey) === requestPromise) {
                linkingStatusCache.delete(cacheKey);
            }
            throw err;
        });

        linkingStatusCache.set(cacheKey, requestPromise);
        return requestPromise;
    };

    return {
        fetchDynamicChildren,
        invalidateDynamicChildren,
        fetchImageLinking: async ({ forceRefresh = false } = {}) => {
            const payload = await fetchCombinedLinkingStatus({ forceRefresh });
            return payload?.image || null;
        },
        fetchAttachmentLinking: async ({ forceRefresh = false } = {}) => {
            const payload = await fetchCombinedLinkingStatus({ forceRefresh });
            return payload?.attachment || null;
        },
    };
}
