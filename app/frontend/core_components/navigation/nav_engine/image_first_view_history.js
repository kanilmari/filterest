// image_first_view_history.js
// Owns the single active image-first article's browser-history identity.
// Bridges the shared URL writer, navigation permission pipeline and modal lifecycle.
// Exists so Back leaves this view and Forward restores its selected row and image.

import { requireArticleViewAccess } from '../../table_views/card_view/article_view_access.js';
import { HISTORY_ENTRY_ID, ensureHistoryEntryId, writeHistoryEntry, retainHistoryEntryAddress, isHistoryEntryAddressRetained } from "./history_entry_state.js";
import { IMAGE_FIRST_VIEW_KEY, CARD_VIEW_KEY, ARTICLE_VIEW_KEY, isRenderableDatasetView } from "../../table_views/dataset_view_registry.js";
import { subscribeDatasetAccessRegistry, hasDatasetAccessSnapshot, canReadDatasetFromRegistry } from "./dataset_access_registry.js";
import { acquire, release } from "../../../reusable_components/background_media_hold.js";

export const IMAGE_FIRST_HISTORY_KEY = "imageFirstView";
let generation = 0;
let activeView = null;
let closingReturn = null;
let pendingTableName = null;

export function isImageFirstViewURL() {
    return [IMAGE_FIRST_VIEW_KEY, "image_first_page_view"].includes(new URL(location.href).searchParams.get("view"));
}

function currentIdentity() {
    return { entryId: history.state?.[HISTORY_ENTRY_ID] ?? null, url: location.href };
}

function identityMatches(identity) {
    return identity?.url === location.href
        && identity.entryId === (history.state?.[HISTORY_ENTRY_ID] ?? null);
}

function validOrigin(origin) {
    if (!origin || typeof origin.url !== "string") return null;
    try {
        return new URL(origin.url).origin === location.origin ? origin : null;
    } catch {
        return null;
    }
}

function readTarget(tableName, rowId) {
    if (!isImageFirstViewURL() || !tableName || !/^\d+$/.test(String(rowId))) return null;
    const saved = history.state?.[IMAGE_FIRST_HISTORY_KEY];
    const matches = saved?.dataset === tableName && String(saved.rowId) === String(rowId);
    return {
        dataset: tableName, rowId: String(rowId),
        image: new URLSearchParams(location.hash.slice(1)).get("image") || "",
        origin: matches ? validOrigin(saved.origin) : null,
        scroll: matches && Number.isFinite(saved.scroll) ? Math.max(0, saved.scroll) : 0,
    };
}

function captureOrigin(tableName) {
    const root = document.getElementById(tableName + "_container");
    return {
        ...currentIdentity(),
        view: root?.querySelector(".tab_parts_container")?.dataset.view || null,
    };
}

/** Uses the existing permission and dirty stages without navigating the backing dataset. */
export async function authorizeImageFirstView(tableName, isCurrent, onAccessDenied, viewKey = IMAGE_FIRST_VIEW_KEY) {
    const { runNavigationPipeline } = await import("../../pipeline/navigation_pipeline.js");
    if (!isCurrent()) return false;
    // Page's presentation right follows its catalogue scope (production: tableless, granted globally), which the
    // viewer's route list already answers here. The dataset boundary is the server's: get_results checks the same
    // shared rule plus /api/get-results, so no dataset-scoped client call can disagree with it.
    if (!requireArticleViewAccess(viewKey)) {
        onAccessDenied?.();
        return false;
    }
    const result = await runNavigationPipeline({
        // This view owns its own address, including its row and image; only the
        // permission and dirty stages are borrowed here.
        name: tableName, skip: ["urlUpdate", "datasetAddress"], isCurrentNavigation: isCurrent,
        canRestoreMountedView: () => true, _performNavigationCore: () => {},
    });
    return !result?.abort && isCurrent();
}

