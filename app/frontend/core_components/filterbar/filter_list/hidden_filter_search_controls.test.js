// hidden_filter_search_controls.test.js
// Reproduces visible-to-hidden reference metadata on a mounted searched listing.
// Connects real search, refresh, row commits, filter controls and active chips.
// Keeps transport and card construction synthetic while proving K377's UI repair.

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as viewPrinter from "../../table_views/dataset_view_printer.js";
import * as viewRenderer from "../../table_views/dataset_view_renderer.js";
import { datasetAppearanceState } from "../../table_views/dataset_appearance_state.js";
import { setAllSpecs } from "../../state_stores/table_specs_reader.js";
import { setChosenDatasetView } from "../../state_stores/dataset_view_choice_saver.js";
import { getUnifiedTableState, setUnifiedTableState } from "../../state_stores/table_state_store.js";
import { getParams, setParams } from "../../navigation/nav_engine/query_params.js";
import { primeDatasetAccessRegistry } from "../../navigation/nav_engine/dataset_access_registry.js";
import { refreshTableUnified } from "../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js";
import { disconnectInfiniteScroll } from "../../infinite_scroll/infinite_scroll_handler.js";
import { do_intelligent_search, ongoingSearchResults } from "../text_search/dataset_search_executor.js";
import { getSearchFilterContext } from "../text_search/dataset_search_runtime_state.js";
import { datasetSearchState } from "../text_search/dataset_search_state_reader.js";
import { isColumnFilterHidden } from "./filter_column_builder_helpers.js";

const { fetchRows, streamSearch, buildCards, appendCards } = vi.hoisted(() => ({
    fetchRows: vi.fn(), streamSearch: vi.fn(), buildCards: vi.fn(), appendCards: vi.fn(),
}));
vi.mock("../../endpoints/endpoint_data_fetcher.js", () => ({ fetchDatasetData: fetchRows }));
vi.mock("../../endpoints/endpoint_router.js", () => ({
    endpoint_router: vi.fn(async () => ({})), get_endpoint_url: () => "/api/fixture",
}));
vi.mock("../../route_permission_checker.js", () => ({
    hasRoutePermission: () => true, hasDatasetPermission: async () => false,
    primeDatasetPermissions: vi.fn(), applyPermission: vi.fn(),
}));
vi.mock("../../config_fetcher.js", async original => ({
    ...await original(), getDefaultViewSync: () => "card",
    getDefaultDatasetSortSync: () => ({ column: "id", direction: "ASC" }),
}));
vi.mock("../../table_views/card_view/card_view_printer.js", () => ({
    create_card_view: buildCards, appendDataToCardView: appendCards,
}));
vi.mock("../text_search/dataset_search_response_reader.js", () => ({ readDatasetSearchResponse: streamSearch }));
vi.mock("../text_search/supplemental_dataset_search.js", () => ({
    createSupplementalDatasetSearch: () => ({ place: vi.fn(), destroy: vi.fn() }),
}));

const columns = ["id", "owner_id", "owner_name (ln)", "title"];
const visibleTypes = { id: { data_type: "integer" }, title: { data_type: "text" },
    owner_id: { data_type: "integer", foreign_table: "accounts" } };
const visibleAnswer = { columns, types: visibleTypes, data: [{ id: 1, title: "Matka" }], row_count: 1 };
const options = { useLocation: true, gps: { lat: 60.17, lon: 24.94 },
    suppressAuthRedirect: true, suppressErrorToast: true };
let buildView, commitRows;

beforeEach(async () => {
    vi.resetAllMocks();
    localStorage.clear(); sessionStorage.clear(); datasetAppearanceState.clear();
    delete ongoingSearchResults.jobs;
    history.replaceState({}, "", "/jobs");
    primeDatasetAccessRegistry({ datasets: [{ dataset_name: "jobs", table_uid: 11,
        names: ["jobs"], preferred_name: "jobs", can_read_rows: true }] });
    setAllSpecs({ jobs: { table_uid: 11 } });
    setChosenDatasetView("jobs", "card");
    const filters = { "jobs_owner_name (ln)": "Vanha omistaja", jobs_title: "Matka" };
    setUnifiedTableState("jobs", { filters, sort: { column: "id", direction: "ASC" } });
    setParams("jobs", { ...filters, view: "card" });
    datasetSearchState.set("jobs", "");
    document.body.innerHTML = '<div id="tabs_container"></div>';
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
    appendCards.mockImplementation(async (host, _columns, rows) => {
        for (const row of rows) {
            const card = document.createElement("div");
            card.className = "card"; card.dataset.id = row.id; card.textContent = row.title;
            host.appendChild(card);
        }
    });
    buildCards.mockImplementation(async (_columns, rows) => {
        const wrapper = document.createElement("div"); wrapper.className = "card_view_wrapper";
        const host = document.createElement("div"); host.className = "card_container";
        wrapper.appendChild(host);
        await appendCards(host, columns, rows);
        return wrapper;
    });
    streamSearch.mockImplementation(async function* () { yield { stage: "ai", data: [] }; });
    fetchRows.mockResolvedValue(visibleAnswer);
    await viewPrinter.generate_table("jobs", columns, visibleAnswer.data, visibleTypes, 1);
    expect(document.getElementById("jobs_owner_id")).not.toBeNull();
    expect(document.querySelector(".active_filters").textContent).toContain("Vanha omistaja");
    expect(isColumnFilterHidden("owner_name (ln)", JSON.parse(localStorage.getItem("jobs_dataTypes")))).toBe(false);
    setParams("jobs", { ...getParams("jobs"), search: "travel" });
    datasetSearchState.set("jobs", "travel");
    history.replaceState({}, "", `/jobs?${new URLSearchParams(getParams("jobs"))}`);
    buildView = vi.spyOn(viewPrinter, "generate_table");
    commitRows = vi.spyOn(viewRenderer, "commitDatasetViewRows");
    buildCards.mockClear(); appendCards.mockClear();
});

