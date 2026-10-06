// @vitest-environment jsdom
// row_article_front_page_history.test.js
// Proves a compact Home block opens its exact article with one Back to root.
// Bridges calendar/map/list callers and the shared article opener host.
// Exists to keep every row-oriented view able to open the default row article experience.

import { expect, test, vi } from "vitest";

const {
    closeRowArticleMock,
    dispatchCardArticleToggleMock,
    fetchPermittedRowArticleDataMock,
    getParamsMock,
    setParamsMock,
    articleUiSettings,
} = vi.hoisted(() => ({
    closeRowArticleMock: vi.fn((_wrapper, _cardContainer, rowArticleElement) => {
        rowArticleElement.remove();
    }),
    dispatchCardArticleToggleMock: vi.fn(),
    fetchPermittedRowArticleDataMock: vi.fn(async ({ rowItem }) => rowItem),
    getParamsMock: vi.fn(() => ({})),
    setParamsMock: vi.fn(),
    articleUiSettings: { showRelatedItems: true },
}));

vi.mock("../../lang/translation_handler.js", () => ({ getTranslationForKey: vi.fn(key => key) }));

vi.mock("../dataset_loaded_rows.js", () => ({ captureLoadedDatasetRows: vi.fn(() => null) }));

vi.mock("./row_article_section_defaults.js", async (importOriginal) => ({
    ...await importOriginal(),
    loadRowArticleSectionDefaults: vi.fn(async () => ({})),
}));

vi.mock("../article_view/article_language_editor.js", () => ({ createArticleLanguageEditor: vi.fn(() => null) }));

vi.mock("../../endpoints/endpoint_router.js", () => ({
    endpoint_router: vi.fn(),
}));

vi.mock("./card_avatar_builder.js", () => ({ createImageElement: vi.fn(src => { const image = document.createElement("img"); image.src = src; return image; }) }));

vi.mock("./row_article_data_fetcher.js", () => ({ fetchPermittedRowArticleData: fetchPermittedRowArticleDataMock }));

vi.mock("./card_field_formatter.js", () => ({
    cancelEditing: vi.fn(),
    collectCardUpdates: vi.fn(() => ({})),
    disableEditing: vi.fn(() => ({})),
    enableEditing: vi.fn(),
    parseRoleString: vi.fn(() => ({ baseRoles: [] })),
    sendCardUpdates: vi.fn(),
}));

vi.mock("./row_article_child_tabs.js", () => ({
    buildRowArticleRelatedTabs: vi.fn(),
}));

vi.mock("./row_article_image_gallery.js", () => ({
    buildRowArticleImageGallery: vi.fn(),
}));

vi.mock("./row_article_attachment_list.js", () => ({
    buildRowArticleAttachmentList: vi.fn(),
}));

vi.mock("./row_article_asset_resolver.js", async (importOriginal) => ({
    // The real resolveRowArticleDisplayedImageRows composes what the article shows
    // from the gallery child these tests steer through the mocks below.
    ...await importOriginal(),
    filterRowArticleNonMediaChildTables: vi.fn((tables) => tables),
    resolveRowArticleAttachmentListChild: vi.fn(),
    resolveRowArticleImageGalleryChild: vi.fn(),
    resolveRowArticleParentImageRows: vi.fn(() => []),
    resolveRowArticleSharedAssetChild: vi.fn(() => null),
}));

vi.mock("../../dev_tools/function_counter.js", () => ({
    count_this_function: vi.fn(),
}));

vi.mock("../../navigation/nav_engine/query_params.js", () => ({
    DATASET_PREFIX: "",
    getParams: getParamsMock,
    setParams: setParamsMock,
    // The address owner imports this from the same module, so a stand-in that
    // leaves it out makes every address it writes throw.
    normalizePath: (pathname) =>
        pathname && pathname !== "/" && pathname.endsWith("/")
            ? pathname.slice(0, -1)
            : pathname,
}));

vi.mock("../../route_permission_checker.js", () => ({
    hasDatasetPermission: vi.fn(() => Promise.resolve(false)),
    hasRoutePermission: vi.fn(() => false),
    primeDatasetPermissions: vi.fn(),
}));

vi.mock("./row_article_opener_helpers.js", () => ({
    buildCardUrl: vi.fn((_prefix, tableName, rowId) => `/${tableName}/${rowId}`),
    buildCreationSeed: vi.fn(() => "seed"),
    buildSlug: vi.fn(() => "row"),
    extractRowId: vi.fn((row) => row.id),
    sortColumnsByRole: vi.fn((columns) => columns),
}));

