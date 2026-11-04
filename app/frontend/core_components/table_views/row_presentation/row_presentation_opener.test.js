// row_presentation_opener.test.js
// Proves which row the split button's image-first choices open, and when they open nothing.
// Bridges the open article, a fresh first-page listing request and the shared image-first opener.
// Exists so a choice never reads old results, never moves to an arbitrary row and never outlives its address.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

const { grants, params, fetchDatasetData, showToast, selected } = vi.hoisted(() => ({
    grants: new Set(),
    params: { value: {} },
    fetchDatasetData: vi.fn(),
    showToast: vi.fn(),
    selected: { value: "demo" },
}));

vi.mock("../../route_permission_checker.js", () => ({ hasRoutePermission: vi.fn((route) => grants.has(route)) }));
vi.mock("../dataset_default_view.js", () => ({ resolveDatasetDefaultView: vi.fn(() => "card") }));
vi.mock("../../lang/translation_handler.js", () => ({
    getTranslationForKey: vi.fn((key, { fallback = "" } = {}) => fallback),
}));
vi.mock("../../state_stores/lang_preference_reader.js", () => ({ getLanguageWithBrowserFallback: vi.fn(() => "fi") }));
vi.mock("../../../reusable_components/notifications/toast_notification_printer.js", () => ({ showToast }));
vi.mock("../../endpoints/endpoint_data_fetcher.js", () => ({ fetchDatasetData }));
vi.mock("../../navigation/nav_engine/query_params.js", () => ({ getParams: vi.fn(() => params.value) }));
vi.mock("../../state_stores/dataset_selection_saver.js", () => ({ getSelectedDataset: vi.fn(() => selected.value) }));

import { openChosenRowPresentation } from "./row_presentation_opener.js";
import { createRowPresentationSplitButton } from "./row_presentation_split_button.js";
import { setUnifiedTableState } from "../../state_stores/table_state_store.js";
import { setChosenDatasetView } from "../../state_stores/dataset_view_choice_saver.js";
import { registerDatasetQueryAdapter } from "../../filterbar/dataset_surface_provider/dataset_query_adapter_registry.js";

const ARTICLE = "/ui/view/article_view";
const PAGE = "/ui/view/image_first_page_view";

function openWith(viewKey, overrides = {}) {
    const openImageFirstView = overrides.openImageFirstView || vi.fn(async () => ({ modal: {} }));
    const notifyEmpty = vi.fn();
    const result = openChosenRowPresentation({
        tableName: "demo", viewKey, notifyEmpty, loadOpener: async () => ({ openImageFirstView }), ...overrides,
    });
    return { result, openImageFirstView, notifyEmpty };
}

function mountOpenArticle(rowId) {
    setChosenDatasetView("demo", "article_view");
    document.body.innerHTML = `<div id="demo_article_view_container"><div class="card_view_wrapper big-card-open">
        <article class="active_row_article"></article></div></div>`;
    document.querySelector(".active_row_article")._row = { id: rowId, title: "Open article" };
}

beforeEach(() => {
    document.body.replaceChildren();
    sessionStorage.clear(); localStorage.clear();
    grants.clear(); grants.add(ARTICLE); grants.add(PAGE);
    params.value = {};
    selected.value = "demo";
    fetchDatasetData.mockReset();
    showToast.mockReset();
    history.replaceState({}, "", "/demo?view=table");
    setChosenDatasetView("demo", "table");
    setUnifiedTableState("demo", { filters: { status: "open" }, sort: { column: "title", direction: "ASC" } });
});

