// dataset_search_clearer.test.js
// Verifies the committed-search clear transition preserves every adjacent dataset state.
// Bridges URL identity, shared search state, cached search artifacts, and table refresh mocks.
// Exists so the narrow X action can never drift into the broader Reset search behavior.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

const getParamsMock = vi.fn();
const setParamsMock = vi.fn();
const updateURLMock = vi.fn();
const isDatasetRowPathMock = vi.fn();
const refreshTableUnifiedMock = vi.fn();
const datasetSearchStateSetMock = vi.fn();
const ongoingSearchResultsMock = {};

vi.mock("../../navigation/nav_engine/query_params.js", () => ({
    DATASET_PREFIX: "/",
    getParams: getParamsMock,
    setParams: setParamsMock,
    updateURL: updateURLMock,
}));

vi.mock("../../navigation/nav_engine/history_navigation_handler_helpers.js", () => ({
    isDatasetRowPath: isDatasetRowPathMock,
}));

vi.mock("../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js", () => ({
    refreshTableUnified: refreshTableUnifiedMock,
}));

vi.mock("./dataset_search_state_reader.js", () => ({
    datasetSearchState: { set: datasetSearchStateSetMock },
}));

vi.mock("./dataset_search_executor.js", () => ({
    ongoingSearchResults: ongoingSearchResultsMock,
}));

describe("clearCommittedDatasetSearch", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        localStorage.clear();
        vi.clearAllMocks();
        Object.keys(ongoingSearchResultsMock).forEach((key) => {
            delete ongoingSearchResultsMock[key];
        });
        isDatasetRowPathMock.mockReturnValue(true);
        window.history.replaceState(
            { bigCard: true, dataset: "tasks", rowId: "473" },
            "",
            "/tasks/473-description?search=urgent&sort_column=name&status=open&view=article"
        );
    });

    test("clears only committed text search and preserves the row-article route", async () => {
        const params = {
            search: "urgent",
            sort_column: "name",
            sort_order: "ASC",
            status: "open",
            view: "article",
        };
        getParamsMock.mockReturnValue(params);
        ongoingSearchResultsMock.tasks = { data: [{ id: 473 }] };
        document.body.innerHTML = `
            <div id="tasks_table_view_container">
                <div id="tasks_search_ai_host"></div>
                <div class="search-stage-notice"></div>
            </div>
            <div id="tasks_card_view_container">
                <div id="tasks_search_ai_cards"></div>
            </div>
        `;
        const { clearCommittedDatasetSearch } = await import(
            "./dataset_search_clearer.js"
        );

        expect(clearCommittedDatasetSearch("tasks")).toBe(true);

        expect(params).toEqual({
            sort_column: "name",
            sort_order: "ASC",
            status: "open",
            view: "article",
        });
        expect(setParamsMock).toHaveBeenCalledWith("tasks", params);
        expect(updateURLMock).toHaveBeenCalledWith(
            "tasks",
            params,
            undefined,
            {
                pathOverride: "/tasks/473-description",
                state: { bigCard: true, dataset: "tasks", rowId: "473" },
            }
        );
        expect(datasetSearchStateSetMock).toHaveBeenCalledWith(
            "tasks",
            "",
            "clear-committed-search"
        );
        expect(localStorage.getItem("int_search_draft_tasks")).toBe("");
        expect(ongoingSearchResultsMock.tasks).toBeNull();
        expect(document.querySelector("#tasks_search_ai_host")).toBeNull();
        expect(document.querySelector("#tasks_search_ai_cards")).toBeNull();
        expect(document.querySelector(".search-stage-notice")).toBeNull();
        expect(refreshTableUnifiedMock).toHaveBeenCalledWith("tasks", {
            skipUrlParams: true,
        });
    });

    test("does nothing when there is no committed text search", async () => {
        getParamsMock.mockReturnValue({ status: "open", view: "card" });
        const { clearCommittedDatasetSearch } = await import(
            "./dataset_search_clearer.js"
        );

        expect(clearCommittedDatasetSearch("tasks")).toBe(false);
        expect(setParamsMock).not.toHaveBeenCalled();
        expect(updateURLMock).not.toHaveBeenCalled();
        expect(datasetSearchStateSetMock).not.toHaveBeenCalled();
        expect(refreshTableUnifiedMock).not.toHaveBeenCalled();
    });
});
