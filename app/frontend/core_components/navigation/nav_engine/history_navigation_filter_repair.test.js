// history_navigation_filter_repair.test.js
// Proves history restoration can repair filters without cancelling its own refresh.
// Connects real navigation, refresh, state, address writers and category reconciliation.
// Replaces I/O and drawing while preserving entry identity and cancellation boundaries.
// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from "vitest";

const { fetchRows, buildView, committedRows, title, subscribe, navigations, navigationCompletions } = vi.hoisted(() => ({
    fetchRows: vi.fn(), buildView: vi.fn(), committedRows: vi.fn(), title: vi.fn(), navigations: [], navigationCompletions: [],
    subscribe: vi.fn(),
}));
vi.mock("../../endpoints/endpoint_data_fetcher.js", () => ({ fetchDatasetData: fetchRows }));
vi.mock("../../endpoints/endpoint_router.js", () => ({ endpoint_router: vi.fn(async () => ({})) }));
vi.mock("../../table_views/dataset_view_printer.js", () => ({ generate_table: buildView }));
vi.mock("../../pipeline/navigation_pipeline.js", () => ({ runNavigationPipeline: async context => {
    navigations.push(context);
    const completion = context._performNavigationCore(context.name, context.containerId, context.loadFunction, context.groupName, context.isCustomView);
    navigationCompletions.push(completion);
    return completion;
} }));
vi.mock("../../route_permission_checker.js", () => ({
    hasRoutePermission: () => true, hasDatasetPermission: async () => true, primeDatasetPermissions: vi.fn(),
}));
vi.mock("../../config_fetcher.js", () => ({ getDefaultDatasetSortSync: () => ({ column: "id", direction: "ASC" }) }));
vi.mock("../../filterbar/filter_list/column_visibility_handler.js", () => ({ applyColumnVisibility: vi.fn() }));
vi.mock("../../table_views/card_view/row_article_opener.js", () => ({ openRowArticleView: vi.fn() }));
vi.mock("../../lang/translation_handler.js", () => ({ getTranslationForKey: key => key }));
vi.mock("../../table_views/view_selector_printer.js", () => ({ applyViewStyling() {} }));
vi.mock("./recent_tab_saver.js", () => ({ update_recently_viewed_list() {}, update_recently_viewed_status() {} }));
vi.mock("./active_heading_updater.js", () => ({ update_active_heading() {} }));
vi.mock("../../ai_features/table_chat/table_chat_printer.js", () => ({ destroy_chat() {} }));
vi.mock("../../endpoints/sse_subscriber.js", () => ({ clearSSEActiveDataset() {}, setSSEActiveDataset: subscribe }));
vi.mock("./browser_tab_title_writer.js", () => ({ updateBrowserTabTitle: title }));
vi.mock("../../front_page/custom_root_navigation.js", () => ({ loadCustomRootFromHistory: async () => false, loadCustomRoot: async () => false }));
vi.mock("../admin_and_user_tools/custom_view_reader.js", () => ({ custom_views: [], ensure_private_custom_views_loaded: async () => {} }));
vi.mock("./card_article_return_state.js", () => ({
    canRestoreCardArticleReturn: () => false, restoreCardArticleReturn: () => false,
    getCardArticleReturnToken: () => null, refreshCardArticleReturnViewport() {}, invalidateCardArticleReturn() {},
}));

import "./history_navigation_handler.js";
import { handle_all_navigation } from "./navigation_handler.js";
import { clearDatasetAccessRegistry, primeDatasetAccessRegistry } from "./dataset_access_registry.js";
import { HISTORY_ENTRY_ID, writeHistoryEntry } from "./history_entry_state.js";
import { getParams, forgetPageDatasetParams } from "./query_params.js";
import { writeDatasetAddress, resetDatasetAddressOwnershipForTests } from "./dataset_address_writer.js";
import { getUnifiedTableState } from "../../state_stores/table_state_store.js";
import { getChosenDatasetView, setChosenDatasetView } from "../../state_stores/dataset_view_choice_saver.js";
import { getSelectedDataset, setSelectedDataset } from "../../state_stores/dataset_selection_saver.js";
import { renderRowGroupFacets, clearRowGroupFacets } from "../../filterbar/filter_list/row_group_facet_printer.js";

const dataset = "jobs";
const answer = { columns: ["id", "owner_id", "owner_name (ln)", "title"],
    types: { owner_id: { data_type: "integer", foreign_table: "accounts", hide_in_filter_panel: true } },
    data: [{ id: 42, title: "Corrected results" }], row_count: 1 };

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

async function traverse(direction) {
    await new Promise(resolve => {
        window.addEventListener("popstate", resolve, { once: true });
        history[direction]();
    });
}