describe("row target", () => {
    test("the open article's row is respected without asking for the listing", async () => {
        mountOpenArticle(7);
        const { result, openImageFirstView } = openWith("image_first_view");
        expect(await result).toEqual({ status: "opened", rowId: 7 });
        expect(fetchDatasetData).not.toHaveBeenCalled();
        expect(openImageFirstView).toHaveBeenCalledWith(expect.objectContaining({
            tableName: "demo", rowItem: { id: 7 }, layout: "image_first", presentationChoice: true,
        }));
        // Only the id travels: the opener fetches the permitted record itself.
        expect(Object.keys(openImageFirstView.mock.calls[0][0].rowItem)).toEqual(["id"]);
    });

    test("otherwise the first row of a fresh listing request with its filters, committed search and sort", async () => {
        params.value = { search: "needle" };
        fetchDatasetData.mockResolvedValueOnce({ data: [{ title: "no id" }, { id: 42 }, { id: 43 }] });
        const { result, openImageFirstView } = openWith("image_first_page_view");
        expect(await result).toEqual({ status: "opened", rowId: 42 });
        expect(fetchDatasetData).toHaveBeenCalledWith(expect.objectContaining({
            dataset_name: "demo", offset: 0, sort_column: "title", sort_order: "ASC",
            filters: { status: "open", search: "needle", limit: 1 }, view_key: "table",
        }));
        expect(openImageFirstView).toHaveBeenCalledWith(expect.objectContaining({ rowItem: { id: 42 }, layout: "page" }));
    });

    test("an empty listing opens nothing and says so", async () => {
        fetchDatasetData.mockResolvedValueOnce({ data: [] });
        const { result, openImageFirstView, notifyEmpty } = openWith("image_first_view");
        expect(await result).toEqual({ status: "empty" });
        expect(notifyEmpty).toHaveBeenCalledOnce();
        expect(openImageFirstView).not.toHaveBeenCalled();
    });

    test("the default empty notice uses the existing no_results key", async () => {
        fetchDatasetData.mockResolvedValueOnce({ data: [] });
        await openChosenRowPresentation({ tableName: "demo", viewKey: "image_first_view", loadOpener: vi.fn() });
        expect(showToast).toHaveBeenCalledOnce();
        const { content } = showToast.mock.calls[0][0];
        expect(content.dataset.langKey).toBe("no_results");
        expect(content.textContent).toBe("Ei tuloksia");
    });

    test("a failed listing request opens nothing and never reads old results", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        fetchDatasetData.mockRejectedValueOnce(new Error("offline"));
        const { result, openImageFirstView, notifyEmpty } = openWith("image_first_view");
        expect(await result).toEqual({ status: "failed" });
        expect(openImageFirstView).not.toHaveBeenCalled();
        expect(notifyEmpty).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    test("an embedded surface's listing is not guessed", async () => {
        const unregister = registerDatasetQueryAdapter("demo", { refresh: vi.fn() });
        const { result, openImageFirstView } = openWith("image_first_view");
        expect(await result).toEqual({ status: "unsupported" });
        expect(openImageFirstView).not.toHaveBeenCalled();
        unregister?.();
    });
});

describe("races", () => {
    test("a listing whose filters changed while it was asked is discarded", async () => {
        let answer;
        fetchDatasetData.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
        const { result, openImageFirstView } = openWith("image_first_view");
        await vi.waitFor(() => expect(answer).toBeTypeOf("function"));
        setUnifiedTableState("demo", { filters: { status: "closed" } });
        answer({ data: [{ id: 1 }] });
        expect(await result).toEqual({ status: "stale" });
        expect(openImageFirstView).not.toHaveBeenCalled();
    });

    test("a later choice supersedes an earlier one still waiting for its row", async () => {
        let firstAnswer;
        fetchDatasetData.mockReturnValueOnce(new Promise((resolve) => { firstAnswer = resolve; }))
            .mockResolvedValueOnce({ data: [{ id: 2 }] });
        const first = openWith("image_first_view");
        await vi.waitFor(() => expect(firstAnswer).toBeTypeOf("function"));
        const second = openWith("image_first_page_view");
        expect(await second.result).toEqual({ status: "opened", rowId: 2 });
        firstAnswer({ data: [{ id: 1 }] });
        expect(await first.result).toEqual({ status: "stale" });
        expect(first.openImageFirstView).not.toHaveBeenCalled();
    });

    test("Back, Forward or a link during the request cancels the opening", async () => {
        let answer;
        fetchDatasetData.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
        const { result, openImageFirstView } = openWith("image_first_view");
        await vi.waitFor(() => expect(answer).toBeTypeOf("function"));
        history.pushState({}, "", "/elsewhere");
        answer({ data: [{ id: 1 }] });
        expect(await result).toEqual({ status: "stale" });
        expect(openImageFirstView).not.toHaveBeenCalled();
    });

    test("the opener receives a guard that ends when another dataset is selected", async () => {
        mountOpenArticle(5);
        const { result, openImageFirstView } = openWith("image_first_view");
        await result;
        const { isCurrent } = openImageFirstView.mock.calls[0][0];
        expect(isCurrent()).toBe(true);
        selected.value = "other";
        expect(isCurrent()).toBe(false);
    });
});

describe("the newest explicit selection wins until the open commits", () => {
    function buildSplit(loadOpener) {
        const selectArticle = vi.fn();
        const results = [];
        const wrapper = createRowPresentationSplitButton({
            tableName: "demo", selectArticle,
            openPresentation: (options) => {
                const result = openChosenRowPresentation({ ...options, loadOpener });
                results.push(result);
                return result;
            },
        });
        document.body.append(wrapper);
        const pick = (viewKey) => {
            wrapper.querySelector('[data-testid="row-presentation-toggle"]').click();
            document.querySelector(`[data-testid="row-presentation-menu-option-${viewKey}"]`).click();
        };
        return { wrapper, selectArticle, results, pick };
    }

    test("a slow opener import, then the same already-open Article (no address change), opens nothing", async () => {
        mountOpenArticle(5);
        const addressBefore = location.href;
        let finishImport;
        const openImageFirstView = vi.fn(async () => ({ modal: {} }));
        const { pick, selectArticle, results } = buildSplit(() => new Promise((resolve) => { finishImport = resolve; }));
        pick("image_first_view");
        await vi.waitFor(() => expect(finishImport).toBeTypeOf("function"));
        // The classic path returns early for an open article: nothing changes the address.
        pick("article_view");
        expect(selectArticle).toHaveBeenCalledOnce();
        expect(location.href).toBe(addressBefore);
        finishImport({ openImageFirstView });
        expect(await results[0]).toEqual({ status: "stale" });
        expect(openImageFirstView).not.toHaveBeenCalled();
        expect(showToast).not.toHaveBeenCalled();
    });

    test("an opener still preparing its view is told it is superseded by Article", async () => {
        mountOpenArticle(5);
        let guard;
        let finishOpen;
        const openImageFirstView = vi.fn(({ isCurrent }) => {
            guard = isCurrent;
            return new Promise((resolve) => { finishOpen = resolve; });
        });
        const { pick, results } = buildSplit(async () => ({ openImageFirstView }));
        pick("image_first_page_view");
        await vi.waitFor(() => expect(guard).toBeTypeOf("function"));
        expect(guard()).toBe(true);
        pick("article_view");
        // The shared opener checks this guard before it commits its address or modal.
        expect(guard()).toBe(false);
        finishOpen(null);
        expect(await results[0]).toEqual({ status: "stale", rowId: 5 });
        expect(showToast).not.toHaveBeenCalled();
    });
});

describe("permissions and failures", () => {
    test("a reader without the presentation's right gets the shared denial notice and nothing is asked", async () => {
        grants.delete(PAGE);
        const { result, openImageFirstView } = openWith("image_first_page_view");
        expect(await result).toEqual({ status: "denied" });
        expect(showToast).toHaveBeenCalledOnce();
        expect(showToast.mock.calls[0][0].content.dataset.langKey).toBe("article_view_permission_missing");
        expect(fetchDatasetData).not.toHaveBeenCalled();
        expect(openImageFirstView).not.toHaveBeenCalled();
    });

    test("a Page-only reader opens Page without passing the classic Article gate", async () => {
        grants.clear(); grants.add(PAGE);
        fetchDatasetData.mockResolvedValueOnce({ data: [{ id: 9 }] });
        const { result, openImageFirstView } = openWith("image_first_page_view");
        expect(await result).toEqual({ status: "opened", rowId: 9 });
        expect(openImageFirstView).toHaveBeenCalledWith(expect.objectContaining({ layout: "page" }));
        expect(showToast).not.toHaveBeenCalled();
        expect((await openWith("image_first_view").result).status).toBe("denied");
    });

    test("a row the fresh fetch no longer returns gives one generic notice that names no row", async () => {
        mountOpenArticle(3);
        const openImageFirstView = vi.fn(async ({ onRowUnavailable }) => { onRowUnavailable(); return null; });
        expect(await openWith("image_first_view", { openImageFirstView }).result).toEqual({ status: "unavailable", rowId: 3 });
        expect(showToast).toHaveBeenCalledOnce();
        const { content, level } = showToast.mock.calls[0][0];
        expect(content.dataset.langKey).toBe("load_failed");
        expect(content.textContent).toBe("Lataus epäonnistui.");
        expect(content.textContent).not.toMatch(/3|Open article/);
        expect(level).toBe("warning");
    });

    test("a throwing opener or a failed listing request gives the same notice", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        mountOpenArticle(3);
        expect(await openWith("image_first_view", {
            openImageFirstView: vi.fn(async () => { throw new Error("network"); }),
        }).result).toEqual({ status: "failed", rowId: 3 });
        document.body.replaceChildren(); setChosenDatasetView("demo", "table");
        fetchDatasetData.mockRejectedValueOnce(new Error("offline"));
        expect(await openWith("image_first_view").result).toEqual({ status: "failed" });
        expect(showToast.mock.calls.map(([call]) => call.content.dataset.langKey)).toEqual(["load_failed", "load_failed"]);
        warn.mockRestore();
    });

    test("a route denial inside the opener is not repeated, and a stopped navigation stays silent", async () => {
        mountOpenArticle(3);
        const denied = vi.fn(async ({ onAccessDenied }) => { onAccessDenied(); return null; });
        expect(await openWith("image_first_view", { openImageFirstView: denied }).result).toEqual({ status: "denied", rowId: 3 });
        expect(await openWith("image_first_view", { openImageFirstView: vi.fn(async () => null) }).result)
            .toEqual({ status: "cancelled", rowId: 3 });
        expect(showToast).not.toHaveBeenCalled();
    });

    test("a superseded failure stays silent", async () => {
        mountOpenArticle(3);
        let fail;
        const openImageFirstView = vi.fn(() => new Promise((_, reject) => { fail = reject; }));
        const { result } = openWith("image_first_view", { openImageFirstView });
        await vi.waitFor(() => expect(fail).toBeTypeOf("function"));
        await openWith("image_first_page_view").result;
        fail(new Error("late"));
        expect(await result).toEqual({ status: "stale" });
        expect(showToast).not.toHaveBeenCalled();
    });

    test("Article and unknown keys are not opened here", async () => {
        expect(await openWith("article_view").result).toEqual({ status: "unsupported" });
        expect(await openWith("table").result).toEqual({ status: "unsupported" });
    });
});
