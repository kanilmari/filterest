// row_article_view_restore_state.js
// Persists classic article-view reader UI across F5 for the same ticket.
// Bridges table_state_store.articleView with related-tab, related-rows, and content-scroll restore.
// Exists so refresh of the same article_view URL keeps the open child tab and scroll position.

import { getUnifiedTableState, setUnifiedTableState } from "../../state_stores/table_state_store.js";

function sameRowArticleId(left, right) {
    return left != null && right != null && String(left) === String(right);
}

function readArticleView(tableName) {
    return getUnifiedTableState(tableName)?.articleView || {};
}

export function articleViewRestoreFieldsForRowChange(tableName, nextRowId) {
    if (sameRowArticleId(readArticleView(tableName).expandedId, nextRowId)) {
        return {};
    }
    return {
        relatedTabKey: null,
        relatedRowsOpen: null,
        scrollTop: null,
    };
}

export function readRowArticleViewRestoreState(tableName, rowId) {
    const articleView = readArticleView(tableName);
    if (!sameRowArticleId(articleView.expandedId, rowId)) {
        return { relatedTabKey: null, relatedRowsOpen: null, scrollTop: null };
    }
    const relatedTabKey = typeof articleView.relatedTabKey === "string"
        ? articleView.relatedTabKey.trim()
        : "";
    const scrollTop = Number(articleView.scrollTop);
    return {
        relatedTabKey: relatedTabKey || null,
        relatedRowsOpen: typeof articleView.relatedRowsOpen === "boolean"
            ? articleView.relatedRowsOpen
            : null,
        scrollTop: Number.isFinite(scrollTop) && scrollTop > 0 ? scrollTop : null,
    };
}

export function persistRowArticleViewRestoreState(tableName, rowId, patch = {}) {
    if (!sameRowArticleId(readArticleView(tableName).expandedId, rowId)) {
        return;
    }
    const next = {};
    if (Object.prototype.hasOwnProperty.call(patch, "relatedTabKey")) {
        const relatedTabKey = typeof patch.relatedTabKey === "string"
            ? patch.relatedTabKey.trim()
            : "";
        next.relatedTabKey = relatedTabKey || null;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "relatedRowsOpen")) {
        next.relatedRowsOpen = patch.relatedRowsOpen == null
            ? null
            : Boolean(patch.relatedRowsOpen);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "scrollTop")) {
        const scrollTop = Number(patch.scrollTop);
        next.scrollTop = Number.isFinite(scrollTop) && scrollTop > 0
            ? Math.round(scrollTop)
            : 0;
    }
    if (Object.keys(next).length === 0) {
        return;
    }
    setUnifiedTableState(tableName, { articleView: next });
}

export function bindRelatedRowsDisclosurePersist(section, tableName, rowId) {
    if (!(section instanceof HTMLElement)) {
        return;
    }
    section.addEventListener("animated-disclosure-toggle", (event) => {
        persistRowArticleViewRestoreState(tableName, rowId, {
            relatedRowsOpen: Boolean(event.detail?.expanded),
        });
    });
}

export function attachRowArticleContentScrollPersistence(
    scrollElement,
    tableName,
    rowId,
    { isCurrent = () => true } = {},
) {
    if (!(scrollElement instanceof HTMLElement)) {
        return { restore() {}, detach() {} };
    }

    let restoring = false;
    let restoreFrame = null;

    const remember = () => {
        if (restoring || !isCurrent()) {
            return;
        }
        persistRowArticleViewRestoreState(tableName, rowId, {
            scrollTop: scrollElement.scrollTop,
        });
    };

    const cancelRestore = () => {
        restoring = false;
        if (restoreFrame != null) {
            cancelAnimationFrame(restoreFrame);
            restoreFrame = null;
        }
    };

    scrollElement.addEventListener("scroll", remember, { passive: true });
    const cancelEvents = ["wheel", "touchstart", "pointerdown", "keydown"];
    cancelEvents.forEach((type) => {
        scrollElement.addEventListener(type, cancelRestore, { passive: true });
    });

    return {
        restore() {
            const savedScroll = readRowArticleViewRestoreState(tableName, rowId).scrollTop;
            if (!isCurrent() || savedScroll == null) {
                return;
            }
            restoring = true;
            const apply = () => {
                if (!isCurrent()) {
                    restoring = false;
                    return;
                }
                scrollElement.scrollTop = savedScroll;
            };
            apply();
            restoreFrame = requestAnimationFrame(() => {
                apply();
                restoring = false;
                restoreFrame = null;
            });
        },
        detach() {
            cancelRestore();
            scrollElement.removeEventListener("scroll", remember);
            cancelEvents.forEach((type) => {
                scrollElement.removeEventListener(type, cancelRestore);
            });
        },
    };
}
