// @vitest-environment jsdom
// Verifies image-first history as a view over its unchanged source surface.
// Covers origin identity, late work, permission gating and modal disposal.
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    open: vi.fn(async () => ({ close() {} })),
    pipeline: vi.fn(async context => context),
    route: vi.fn(() => true),
    datasetRight: vi.fn(async () => true),
    acquire: vi.fn(),
    release: vi.fn(),
}));
vi.mock("../../../reusable_components/background_media_hold.js", () => ({ acquire: mocks.acquire, release: mocks.release }));
vi.mock("../../route_permission_checker.js", () => ({ hasRoutePermission: mocks.route, hasDatasetPermission: mocks.datasetRight }));
vi.mock("../../table_views/card_view/image_first_view_opener.js", () => ({ openImageFirstView: mocks.open }));
vi.mock("../../pipeline/navigation_pipeline.js", () => ({ runNavigationPipeline: mocks.pipeline }));
import {
    authorizeImageFirstView, beginImageFirstViewOpen, attachImageFirstView,
    imageFirstViewDidClose, updateImageFirstViewImage, handleImageFirstViewHistory,
    getImageFirstViewBackingView,
} from "./image_first_view_history.js";
import { clearDatasetAccessRegistry, beginDatasetAccessRefresh, primeDatasetAccessRegistry } from "./dataset_access_registry.js";
import { HISTORY_ENTRY_ID } from "./history_entry_state.js";

function openView({ restoring = false, rowId = 185, ready, viewKey } = {}) {
    const intent = beginImageFirstViewOpen({ tableName: "events", rowId, listPath: "/events", restoring, viewKey });
    const origin = { url: location.href, state: history.state };
    const id = intent.commit("first.jpg");
    // The source entry receives its identity when the allowed opening commits.
    if (history.state.imageFirstView?.origin?.entryId) {
        origin.state = { ...origin.state, [HISTORY_ENTRY_ID]: history.state.imageFirstView.origin.entryId };
    }
    const modal = document.createElement("div");
    modal.innerHTML = '<div class="modal_body"><div class="image_first_view">protected</div></div>';
    document.body.append(modal);
    const close = vi.fn(() => imageFirstViewDidClose(id));
    attachImageFirstView(id, { modal, close, whenReady: ready });
    return { id, origin, close, modal };
}
function moveTo(entry) {
    history.replaceState(entry.state, "", entry.url);
}

