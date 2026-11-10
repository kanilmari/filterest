// image_first_view_history_restore.test.js
// Proves picker history through reload, Back and Forward with the real opener and history owners.
// Replaces network and article drawing while retaining the modal and popstate lifecycle.
// Keeps text-only choices distinct from unavailable photo-click entries.
// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from "vitest";

const { fetchRows, loadSession, refreshDataset } = vi.hoisted(() => ({
    fetchRows: vi.fn(), refreshDataset: vi.fn(),
    loadSession: { fetchDynamicChildren: vi.fn() },
}));
vi.mock("../../endpoints/endpoint_data_fetcher.js", () => ({ fetchDatasetData: fetchRows }));
vi.mock("../../pipeline/navigation_pipeline.js", () => ({ runNavigationPipeline: async context => {
    await context._performNavigationCore(context.name, context.containerId, context.loadFunction, context.groupName, context.isCustomView);
    return context;
} }));
vi.mock("../../route_permission_checker.js", () => ({
    hasRoutePermission: () => true, hasDatasetPermission: async () => false, primeDatasetPermissions: vi.fn(),
}));
vi.mock("../../lang/translation_handler.js", () => ({ getTranslationForKey: key => key }));
vi.mock("../../state_stores/lang_preference_reader.js", () => ({ getLanguageWithBrowserFallback: () => "en" }));
vi.mock("../../user_tools/current_user_profile_fetcher.js", () => ({ fetchCurrentUserProfile: async () => ({ user_id: 1 }) }));
vi.mock("../../../icons/icon_loader.js", () => ({ setElementSvgContent: async () => {} }));
vi.mock("./row_article_section_defaults.js", () => ({ loadRowArticleSectionDefaults: async () => ({}) }));
vi.mock("./row_article_content_builder.js", () => ({ buildRowArticleContent: async row => {
    const article = document.createElement("article");
    article.textContent = row.title;
    return { rowArticleContentElement: article };
} }));
vi.mock("./row_article_data_types_resolver.js", () => ({ resolveRowArticleDataTypes: () => ({}) }));
vi.mock("./row_article_load_session.js", () => ({ createRowArticleLoadSession: () => loadSession }));
vi.mock("./row_article_media_hydrator.js", () => ({ createRowArticleMediaHydrator: () => ({ hydrateRelatedSections() {}, refreshMediaSections() {} }) }));
vi.mock("./row_article_task_progress_hydrator.js", () => ({ hydrateRowArticleTaskProgressSection: async () => {} }));
vi.mock("../../../ui_config.js", () => ({
    enable_experimental_row_article_row_navigation: false, image_first_view_details_position: "after_description",
    show_related_items_on_big_cards: false,
}));
vi.mock("../../table_views/view_selector_printer.js", () => ({ applyViewStyling() {} }));
vi.mock("../../navigation/nav_engine/recent_tab_saver.js", () => ({ update_recently_viewed_list() {}, update_recently_viewed_status() {} }));
vi.mock("../../navigation/nav_engine/active_heading_updater.js", () => ({ update_active_heading() {} }));
vi.mock("../../navigation/main_tabs/main_tab_active_state.js", () => ({ applyMainTabActiveState() {}, clearMainTabActiveState() {} }));
vi.mock("../../ai_features/table_chat/table_chat_printer.js", () => ({ destroy_chat() {} }));
vi.mock("../../endpoints/sse_subscriber.js", () => ({ clearSSEActiveDataset() {}, setSSEActiveDataset() {} }));
vi.mock("../../navigation/nav_engine/browser_tab_title_writer.js", () => ({ updateBrowserTabTitle: async () => true }));
vi.mock("../../front_page/custom_root_navigation.js", () => ({ loadCustomRootFromHistory: async () => false, loadCustomRoot: async () => false }));
vi.mock("../../navigation/admin_and_user_tools/custom_view_reader.js", () => ({ custom_views: [], ensure_private_custom_views_loaded: async () => {} }));
vi.mock("../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js", async () => ({
    ...await import("../../state_stores/table_state_store.js"), invalidateTableRefresh: vi.fn(), refreshTableUnified: refreshDataset,
}));
vi.mock("../../navigation/nav_engine/card_article_return_state.js", () => ({
    canRestoreCardArticleReturn: () => false, restoreCardArticleReturn: () => false,
    getCardArticleReturnToken: () => null, refreshCardArticleReturnViewport: vi.fn(),
    captureCardArticleReturn: vi.fn(), getCardArticleOriginEntry: () => null,
    invalidateCardArticleReturn() {},
}));