/** Captures an opening intent; asynchronous media/row work cannot outlive its URL. */
export function beginImageFirstViewOpen({ tableName, rowId, listPath, restoring = false, isCurrent = () => true, viewKey = IMAGE_FIRST_VIEW_KEY }) {
    const initial = currentIdentity();
    const ownGeneration = ++generation;
    pendingTableName = tableName;
    const target = restoring ? readTarget(tableName, rowId) : null;
    const origin = target?.origin || (isImageFirstViewURL()
        ? validOrigin(history.state?.[IMAGE_FIRST_HISTORY_KEY]?.origin)
        : captureOrigin(tableName));
    const canCommit = () => generation === ownGeneration && identityMatches(initial) && isCurrent();
    return {
        isCurrent: canCommit,
        image: target?.image || "",
        commit(image) {
            if (!canCommit() || !/^\d+$/.test(String(rowId))) return null;
            // Assign the source's identity only after authorization/media work
            // succeeds; even an ID-only replace would mutate a denied restore.
            if (origin && !origin.entryId && identityMatches(origin)) origin.entryId = ensureHistoryEntryId();
            const url = new URL(listPath.replace(/\/$/, "") + "/" + rowId, location.origin);
            url.search = location.search;
            url.searchParams.set("view", viewKey);
            if (image) url.hash = new URLSearchParams({ image }).toString();
            const saved = { dataset: tableName, rowId: String(rowId), image: image || "", origin, scroll: target?.scroll || 0 };
            const entryId = writeHistoryEntry(url.pathname + url.search + url.hash,
                { [IMAGE_FIRST_HISTORY_KEY]: saved }, { replace: restoring || isImageFirstViewURL() });
            activeView?.cleanup?.();
            pendingTableName = null;
            closingReturn = null;
            const holdsBackground = viewKey === 'image_first_page_view';
            let cleaned = false;
            if (holdsBackground) acquire('cifav');
            activeView = {
                entryId, origin, tableName, root: document.getElementById(tableName + "_container"),
                close: null, modal: null,
                // Close can be followed by navigation cleanup for the same entry.
                cleanup() {
                    if (cleaned) return;
                    cleaned = true;
                    if (holdsBackground) release('cifav');
                },
            };
            return entryId;
        },
    };
}

export function attachImageFirstView(entryId, modalResult) {
    if (activeView?.entryId !== entryId) return;
    activeView.close = modalResult?.close;
    activeView.modal = modalResult?.modal;
    const body = modalResult?.modal?.querySelector(":scope > .modal_body");
    if (!body) return;
    const savedScroll = history.state?.[IMAGE_FIRST_HISTORY_KEY]?.scroll || 0;
    let restoringScroll = savedScroll > 0;
    let restoreFrame = null;
    body.scrollTop = savedScroll;
    const rememberScroll = () => {
        if (restoringScroll || isHistoryEntryAddressRetained() || activeView?.entryId !== entryId || history.state?.[HISTORY_ENTRY_ID] !== entryId) return;
        history.replaceState({ ...history.state, [IMAGE_FIRST_HISTORY_KEY]: {
            ...history.state[IMAGE_FIRST_HISTORY_KEY], scroll: body.scrollTop,
        } }, "", location.href);
    };
    body.addEventListener("scroll", rememberScroll, { passive: true });
    const cancelScrollRestore = () => {
        restoringScroll = false;
        if (restoreFrame !== null) cancelAnimationFrame(restoreFrame);
    };
    const inputEvents = ["wheel", "touchstart", "pointerdown", "keydown"];
    inputEvents.forEach(type => body.addEventListener(type, cancelScrollRestore, { passive: true }));
    if (restoringScroll) {
        // The entrance transform temporarily reduces scrollable overflow.
        // Restore once it finishes; ignore its transient clamp, not user input.
        Promise.resolve(modalResult.whenReady).then(() => {
            if (!restoringScroll || isHistoryEntryAddressRetained() || activeView?.entryId !== entryId) return;
            restoreFrame = requestAnimationFrame(() => {
                if (!restoringScroll || isHistoryEntryAddressRetained() || activeView?.entryId !== entryId
                    || history.state?.[HISTORY_ENTRY_ID] !== entryId) return;
                body.scrollTop = savedScroll;
                restoringScroll = false;
                rememberScroll();
            });
        });
    }
    const cleanup = activeView.cleanup;
    activeView.cleanup = () => {
        cleanup();
        cancelScrollRestore();
        body.removeEventListener("scroll", rememberScroll);
        inputEvents.forEach(type => body.removeEventListener(type, cancelScrollRestore));
    };
}

export function updateImageFirstViewImage(entryId, image) {
    if (activeView?.entryId !== entryId || history.state?.[HISTORY_ENTRY_ID] !== entryId || !isImageFirstViewURL()) return;
    const saved = history.state[IMAGE_FIRST_HISTORY_KEY];
    const url = new URL(location.href);
    url.hash = image ? new URLSearchParams({ image }).toString() : "";
    writeHistoryEntry(url.pathname + url.search + url.hash,
        { [IMAGE_FIRST_HISTORY_KEY]: { ...saved, image: image || "" } }, { replace: true });
}