describe("image-first history", () => {
    beforeEach(() => {
        clearDatasetAccessRegistry();
        vi.restoreAllMocks();
        mocks.route.mockReset().mockReturnValue(true);
        mocks.open.mockReset().mockResolvedValue({ close() {} });
        mocks.pipeline.mockReset().mockImplementation(async context => context);
        document.body.innerHTML = '<div id="events_container"><div class="tab_parts_container" data-view="table"><div id="kept">existing row</div></div></div>';
        history.replaceState({ anotherOwner: true }, "", "/events?search=needle&view=table");
    });

    test("Back leaves the overlay without navigating or replacing its table source; Forward reopens the same image", async () => {
        const node = document.getElementById("kept");
        const opened = openView();
        updateImageFirstViewImage(opened.id, "second image.jpg");
        const target = { url: location.href, state: history.state };
        expect(new URL(target.url).searchParams.get("search")).toBe("needle");
        expect(new URL(target.url).searchParams.get("view")).toBe("image_first_view");
        expect(target.state.imageFirstView).toMatchObject({ dataset: "events", rowId: "185", image: "second image.jpg" });
        expect(target.state.imageFirstView.origin.entryId).toBe(opened.origin.state[HISTORY_ENTRY_ID]);
        moveTo(opened.origin);
        expect(await handleImageFirstViewHistory({ tableName: "events" })).toBe(true);
        expect(opened.close).toHaveBeenCalledOnce();
        expect(document.getElementById("kept")).toBe(node);
        moveTo(target);
        expect(await handleImageFirstViewHistory({ tableName: "events", rowId: "185" })).toBe(true);
        expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({
            tableName: "events", rowItem: { id: "185" }, restoringHistory: true,
        }));
    });

    test("row selection replaces the same IFAV entry and retains the original source", () => {
        const first = openView();
        const selected = openView({ rowId: 186 });
        expect(selected.id).toBe(first.id);
        expect(history.state.imageFirstView.rowId).toBe("186");
        expect(history.state.imageFirstView.origin.url).toBe(first.origin.url);
        expect(history.state.imageFirstView.origin.entryId).toBe(first.origin.state[HISTORY_ENTRY_ID]);
    });

    test("button/Escape cleanup traverses the existing source entry and avoids background reload", async () => {
        const back = vi.spyOn(history, "back").mockImplementation(() => {});
        const opened = openView();
        imageFirstViewDidClose(opened.id);
        expect(back).toHaveBeenCalledOnce();
        moveTo(opened.origin);
        expect(await handleImageFirstViewHistory({ tableName: "events" })).toBe(true);
    });

    test("a different history entry or replaced backing surface cannot reuse the original DOM", async () => {
        const opened = openView();
        moveTo({ url: opened.origin.url, state: { [HISTORY_ENTRY_ID]: "different" } });
        expect(await handleImageFirstViewHistory({ tableName: "events" })).toBe(false);
        expect(opened.close).toHaveBeenCalledOnce();
    });

    test("access reset disposes the protected overlay and cancels an unfinished opening", () => {
        const opened = openView();
        const intent = beginImageFirstViewOpen({ tableName: "events", rowId: 186, listPath: "/events" });
        clearDatasetAccessRegistry();
        expect(opened.close).toHaveBeenCalledWith({ immediate: true });
        expect(opened.modal.querySelector(".image_first_view")).toBeNull();
        expect(intent.isCurrent()).toBe(false);
        expect(intent.commit("late.jpg")).toBeNull();
    });

    test("Back while an opening is pending prevents a late modal commit", async () => {
        const intent = beginImageFirstViewOpen({ tableName: "events", rowId: 185, listPath: "/events" });
        history.replaceState({}, "", "/another?view=card");
        await handleImageFirstViewHistory({ tableName: "another" });
        expect(intent.commit("late.jpg")).toBeNull();
        expect(location.pathname).toBe("/another");
    });

    test("Forward uses the existing permission/dirty pipeline and rejects denied or stale intents", async () => {
        mocks.pipeline.mockResolvedValue({ abort: true, reason: "permission_denied" });
        expect(await authorizeImageFirstView("events", () => true)).toBe(false);
        expect(mocks.pipeline).toHaveBeenCalledWith(expect.objectContaining({ name: "events", skip: ["urlUpdate", "datasetAddress"] }));
        mocks.pipeline.mockClear();
        expect(await authorizeImageFirstView("events", () => false)).toBe(false);
        expect(mocks.pipeline).not.toHaveBeenCalled();
    });

    test("standalone IFAV close replaces its own URL with a usable dataset view, not an external Back", () => {
        history.replaceState({}, "", "/events/185?view=image_first_view&search=needle#image=one.jpg");
        const opened = openView({ restoring: true });
        const back = vi.spyOn(history, "back").mockImplementation(() => {});
        imageFirstViewDidClose(opened.id);
        expect(back).not.toHaveBeenCalled();
        expect(location.pathname).toBe("/events");
        expect(new URL(location.href).searchParams.get("view")).toBe("card");
        expect(new URL(location.href).searchParams.get("search")).toBe("needle");
    });

    test("F5 backing view preserves table origins; classic origins rebuild behind IFAV without auto-opening another article", () => {
        const opened = openView();
        expect(getImageFirstViewBackingView()).toBe("table");
        history.replaceState({ ...history.state, imageFirstView: {
            ...history.state.imageFirstView, origin: { ...opened.origin, view: "article_view" },
        } }, "", location.href);
        expect(getImageFirstViewBackingView()).toBe("card");
    });

    test("scroll state follows the selected IFAV entry but never changes its source view", () => {
        const opened = openView();
        const body = opened.modal.querySelector(".modal_body");
        body.scrollTop = 420;
        body.dispatchEvent(new Event("scroll"));
        expect(history.state.imageFirstView.scroll).toBe(420);
        expect(document.querySelector(".tab_parts_container").dataset.view).toBe("table");
        expect(history.state.imageFirstView.origin.url).toBe(opened.origin.url);
    });
});

