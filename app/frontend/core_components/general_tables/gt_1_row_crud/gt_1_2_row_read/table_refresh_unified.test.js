// table_refresh_unified.test.js
// Verifies the missing-dataset recovery branch in refreshTableUnified without booting the full table UI stack.
// Bridges mocked fetch/state dependencies and the shared SPA root redirect helper.
// Exists to keep the no-F5 missing-dataset redirect path covered after the v6.18.31 change.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

let retainedToken = null;
const fetchDatasetDataMock = vi.fn();
const generateTableMock = vi.fn();
const resetOffsetMock = vi.fn();
const updateOffsetMock = vi.fn();
const disconnectInfiniteScrollMock = vi.fn();
const applyColumnVisibilityMock = vi.fn();
const openRowArticleViewMock = vi.fn();
const setRedirectNoticeMock = vi.fn();
const clearDatasetSelectionStateMock = vi.fn();
const redirectToRootInSpaMock = vi.fn();
const parseTableQueryStringMock = vi.fn();
const getParamsMock = vi.fn();
const getUnifiedTableStateMock = vi.fn();
const setUnifiedTableStateMock = vi.fn();
const primeDatasetPermissionsMock = vi.fn();
const mergeStateWithOptionsMock = vi.fn();
const computeNextSortStateMock = vi.fn();
const getSearchGroupsForViewRebuildMock = vi.fn();
const getDatasetListingFiltersMock = vi.fn();

async function loadModule() {
    vi.resetModules();
    vi.doMock("../../../navigation/nav_engine/card_article_return_state.js", () => ({
        getCardArticleReturnToken: () => retainedToken,
        invalidateCardArticleReturn: vi.fn(),
    }));
    vi.doMock("../../../endpoints/endpoint_data_fetcher.js", () => ({
        fetchDatasetData: fetchDatasetDataMock,
    }));
    vi.doMock("../../../table_views/dataset_view_printer.js", () => ({
        generate_table: generateTableMock,
    }));
    vi.doMock("../../../infinite_scroll/infinite_scroll_handler.js", () => ({
        resetOffset: resetOffsetMock,
        updateOffset: updateOffsetMock,
        disconnectInfiniteScroll: disconnectInfiniteScrollMock,
    }));
    vi.doMock("../../../infinite_scroll/dataset_listing_filters.js", () => ({
        getDatasetListingFilters: getDatasetListingFiltersMock,
    }));
    vi.doMock("../../../filterbar/filter_list/column_visibility_handler.js", () => ({
        applyColumnVisibility: applyColumnVisibilityMock,
    }));
    vi.doMock("../../../table_views/card_view/row_article_opener.js", () => ({
        openRowArticleView: openRowArticleViewMock,
    }));
    vi.doMock("../../../state_stores/dataset_selection_saver.js", () => ({
        setRedirectNotice: setRedirectNoticeMock,
        clearDatasetSelectionState: clearDatasetSelectionStateMock,
    }));
    vi.doMock("../../../navigation/root_redirect_handler.js", () => ({
        redirectToRootInSpa: redirectToRootInSpaMock,
    }));
    vi.doMock("../../../navigation/nav_engine/query_params.js", () => ({
        getParams: getParamsMock,
        parseTableQueryString: parseTableQueryStringMock,
    }));
    vi.doMock("../../../state_stores/table_state_store.js", () => ({
        getUnifiedTableState: getUnifiedTableStateMock,
        setUnifiedTableState: setUnifiedTableStateMock,
    }));
    vi.doMock("../../../route_permission_checker.js", () => ({
        primeDatasetPermissions: primeDatasetPermissionsMock,
    }));
    vi.doMock("../../../config_fetcher.js", () => ({ getDefaultDatasetSortSync: vi.fn(() => ({ column: "__newest", direction: "DESC" })) }));
    vi.doMock("./table_refresh_unified_helpers.js", () => ({
        mergeStateWithOptions: mergeStateWithOptionsMock,
        computeNextSortState: computeNextSortStateMock,
    }));
    vi.doMock("../../../filterbar/text_search/dataset_search_executor.js", () => ({
        getSearchGroupsForViewRebuild: getSearchGroupsForViewRebuildMock,
    }));

    return import("./table_refresh_unified.js");
}

