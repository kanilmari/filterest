// row_group_search_reconciliation.test.js
// Exercises selection reconciliation across a committed search, paging and view changes.
// Connects real facets, search, refresh, view assembly, remembered rows and article opening.
// Replaces endpoint responses and presentation leaves so no database or network is used.
// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from "vitest";

const { fetchListing, endpointRouter, articleData, observers } = vi.hoisted(() => ({
    fetchListing: vi.fn(), endpointRouter: vi.fn(), articleData: vi.fn(), observers: [],
}));
vi.mock("../../endpoints/endpoint_data_fetcher.js", () => ({ fetchDatasetData: fetchListing }));
vi.mock("../../endpoints/endpoint_router.js", () => ({ endpoint_router: endpointRouter }));
vi.mock("../../lang/translation_handler.js", () => ({ getTranslationForKey: key => key }));
vi.mock("../../table_views/dataset_value_localizer.js", () => ({
    bindDatasetLanguageRenderer: (_host, render) => render("en"),
    resolveDatasetDisplayValue: value => value?.en || String(value || ""),
}));
vi.mock("../../route_permission_checker.js", () => ({
    hasRoutePermission: () => true, hasDatasetPermission: async () => false,
    primeDatasetPermissions: vi.fn(), applyPermission: vi.fn(),
}));
vi.mock("../../config_fetcher.js", () => ({
    getDefaultViewSync: () => "table", getDefaultDatasetSortSync: () => ({ column: "id", direction: "ASC" }),
}));
vi.mock("../../state_stores/table_specs_reader.js", async original => ({ ...await original(), getAllSpecs: () => ({}) }));
vi.mock("../filter_bar_builder.js", () => ({ create_filter_bar: vi.fn() }));
vi.mock("../text_search/create_text_search_panel.js", () => ({
    ongoingSearchResults: {}, do_intelligent_search: vi.fn(), rerenderCachedSearchResults: vi.fn(),
}));
vi.mock("../text_search/dataset_search_clearer.js", () => ({ clearCommittedDatasetSearch: vi.fn() }));
vi.mock("../text_search/supplemental_dataset_search.js", () => ({
    createSupplementalDatasetSearch: () => ({ place: vi.fn(), destroy: vi.fn() }),
}));
vi.mock("./column_visibility_handler.js", () => ({ applyColumnVisibility: vi.fn() }));
vi.mock("../../navigation/main_tabs/main_tab_printer.js", () => ({ updateTabPathsForView: vi.fn() }));
vi.mock("../../navigation/menu_button/navbar_visibility_handler.js", () => ({ updateShowMenuButtonPosition: vi.fn() }));
vi.mock("../../navigation/nav_engine/browser_tab_title_writer.js", () => ({ updateBrowserTabTitle: vi.fn() }));
vi.mock("../../../ui_config.js", () => ({ show_search_and_filter_button: false, show_related_items_on_big_cards: false }));

// Production callers still clear, reconcile, remember and transfer in their own order.
vi.mock("../../table_views/table_view/table_row_printer.js", () => ({
    appendDataToTable: (table, rows) => {
        for (const row of rows) {
            const tr = document.createElement("tr");
            tr.dataset.id = row.id; tr.textContent = row.header;
            table.querySelector("tbody").append(tr);
        }
    },
}));
vi.mock("../../table_views/table_view/table_structure_builder.js", async () => {
    const { appendDataToTable } = await import("../../table_views/table_view/table_row_printer.js");
    return {
        saveColumnWidths: vi.fn(),
        create_table_element: (columns, rows, _name, types) => {
            const table = document.createElement("table");
            table.dataset.columns = JSON.stringify(columns); table.dataset.dataTypes = JSON.stringify(types);
            table.append(document.createElement("tbody")); appendDataToTable(table, rows);
            return table;
        },
    };
});
vi.mock("../../table_views/card_view/card_view_printer.js", () => ({
    create_card_view: (columns, rows) => createCards(columns, rows),
    appendDataToCardView: async (host, _columns, rows) => appendCards(host, rows),
}));
vi.mock("../../table_views/article_view/article_view_printer.js", () => ({
    create_article_view: (columns, rows) => createCards(columns, rows),
}));
vi.mock("../../table_views/tree_view/tree_view_printer.js", () => ({ create_tree_view: vi.fn() }));
vi.mock("../../table_views/table_component_builder.js", () => ({ TableComponent: class {} }));
vi.mock("../../table_views/settings_view/settings_view_printer.js", () => ({ create_settings_view: vi.fn() }));
vi.mock("../../table_views/product_card_view/product_card_view_printer.js", () => ({ create_product_card_view: vi.fn() }));
vi.mock("../../table_views/calendar_view/calendar_view_printer.js", () => ({ create_calendar_view: vi.fn() }));
vi.mock("../../table_views/map_view/map_view_printer.js", () => ({ create_map_view: vi.fn(), dataset_supports_map_view: () => false }));
vi.mock("../../table_views/price_chart_view/price_chart_view_printer.js", () => ({ create_price_chart_view: vi.fn() }));
vi.mock("../../table_views/cloud_management_view/cloud_management_view_printer.js", () => ({ create_cloud_management_view: vi.fn() }));