async function landOnRepair(repair, direction = "back", entryId = "repair-entry") {
    const params = repair === "hidden" ? { "jobs_owner_name (ln)": "Old owner" }
        : { row_group: "disabled", row_group_mode: "7:all" };
    const url = `/jobs?${new URLSearchParams({ ...params, jobs_title: "Trip", view: "card" })}`;
    history.replaceState({}, "", "/frontend/origin");
    history.pushState(entryId ? { [HISTORY_ENTRY_ID]: entryId } : {}, "", url);
    if (direction === "back") history.pushState({}, "", "/frontend/after");
    else {
        await traverse("back");
        await vi.waitFor(() => expect(title).toHaveBeenCalled());
        title.mockClear();
    }
    const length = history.length;
    await traverse(direction);
    return { length, url };
}

beforeEach(() => {
    vi.clearAllMocks(); navigations.length = 0; navigationCompletions.length = 0;
    localStorage.clear(); sessionStorage.clear(); forgetPageDatasetParams();
    resetDatasetAddressOwnershipForTests();
    clearDatasetAccessRegistry();
    primeDatasetAccessRegistry({ datasets: [dataset, "other"].map(dataset_name => ({ dataset_name, can_read_rows: true })) });
    setChosenDatasetView(dataset, "table"); setSelectedDataset(dataset);
    document.body.innerHTML = '<div id="tabs_container"><div id="jobs_container" class="content_div">'
        + '<div class="tab_parts_container" data-view="table"></div></div>'
        + '<div id="other_container" class="content_div hidden">Other listing</div></div>'
        + '<div class="navtabs"><button class="navtablinks active" data-id="jobs">Jobs</button>'
        + '<button class="navtablinks" data-id="other">Other</button></div>';
    fetchRows.mockReset().mockResolvedValue(answer);
    title.mockResolvedValue(true);
    buildView.mockReset().mockImplementation(async (name, _columns, rows, _types, _count, _geo, _meta, _presentation, facets, options) => {
        const root = document.getElementById(`${name}_container`);
        root.querySelector(".tab_parts_container").dataset.view = getChosenDatasetView(name);
        renderRowGroupFacets(name, facets, options.rowGroupFacetContext);
        // The real renderer awaits after category reconciliation; its address
        // replacement can settle before refresh rechecks its lifetime.
        await Promise.resolve();
        if (!options.isCurrent()) return null;
        committedRows(rows);
        return root;
    });
});
afterEach(() => {
    clearRowGroupFacets(dataset); clearDatasetAccessRegistry(); vi.restoreAllMocks();
});

test.each(["back", "forward"])("%s's hidden-field repair fetches corrected rows and renders on the same entry", async direction => {
    const { length } = await landOnRepair("hidden", direction);
    await vi.waitFor(() => expect(title).toHaveBeenCalledOnce());
    expect(fetchRows).toHaveBeenCalledTimes(2);
    expect(fetchRows.mock.calls[0][0].filters).toMatchObject({ "jobs_owner_name (ln)": "Old owner" });
    expect(fetchRows.mock.calls[1][0]).toMatchObject({ offset: 0, filters: { jobs_title: "Trip" } });
    expect(committedRows).toHaveBeenCalledExactlyOnceWith(answer.data);
    expect(getUnifiedTableState(dataset).filters).toEqual({ jobs_title: "Trip" });
    expect(getParams(dataset)).toEqual({ jobs_title: "Trip", view: "card" });
    expect(new URLSearchParams(location.search).has("jobs_owner_name (ln)")).toBe(false);
    expect(history.state[HISTORY_ENTRY_ID]).toBe("repair-entry");
    expect(history.length).toBe(length);
    expect(navigations[0].isCurrentNavigation()).toBe(true);
});

test("an authorized legacy entry receives its identity before hidden-field cleanup", async () => {
    const { length } = await landOnRepair("hidden", "back", null);
    await vi.waitFor(() => expect(title).toHaveBeenCalledOnce());
    expect(fetchRows).toHaveBeenCalledTimes(2);
    expect(committedRows).toHaveBeenCalledOnce();
    expect(history.state[HISTORY_ENTRY_ID]).toBeTypeOf("string");
    expect(history.length).toBe(length);
});

