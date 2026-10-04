// row_article_view_restore_state.js
// Persists classic article-view reader UI across F5 for the same ticket.
// Bridges table_state_store.articleView with related-tab, related-rows, and content-scroll restore.
// Exists so refresh of the same article_view URL keeps the open child tab and scroll position.

import {
    ARTICLE_READING_POSITION_FIELDS,
    getUnifiedTableState,
    isSameOpenRow as sameRowArticleId,
    setUnifiedTableState,
} from "../../state_stores/table_state_store.js";

const HEIGHT_STABLE_FRAMES = 2;
const LAYOUT_UNKNOWN_SETTLE_FRAMES = 2;
const MAX_RESTORE_MS = 1200;

function cleanRelatedTabKey(value) {
    const relatedTabKey = typeof value === "string" ? value.trim() : "";
    return relatedTabKey || null;
}

/**
 * How each reading-position field is cleaned when this tab's stored value is
 * read back, and when a change to it is written. Which fields make up the
 * reading position is decided once, in table_state_store.js
 * (ARTICLE_READING_POSITION_FIELDS); a field listed there without a cleaner
 * here fails the first read of the same row, so the tests catch it.
 */
const READING_POSITION_FIELD_CLEANERS = Object.freeze({
    relatedTabKey: { read: cleanRelatedTabKey, write: cleanRelatedTabKey },
    relatedRowsOpen: {
        read: (value) => (typeof value === "boolean" ? value : null),
        write: (value) => (value == null ? null : Boolean(value)),
    },
    scrollTop: {
        read: (value) => {
            const scrollTop = Number(value);
            return Number.isFinite(scrollTop) && scrollTop > 0 ? scrollTop : null;
        },
        write: (value) => {
            const scrollTop = Number(value);
            return Number.isFinite(scrollTop) && scrollTop > 0 ? Math.round(scrollTop) : 0;
        },
    },
});

/** The reading position of a row that has none here: every field empty. */
function emptyReadingPosition() {
    return Object.fromEntries(ARTICLE_READING_POSITION_FIELDS.map((field) => [field, null]));
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
    return emptyReadingPosition();
}

export function readRowArticleViewRestoreState(tableName, rowId) {
    const articleView = readArticleView(tableName);
    if (!sameRowArticleId(articleView.expandedId, rowId)) {
        return emptyReadingPosition();
    }
    return Object.fromEntries(ARTICLE_READING_POSITION_FIELDS.map(
        (field) => [field, READING_POSITION_FIELD_CLEANERS[field].read(articleView[field])],
    ));
}

export function persistRowArticleViewRestoreState(tableName, rowId, patch = {}) {
    if (!sameRowArticleId(readArticleView(tableName).expandedId, rowId)) {
        return;
    }
    const next = {};
    for (const field of ARTICLE_READING_POSITION_FIELDS) {
        if (Object.hasOwn(patch, field)) {
            next[field] = READING_POSITION_FIELD_CLEANERS[field].write(patch[field]);
        }
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