describe('cifav background hold lifecycle', () => {
    beforeEach(() => {
        clearDatasetAccessRegistry();
        vi.restoreAllMocks();
        mocks.acquire.mockClear(); mocks.release.mockClear();
        mocks.route.mockReturnValue(true);
        history.replaceState({}, '', '/events?view=card');
        document.body.replaceChildren();
    });

    test('only a cifav commit acquires, even before a modal body is attached', () => {
        const intent = beginImageFirstViewOpen({ tableName: 'events', rowId: 185,
            listPath: '/events', viewKey: 'image_first_page_view' });
        expect(mocks.acquire).not.toHaveBeenCalled();
        const id = intent.commit('page.png');
        expect(mocks.acquire).toHaveBeenCalledExactlyOnceWith('cifav');
        attachImageFirstView(id, {});
        vi.spyOn(history, 'back').mockImplementation(() => {});
        imageFirstViewDidClose(id);
        imageFirstViewDidClose(id);
        expect(mocks.release).toHaveBeenCalledExactlyOnceWith('cifav');
    });

    test.each(['user close', 'navigation', 'Back', 'access reset'])('%s releases exactly once after modal attachment', async exit => {
        const opened = openView({ viewKey: 'image_first_page_view' });
        expect(mocks.acquire).toHaveBeenCalledExactlyOnceWith('cifav');
        vi.spyOn(history, 'back').mockImplementation(() => {});
        if (exit === 'user close') imageFirstViewDidClose(opened.id);
        if (exit === 'access reset') clearDatasetAccessRegistry();
        if (exit === 'Back') moveTo(opened.origin);
        else history.replaceState({}, '', '/another?view=card');
        await handleImageFirstViewHistory({ tableName: 'another' });
        await handleImageFirstViewHistory({ tableName: 'another' });
        imageFirstViewDidClose(opened.id);
        expect(mocks.release).toHaveBeenCalledExactlyOnceWith('cifav');
        // The existing scroll-listener cleanup must survive hold composition.
        const replace = vi.spyOn(history, 'replaceState');
        opened.modal.querySelector('.modal_body').dispatchEvent(new Event('scroll'));
        expect(replace).not.toHaveBeenCalled();
    });

    test('a replacing cifav releases the old hold once and owns its own hold until close', () => {
        openView({ viewKey: 'image_first_page_view' });
        const next = openView({ rowId: 186, viewKey: 'image_first_page_view' });
        expect(mocks.acquire).toHaveBeenCalledTimes(2);
        expect(mocks.release).toHaveBeenCalledExactlyOnceWith('cifav');
        vi.spyOn(history, 'back').mockImplementation(() => {});
        imageFirstViewDidClose(next.id);
        imageFirstViewDidClose(next.id);
        expect(mocks.release).toHaveBeenCalledTimes(2);
    });

    test('Forward restores a fresh cifav hold after Back released the previous visit', async () => {
        const opened = openView({ viewKey: 'image_first_page_view' });
        const target = { url: location.href, state: history.state };
        moveTo(opened.origin);
        await handleImageFirstViewHistory({ tableName: 'events' });
        expect(mocks.release).toHaveBeenCalledExactlyOnceWith('cifav');
        moveTo(target);
        mocks.open.mockImplementationOnce(() => openView({ restoring: true, viewKey: 'image_first_page_view' }));
        await handleImageFirstViewHistory({ tableName: 'events', rowId: '185' });
        expect(mocks.acquire).toHaveBeenCalledTimes(2);
        vi.spyOn(history, 'back').mockImplementation(() => {});
        imageFirstViewDidClose(history.state[HISTORY_ENTRY_ID]);
        moveTo(opened.origin);
        await handleImageFirstViewHistory({ tableName: 'events' });
        expect(mocks.release).toHaveBeenCalledTimes(2);
    });

    test('replacing cifav with IFAV releases without taking another hold', () => {
        openView({ viewKey: 'image_first_page_view' });
        const next = openView();
        expect(mocks.acquire).toHaveBeenCalledExactlyOnceWith('cifav');
        expect(mocks.release).toHaveBeenCalledExactlyOnceWith('cifav');
        vi.spyOn(history, 'back').mockImplementation(() => {});
        imageFirstViewDidClose(next.id);
        expect(mocks.release).toHaveBeenCalledTimes(1);
    });

    test.each(['image_first_view', 'article_view'])('%s takes no background hold', viewKey => {
        const opened = openView({ viewKey });
        vi.spyOn(history, 'back').mockImplementation(() => {});
        imageFirstViewDidClose(opened.id);
        expect(mocks.acquire).not.toHaveBeenCalled();
        expect(mocks.release).not.toHaveBeenCalled();
    });
});