/** Called after any user modal close (button, Escape or backdrop). */
export function imageFirstViewDidClose(entryId) {
    if (activeView?.entryId !== entryId) return;
    const closed = activeView;
    closed.cleanup?.();
    closingReturn = closed;
    activeView = null;
    generation += 1;
    if (history.state?.[HISTORY_ENTRY_ID] !== entryId || !isImageFirstViewURL()) return;
    if (closed.origin?.entryId) {
        history.back();
    } else {
        // A standalone bookmark has no in-app source entry to traverse.
        const url = new URL(location.href);
        url.pathname = url.pathname.replace(/\/\d+(?:-[^/]*)?\/?$/, "");
        url.searchParams.set("view", getImageFirstViewBackingView());
        url.hash = "";
        writeHistoryEntry(url.pathname + url.search, {}, { replace: true });
        window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
    }
}

function closeForNavigation() {
    const previous = activeView || closingReturn;
    activeView = null;
    closingReturn = null;
    pendingTableName = null;
    generation += 1;
    previous?.cleanup?.();
    previous?.close?.({ immediate: true });
    previous?.modal?.querySelectorAll(".image_first_view").forEach(node => node.remove());
    return previous;
}

// Access invalidation must release protected hidden modal contents, not just references.
subscribeDatasetAccessRegistry(() => {
    const dataset = pendingTableName || activeView?.tableName;
    if (!hasDatasetAccessSnapshot()
        || (dataset && canReadDatasetFromRegistry(dataset) !== true)) {
        closeForNavigation();
    }
});

export function getImageFirstViewBackingView() {
    const view = validOrigin(history.state?.[IMAGE_FIRST_HISTORY_KEY]?.origin)?.view;
    return view !== ARTICLE_VIEW_KEY && isRenderableDatasetView(view) ? view : CARD_VIEW_KEY;
}

function returnFromUnavailableImageFirstView(target) {
    closeForNavigation();
    const url = target.origin ? new URL(target.origin.url) : new URL(location.href);
    if (!target.origin) {
        url.pathname = url.pathname.replace(/\/\d+(?:-[^/]*)?\/?$/, "");
        url.searchParams.set("view", getImageFirstViewBackingView());
        url.hash = "";
    }
    writeHistoryEntry(url.pathname + url.search + url.hash, {}, { replace: true });
    window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
}

/** Returns a denial result, or true when IFAV fully owns this transition. */
export async function handleImageFirstViewHistory({ tableName, rowId, isCurrentNavigation = () => true } = {}) {
    const target = readTarget(tableName, rowId);
    if (target) {
        if (!isCurrentNavigation()) return true;
        const viewKey = new URL(location.href).searchParams.get("view");
        if (!requireArticleViewAccess(viewKey)) {
            retainHistoryEntryAddress();
            return { articleAccessDenied: true };
        }
        const expected = currentIdentity();
        const { openImageFirstView } = await import("../../table_views/card_view/image_first_view_opener.js");
        const isCurrent = () => identityMatches(expected) && isCurrentNavigation();
        if (!isCurrent()) return true;
        let articleAccessDenied = false;
        try {
            const result = await openImageFirstView({
                tableName, rowItem: { id: target.rowId }, restoringHistory: true, isCurrent,
                ...(viewKey === "image_first_page_view" ? { layout: "page" } : {}),
                onAccessDenied: () => {
                    if (!isCurrent()) return;
                    articleAccessDenied = true;
                    retainHistoryEntryAddress();
                },
            });
            if (articleAccessDenied) return { articleAccessDenied: true };
            if (!result && isCurrent()) returnFromUnavailableImageFirstView(target);
        } catch (error) {
            if (isCurrent()) returnFromUnavailableImageFirstView(target);
            console.warn("image-first history restore unavailable", error?.message || error);
        }
        return true;
    }
    const previous = closeForNavigation();
    if (!previous || !identityMatches(previous.origin)) return false;
    const root = previous.root;
    return Boolean(root?.isConnected && !root.classList.contains("hidden")
        && root === document.getElementById(previous.tableName + "_container")
        && root.querySelector(".tab_parts_container")?.dataset.view === previous.origin.view);
}