afterEach(() => {
    document.getElementById("jobs_filterBar_panel")?.destroy?.();
    disconnectInfiniteScroll("jobs");
    ongoingSearchResults.jobs?.abortController?.abort();
    delete ongoingSearchResults.jobs;
    document.body.replaceChildren();
    vi.restoreAllMocks(); vi.unstubAllGlobals();
});

function hiddenAnswer(flag = "hide_in_filter_panel") {
    return { ...visibleAnswer, data: [{ id: 42, title: "Matka" }],
        columns: flag === "hide_everywhere" ? ["id", "title"] : columns,
        types: { ...visibleTypes, owner_id: { ...visibleTypes.owner_id, [flag]: true } } };
}

const repairCases = ["hide_in_filter_panel", "hide_everywhere"].flatMap(flag =>
    ["search", "refresh"].map(entry => [flag, entry]));
test.each(repairCases)("%s cleanup through %s removes mounted inputs, chips and cached visibility", async (flag, entry) => {
    if (entry === "refresh") {
        await do_intelligent_search("jobs", "travel", options);
        fetchRows.mockClear(); streamSearch.mockClear(); commitRows.mockClear();
    }
    fetchRows.mockResolvedValue(hiddenAnswer(flag));
    if (entry === "search") await do_intelligent_search("jobs", "travel", options);
    else await refreshTableUnified("jobs", { skipUrlParams: true });

    expect.soft(document.getElementById("jobs_owner_id")).toBeNull();
    expect.soft(document.querySelector(".active_filters").textContent).not.toContain("Vanha omistaja");
    expect.soft(JSON.parse(localStorage.getItem("jobs_dataTypes"))).toEqual(hiddenAnswer(flag).types);
    expect.soft(JSON.parse(localStorage.getItem("jobs_columns"))).toEqual(hiddenAnswer(flag).columns);
    expect(document.getElementById("jobs_title")).not.toBeNull();
    expect(document.querySelector(".card_container .card").dataset.id).toBe("42");
    expect(getUnifiedTableState("jobs").filters).toEqual({ jobs_title: "Matka" });
    const cache = ongoingSearchResults.jobs;
    expect(cache.complete).toBe(true);
    expect(cache.executionPromise).toBeNull();
    expect(cache.filterSignature).toBe(getSearchFilterContext("jobs").signature);
    expect(cache.searchOptions).toEqual(options);
    expect(fetchRows).toHaveBeenCalledTimes(2);
    expect(fetchRows.mock.calls.at(-1)[0]).toMatchObject({ offset: 0,
        filters: { jobs_title: "Matka", search: "travel" } });
    expect(buildView).toHaveBeenCalledOnce();
    expect(commitRows).not.toHaveBeenCalled();
    expect(streamSearch).toHaveBeenCalledOnce();
    expect(streamSearch.mock.calls[0][2]).toMatchObject({ ...options, filters: { jobs_title: "Matka" } });
});

test("unchanged metadata keeps mounted controls and uses one listing load", async () => {
    const input = document.getElementById("jobs_owner_id");
    const panel = document.getElementById("jobs_filterBar_panel");
    await do_intelligent_search("jobs", "travel", options);
    expect(fetchRows).toHaveBeenCalledOnce();
    expect(commitRows).toHaveBeenCalledOnce();
    expect(buildView).not.toHaveBeenCalled();
    expect(document.getElementById("jobs_owner_id")).toBe(input);
    expect(document.getElementById("jobs_filterBar_panel")).toBe(panel);
    expect(ongoingSearchResults.jobs.searchOptions).toEqual(options);
});

test.each(["new query", "retired dataset"])("pending repair cannot commit after %s", async superseding => {
    let deliver;
    fetchRows.mockResolvedValueOnce(hiddenAnswer()).mockImplementationOnce(() =>
        new Promise(resolve => { deliver = resolve; }));
    const pending = do_intelligent_search("jobs", "travel", options);
    await vi.waitFor(() => expect(deliver).toBeTypeOf("function"));
    const repairCache = ongoingSearchResults.jobs;
    if (superseding === "new query") {
        setParams("jobs", { ...getParams("jobs"), search: "new question" });
        await do_intelligent_search("jobs", "new question", options);
    } else datasetAppearanceState.forget("jobs");
    deliver(hiddenAnswer("hide_everywhere"));
    await pending;

    expect(buildCards).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("jobs_dataTypes"))).toEqual(visibleTypes);
    expect(document.querySelector(".card_container .card").dataset.id).toBe("1");
    expect(repairCache.complete).toBe(false);
    if (superseding === "new query") {
        expect(ongoingSearchResults.jobs.query).toBe("new question");
        expect(ongoingSearchResults.jobs.complete).toBe(true);
        expect(commitRows).toHaveBeenCalledOnce();
    } else expect(commitRows).not.toHaveBeenCalled();
    expect(streamSearch).toHaveBeenCalledTimes(superseding === "new query" ? 1 : 0);
});
