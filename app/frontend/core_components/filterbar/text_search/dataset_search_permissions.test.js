// dataset_search_permissions.test.js
// Proves readable datasets offer text search independently of paid AI routes.
// Exercises the real builder, executor, stream reader and results counter.
// Only listing transport and presentation leaves are replaced; no network is used.
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const transport = vi.hoisted(() => vi.fn());
vi.mock("../../endpoints/endpoint_router.js", () => ({ endpoint_router: transport }));
vi.mock("../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js", async () =>
    import("../../state_stores/table_state_store.js"));
vi.mock("../../infinite_scroll/infinite_scroll_handler.js", () => ({
    reloadDatasetRowsFromListing: async dataset => {
        const { getParams } = await import("../../navigation/nav_engine/query_params.js");
        return transport("getResults", { dataset, search: getParams(dataset).search });
    },
}));
vi.mock("../../table_views/table_view/table_row_printer.js", () => ({
    appendDataToTable: (host, rows) => {
        host.querySelector("tbody").textContent = rows.map(row => row.title).join(",");
    },
}));
vi.mock("../../table_views/card_view/card_view_printer.js", () => ({ appendDataToCardView: vi.fn() }));
vi.mock("../filter_list/row_group_facet_printer.js", () => ({ renderRowGroupFacets: vi.fn() }));
vi.mock("../filter_list/active_filter_tag_printer.js", () => ({ renderActiveFilters: vi.fn() }));
vi.mock("../../lang/translation_handler.js", () => ({ getTranslationForKey: (_key, { fallback }) => fallback }));
vi.mock("../../navigation/nav_engine/browser_tab_title_writer.js", () => ({ updateBrowserTabTitle: vi.fn() }));
vi.mock("../../navigation/main_tabs/main_dataset_tabs.js", () => ({
    getMainDatasetTabs: () => [{ dataset: "other_readable" }],
    subscribeMainDatasetTabs: () => () => {},
}));
vi.mock("../../table_views/compact_dataset_group.js", () => ({
    getSupplementalSearchCopy: () => ({ heading: "Muut tulokset" }),
    createSupplementalDatasetGroup: () => ({ element: document.createElement("section"), render: vi.fn() }),
}));

import { createDatasetSearchComponent } from "./dataset_search_component_builder.js";
import { do_intelligent_search, ongoingSearchResults } from "./dataset_search_executor.js";
import { readDatasetSearchResponse } from "./dataset_search_response_reader.js";
import { primeDatasetAccessRegistry, clearDatasetAccessRegistry } from "../../navigation/nav_engine/dataset_access_registry.js";
import { setChosenDatasetView } from "../../state_stores/dataset_view_choice_saver.js";
import { setParams } from "../../navigation/nav_engine/query_params.js";
import { datasetAppearanceState } from "../../table_views/dataset_appearance_state.js";
import { setSearchAiResultsCount } from "../../../reusable_components/results_count/results_count_printer.js";

let component;
const dataset = "readable_search";
beforeEach(() => {
    localStorage.clear(); sessionStorage.clear(); transport.mockReset();
    datasetAppearanceState.clear();
    window.history.replaceState({}, "", "/");
    localStorage.setItem("chosen_language", "fi");
    setParams(dataset, {});
    setChosenDatasetView(dataset, "table");
    document.body.innerHTML = `<div id="${dataset}_container">
        <div id="${dataset}_results_count"></div>
        <div id="${dataset}_table_view_container"><table data-columns='["id","title"]'><tbody></tbody></table></div>
    </div>`;
    transport.mockImplementation(async name => {
        if (name === "getResults") return { data: [{ id: 1, title: "Vene" }], row_count: 1, columns: ["id", "title"] };
        if (name === "getIntelligentResultsStream") return new Response(
            JSON.stringify({ stage: "ai", columns: ["id", "title"], data: [{ id: 2, title: "Laiva" }] }) + "\n");
        throw new Error(`Unexpected request: ${name}`);
    });
});
afterEach(() => {
    component?.destroy(); component = null;
    ongoingSearchResults[dataset]?.abortController?.abort();
    ongoingSearchResults[dataset]?.supplemental?.destroy();
    delete ongoingSearchResults[dataset];
    clearDatasetAccessRegistry(); setSearchAiResultsCount(dataset, null);
    sessionStorage.clear();
});

test.each([
    ["guest", ["/ui/table"], false],
    ["user without AI", ["/api/get-results"], false],
    ["user with AI", ["/api/get-results", "/api/get-intelligent-results"], true],
    ["admin", ["/api/get-results", "/api/get-intelligent-results", "/api/get-results-vector"], true],
])("%s: box follows dataset Read, AI controls and targets follow AI permission", async (_viewer, routes, aiAllowed) => {
    sessionStorage.setItem("user_permissions", JSON.stringify(routes));
    primeDatasetAccessRegistry({ datasets: [{ dataset_name: dataset, table_uid: 283, can_read_rows: true }] });
    component = createDatasetSearchComponent(dataset, { showLocationCheckbox: true });
    document.body.append(component.element);
    expect(component.element.hidden).toBe(false);
    expect(component.input.isConnected).toBe(true);
    expect(component.element.querySelector(".dataset-search-location-row").style.display).toBe(aiAllowed ? "flex" : "none");
    component.input.value = "vene";
    component.input.dispatchEvent(new Event("input"));
    component.element.querySelector('[data-testid="dataset-search-submit"]').click();
    await vi.waitFor(() => expect(ongoingSearchResults[dataset]?.query).toBe("vene"));
    await ongoingSearchResults[dataset].executionPromise;
    await vi.waitFor(() => expect(transport).toHaveBeenCalledWith("getResults", { dataset, search: "vene" }));
    const targets = transport.mock.calls.map(([name]) => name);
    expect(targets.includes("getIntelligentResultsStream")).toBe(aiAllowed);
    expect(targets.some(name => /vector|embedding/i.test(name))).toBe(false);
    expect(Boolean(document.querySelector(".search-ai-results-table"))).toBe(aiAllowed);
    expect(Boolean(document.querySelector('[data-lang-key="results_count_ai_search_singular"]'))).toBe(aiAllowed);
    if (!aiAllowed) {
        expect(targets).toEqual(["getResults"]);
        // Direct/background stream callers must also stop before transport.
        for await (const packet of readDatasetSearchResponse("other_readable", "vene", {}, () => true)) void packet;
        expect(transport.mock.calls.map(([name]) => name)).toEqual(["getResults"]);
    }
    // Every viewer also loses the box when the catalogue withdraws row Read.
    primeDatasetAccessRegistry({ datasets: [{ dataset_name: dataset, can_read_rows: false }] });
    expect(component.element.hidden).toBe(true);
    transport.mockClear();
    component.element.querySelector('[data-testid="dataset-search-submit"]').click();
    await Promise.resolve();
    expect(transport).not.toHaveBeenCalled();
});

test("unknown catalogue hides search until a readable snapshot arrives", () => {
    clearDatasetAccessRegistry();
    component = createDatasetSearchComponent(dataset);
    expect(component.element.hidden).toBe(true);
    primeDatasetAccessRegistry({ datasets: [{ dataset_name: dataset, can_read_rows: true }] });
    expect(component.element.hidden).toBe(false);
});

test("a URL-restored search without AI permission uses only the listing", async () => {
    sessionStorage.setItem("user_permissions", JSON.stringify(["/ui/table"]));
    setParams(dataset, { search: "vene" });
    await do_intelligent_search(dataset, "vene");
    expect(transport.mock.calls.map(([name]) => name)).toEqual(["getResults"]);
});