// Article details/media are leaves; its opener and list handoff remain real.
vi.mock("../../table_views/card_view/row_article_data_fetcher.js", () => ({ fetchPermittedRowArticleData: articleData }));
vi.mock("../../table_views/card_view/row_article_section_defaults.js", () => ({ loadRowArticleSectionDefaults: async () => ({}) }));
vi.mock("../../table_views/article_view/article_language_editor.js", () => ({ createArticleLanguageEditor: () => null }));
vi.mock("../../table_views/card_view/card_field_formatter.js", () => ({
    parseRoleString: () => ({ baseRoles: [] }), cancelEditing: vi.fn(), collectCardUpdates: vi.fn(),
    disableEditing: vi.fn(), enableEditing: vi.fn(), sendCardUpdates: vi.fn(),
}));
vi.mock("../../table_views/card_view/card_edit_reconciler.js", () => ({ rebaseSavedCardDraftFields: vi.fn() }));
vi.mock("../../table_views/card_view/row_article_asset_resolver.js", () => ({ resolveRowArticleParentImageRows: () => [] }));
vi.mock("../../dev_tools/function_counter.js", () => ({ count_this_function: vi.fn() }));
vi.mock("../../table_views/card_view/row_article_content_builder.js", () => ({
    buildRowArticleContent: async row => {
        const rowArticleContentElement = document.createElement("div");
        rowArticleContentElement.textContent = row.header;
        return { rowArticleContentElement };
    },
}));
vi.mock("../../table_views/card_view/row_article_task_progress_hydrator.js", () => ({ hydrateRowArticleTaskProgressSection: vi.fn() }));
vi.mock("../../table_views/card_view/row_article_ui_handler.js", () => ({
    closeRowArticle: vi.fn(), dispatchCardArticleToggle: vi.fn(), updateHighlightedCard: vi.fn(), saveScrollBeforeRowArticle: vi.fn(),
}));
vi.mock("../../table_views/card_view/row_article_load_session.js", () => ({ createRowArticleLoadSession: () => ({}) }));
vi.mock("../../table_views/card_view/row_article_media_hydrator.js", () => ({
    createRowArticleMediaHydrator: () => ({ hydrateRelatedSections: vi.fn(), refreshMediaSections: vi.fn() }),
}));
vi.mock("../../user_tools/current_user_profile_fetcher.js", () => ({ fetchCurrentUserProfile: async () => ({ user_id: 1 }) }));
vi.mock("../../../reusable_components/modal/confirm_modal_builder.js", () => ({ showConfirmModal: vi.fn() }));
vi.mock("../../../reusable_components/notifications/toast_notification_printer.js", () => ({ showSuccessToast: vi.fn() }));
vi.mock("../../general_tables/gt_1_row_crud/gt_1_4_row_delete/row_remover_helpers.js", () => ({ buildConfirmationMessage: vi.fn() }));

import { getUnifiedTableState, setUnifiedTableState } from "../../state_stores/table_state_store.js";
import { getChosenDatasetView, setChosenDatasetView } from "../../state_stores/dataset_view_choice_saver.js";
import { forgetPageDatasetParams, getParams, parseDatasetParamsFromSearch, setParams } from "../../navigation/nav_engine/query_params.js";
import { primeDatasetAccessRegistry } from "../../navigation/nav_engine/dataset_access_registry.js";
import { invalidateCardArticleReturn } from "../../navigation/nav_engine/card_article_return_state.js";
import { generate_table } from "../../table_views/dataset_view_printer.js";
import { selectDatasetView } from "../../table_views/view_selector_printer.js";
import { captureLoadedDatasetRows, resolveLoadedDatasetRows } from "../../table_views/dataset_loaded_rows.js";
import { openRowArticleView } from "../../table_views/card_view/row_article_opener.js";
import { disconnectInfiniteScroll } from "../../infinite_scroll/infinite_scroll_handler.js";
import { do_intelligent_search, ongoingSearchResults, getSearchGroupsForViewRebuild } from "../text_search/dataset_search_executor.js";
import { getSearchFilterContext } from "../text_search/dataset_search_runtime_state.js";
import { renderRowGroupFacets } from "./row_group_facet_printer.js";