vi.mock("../../../ui_config.js", () => ({
    enable_experimental_row_article_row_navigation: false,
    isCardStackViewport: vi.fn(() => false),
    get show_related_items_on_big_cards() { return articleUiSettings.showRelatedItems; },
}));

vi.mock("./row_article_content_builder.js", () => ({
    buildRowArticleContent: vi.fn(async () => {
        const rowArticleContentElement = document.createElement("div");
        rowArticleContentElement.classList.add("big_card_content");
        rowArticleContentElement.textContent = "Article content";
        return { rowArticleContentElement };
    }),
}));

vi.mock("./row_article_ui_handler.js", () => ({
    closeRowArticle: closeRowArticleMock,
    dispatchCardArticleToggle: dispatchCardArticleToggleMock,
    saveScrollBeforeRowArticle: vi.fn(),
    updateHighlightedCard: vi.fn(),
}));

vi.mock("../table_view/row_selection_handler.js", () => ({
    update_card_selection: vi.fn(),
}));

vi.mock("../../../reusable_components/modal/confirm_modal_builder.js", () => ({
    showConfirmModal: vi.fn(),
}));

vi.mock("../../../reusable_components/notifications/toast_notification_printer.js", () => ({
    showSuccessToast: vi.fn(),
}));

vi.mock("../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js", () => ({
    refreshTableUnified: vi.fn(),
}));

vi.mock("../../general_tables/gt_1_row_crud/gt_1_4_row_delete/row_remover_helpers.js", () => ({
    buildConfirmationMessage: vi.fn(() => ({
        messageLangKey: "delete_confirm",
        messagePlainText: "Delete?",
    })),
}));

vi.mock("../../state_stores/lang_preference_reader.js", () => ({
    getLanguageWithBrowserFallback: vi.fn(() => "en"),
}));

vi.mock("./row_article_load_session.js", () => ({
    createRowArticleLoadSession: vi.fn(() => ({
        fetchAttachmentLinking: vi.fn(),
        fetchDynamicChildren: vi.fn(),
    })),
}));

vi.mock("../../user_tools/current_user_profile_fetcher.js", () => ({
    fetchCurrentUserProfile: vi.fn(() => Promise.resolve({ user_id: 1 })),
}));


import { openRowArticleView } from "./row_article_opener.js";
import { createSupplementalDatasetGroup } from "../compact_dataset_group.js";
import { getUnifiedTableState, setUnifiedTableState } from "../../state_stores/table_state_store.js";
import { setChosenDatasetView } from "../../state_stores/dataset_view_choice_saver.js";

const tabNavigation = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("../../navigation/main_tabs/main_tab_printer.js", () => ({ openNavTab: tabNavigation.open }));

test("a block link opens the chosen row, bypasses a remembered article, and one Back reaches root", async () => {
    document.body.innerHTML = `<div id="front_page_container"></div>
        <div id="events_article_view_container"><div class="card_view_wrapper">
        <div class="card_container"><div class="card" data-id="42"></div></div>
        <div class="big_card_placeholder row_article_placeholder"></div></div></div>`;
    history.replaceState({ __filterestEntryId: "home" }, "", "/");
    localStorage.clear(); sessionStorage.clear();
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { callback(); return 1; });
    const params = new Map();
    getParamsMock.mockImplementation(dataset => params.get(dataset) || {});
    setParamsMock.mockImplementation((dataset, value) => params.set(dataset, value));
    setChosenDatasetView("events", "article_view");
    setUnifiedTableState("events", { articleView: { collapsed: true, expandedId: 99 } });
    const group = createSupplementalDatasetGroup({ dataset: "events", langKey: "events" }, "", {
        rowCap: 5, preselectArticle: true, replacementParams: { sort_column: "__newest", sort_order: "DESC", view: "card" },
    });
    group.render([{ id: 42 }], [], {});
    document.getElementById("front_page_container").append(group.element);
    const push = vi.spyOn(history, "pushState");
    try {
        tabNavigation.open.mockImplementation(async (dataset, options) => {
            expect(options.skipUrlUpdate).toBe(true);
            expect(getUnifiedTableState(dataset).articleView.expandedId).toBe(42);
            await openRowArticleView({ id: 42 }, dataset, document.querySelector('.card[data-id="42"]'));
            return { abort: false };
        });
        group.element.querySelector("li a").click();
        await vi.waitFor(() => expect(location.pathname).toBe("/events/42"));
        expect(push).toHaveBeenCalledTimes(1);
        expect(history.state.rowId).toBe("42");
        history.back();
        await vi.waitFor(() => expect(location.pathname).toBe("/"));
        expect(history.state.__filterestEntryId).toBe("home");
    } finally {
        push.mockRestore(); vi.restoreAllMocks();
    }
});
