// hidden_filter_cleanup_regressions.test.js
// Reproduces cleanup races and search completion with the real state owners.
// Connects refresh, pagination, search and navigation with mocked I/O/rendering.
// Protects K377 without letting a repair escape its dataset or strand a search.
// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getUnifiedTableState, setUnifiedTableState } from "../../state_stores/table_state_store.js";
import { getParams, setParams } from "../../navigation/nav_engine/query_params.js";
import { primeDatasetAccessRegistry } from "../../navigation/nav_engine/dataset_access_registry.js";
import { setChosenDatasetView } from "../../state_stores/dataset_view_choice_saver.js";
import { refreshTableUnified } from "../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js";
import { disconnectInfiniteScroll } from "../../infinite_scroll/infinite_scroll_handler.js";
import { do_intelligent_search, ongoingSearchResults } from "../text_search/dataset_search_executor.js";
import { getSearchFilterContext } from "../text_search/dataset_search_runtime_state.js";
import { discardHiddenColumnFilters } from "./hidden_filter_state_reconciler.js";

const { fetchRows, buildView, commitRows, streamSearch, supplemental } = vi.hoisted(() => ({
    fetchRows: vi.fn(), buildView: vi.fn(), commitRows: vi.fn(), streamSearch: vi.fn(), supplemental: vi.fn(),
}));
vi.mock("../../endpoints/endpoint_data_fetcher.js", () => ({ fetchDatasetData: fetchRows }));
vi.mock("../../endpoints/endpoint_router.js", () => ({ endpoint_router: vi.fn(async () => ({})) }));
vi.mock("../../table_views/dataset_view_printer.js", () => ({ generate_table: buildView }));
vi.mock("../../table_views/dataset_view_renderer.js", () => ({ commitDatasetViewRows: commitRows }));
vi.mock("../../table_views/table_view/table_row_printer.js", () => ({ appendDataToTable: vi.fn() }));
vi.mock("../../table_views/card_view/card_view_printer.js", () => ({ appendDataToCardView: vi.fn() }));
vi.mock("../../table_views/card_view/row_article_opener.js", () => ({ openRowArticleView: vi.fn() }));
vi.mock("../../route_permission_checker.js", () => ({ primeDatasetPermissions: vi.fn() }));
vi.mock("../../config_fetcher.js", () => ({ getDefaultDatasetSortSync: () => ({ column: "id", direction: "ASC" }) }));
vi.mock("./column_visibility_handler.js", () => ({ applyColumnVisibility: vi.fn() }));
vi.mock("./row_group_facet_printer.js", () => ({ renderRowGroupFacets: vi.fn() }));
vi.mock("../text_search/dataset_search_response_reader.js", () => ({ readDatasetSearchResponse: streamSearch }));
vi.mock("../text_search/supplemental_dataset_search.js", () => ({ createSupplementalDatasetSearch: supplemental }));
vi.mock("../../lang/translation_handler.js", () => ({ getTranslationForKey: (_key, { fallback }) => fallback }));
vi.mock("../../../reusable_components/results_count/results_count_printer.js", () => ({
    setResultsCount: vi.fn(), setSearchAiResultsCount: vi.fn(),
}));

const columns = ["id", "owner_id", "owner_name (ln)", "title"];
const types = { id: { data_type: "integer" }, title: { data_type: "text" },
    owner_id: { data_type: "integer", foreign_table: "accounts", hide_in_filter_panel: true } };
const answer = { columns, types, data: [{ id: 42, title: "Trip" }], row_count: 1 };
const currentAddress = () => location.pathname + location.search + location.hash;

function restoreHiddenName() {
    const filters = { "jobs_owner_name (ln)": "Old owner", jobs_title: "Trip" };
    setUnifiedTableState("jobs", { filters, offset: 30, sort: { column: "title", direction: "ASC" } });
    setParams("jobs", { ...filters, view: "card", search: "travel" });
    history.replaceState({}, "", `/jobs?${new URLSearchParams(getParams("jobs"))}`);
}

beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem("user_permissions", JSON.stringify(["/api/get-intelligent-results"]));
    for (const key of Object.keys(ongoingSearchResults)) delete ongoingSearchResults[key];
    history.replaceState({}, "", "/");
    primeDatasetAccessRegistry({ datasets: ["jobs", "other"].map((dataset_name, index) => ({
        dataset_name, table_uid: index + 11, names: [dataset_name], preferred_name: dataset_name, can_read_rows: true,
    })) });
    setChosenDatasetView("jobs", "card");
    document.body.innerHTML = '<div id="jobs_card_view_container"><div class="card_container"></div></div><div id="jobs_filters">Same available fields</div>';
    localStorage.setItem("jobs_columns", JSON.stringify(columns));
    localStorage.setItem("jobs_dataTypes", JSON.stringify(types));
    buildView.mockImplementation(async () => document.getElementById("jobs_card_view_container"));
    commitRows.mockResolvedValue("committed");
    fetchRows.mockResolvedValue(answer);
    streamSearch.mockImplementation(async function* () { yield { stage: "ai", data: [] }; });
    supplemental.mockImplementation(() => ({ place: vi.fn(), destroy: vi.fn() }));
    vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { disconnectInfiniteScroll("jobs"); vi.unstubAllGlobals(); });

test("late dataset A cleanup cannot replace dataset B's address or history", async () => {
    restoreHiddenName();
    let deliver;
    fetchRows.mockImplementationOnce(() => new Promise(resolve => { deliver = resolve; }));
    const pending = refreshTableUnified("jobs", { skipUrlParams: true });
    await vi.waitFor(() => expect(deliver).toBeTypeOf("function"));
    const nextHistory = { dataset: "other", rowId: "7", bigCard: true,
        articleReturnAvailable: true, articleOriginEntry: "other-origin", __filterestEntryId: "other-entry" };
    history.pushState(nextHistory, "", "/other/7-readable?other_title=Stay#section");
    setParams("other", { other_title: "Stay" });
    const nextAddress = currentAddress();
    const entries = history.length;
    deliver(answer);
    await pending;
    expect(currentAddress()).toBe(nextAddress);
    expect(history.state).toEqual(nextHistory);
    expect(history.length).toBe(entries);
    expect(getParams("other")).toEqual({ other_title: "Stay" });
});

test.each(["/jobs", "/admin/jobs"])("article cleanup keeps %s row path, hash and navigation history", path => {
    restoreHiddenName();
    const articleHistory = { dataset: "jobs", rowId: "42", bigCard: true,
        articleReturnAvailable: true, articleOriginEntry: "list-entry", __filterestEntryId: "article-entry",
        __filterestDatasetView: { dataset: "jobs", path: `${path}/42-readable`, view: "article_view" },
        scrollPosition: 81 };
    history.replaceState(articleHistory, "", `${path}/42-readable?${new URLSearchParams(getParams("jobs"))}#section`);
    const entries = history.length;
    expect(discardHiddenColumnFilters("jobs", columns, types)).toBe(true);
    expect(location.pathname).toBe(`${path}/42-readable`);
    expect(location.hash).toBe("#section");
    expect(history.state).toEqual(articleHistory);
    expect(history.length).toBe(entries);
    expect(Object.fromEntries(new URLSearchParams(location.search))).toEqual({
        jobs_title: "Trip", view: "card", search: "travel",
    });
});

test.each([[false, true], [true, true], [true, false]])("search completes once after hidden-name restore=%s, mounted host=%s", async (hidden, mounted) => {
    restoreHiddenName();
    if (!mounted) document.querySelector(".card_container").remove();
    if (!hidden) discardHiddenColumnFilters("jobs", columns, types);
    const filterPanel = document.getElementById("jobs_filters");
    const options = { useLocation: true, gps: { lat: 60.17, lon: 24.94 }, suppressAuthRedirect: true, suppressErrorToast: true };
    await do_intelligent_search("jobs", "travel", options);
    const cache = ongoingSearchResults.jobs;
    expect(cache.complete).toBe(true);
    expect(cache.executionPromise).toBeNull();
    expect(cache.filterSignature).toBe(getSearchFilterContext("jobs").signature);
    expect(cache.searchOptions).toEqual(options);
    expect(cache.data).toEqual(answer.data);
    expect(getUnifiedTableState("jobs").filters).toEqual({ jobs_title: "Trip" });
    expect(fetchRows).toHaveBeenCalledTimes(hidden ? 2 : 1);
    expect(fetchRows.mock.calls.at(-1)[0]).toMatchObject({ offset: 0, filters: { jobs_title: "Trip", search: "travel" } });
    expect(commitRows.mock.calls.length + buildView.mock.calls.length).toBe(1);
    expect(streamSearch).toHaveBeenCalledOnce();
    expect(streamSearch.mock.calls[0][2]).toMatchObject({ ...options, filters: { jobs_title: "Trip" } });
    expect(supplemental).toHaveBeenCalledTimes(hidden ? 2 : 1);
    if (hidden) expect(supplemental.mock.results[0].value.destroy).toHaveBeenCalledOnce();
    expect(document.getElementById("jobs_filters")).toBe(filterPanel);
});