test("article UI permission denial is enforced before the dataset pipeline", async () => {
    mocks.route.mockReturnValueOnce(false); mocks.pipeline.mockClear();
    expect(await authorizeImageFirstView("events", () => true)).toBe(false);
    expect(mocks.route).toHaveBeenLastCalledWith("/ui/view/article_view");
    expect(mocks.pipeline).not.toHaveBeenCalled();
});

test("an unavailable standalone IFAV bookmark resolves to a normal dataset URL", async () => {
    clearDatasetAccessRegistry();
    history.replaceState({}, "", "/events/185?view=image_first_view&search=needle");
    mocks.open.mockResolvedValueOnce(null);
    expect(await handleImageFirstViewHistory({ tableName: "events", rowId: "185" })).toBe(true);
    expect(location.pathname).toBe("/events");
    expect(new URL(location.href).searchParams.get("view")).toBe("card");
    expect(new URL(location.href).searchParams.get("search")).toBe("needle");
    expect(history.state.imageFirstView).toBeUndefined();
});

test("accepting the same authorized bootstrap snapshot keeps IFAV open; a denied snapshot closes it", () => {
    const generation = beginDatasetAccessRefresh();
    const response = { datasets: [{ dataset_name: "events", can_read_rows: true }] };
    primeDatasetAccessRegistry(response, generation);
    const opened = openView();
    primeDatasetAccessRegistry(response, generation);
    expect(opened.close).not.toHaveBeenCalled();
    expect(opened.modal.querySelector(".image_first_view")).not.toBeNull();
    primeDatasetAccessRegistry({ datasets: [] }, generation);
    expect(opened.close).toHaveBeenCalledWith({ immediate: true });
    expect(opened.modal.querySelector(".image_first_view")).toBeNull();
});

test("access clear cancels a pending opening even before any modal is mounted", () => {
    clearDatasetAccessRegistry();
    history.replaceState({}, "", "/events?view=card");
    const intent = beginImageFirstViewOpen({ tableName: "events", rowId: 185, listPath: "/events" });
    clearDatasetAccessRegistry();
    expect(intent.isCurrent()).toBe(false);
    expect(intent.commit("late.jpg")).toBeNull();
    expect(location.pathname).toBe("/events");
});