import "../../navigation/nav_engine/history_navigation_handler.js";
import { openChosenRowPresentation } from "../row_presentation/row_presentation_opener.js";
import { beginRowPresentationRequest } from "../row_presentation/row_presentation_choice.js";
import { openImageFirstView } from "./image_first_view_opener.js";
import { openRowArticleView } from "./row_article_opener.js";
import { handleImageFirstViewHistory } from "../../navigation/nav_engine/image_first_view_history.js";
import { clearDatasetAccessRegistry, primeDatasetAccessRegistry } from "../../navigation/nav_engine/dataset_access_registry.js";
import { HISTORY_ENTRY_ID } from "../../navigation/nav_engine/history_entry_state.js";
import { setSelectedDataset } from "../../state_stores/dataset_selection_saver.js";
import { setChosenDatasetView } from "../../state_stores/dataset_view_choice_saver.js";
import { setUnifiedTableState } from "../../state_stores/table_state_store.js";
import { setParams } from "../../navigation/nav_engine/query_params.js";
import { hideModal } from "../../../reusable_components/modal/modal_builder.js";

const VIEW = '[data-testid="image-first-view"]';
const CLASSIC_URL = "/examples/3?view=article_view";
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const recordResponse = () => ({ data: [{ id: 3, title: "Current row three" }], columns: ["title"], types: {} });

async function restoreReload() {
    // Model a cold reload's disposal and Card backing view. Keep the browser's
    // current URL, entry identity and saved choice for the real history restore.
    clearDatasetAccessRegistry();
    primeDatasetAccessRegistry({ datasets: [{ dataset_name: "examples", can_read_rows: true }] });
    document.getElementById("examples_container").innerHTML = '<div class="tab_parts_container" data-view="card"></div>';
    setChosenDatasetView("examples", "card");
    setParams("examples", { view: "card" });
    setUnifiedTableState("examples", { articleView: { collapsed: false, expandedId: null } });
    expect(await handleImageFirstViewHistory({ tableName: "examples", rowId: "3" })).toBe(true);
}

test.each(["image_first_view", "image_first_page_view"])("a bare bookmarked row inherits %s and replaces its entry, keeping the calendar for close", async viewKey => {
    history.replaceState({}, "", "/examples/3?view=calendar&offset=7");
    const length = history.length;
    expect(await handleImageFirstViewHistory({ tableName: "examples", rowId: "3", viewKey })).toBe(true);
    expect(document.querySelector(VIEW)).toBeTruthy();
    expect(new URL(location.href).searchParams.get("view")).toBe(viewKey);
    expect(new URL(location.href).searchParams.get("offset")).toBe("7");
    expect(history.state.imageFirstView).toMatchObject({ rowId: "3", viewKey, presentationChoice: true, backingView: "calendar", origin: null });
    expect(history.length).toBe(length);
});

async function traverse(direction) {
    await new Promise(resolve => {
        window.addEventListener("popstate", resolve, { once: true });
        history[direction]();
    });
    await settle(); await settle();
}

beforeEach(() => {
    clearDatasetAccessRegistry();
    localStorage.clear(); sessionStorage.clear();
    history.replaceState({ [HISTORY_ENTRY_ID]: "classic", bigCard: true, dataset: "examples", rowId: "3" }, "", CLASSIC_URL);
    primeDatasetAccessRegistry({ datasets: [{ dataset_name: "examples", can_read_rows: true }] });
    document.body.innerHTML = '<div id="examples_container"><div class="tab_parts_container" data-view="article_view"></div>'
        + '<div id="examples_article_view_container"><div class="card_view_wrapper big-card-open">'
        + '<div class="card_container"></div><div class="row_article_placeholder"><article class="active_row_article"></article></div>'
        + '</div></div></div>';
    document.querySelector(".active_row_article")._row = { id: 3 };
    setSelectedDataset("examples"); setChosenDatasetView("examples", "article_view");
    setParams("examples", { view: "article_view" });
    setUnifiedTableState("examples", { filters: {}, sort: {}, articleView: { collapsed: true, expandedId: 3 } });
    fetchRows.mockReset().mockImplementation(async () => recordResponse());
    loadSession.fetchDynamicChildren.mockReset().mockResolvedValue({ child_tables: [], card_picture: "" });
    refreshDataset.mockReset().mockImplementation(async () => {
        document.querySelector(".tab_parts_container").dataset.view = "article_view";
        return {};
    });
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
});
afterEach(() => {
    clearDatasetAccessRegistry(); hideModal({ immediate: true });
    vi.restoreAllMocks(); vi.unstubAllGlobals();
});