const dataset = "travel_info";
const columns = ["id", "header", "status"];
const types = { id: "integer", header: "text", status: "text" };
const row = id => ({ id, header: `Trip ${id}`, status: "open" });
const hotel = { id: 1, slug: "hotel", title: { en: "Hotel" }, selected: true, row_count: 10 };
const answer = (data = [row(1), row(2), row(3)], facets = [hotel]) => ({ data, columns, types, row_count: 10, row_group_facets: facets, row_group_selection: Array.isArray(facets) ? { slugs: facets.filter(value => value.selected).map(value => value.slug), modes: {} } : undefined });

function appendCards(host, rows) {
    for (const item of rows) {
        const card = document.createElement("div");
        card.className = "card"; card.dataset.id = item.id;
        card._row = item; card.textContent = item.header; host.append(card);
    }
}
function createCards(_columns, rows) {
    const wrapper = document.createElement("div");
    wrapper.className = "card_view_wrapper";
    wrapper.innerHTML = '<div class="card_sidebar_panel"><div class="card_container"></div></div><div class="row_article_placeholder"></div>';
    appendCards(wrapper.querySelector(".card_container"), rows);
    return wrapper;
}
function streamAnswer() {
    const packet = { stage: "ai", columns, types, filters_applied: true, data: [row(99)] };
    return { body: new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(`${JSON.stringify(packet)}\n`)); controller.close();
    } }) };
}
async function seedSearch(selection = "disabled,hotel", modes = "") {
    const params = new URLSearchParams({ row_group: selection, ...(modes ? { row_group_mode: modes } : {}), status: "open", search: "trip", view: "table", sort_column: "id", sort_order: "ASC" });
    history.replaceState({ dataset }, "", `/${dataset}?${params}`);
    setParams(dataset, parseDatasetParamsFromSearch(location.search)); setChosenDatasetView(dataset, "table");
    setUnifiedTableState(dataset, { filters: { row_group: selection, ...(modes ? { row_group_mode: modes } : {}), status: "open" }, sort: { column: "id", direction: "ASC" }, offset: 0 });
    await generate_table(dataset, columns, [], types, 10);
    return do_intelligent_search(dataset, "trip", { useLocation: false });
}
function currentTransfer() {
    const previousView = getChosenDatasetView(dataset);
    const token = captureLoadedDatasetRows(dataset); expect(token).not.toBeNull();
    setChosenDatasetView(dataset, "article_view");
    const entry = resolveLoadedDatasetRows(dataset, token); setChosenDatasetView(dataset, previousView);
    return entry;
}

beforeEach(() => {
    vi.clearAllMocks(); vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", class {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe() {} disconnect() {}
    });
    observers.length = 0;
    localStorage.clear(); sessionStorage.clear(); forgetPageDatasetParams();
    document.documentElement.lang = "en"; document.body.innerHTML = '<div id="tabs_container"></div>';
    primeDatasetAccessRegistry({ datasets: [{ dataset_name: dataset }] }); delete ongoingSearchResults[dataset];
    fetchListing.mockReset().mockResolvedValue(answer());
    endpointRouter.mockReset().mockImplementation(name => {
        if (name !== "getIntelligentResultsStream") throw new Error(`Unexpected endpoint ${name}`);
        return Promise.resolve(streamAnswer());
    });
    articleData.mockReset().mockImplementation(async ({ rowItem }) => rowItem);
});
afterEach(() => {
    disconnectInfiniteScroll(dataset); invalidateCardArticleReturn(dataset);
    vi.useRealTimers(); vi.unstubAllGlobals();
});

