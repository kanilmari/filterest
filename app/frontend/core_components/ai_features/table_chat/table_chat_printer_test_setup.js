// table_chat_printer_test_setup.js
// Shares the chat UI transport, renderer and query-state fixtures.
// Connects focused composer, result and plan regressions to the real chat module.
// Preserves the existing cases while keeping every handwritten file below 700 lines.
import { vi } from "vitest";

let configuredChatMode = "api_tools";
export const endpointRouterMock = vi.fn();
export const generateTableMock = vi.fn();
export const disconnectInfiniteScrollMock = vi.fn();
export const resetOffsetMock = vi.fn();
export const updateOffsetMock = vi.fn();
export const hasCachedSearchResultsMock = vi.fn();
export const refreshTableUnifiedMock = vi.fn();
export const getUnifiedTableStateMock = vi.fn();
export const sortCachedSearchResultsMock = vi.fn();
export const setUnifiedTableStateMock = vi.fn();
export const getParamsMock = vi.fn();
export const setParamsMock = vi.fn();
export const updateURLMock = vi.fn();
export const emitDatasetSortSelectionMock = vi.fn();
export const hasRoutePermissionMock = vi.fn();
let tableState;
let queryParamsState;

export async function loadModule() {
    vi.resetModules();
    vi.doMock("../../table_views/dataset_view_printer.js", () => ({
        generate_table: generateTableMock,
    }));
    vi.doMock("../../infinite_scroll/infinite_scroll_handler.js", () => ({
        disconnectInfiniteScroll: disconnectInfiniteScrollMock,
        resetOffset: resetOffsetMock,
        updateOffset: updateOffsetMock,
    }));
    vi.doMock(
        "../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js",
        () => ({
            getUnifiedTableState: getUnifiedTableStateMock,
            setUnifiedTableState: setUnifiedTableStateMock,
            refreshTableUnified: refreshTableUnifiedMock,
        })
    );
    vi.doMock("../../endpoints/endpoint_router.js", () => ({
        endpoint_router: endpointRouterMock,
    }));
    vi.doMock("../../lang/translation_handler.js", () => ({
        getTranslationForKey: (key) =>
            ({
                send: "Send",
                write_question: "Write your question",
                results_loaded: "Results loaded.",
            })[key] || "",
    }));
    vi.doMock("../../route_permission_checker.js", () => ({
        hasRoutePermission: hasRoutePermissionMock,
    }));
    vi.doMock("../../navigation/nav_engine/query_params.js", () => ({
        getParams: getParamsMock,
        setParams: setParamsMock,
        updateURL: updateURLMock,
    }));
    vi.doMock("../../filterbar/top_row_buttons/sort_sync_state.js", () => ({
        emitDatasetSortSelection: emitDatasetSortSelectionMock,
    }));
    vi.doMock("../../filterbar/text_search/dataset_search_executor.js", () => ({
        hasCachedSearchResults: hasCachedSearchResultsMock,
        sortCachedSearchResults: sortCachedSearchResultsMock,
    }));
    vi.doMock("../../../ui_config.js", () => ({
        FILTERBAR_AI_CHAT_MODE: configuredChatMode,
    }));
    return import("./table_chat_printer.js");
}

export function resetTableChatPrinterTest() {
    configuredChatMode = "api_tools";
    endpointRouterMock.mockReset();
    generateTableMock.mockReset();
    disconnectInfiniteScrollMock.mockReset();
    resetOffsetMock.mockReset();
    updateOffsetMock.mockReset();
    hasRoutePermissionMock.mockReset();
    hasRoutePermissionMock.mockImplementation(
        (route) => route === "/api/app/ai-chat/query"
    );
    generateTableMock.mockResolvedValue(undefined);
    refreshTableUnifiedMock.mockResolvedValue(undefined);
    hasCachedSearchResultsMock.mockReset();
    getUnifiedTableStateMock.mockReset();
    sortCachedSearchResultsMock.mockReset();
    setUnifiedTableStateMock.mockReset();
    getParamsMock.mockReset();
    setParamsMock.mockReset();
    updateURLMock.mockReset();
    emitDatasetSortSelectionMock.mockReset();
    tableState = { filters: {}, sort: { column: null, direction: null }, offset: 0 };
    queryParamsState = {};
    getUnifiedTableStateMock.mockImplementation(() => structuredClone(tableState));
    setUnifiedTableStateMock.mockImplementation((_, nextState) => {
        tableState = structuredClone(nextState);
    });
    getParamsMock.mockImplementation(() => ({ ...queryParamsState }));
    setParamsMock.mockImplementation((_, params) => {
        queryParamsState = { ...params };
    });
    hasCachedSearchResultsMock.mockReturnValue(false);
    sortCachedSearchResultsMock.mockResolvedValue(true);
    localStorage.clear();
    document.documentElement.lang = "en";
    document.head.innerHTML = "";
    document.body.innerHTML = `<div id="chat-host"></div>`;
}

export function setChatQueryParamsState(params) { queryParamsState = params; }