test("a chosen text-only IFAV keeps its row and choice through reload, Back and Forward without adding entries", async () => {
    expect(await openChosenRowPresentation({ tableName: "examples", viewKey: "image_first_view",
        loadOpener: async () => ({ openImageFirstView }) })).toEqual({ status: "opened", rowId: 3 });
    const entryId = history.state[HISTORY_ENTRY_ID], entries = history.length;
    const chosenURL = location.href;
    expect(document.querySelector(`${VIEW}.image_first_view--text-only`).textContent).toBe("Current row three");
    const push = vi.spyOn(history, "pushState");
    await restoreReload();
    expect(document.querySelector(`${VIEW}.image_first_view--text-only`).textContent).toBe("Current row three");
    expect(history.state.imageFirstView).toMatchObject({ rowId: "3", presentationChoice: true });
    expect(history.state[HISTORY_ENTRY_ID]).toBe(entryId);
    await traverse("back");
    expect(document.querySelector(VIEW)).toBeNull();
    expect(location.pathname + location.search).toBe(CLASSIC_URL);
    expect(refreshDataset).toHaveBeenCalledOnce();
    // The picker activation is over; navigation invalidates that ticket, not the restore.
    const pendingPicker = beginRowPresentationRequest("examples");
    await traverse("forward");
    expect(pendingPicker()).toBe(false);
    await vi.waitFor(() => expect(document.querySelector(`${VIEW}.image_first_view--text-only`)?.textContent).toBe("Current row three"));
    expect(location.href).toBe(chosenURL);
    expect(history.state).toMatchObject({ [HISTORY_ENTRY_ID]: entryId,
        imageFirstView: { dataset: "examples", rowId: "3", presentationChoice: true } });
    expect(fetchRows.mock.calls.filter(([options]) => options.callerName === "openImageFirstView")).toHaveLength(3);
    expect(history.length).toBe(entries); expect(push).not.toHaveBeenCalled();
});

test("Forward restores the choice while Back's classic article fetch is still pending", async () => {
    await openChosenRowPresentation({ tableName: "examples", viewKey: "image_first_view",
        loadOpener: async () => ({ openImageFirstView }) });
    const chosenURL = location.href, entryId = history.state[HISTORY_ENTRY_ID], entries = history.length;
    await restoreReload();
    let finishClassic;
    const classicData = new Promise(resolve => { finishClassic = resolve; });
    fetchRows.mockImplementation(async options => options.callerName === "openRowArticleView" ? classicData : recordResponse());
    let classicOpening;
    refreshDataset.mockImplementationOnce(async (_tableName, options) => {
        document.querySelector(".tab_parts_container").dataset.view = "article_view";
        const container = document.createElement("div");
        container.id = "examples_article_view_container";
        container.innerHTML = '<div class="card_view_wrapper"><div class="card_container"></div><div class="row_article_placeholder"></div></div>';
        document.getElementById("examples_container").append(container);
        // refreshTableUnified starts the classic article without awaiting it;
        // its listing/view checks alone stay current under an IFAV overlay.
        // Use the navigation lifetime the real dataset loader hands it.
        classicOpening = openRowArticleView({ id: 3 }, "examples", null, { isCurrent: options.isCurrent });
        return {};
    });
    await traverse("back");
    await vi.waitFor(() => expect(fetchRows).toHaveBeenCalledWith(expect.objectContaining({ callerName: "openRowArticleView" })));
    let finishForward;
    fetchRows.mockImplementationOnce(() => new Promise(resolve => { finishForward = resolve; }));
    const push = vi.spyOn(history, "pushState");
    await traverse("forward");
    await vi.waitFor(() => expect(finishForward).toBeTypeOf("function"));
    finishClassic(recordResponse());
    await classicOpening;
    expect(location.href).toBe(chosenURL);
    expect(history.state.imageFirstView.presentationChoice).toBe(true);
    finishForward(recordResponse());
    await vi.waitFor(() => expect(document.querySelector(`${VIEW}.image_first_view--text-only`)?.textContent).toBe("Current row three"));
    expect(document.querySelector(".active_row_article")).toBeNull();
    expect(location.href).toBe(chosenURL);
    expect(history.state).toMatchObject({ [HISTORY_ENTRY_ID]: entryId, imageFirstView: { presentationChoice: true } });
    expect(history.length).toBe(entries); expect(push).not.toHaveBeenCalled();
});

test("Forward to a photo-click entry whose photo is gone returns to its classic origin", async () => {
    loadSession.fetchDynamicChildren.mockResolvedValueOnce({ child_tables: [], card_picture: "present.png" });
    expect(await openImageFirstView({ tableName: "examples", rowItem: { id: 3 } })).not.toBeNull();
    expect(history.state.imageFirstView.presentationChoice).toBeUndefined();
    const entries = history.length;
    await traverse("back");
    const push = vi.spyOn(history, "pushState");
    await traverse("forward");
    await vi.waitFor(() => expect(location.pathname + location.search).toBe(CLASSIC_URL));
    expect(document.querySelector(VIEW)).toBeNull();
    expect(history.state.imageFirstView).toBeUndefined();
    expect(history.length).toBe(entries); expect(push).not.toHaveBeenCalled();
});