test.each(["disabled", "disappeared"])("%s URL value resolves without losing completed AI results on table → cards", async unavailable => {
    await seedSearch(`${unavailable},hotel`);
    const cache = ongoingSearchResults[dataset];
    expect(cache.aiData).toEqual([row(99)]);
    expect(document.querySelector(`#${dataset}_search_ai_table`).textContent).toContain("Trip 99");
    expect(document.querySelector('[data-lang-key="see_also"]')).not.toBeNull();
    expect(cache.filterSignature).toBe(getSearchFilterContext(dataset).signature);
    expect(cache.executionSignature).toBe(`${cache.filterSignature}\n${JSON.stringify({ useLocation: false })}`);
    expect(cache.requestContext).toMatchObject({ rowGroupSlug: "hotel", clientFilters: { status: "open" } });
    const request = new URLSearchParams(endpointRouter.mock.calls[0][1].url_params);
    expect(request.get("row_group")).toBe("hotel"); expect(JSON.parse(request.get("filters"))).toEqual({ status: "open" });
    expect(fetchListing).toHaveBeenCalledTimes(1);

    selectDatasetView(dataset, "card");
    await vi.waitFor(() => expect(document.querySelector(`#${dataset}_search_ai_cards .card`)?.dataset.id).toBe("99"));
    expect(ongoingSearchResults[dataset]).toBe(cache);
    expect(getSearchGroupsForViewRebuild(dataset, { query: "trip" })).not.toBeNull();
    expect(document.querySelector('[data-lang-key="see_also"]')).not.toBeNull();
    expect(getParams(dataset)).toMatchObject({ row_group: "hotel", search: "trip", status: "open" });
    expect(endpointRouter).toHaveBeenCalledTimes(1);
    expect(fetchListing).toHaveBeenCalledTimes(2); // The ordinary view refresh only.
    expect(currentTransfer()).toMatchObject({ projectionView: "card", offset: 3 });
});

test("pagination then article opening transfers the whole resolved prefix without a listing refetch", async () => {
    await seedSearch();
    const cache = ongoingSearchResults[dataset];
    expect(currentTransfer()).toMatchObject({ projectionView: "table", offset: 3 });
    fetchListing.mockResolvedValueOnce(answer([row(3), row(4), row(5)]));
    observers.at(-1).callback([{ isIntersecting: true }]);
    await vi.waitFor(() => expect(getUnifiedTableState(dataset).offset).toBe(6));
    expect(fetchListing.mock.calls[1][0]).toMatchObject({ offset: 3, view_key: "table", filters: { status: "open", row_group: "hotel", search: "trip" } });
    const prefix = currentTransfer();
    expect(prefix).toMatchObject({ projectionView: "table", offset: 6, result: { data: [row(1), row(2), row(3), row(4), row(5)], columns, types } });

    await openRowArticleView(row(5), dataset);
    await vi.waitFor(() => expect(document.querySelector("article")?._row.id).toBe(5));
    expect(fetchListing).toHaveBeenCalledTimes(2); expect(endpointRouter).toHaveBeenCalledTimes(1);
    expect(ongoingSearchResults[dataset]).toBe(cache);
    expect(currentTransfer()).toMatchObject({ projectionView: "table", offset: 6, result: { data: prefix.result.data, columns, types } });
    expect([...document.querySelectorAll(`#${dataset}_article_view_container .card_container > .card`)].map(card => card.dataset.id)).toEqual(["1", "2", "3", "4", "5"]);
    expect(document.querySelector('[data-lang-key="see_also"]')).not.toBeNull();
    expect(getUnifiedTableState(dataset).offset).toBe(6);
});

test("a synchronized search panel joins the same in-flight search after reconciliation", async () => {
    let finishAiRequest;
    endpointRouter.mockImplementationOnce(() => new Promise(resolve => { finishAiRequest = resolve; }));
    const firstSearch = seedSearch();
    await vi.waitFor(() => expect(finishAiRequest).toBeTypeOf("function"));
    const cache = ongoingSearchResults[dataset];
    expect(cache.requestContext.rowGroupSlug).toBe("hotel");
    const sameSearch = do_intelligent_search(dataset, "trip", { useLocation: false });
    expect(ongoingSearchResults[dataset]).toBe(cache);
    finishAiRequest(streamAnswer());
    await Promise.all([firstSearch, sameSearch]);
    expect(cache.aiData).toEqual([row(99)]);
    expect(fetchListing).toHaveBeenCalledTimes(1);
    expect(endpointRouter).toHaveBeenCalledTimes(1);
});

test("a later ordinary first-page refresh adopts its resolved selection before remembering rows", async () => {
    await seedSearch();
    const cache = ongoingSearchResults[dataset];
    fetchListing.mockResolvedValueOnce(answer([row(4)], [{ ...hotel, selected: false }]));
    selectDatasetView(dataset, "card");
    await vi.waitFor(() => expect(document.querySelector(`#${dataset}_search_ai_cards .card`)?.dataset.id).toBe("99"));
    expect(ongoingSearchResults[dataset]).toBe(cache);
    expect(cache.requestContext.rowGroupSlug).toBe("");
    expect(cache.filterSignature).toBe(getSearchFilterContext(dataset).signature);
    expect(getUnifiedTableState(dataset).filters).toEqual({ status: "open" });
    expect(currentTransfer()).toMatchObject({ projectionView: "card", offset: 1, result: { data: [row(4)] } });
    expect(fetchListing).toHaveBeenCalledTimes(2);
    expect(endpointRouter).toHaveBeenCalledTimes(1);
});

