// table_refresh_unified.test.js
// Verifies the missing-dataset recovery branch in refreshTableUnified without booting the full table UI stack.
// Bridges mocked fetch/state dependencies and the shared SPA root redirect helper.
// Exists to keep the no-F5 missing-dataset redirect path covered after the v6.18.31 change.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

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
const getCachedSearchResultForRenderMock = vi.fn();
const hasCachedSearchResultsMock = vi.fn();

async function loadModule() {
    vi.resetModules();
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
    vi.doMock("../../../filterbar/filter_list/column_visibility_handler.js", () => ({
        applyColumnVisibility: applyColumnVisibilityMock,
    }));
    vi.doMock("../../../table_views/card_view/row_article_opener.js", () => ({
        openRowArticleView: openRowArticleViewMock,
        open_big_card_view: openRowArticleViewMock,
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
    vi.doMock("./table_refresh_unified_helpers.js", () => ({
        mergeStateWithOptions: mergeStateWithOptionsMock,
        computeNextSortState: computeNextSortStateMock,
    }));
    vi.doMock("../../../filterbar/text_search/dataset_search_executor.js", () => ({
        getCachedSearchResultForRender: getCachedSearchResultForRenderMock,
        hasCachedSearchResults: hasCachedSearchResultsMock,
    }));

    return import("./table_refresh_unified.js");
}

describe("table_refresh_unified missing-dataset recovery", () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
        hasCachedSearchResultsMock.mockReturnValue(false);
        getCachedSearchResultForRenderMock.mockReturnValue(null);
        redirectToRootInSpaMock.mockResolvedValue(undefined);
        fetchDatasetDataMock.mockRejectedValue(new Error("Dataset not found"));
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

    test("renders cached search rows when switching views with an active search", async () => {
        localStorage.setItem("app_service_catalog_view", "table");
        getParamsMock.mockReturnValue({ search: "firefox" });
        hasCachedSearchResultsMock.mockReturnValue(true);
        getCachedSearchResultForRenderMock.mockReturnValue({
            columns: ["id", "title", "cached_image"],
            data: [{ id: 7, title: "Firefox" }],
            types: { title: "text", cached_image: "text" },
            row_count: 1,
        });
        fetchDatasetDataMock.mockResolvedValue({
            columns: ["id", "title"],
            data: [{ id: 133, title: "Brave" }],
            types: { id: "integer", title: "text" },
            row_count: 42,
            has_geo: false,
            table_meta: { card_style_variant: "standard" },
        });
        generateTableMock.mockResolvedValue(document.createElement("div"));

        const mod = await loadModule();

        await mod.refreshTableUnified("app_service_catalog", { skipUrlParams: true });

        expect(generateTableMock).toHaveBeenCalledWith(
            "app_service_catalog",
            ["id", "title"],
            [{ id: 7, title: "Firefox" }],
            { title: "text", cached_image: "text", id: "integer" },
            1,
            false,
            { card_style_variant: "standard" }
        );
        expect(updateOffsetMock).not.toHaveBeenCalled();
        expect(disconnectInfiniteScrollMock).toHaveBeenCalledTimes(2);
        expect(applyColumnVisibilityMock).toHaveBeenCalledWith("app_service_catalog");
    });

    test("keeps zero-result cached searches empty instead of falling back to normal rows", async () => {
        localStorage.setItem("app_service_catalog_view", "table");
        getParamsMock.mockReturnValue({ search: "no-match" });
        getCachedSearchResultForRenderMock.mockReturnValue({
            columns: [],
            data: [],
            types: {},
            row_count: 0,
        });
        fetchDatasetDataMock.mockResolvedValue({
            columns: ["id", "title"],
            data: [{ id: 133, title: "Brave" }],
            types: { id: "integer", title: "text" },
            row_count: 42,
            has_geo: false,
        });
        generateTableMock.mockResolvedValue(document.createElement("div"));

        const mod = await loadModule();

        await mod.refreshTableUnified("app_service_catalog", { skipUrlParams: true });

        expect(generateTableMock).toHaveBeenCalledWith(
            "app_service_catalog",
            ["id", "title"],
            [],
            { id: "integer", title: "text" },
            0,
            false,
            undefined
        );
        expect(updateOffsetMock).not.toHaveBeenCalled();
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
            null
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
});
