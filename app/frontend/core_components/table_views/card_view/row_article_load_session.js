// row_article_load_session.js
// Request-session cache for row article child/media loading.
// Bridges row-article callers and backend endpoints with per-open dedupe and refresh control.
// Exists to stop one article-open lifecycle from firing the same child/media requests multiple times.

import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { datasetAppearanceState } from '../dataset_appearance_state.js';
import { revalidateRelatedDatasetAppearance } from './related_dataset_appearance_revalidation.js';

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
    let attachmentLinkingRequest = null;

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

        const appearanceToken = datasetAppearanceState.captureRegistry();
        const parentToken = datasetAppearanceState.capture(tableName);
        const requestPromise = requestFn("fetchDynamicChildren", {
            method: "POST",
            url_params: `?dataset=${tableName}`,
            body_data: {
                parent_dataset: tableName,
                parent_pk_value: String(rowId),
                ...(normalizedChildTable ? { child_table: normalizedChildTable } : {}),
            },
        }).then(payload => {
            if (!datasetAppearanceState.isCurrent(parentToken) || !datasetAppearanceState.isCurrent(appearanceToken)) {
                throw new DOMException('Related rows request superseded', 'AbortError');
            }
            for (const child of payload?.child_tables || []) {
                // The guard belongs to dispatch, before this response discovers
                // any child name. Accept before panel assembly or lazy rendering.
                revalidateRelatedDatasetAppearance(child, appearanceToken);
            }
            return payload;
        }).catch((err) => {
            if (dynamicChildrenCache.get(cacheKey) === requestPromise) {
                dynamicChildrenCache.delete(cacheKey);
            }
            throw err;
        });

        dynamicChildrenCache.set(cacheKey, requestPromise);
        return requestPromise;
    };

    // The attachment list's linking status, asked once per article opening. The image
    // gallery needs no linking status: the related-rows response names the gallery.
    const fetchAttachmentLinking = ({
        forceRefresh = false,
    } = {}) => {
        if (!canFetchLinkingStatus) {
            return Promise.resolve(null);
        }

        if (forceRefresh) {
            attachmentLinkingRequest = null;
        } else if (attachmentLinkingRequest) {
            return attachmentLinkingRequest;
        }

        const requestPromise = requestFn("assetLinkingStatus", {
            url_params: `?table=${encodeURIComponent(tableName)}`,
        }).then((payload) => (
            Array.isArray(payload?.attachment_asset_linkings)
                ? payload.attachment_asset_linkings[0] || null
                : null
        )).catch((err) => {
            if (attachmentLinkingRequest === requestPromise) {
                attachmentLinkingRequest = null;
            }
            throw err;
        });

        attachmentLinkingRequest = requestPromise;
        return requestPromise;
    };

    return {
        fetchDynamicChildren,
        invalidateDynamicChildren,
        fetchAttachmentLinking,
    };
}