test.each([
    ["selected zero count", [{ ...hotel, row_count: 0 }], "hotel"], ["empty", [], undefined],
    ["omitted", undefined, "disabled,hotel"], ["null", null, "disabled,hotel"],
])("%s payload keeps the same committed search and its remembered scope", async (_label, facets, selection) => {
    const result = answer(); result.row_group_facets = facets; result.row_group_selection = Array.isArray(facets) ? { slugs: facets.filter(value => value.selected).map(value => value.slug), modes: {} } : undefined; fetchListing.mockResolvedValue(result);
    await seedSearch();
    const cache = ongoingSearchResults[dataset];
    expect(getParams(dataset).row_group).toBe(selection);
    expect(cache.filterSignature).toBe(getSearchFilterContext(dataset).signature); expect(cache.aiData).toEqual([row(99)]);
    expect(currentTransfer()?.result.data).toEqual(result.data);
    expect(fetchListing).toHaveBeenCalledTimes(1); expect(endpointRouter).toHaveBeenCalledTimes(1);
});

test("a stale filter edit cannot rekey either owner through an old response", async () => {
    await seedSearch();
    const cache = ongoingSearchResults[dataset]; const oldSignature = cache.filterSignature;
    const requestFilters = { ...getUnifiedTableState(dataset).filters };
    setUnifiedTableState(dataset, { filters: { status: "closed", row_group: "new" } });
    setParams(dataset, { ...getParams(dataset), status: "closed", row_group: "new" });
    renderRowGroupFacets(dataset, [], { authoritative: true, requestFilters });
    expect(cache.filterSignature).toBe(oldSignature); expect(cache.requestContext.rowGroupSlug).toBe("hotel");
    expect(getSearchGroupsForViewRebuild(dataset)).toBeNull(); expect(captureLoadedDatasetRows(dataset)).toBeNull();
    expect(getUnifiedTableState(dataset).filters).toEqual({ status: "closed", row_group: "new" });
    expect(fetchListing).toHaveBeenCalledTimes(1); expect(endpointRouter).toHaveBeenCalledTimes(1);
});


test("modes are server-only search context and change execution identity", async () => {
    await seedSearch("hotel");
    const previous = getSearchFilterContext(dataset);
    setUnifiedTableState(dataset, { filters: { row_group: "hotel", row_group_mode: "0:all", status: "open" } });
    setParams(dataset, { ...getParams(dataset), row_group_mode: "0:all" });
    const current = getSearchFilterContext(dataset);
    expect(current).toMatchObject({ rowGroupSlug: "hotel", rowGroupMode: "0:all", clientFilters: { status: "open" } });
    expect(current.signature).not.toBe(previous.signature);
    expect(getSearchGroupsForViewRebuild(dataset)).toBeNull();
    expect(captureLoadedDatasetRows(dataset)).toBeNull();
    fetchListing.mockResolvedValueOnce({ ...answer(), row_group_selection: { slugs: ["hotel"], modes: { 0: "all" } } });
    await do_intelligent_search(dataset, "trip", { useLocation: false });
    const request = new URLSearchParams(endpointRouter.mock.calls.at(-1)[1].url_params);
    expect(request.get("row_group_mode")).toBe("0:all");
    expect(JSON.parse(request.get("filters"))).toEqual({ status: "open" });
    expect(ongoingSearchResults[dataset].filterSignature).toBe(getSearchFilterContext(dataset).signature);
});

test("resolved mode preferences adopt the existing AI request and remembered row scope", async () => {
    let finishListing;
    fetchListing.mockImplementationOnce(() => new Promise(resolve => { finishListing = resolve; }));
    const search = seedSearch("hotel", "0:all,9:all");
    await vi.waitFor(() => expect(finishListing).toBeTypeOf("function"));
    // This test starts with canonical state; a preference outside the capped values
    // is accepted from complete resolved metadata and rekeys both current owners.
    finishListing({ ...answer(), row_group_selection: { slugs: ["hotel"], modes: { 0: "all" } } });
    await search;
    expect(ongoingSearchResults[dataset].requestContext.rowGroupMode).toBe("0:all");
    expect(new URLSearchParams(endpointRouter.mock.calls.at(-1)[1].url_params).get("row_group_mode")).toBe("0:all");
    expect(currentTransfer()).not.toBeNull();
    expect(fetchListing).toHaveBeenCalledTimes(1);
});
