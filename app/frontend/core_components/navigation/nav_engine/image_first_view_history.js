// image_first_view_history.js
// Owns the single active image-first article's browser-history identity.
// Bridges the shared URL writer, navigation permission pipeline and modal lifecycle.
// Exists so Back leaves this view and Forward restores its selected row and image.

import { HISTORY_ENTRY_ID, ensureHistoryEntryId, writeHistoryEntry } from "./history_entry_state.js";
import { IMAGE_FIRST_VIEW_KEY, CARD_VIEW_KEY, ARTICLE_VIEW_KEY, isRenderableDatasetView } from "../../table_views/dataset_view_registry.js";
import { subscribeDatasetAccessRegistry, hasDatasetAccessSnapshot, canReadDatasetFromRegistry } from "./dataset_access_registry.js";

export const IMAGE_FIRST_HISTORY_KEY = "imageFirstView";
let generation = 0;
let activeView = null;
let closingReturn = null;
let pendingTableName = null;

export function isImageFirstViewURL() {
    return new URL(location.href).searchParams.get("view") === IMAGE_FIRST_VIEW_KEY;
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
export async function authorizeImageFirstView(tableName, isCurrent) {
    const [{ runNavigationPipeline }, { hasRoutePermission }] = await Promise.all([
        import("../../pipeline/navigation_pipeline.js"),
        import("../../route_permission_checker.js"),
    ]);
    if (!isCurrent() || !hasRoutePermission("/ui/view/article_view")) return false;
    const result = await runNavigationPipeline({
        // This view owns its own address, including its row and image; only the
        // permission and dirty stages are borrowed here.
        name: tableName, skip: ["urlUpdate", "datasetAddress"], isCurrentNavigation: isCurrent,
        canRestoreMountedView: () => true, _performNavigationCore: () => {},
    });
    return !result?.abort && isCurrent();
}

/** Captures an opening intent; asynchronous media/row work cannot outlive its URL. */
export function beginImageFirstViewOpen({ tableName, rowId, listPath, restoring = false, isCurrent = () => true }) {
    ensureHistoryEntryId();
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
            const url = new URL(listPath.replace(/\/$/, "") + "/" + rowId, location.origin);
            url.search = location.search;
            url.searchParams.set("view", IMAGE_FIRST_VIEW_KEY);
            if (image) url.hash = new URLSearchParams({ image }).toString();
            const saved = { dataset: tableName, rowId: String(rowId), image: image || "", origin, scroll: target?.scroll || 0 };
            const entryId = writeHistoryEntry(url.pathname + url.search + url.hash,
                { [IMAGE_FIRST_HISTORY_KEY]: saved }, { replace: restoring || isImageFirstViewURL() });
            activeView?.cleanup?.();
            pendingTableName = null;
            closingReturn = null;
            activeView = {
                entryId, origin, tableName, root: document.getElementById(tableName + "_container"),
                close: null, modal: null,
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
        if (restoringScroll || activeView?.entryId !== entryId || history.state?.[HISTORY_ENTRY_ID] !== entryId) return;
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
            if (!restoringScroll || activeView?.entryId !== entryId) return;
            restoreFrame = requestAnimationFrame(() => {
                if (!restoringScroll || activeView?.entryId !== entryId
                    || history.state?.[HISTORY_ENTRY_ID] !== entryId) return;
                body.scrollTop = savedScroll;
                restoringScroll = false;
                rememberScroll();
            });
        });
    }
    activeView.cleanup = () => {
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

/** Returns true only when the image-first route fully owns this history transition. */
export async function handleImageFirstViewHistory({ tableName, rowId, isCurrentNavigation = () => true } = {}) {
    const target = readTarget(tableName, rowId);
    if (target) {
        ensureHistoryEntryId();
        const expected = currentIdentity();
        const { openImageFirstView } = await import("../../table_views/card_view/image_first_view_opener.js");
        const isCurrent = () => identityMatches(expected) && isCurrentNavigation();
        if (!isCurrent()) return true;
        try {
            const result = await openImageFirstView({
                tableName, rowItem: { id: target.rowId }, restoringHistory: true, isCurrent,
            });
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