test.each(["back", "forward"])("%s's category reconciliation keeps refresh current after its address replacement", async direction => {
    fetchRows.mockResolvedValue({ ...answer, row_group_facets: [], row_group_selection: { slugs: [], modes: {} } });
    const { length } = await landOnRepair("category", direction);
    await vi.waitFor(() => expect(title).toHaveBeenCalledOnce());
    expect(fetchRows).toHaveBeenCalledOnce();
    expect(committedRows).toHaveBeenCalledExactlyOnceWith(answer.data);
    expect(getUnifiedTableState(dataset).filters).toEqual({ jobs_title: "Trip" });
    expect(getParams(dataset)).toEqual({ jobs_title: "Trip", view: "card" });
    expect(new URLSearchParams(location.search).has("row_group")).toBe(false);
    expect(new URLSearchParams(location.search).has("row_group_mode")).toBe(false);
    expect(history.state[HISTORY_ENTRY_ID]).toBe("repair-entry");
    expect(history.length).toBe(length);
    expect(navigations[0].isCurrentNavigation()).toBe(true);
});

test("the settled address can replace a restored view with its rendered fallback", async () => {
    buildView.mockImplementationOnce(async () => {
        setChosenDatasetView(dataset, "table");
        return document.getElementById("jobs_container");
    });
    const { length } = await landOnRepair("category");
    await vi.waitFor(() => expect(title).toHaveBeenCalledOnce());
    expect(fetchRows).toHaveBeenCalledTimes(2);
    expect(committedRows).toHaveBeenCalledOnce();
    expect(new URLSearchParams(location.search).get("view")).toBe("table");
    expect(history.state[HISTORY_ENTRY_ID]).toBe("repair-entry");
    expect(history.length).toBe(length);
    expect(navigations[0].isCurrentNavigation()).toBe(true);
});

test("navigation during category reconciliation prevents the pending render from committing", async () => {
    const rendering = deferred();
    fetchRows.mockResolvedValue({ ...answer, row_group_facets: [], row_group_selection: { slugs: [], modes: {} } });
    const render = buildView.getMockImplementation();
    buildView.mockImplementationOnce(async (...args) => {
        const options = args[9];
        renderRowGroupFacets(dataset, [], options.rowGroupFacetContext);
        await rendering.promise;
        return options.isCurrent() ? render(...args) : null;
    });
    await landOnRepair("category");
    await vi.waitFor(() => expect(new URLSearchParams(location.search).has("row_group")).toBe(false));
    writeDatasetAddress("other", { view: "table" });
    const address = location.href, state = history.state;
    expect(navigations[0].isCurrentNavigation()).toBe(false);
    rendering.resolve();
    await navigationCompletions[0];
    expect(committedRows).not.toHaveBeenCalled();
    expect(location.href).toBe(address); expect(history.state).toEqual(state);
});

test.each(["restoration", "entry", "user"])("a newer %s cancels the corrected hidden-field fetch", async newer => {
    const corrected = deferred();
    fetchRows.mockResolvedValueOnce(answer).mockReturnValueOnce(corrected.promise);
    await landOnRepair("hidden");
    await vi.waitFor(() => expect(fetchRows).toHaveBeenCalledTimes(2));
    const previous = navigations[0].isCurrentNavigation;
    expect(previous()).toBe(true);
    if (newer === "restoration") {
        // Same URL and entry: only the newer restoration generation supersedes it.
        window.dispatchEvent(new PopStateEvent("popstate"));
        await vi.waitFor(() => expect(title).toHaveBeenCalledOnce());
        expect(committedRows).toHaveBeenCalledOnce();
    } else if (newer === "entry") {
        writeHistoryEntry(location.href);
    } else {
        writeDatasetAddress("other", { view: "table" });
        await handle_all_navigation("other", [], {});
        expect(getSelectedDataset()).toBe("other");
        expect(subscribe).toHaveBeenLastCalledWith("other");
        expect(document.querySelector(".navtablinks.active")?.dataset.id).toBe("other");
        expect([...document.querySelectorAll("#tabs_container > .content_div:not(.hidden)")].map(node => node.id))
            .toEqual(["other_container"]);
    }
    expect(previous()).toBe(false);
    const address = location.href, state = history.state, count = committedRows.mock.calls.length;
    const selectedDataset = getSelectedDataset(), subscriptions = subscribe.mock.calls.length;
    const activeTabs = [...document.querySelectorAll(".navtablinks.active")];
    const visibleContainers = [...document.querySelectorAll("#tabs_container > .content_div:not(.hidden)")];
    corrected.resolve(answer);
    // Drain the real navigation loader, including refresh's guarded completion.
    await navigationCompletions[0];
    await Promise.resolve();
    expect(committedRows).toHaveBeenCalledTimes(count);
    expect(location.href).toBe(address); expect(history.state).toEqual(state);
    expect(getSelectedDataset()).toBe(selectedDataset);
    expect(subscribe).toHaveBeenCalledTimes(subscriptions);
    expect([...document.querySelectorAll(".navtablinks.active")]).toEqual(activeTabs);
    expect([...document.querySelectorAll("#tabs_container > .content_div:not(.hidden)")]).toEqual(visibleContainers);
});