test.each([false, true])("entrance clamp preserves saved scroll; new user input cancels the one-time restore (%s)", async (inputBeforeReady) => {
    clearDatasetAccessRegistry();
    history.replaceState({ imageFirstView: { dataset: "events", rowId: "185", scroll: 420 } }, "", "/events/185?view=image_first_view");
    let finishEntrance;
    const ready = new Promise(resolve => { finishEntrance = resolve; });
    const opened = openView({ restoring: true, ready });
    const body = opened.modal.querySelector(".modal_body");
    body.scrollTop = 362; // Firefox's temporary entrance-animation maximum.
    body.dispatchEvent(new Event("scroll"));
    expect(history.state.imageFirstView.scroll).toBe(420);
    if (inputBeforeReady) {
        body.dispatchEvent(new WheelEvent("wheel", { deltaY: 100 }));
        body.scrollTop = 500;
        body.dispatchEvent(new Event("scroll"));
    }
    finishEntrance();
    await vi.waitFor(() => expect(body.scrollTop).toBe(inputBeforeReady ? 500 : 420));
    // The restored view accepts ordinary user scrolling without pulling it back.
    body.dispatchEvent(new WheelEvent("wheel", { deltaY: 80 }));
    body.scrollTop = 580;
    body.dispatchEvent(new Event("scroll"));
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(body.scrollTop).toBe(580);
    expect(history.state.imageFirstView.scroll).toBe(580);
});


test('a denied IFAV URL explains without importing the opener or changing its backing view', async () => {
    mocks.route.mockReset().mockReturnValue(false);
    mocks.open.mockClear();
    document.body.replaceChildren();
    history.replaceState({}, '', '/events/185?view=image_first_view');
    const address = location.href;
    const state = structuredClone(history.state);
    const replace = vi.spyOn(history, 'replaceState'), push = vi.spyOn(history, 'pushState');
    expect(await handleImageFirstViewHistory({ tableName: 'events', rowId: '185' })).toEqual({ articleAccessDenied: true });
    expect(location.href).toBe(address);
    expect(history.state).toEqual(state);
    expect(replace).not.toHaveBeenCalled(); expect(push).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(document.querySelector('[data-lang-key="article_view_permission_missing"]')).not.toBeNull();
});

test.each([null, 'ifav'])('an asynchronous IFAV view denial retains entry ID %s and never takes the unavailable-media fallback', async entryId => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
    mocks.route.mockReset().mockReturnValue(true);
    history.replaceState({ ...(entryId ? { [HISTORY_ENTRY_ID]: entryId } : {}), other: 9 }, '', '/events/185?view=image_first_view');
    const href = location.href, state = structuredClone(history.state);
    mocks.open.mockImplementationOnce(async ({ isCurrent, onAccessDenied }) => {
        mocks.route.mockReturnValue(false);
        expect(await authorizeImageFirstView('events', isCurrent, onAccessDenied)).toBe(false);
        return null;
    });
    const replace = vi.spyOn(history, 'replaceState'), push = vi.spyOn(history, 'pushState');
    expect(await handleImageFirstViewHistory({ tableName: 'events', rowId: '185' })).toEqual({ articleAccessDenied: true });
    expect(location.href).toBe(href); expect(history.state).toEqual(state);
    expect(document.querySelectorAll('[data-lang-key="article_view_permission_missing"]')).toHaveLength(1);
    expect(replace).not.toHaveBeenCalled(); expect(push).not.toHaveBeenCalled();
});

test('a pending IFAV intent assigns no history identity before authorization succeeds', async () => {
    vi.restoreAllMocks(); document.body.replaceChildren();
    history.replaceState({ other: 9 }, '', '/events/185?view=image_first_view');
    const href = location.href, state = structuredClone(history.state);
    const replace = vi.spyOn(history, 'replaceState'), push = vi.spyOn(history, 'pushState');
    const intent = beginImageFirstViewOpen({ tableName: 'events', rowId: '185', listPath: '/events', restoring: true });
    mocks.route.mockReturnValue(false);
    expect(await authorizeImageFirstView('events', intent.isCurrent)).toBe(false);
    expect(location.href).toBe(href); expect(history.state).toEqual(state);
    expect(replace).not.toHaveBeenCalled(); expect(push).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[data-lang-key="article_view_permission_missing"]')).toHaveLength(1);
});

