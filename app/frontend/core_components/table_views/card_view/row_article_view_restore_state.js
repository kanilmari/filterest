// row_article_view_restore_state.js
// Persists classic article-view reader UI across F5 for the same ticket.
// Bridges table_state_store.articleView with related-tab, related-rows, and content-scroll restore.
// Exists so refresh of the same article_view URL keeps the open child tab and scroll position.

import { getUnifiedTableState, setUnifiedTableState } from "../../state_stores/table_state_store.js";

const HEIGHT_STABLE_FRAMES = 2;
const LAYOUT_UNKNOWN_SETTLE_FRAMES = 2;
const MAX_RESTORE_MS = 1200;

function sameRowArticleId(left, right) {
    return left != null && right != null && String(left) === String(right);
}

function readArticleView(tableName) {
    return getUnifiedTableState(tableName)?.articleView || {};
}

function scheduleNextFrame(callback) {
    if (typeof requestAnimationFrame === "function") {
        return requestAnimationFrame(callback);
    }
    return setTimeout(callback, 0);
}

function cancelNextFrame(handle) {
    if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(handle);
        return;
    }
    clearTimeout(handle);
}

function nowMs() {
    return typeof performance === "object" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
}

export function waitForRowArticleLayoutPass() {
    return new Promise((resolve) => {
        scheduleNextFrame(() => scheduleNextFrame(resolve));
    });
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

function canHoldSavedScroll(scrollElement, savedScroll) {
    const scrollHeight = Number(scrollElement.scrollHeight) || 0;
    const clientHeight = Number(scrollElement.clientHeight) || 0;
    if (scrollHeight === 0 && clientHeight === 0) {
        return null;
    }
    return (scrollHeight - clientHeight) >= savedScroll - 1;
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
    let resizeObserver = null;

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
            cancelNextFrame(restoreFrame);
            restoreFrame = null;
        }
        resizeObserver?.disconnect();
        resizeObserver = null;
    };

    const applySavedScroll = (savedScroll) => {
        if (!isCurrent()) {
            cancelRestore();
            return;
        }
        scrollElement.scrollTop = savedScroll;
    };

    const finishRestore = (savedScroll) => {
        applySavedScroll(savedScroll);
        restoring = false;
        restoreFrame = null;
        resizeObserver?.disconnect();
        resizeObserver = null;
    };

    const watchLayout = (savedScroll) => {
        if (typeof ResizeObserver !== "function") {
            return;
        }
        resizeObserver?.disconnect();
        resizeObserver = new ResizeObserver(() => {
            if (restoring && isCurrent()) {
                applySavedScroll(savedScroll);
            }
        });
        resizeObserver.observe(scrollElement);
        for (const child of scrollElement.children) {
            resizeObserver.observe(child);
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
            cancelRestore();
            restoring = true;
            const startedAt = nowMs();
            let lastHeight = -1;
            let stableFrames = 0;
            let unknownFrames = 0;

            applySavedScroll(savedScroll);
            watchLayout(savedScroll);

            const tick = () => {
                if (!restoring || !isCurrent()) {
                    return;
                }
                applySavedScroll(savedScroll);
                const height = Number(scrollElement.scrollHeight) || 0;
                if (height === lastHeight) {
                    stableFrames += 1;
                } else {
                    stableFrames = 0;
                    lastHeight = height;
                }
                const canHold = canHoldSavedScroll(scrollElement, savedScroll);
                if (canHold === null) {
                    unknownFrames += 1;
                    if (unknownFrames >= LAYOUT_UNKNOWN_SETTLE_FRAMES) {
                        finishRestore(savedScroll);
                        return;
                    }
                } else if (canHold && stableFrames >= HEIGHT_STABLE_FRAMES) {
                    finishRestore(savedScroll);
                    return;
                } else if ((nowMs() - startedAt) >= MAX_RESTORE_MS) {
                    finishRestore(savedScroll);
                    return;
                }
                restoreFrame = scheduleNextFrame(tick);
            };
            restoreFrame = scheduleNextFrame(tick);
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