describe("table_refresh_unified missing-dataset recovery", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        retainedToken = null;
        const baseState = {
            offset: 0,
            sort: { column: "id", direction: "ASC" },
            filters: {},
        };

        getUnifiedTableStateMock.mockReturnValue(baseState);
        primeDatasetPermissionsMock.mockResolvedValue({});
        mergeStateWithOptionsMock.mockImplementation((state) => state);
        parseTableQueryStringMock.mockReturnValue(baseState);
        getParamsMock.mockReturnValue({});
        getSearchGroupsForViewRebuildMock.mockReturnValue(null);
        // The listing's own contract: a committed search is one more condition.
        getDatasetListingFiltersMock.mockImplementation((tableName, filters) => {
            const search = String(getParamsMock(tableName)?.search || "").trim();
            return { ...(filters || {}), ...(search ? { search } : {}) };
        });
        redirectToRootInSpaMock.mockResolvedValue(undefined);
        fetchDatasetDataMock.mockRejectedValue(new Error("Dataset not found"));
    });

    test("dispatches only an explicitly registered surface before SQL fetch and permissions", async () => {
        const { refreshTableUnified } = await loadModule();
        const { registerDatasetQueryAdapter } = await import('../../../filterbar/dataset_surface_provider/dataset_query_adapter_registry.js');
        const refresh = vi.fn(async () => ({ total_count: 1 }));
        const release = registerDatasetQueryAdapter('extension', { refresh });
        try {
            expect(await refreshTableUnified('extension', { skipUrlParams: true })).toEqual({ total_count: 1 });
            expect(refresh).toHaveBeenCalledWith({ skipUrlParams: true });
            expect(fetchDatasetDataMock).not.toHaveBeenCalled();
            expect(primeDatasetPermissionsMock).not.toHaveBeenCalled();
        } finally { release(); }
    });

    test("redirects missing datasets back to root inside the SPA", async () => {
        const mod = await loadModule();

        await mod.refreshTableUnified("ghost_table", { skipUrlParams: true });

        expect(setRedirectNoticeMock).toHaveBeenCalledWith({
            datasetName: "ghost_table",
            reason: "missing",
        });
        expect(clearDatasetSelectionStateMock).toHaveBeenCalledTimes(1);
        expect(redirectToRootInSpaMock).toHaveBeenCalledTimes(1);
        expect(setUnifiedTableStateMock).toHaveBeenCalledTimes(1);
        expect(disconnectInfiniteScrollMock).toHaveBeenCalledWith("ghost_table");
        expect(resetOffsetMock).toHaveBeenCalledWith("ghost_table");
        expect(primeDatasetPermissionsMock).toHaveBeenCalledWith("ghost_table", [
            '/api/add-row-multipart',
            '/api/comment-counts',
            '/api/delete-rows',
            '/api/embedding_stream_handler',
            '/api/modify-columns',
            '/api/update-row',
            '/ui/table-view-style-buttons',
        ]);
        expect(generateTableMock).not.toHaveBeenCalled();
        expect(applyColumnVisibilityMock).not.toHaveBeenCalled();
        expect(updateOffsetMock).not.toHaveBeenCalled();
    });

    test("seeds the next offset before rendering so initial card scroll cannot append duplicates", async () => {
        localStorage.setItem("dev_agent_tasks_view", "card");
        fetchDatasetDataMock.mockResolvedValue({
            columns: ["id", "title"],
            data: [{ id: 828, title: "Extract agent_network as git subtree / separate repo" }],
            types: {},
            row_count: 1,
            has_geo: false,
            row_group_facets: [
                { id: 4, slug: "security", title: { en: "Security" }, row_count: 1 },
            ],
        });
        generateTableMock.mockResolvedValue(document.createElement("div"));

        const mod = await loadModule();

        await mod.refreshTableUnified("dev_agent_tasks", { skipUrlParams: true });

        expect(fetchDatasetDataMock).toHaveBeenCalledWith(expect.objectContaining({
            include_card_support: true,
        }));
        expect(primeDatasetPermissionsMock).toHaveBeenCalledWith("dev_agent_tasks", [
            '/api/add-row-multipart',
            '/api/comment-counts',
            '/api/delete-rows',
            '/api/embedding_stream_handler',
            '/api/modify-columns',
            '/api/update-row',
            '/ui/table-view-style-buttons',
        ]);
        expect(updateOffsetMock).toHaveBeenCalledWith("dev_agent_tasks", 1);
        expect(generateTableMock).toHaveBeenCalledTimes(1);
        expect(generateTableMock).toHaveBeenCalledWith(
            "dev_agent_tasks",
            expect.any(Array),
            expect.any(Array),
            expect.any(Object),
            1,
            false,
            undefined,
            undefined,
            [{ id: 4, slug: "security", title: { en: "Security" }, row_count: 1 }]
        );
        expect(applyColumnVisibilityMock).toHaveBeenCalledWith("dev_agent_tasks");
        expect(updateOffsetMock.mock.invocationCallOrder[0]).toBeLessThan(
            generateTableMock.mock.invocationCallOrder[0]
        );
        expect(primeDatasetPermissionsMock.mock.invocationCallOrder[0]).toBeLessThan(
            fetchDatasetDataMock.mock.invocationCallOrder[0]
        );
    });

    test("requests map support geometry only for map view", async () => {
        localStorage.setItem("app_service_locations_view", "map");
        fetchDatasetDataMock.mockResolvedValue({
            columns: ["id", "title"],
            data: [{ id: 188, title: "Espoo" }],
            types: {},
            row_count: 1,
            has_geo: true,
        });
        generateTableMock.mockResolvedValue(document.createElement("div"));

        const mod = await loadModule();

        await mod.refreshTableUnified("app_service_locations", { skipUrlParams: true });

        expect(fetchDatasetDataMock).toHaveBeenCalledWith(expect.objectContaining({
            include_map_support: true,
            include_card_support: false,
        }));
    });

    test("a view switch during a search browses the searched listing and keeps endless scrolling", async () => {
        // The search for "api" matches 251 rows; the view shows its first page
        // of 20 and must keep paging from there, exactly as when browsing.
        localStorage.setItem("system_functions_view", "card");
        getParamsMock.mockReturnValue({ search: "api" });
        getUnifiedTableStateMock.mockReturnValue({
            offset: 0,
            sort: { column: "name", direction: "ASC" },
            filters: { status: "active" },
        });
        const searchGroups = { isCurrent: vi.fn(() => true), place: vi.fn(async () => true) };
        getSearchGroupsForViewRebuildMock.mockReturnValue(searchGroups);
        const firstPage = Array.from({ length: 20 }, (_value, index) => ({ id: index + 1, name: `api_${index + 1}` }));
        fetchDatasetDataMock.mockResolvedValue({
            columns: ["id", "name"],
            data: firstPage,
            types: { id: "integer", name: "text" },
            row_count: 251,
            has_geo: false,
            row_group_facets: [
                { id: 4, slug: "security", title: { en: "Security" }, row_count: 17 },
            ],
            table_meta: { card_style_variant: "standard" },
			dataset_presentation: {
				background_image_path: "/storage/104/dataset_media/background/original/background.webp",
			},
        });
        generateTableMock.mockResolvedValue(document.createElement("div"));

        const mod = await loadModule();

        await mod.refreshTableUnified("system_functions", { skipUrlParams: true });

        // The one request is the dataset's listing asked with the search as a
        // condition beside the selected filters, not an unsearched page.
        expect(fetchDatasetDataMock).toHaveBeenCalledTimes(1);
        expect(fetchDatasetDataMock).toHaveBeenCalledWith(expect.objectContaining({
            dataset_name: "system_functions",
            offset: 0,
            filters: { status: "active", search: "api" },
        }));
        // Its rows and its count are what the view shows.
        expect(generateTableMock).toHaveBeenCalledWith(
            "system_functions",
            ["id", "name"],
            firstPage,
            { id: "integer", name: "text" },
            251,
            false,
			{ card_style_variant: "standard" },
			{
				background_image_path: "/storage/104/dataset_media/background/original/background.webp",
			},
            null
        );
        // The next page starts after the first one, and endless scrolling is
        // left connected: the only disconnect is the one before the request.
        expect(updateOffsetMock).toHaveBeenCalledWith("system_functions", 20);
        expect(updateOffsetMock.mock.invocationCallOrder[0]).toBeLessThan(
            generateTableMock.mock.invocationCallOrder[0]
        );
        expect(disconnectInfiniteScrollMock).toHaveBeenCalledTimes(1);
        expect(disconnectInfiniteScrollMock.mock.invocationCallOrder[0]).toBeLessThan(
            fetchDatasetDataMock.mock.invocationCallOrder[0]
        );
        // The search's own groups are placed after the rebuilt rows, without
        // asking the search again.
        expect(getSearchGroupsForViewRebuildMock).toHaveBeenCalledWith("system_functions", { query: "api" });
        expect(searchGroups.place).toHaveBeenCalledTimes(1);
        // The counter's text part takes the number the rebuilt listing just counted.
        expect(searchGroups.place).toHaveBeenCalledWith({ rowCount: 251 });
        expect(searchGroups.place.mock.invocationCallOrder[0]).toBeGreaterThan(
            generateTableMock.mock.invocationCallOrder[0]
        );
        expect(applyColumnVisibilityMock).toHaveBeenCalledWith("system_functions");
    });

    test("a search without matches shows the searched listing's empty answer", async () => {
        localStorage.setItem("app_service_catalog_view", "table");
        getParamsMock.mockReturnValue({ search: "no-match" });
        fetchDatasetDataMock.mockResolvedValue({
            columns: ["id", "title"],
            data: [],
            types: { id: "integer", title: "text" },
            row_count: 0,
            has_geo: false,
            row_group_facets: [],
        });
        generateTableMock.mockResolvedValue(document.createElement("div"));

        const mod = await loadModule();

        await mod.refreshTableUnified("app_service_catalog", { skipUrlParams: true });

        expect(fetchDatasetDataMock).toHaveBeenCalledWith(expect.objectContaining({
            filters: { search: "no-match" },
        }));
        expect(generateTableMock).toHaveBeenCalledWith(
            "app_service_catalog",
            ["id", "title"],
            [],
            { id: "integer", title: "text" },
            0,
            false,
			undefined,
			undefined,
            null
        );
        expect(updateOffsetMock).toHaveBeenCalledWith("app_service_catalog", 0);
    });

    test("a rebuild yields to a newer run of the same search started while it waited", async () => {
        localStorage.setItem("system_functions_view", "table");
        getParamsMock.mockReturnValue({ search: "api" });
        let searchStillCurrent = true;
        const searchGroups = { isCurrent: () => searchStillCurrent, place: vi.fn(async () => true) };
        getSearchGroupsForViewRebuildMock.mockReturnValue(searchGroups);
        let release;
        fetchDatasetDataMock.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
        const mod = await loadModule();

        const pending = mod.refreshTableUnified("system_functions", { skipUrlParams: true });
        await vi.waitFor(() => expect(release).toBeTypeOf("function"));
        // A filter changed meanwhile, so the search ran again and reloads the
        // listing itself under the new filters.
        searchStillCurrent = false;
        release({ columns: ["id"], data: [{ id: 1 }], types: {}, row_count: 251 });
        await pending;

        expect(generateTableMock).not.toHaveBeenCalled();
        expect(updateOffsetMock).not.toHaveBeenCalled();
        expect(searchGroups.place).not.toHaveBeenCalled();
    });

    test("opens the first rendered row when article view was requested without a cached search", async () => {
        localStorage.setItem("app_service_catalog_view", "card");
        let storedState = {
            offset: 0,
            sort: { column: "id", direction: "ASC" },
            filters: {},
            cardView: {
                collapsed: true,
                expandedId: null,
                pendingAutoOpenFirstRenderedResult: true,
            },
        };
        getUnifiedTableStateMock.mockImplementation(() => storedState);
        setUnifiedTableStateMock.mockImplementation((_tableName, nextState) => {
            storedState = {
                ...storedState,
                ...nextState,
                cardView: {
                    ...(storedState.cardView || {}),
                    ...(nextState.cardView || {}),
                },
            };
        });
        fetchDatasetDataMock.mockResolvedValue({
            columns: ["id", "title"],
            data: [
                { id: 7, title: "Firefox" },
                { id: 9, title: "Fennec" },
            ],
            types: { id: "integer", title: "text" },
            row_count: 2,
            has_geo: false,
        });
        generateTableMock.mockResolvedValue(document.createElement("div"));

        const mod = await loadModule();

        await mod.refreshTableUnified("app_service_catalog", { skipUrlParams: true });

        expect(setUnifiedTableStateMock).toHaveBeenCalledWith("app_service_catalog", {
            cardView: expect.objectContaining({
                collapsed: true,
                expandedId: 7,
                pendingAutoOpenFirstRenderedResult: false,
                pendingAutoOpenFirstSearchResult: false,
            }),
        });
        expect(openRowArticleViewMock).toHaveBeenCalledWith(
            { id: 7, title: "Firefox" },
            "app_service_catalog",
            null,
            expect.objectContaining({ isCurrent: expect.any(Function) }),
        );
    });

    test("refetches with card support when rendering falls back from unsupported map view", async () => {
        localStorage.setItem("app_service_catalog_view", "map");
        fetchDatasetDataMock.mockResolvedValue({
            columns: ["id", "title"],
            data: [{ id: 133, title: "Brave" }],
            types: {},
            row_count: 1,
            has_geo: false,
        });
        generateTableMock
            .mockImplementationOnce(() => {
                localStorage.setItem("app_service_catalog_view", "card");
                return document.createElement("div");
            })
            .mockImplementation(() => document.createElement("div"));

        const mod = await loadModule();

        await mod.refreshTableUnified("app_service_catalog", { skipUrlParams: true });

        expect(fetchDatasetDataMock).toHaveBeenCalledTimes(2);
        expect(fetchDatasetDataMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
            include_map_support: true,
            include_card_support: false,
        }));
        expect(fetchDatasetDataMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
            include_map_support: false,
            include_card_support: true,
        }));
        expect(generateTableMock).toHaveBeenCalledTimes(2);
        expect(applyColumnVisibilityMock).toHaveBeenCalledTimes(1);
    });
    test("an article waiting for the first search match opens the searched listing's first row", async () => {
        localStorage.setItem("tasks_view", "article_view");
        getParamsMock.mockReturnValue({ search: "waiting" });
        getUnifiedTableStateMock.mockReturnValue({
            sort: { column: "id", direction: "ASC" }, filters: {}, offset: 0,
            articleView: { collapsed: true, expandedId: null, pendingAutoOpenFirstSearchResult: true },
        });
        fetchDatasetDataMock.mockResolvedValue({ columns: ["id"], data: [{ id: 404 }, { id: 405 }], types: {}, row_count: 2 });
        generateTableMock.mockResolvedValue(document.createElement("div"));
        const mod = await loadModule();
        await mod.refreshTableUnified("tasks", { skipUrlParams: true });
        // The only rows rendered are the listing's answer to the search itself,
        // so its first row is the first match.
        expect(fetchDatasetDataMock).toHaveBeenCalledWith(expect.objectContaining({
            filters: { search: "waiting" },
        }));
        expect(generateTableMock.mock.calls.at(-1)[2]).toEqual([{ id: 404 }, { id: 405 }]);
        expect(setUnifiedTableStateMock).toHaveBeenCalledWith("tasks", {
            articleView: expect.objectContaining({ expandedId: 404, pendingAutoOpenFirstSearchResult: false }),
        });
    });

    test("ignores a delayed ordinary response after the committed query changes", async () => {
        let release;
        getParamsMock.mockReturnValue({ search: "old" });
        fetchDatasetDataMock.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
        const mod = await loadModule();
        const old = mod.refreshTableUnified("tasks", { skipUrlParams: true });
        await vi.waitFor(() => expect(release).toBeTypeOf("function"));
        getParamsMock.mockReturnValue({ search: "new" });
        release({ columns: ["id"], data: [{ id: 404 }], types: {}, row_count: 1 });
        await old;
        expect(generateTableMock).not.toHaveBeenCalled();
        expect(openRowArticleViewMock).not.toHaveBeenCalled();
    });

    test("a committed mounted return invalidates a refresh still awaiting its response", async () => {
        const mod = await loadModule();
        let resolve;
        fetchDatasetDataMock.mockReturnValue(new Promise(done => { resolve = done; }));
        const pending = mod.refreshTableUnified("events", { skipUrlParams: true });
        await vi.waitFor(() => expect(fetchDatasetDataMock).toHaveBeenCalledOnce());
        mod.invalidateTableRefresh("events");
        resolve({ data: [{ id: 99 }], columns: ["id"], types: {}, row_count: 1 });
        await pending;
        expect(generateTableMock).not.toHaveBeenCalled();
        expect(updateOffsetMock).not.toHaveBeenCalled();
    });

    test.each(["card", "table"])("article transfer reuses all loaded %s rows and selected row without a page fetch", async (view) => {
        const mod = await loadModule();
        const loaded = await import("../../../table_views/dataset_loaded_rows.js");
        const registry = await import("../../../navigation/nav_engine/dataset_access_registry.js");
        registry.primeDatasetAccessRegistry({ datasets: [{ dataset_name: "events" }] });
        document.body.innerHTML = '<div id="events_' + view + '_view_container"></div>';
        const state = { offset: 4, filters: {}, sort: { column: "id", direction: "ASC" }, articleView: { collapsed: true, expandedId: 3 } };
        getUnifiedTableStateMock.mockReturnValue(state);
        localStorage.setItem("events_view", view);
        const host = document.querySelector("div");
        loaded.rememberLoadedDatasetRows(host, "events", { data: [{ id: 1 }, { id: 2 }], columns: ["id"], types: {}, row_count: 9 }, view);
        loaded.appendLoadedDatasetRows(host, "events", [{ id: 3 }, { id: 4 }], 4);
        const token = loaded.captureLoadedDatasetRows("events");
        localStorage.setItem("events_view", "article_view");
        await mod.refreshTableUnified("events", { skipUrlParams: true, loadedRows: token });
        expect(fetchDatasetDataMock).not.toHaveBeenCalled();
        expect(resetOffsetMock).not.toHaveBeenCalled();
        expect(updateOffsetMock).not.toHaveBeenCalled();
        expect(generateTableMock.mock.calls[0][2].map(row => row.id)).toEqual([1, 2, 3, 4]);
        expect(generateTableMock.mock.calls[0][9].loadedRows).toMatchObject({ offset: 4, projectionView: view });
        expect(openRowArticleViewMock).toHaveBeenCalledWith({ id: 3 }, "events", null, expect.any(Object));
    });

    test("access revoked during transfer preparation prevents rendering retained rows", async () => {
        const mod = await loadModule();
        const loaded = await import("../../../table_views/dataset_loaded_rows.js");
        const registry = await import("../../../navigation/nav_engine/dataset_access_registry.js");
        registry.primeDatasetAccessRegistry({ datasets: [{ dataset_name: "events" }] });
        const access = await import("../../../navigation/nav_engine/dataset_access_registry.js");
        document.body.innerHTML = '<div id="events_card_view_container"></div>';
        getUnifiedTableStateMock.mockReturnValue({ offset: 1, filters: {}, sort: {} });
        localStorage.setItem("events_view", "card");
        loaded.rememberLoadedDatasetRows(document.querySelector("div"), "events", { data: [{ id: 1 }] }, "card");
        const token = loaded.captureLoadedDatasetRows("events");
        localStorage.setItem("events_view", "article_view");
        primeDatasetPermissionsMock.mockImplementationOnce(() => { access.clearDatasetAccessRegistry(); return Promise.resolve({}); });
        await mod.refreshTableUnified("events", { skipUrlParams: true, loadedRows: token });
        expect(generateTableMock).not.toHaveBeenCalled();
        expect(fetchDatasetDataMock).not.toHaveBeenCalled();
    });


    test.each([true, false])("Forward reuses the committed card prefix only with its valid return token (%s)", async valid => {
        const mod = await loadModule();
        const loaded = await import("../../../table_views/dataset_loaded_rows.js");
        const registry = await import("../../../navigation/nav_engine/dataset_access_registry.js");
        registry.primeDatasetAccessRegistry({ datasets: [{ dataset_name: "events" }] });
        document.body.innerHTML = '<div id="events_card_view_container"></div>';
        loaded.rememberLoadedDatasetRows(document.querySelector("div"), "events", {
            data: [{ id: 1 }, { id: 2 }, { id: 3 }], columns: ["id"], types: {}, row_count: 10,
        }, "card");
        localStorage.setItem("events_view", "article_view");
        getUnifiedTableStateMock.mockReturnValue({ offset: 0, filters: {}, sort: { column: "id", direction: "ASC" } });
        // The signature at render and return must match; URL parsing may reset
        // the offset, but cannot change the already-committed source prefix.
        loaded.rememberLoadedDatasetRows(document.querySelector("div"), "events", {
            data: [{ id: 1 }, { id: 2 }, { id: 3 }], columns: ["id"], types: {}, row_count: 10,
        }, "card");
        const requested = {};
        retainedToken = valid ? requested : {};
        fetchDatasetDataMock.mockResolvedValue({ data: [{ id: 1 }], columns: ["id"], types: {}, row_count: 10 });
        await mod.refreshTableUnified("events", { skipUrlParams: true, preserveCardReturn: requested });
        if (valid) {
            expect(fetchDatasetDataMock).not.toHaveBeenCalled();
            expect(resetOffsetMock).not.toHaveBeenCalled();
            expect(generateTableMock.mock.calls[0][2]).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
            expect(setUnifiedTableStateMock).toHaveBeenCalledWith("events", { offset: 3 });
        } else {
            expect(fetchDatasetDataMock).toHaveBeenCalledOnce();
            expect(resetOffsetMock).toHaveBeenCalledWith("events");
        }
    });

});