test('a denied retained IFAV entry prevents its pending scroll restoration and state writer', async () => {
    vi.restoreAllMocks(); document.body.replaceChildren();
    mocks.route.mockReturnValue(true);
    history.replaceState({ [HISTORY_ENTRY_ID]: 'ifav-scroll', imageFirstView: { dataset: 'events', rowId: '185', scroll: 420 } }, '', '/events/185?view=image_first_view');
    let ready;
    const opened = openView({ restoring: true, ready: new Promise(resolve => { ready = resolve; }) });
    const body = opened.modal.querySelector('.modal_body');
    body.scrollTop = 555;
    const href = location.href, state = structuredClone(history.state);
    mocks.route.mockReturnValue(false);
    const replace = vi.spyOn(history, 'replaceState'), push = vi.spyOn(history, 'pushState');
    expect(await handleImageFirstViewHistory({ tableName: 'events', rowId: '185' })).toEqual({ articleAccessDenied: true });
    ready(); await new Promise(resolve => setTimeout(resolve, 25));
    body.dispatchEvent(new Event('scroll'));
    expect(body.scrollTop).toBe(555); expect(opened.modal.isConnected).toBe(true);
    expect(location.href).toBe(href); expect(history.state).toEqual(state);
    expect(document.querySelectorAll('[data-lang-key="article_view_permission_missing"]')).toHaveLength(1);
    expect(replace).not.toHaveBeenCalled(); expect(push).not.toHaveBeenCalled();
});

test('Page keeps its key, restores with the shared opener and returns to its Home origin', async () => {
    mocks.route.mockReset().mockReturnValue(true); mocks.open.mockClear();
    history.replaceState({}, '', '/');
    const intent = beginImageFirstViewOpen({ tableName: 'events', rowId: 185, listPath: '/events', viewKey: 'image_first_page_view' });
    const entryId = intent.commit('page.png');
    expect(location.search).toBe('?view=image_first_page_view');
    expect(history.state.imageFirstView.origin.url).toBe(location.origin + '/');
    updateImageFirstViewImage(entryId, 'next.png');
    expect(location.search).toBe('?view=image_first_page_view');
    expect(location.hash).toContain('next.png');
    expect(await handleImageFirstViewHistory({ tableName: 'events', rowId: '185' })).toBe(true);
    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ layout: 'page', restoringHistory: true, rowItem: { id: '185' } }));
    const back = vi.spyOn(history, 'back').mockImplementation(() => {});
    imageFirstViewDidClose(entryId);
    expect(back).toHaveBeenCalledOnce(); back.mockRestore();
});
test('Page denial uses the contract Page route and preserves its address', async () => {
    mocks.open.mockClear();
    history.replaceState({}, '', '/events/185?view=image_first_page_view');
    mocks.route.mockImplementation(route => route === '/ui/view/article_view');
    expect(await handleImageFirstViewHistory({ tableName: 'events', rowId: '185' })).toEqual({ articleAccessDenied: true });
    expect(mocks.route).toHaveBeenCalledWith('/ui/view/image_first_page_view');
    expect(location.search).toBe('?view=image_first_page_view');
    expect(mocks.open).not.toHaveBeenCalled();
});


test('Page follows the route list only; the server owns its dataset boundary (F1: tableless global grants)', async () => {
    // A global Page grant (the production shape) must pass on every dataset; a dataset-scoped client call
    // (/api/check-table-right) would refuse it, so none is made.
    mocks.route.mockImplementation(route => route === '/ui/view/image_first_page_view'); mocks.datasetRight.mockClear();
    mocks.pipeline.mockClear();
    const denied = vi.fn();
    await authorizeImageFirstView('events', () => true, denied, 'image_first_page_view');
    expect(mocks.datasetRight).not.toHaveBeenCalled();
    expect(denied).not.toHaveBeenCalled(); expect(mocks.pipeline).toHaveBeenCalled();
    // Without the Page route the IFAV-style denial runs before the pipeline.
    mocks.route.mockReturnValue(false); mocks.pipeline.mockClear();
    expect(await authorizeImageFirstView('events', () => true, denied, 'image_first_page_view')).toBe(false);
    expect(denied).toHaveBeenCalledOnce(); expect(mocks.pipeline).not.toHaveBeenCalled();
    mocks.route.mockReturnValue(true);
});
