// @vitest-environment jsdom
// row_article_opener_test_setup.js
// Shares article-opening test setup with its navigation and media suites.
// Bridges drawing/network mocks with real catalogue identities and article state.
// Keeps both suites below the file limit without duplicating their setup.

import { afterEach, beforeEach, vi } from "vitest";

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

vi.mock("../../state_stores/table_state_store.js", async (importOriginal) => {
    // The article's restore state compares rows, and names its reading-position
    // fields, the store's own way.
    const store = await importOriginal();
    return {
        ARTICLE_READING_POSITION_FIELDS: store.ARTICLE_READING_POSITION_FIELDS,
        isSameOpenRow: store.isSameOpenRow,
        getUnifiedTableState: vi.fn(() => ({ articleView: { expandedId: null } })),
        setUnifiedTableState: vi.fn(),
    };
});

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

import { createArticleLanguageEditor } from "../article_view/article_language_editor.js";
import {
    collectCardUpdates,
    disableEditing,
    parseRoleString,
    sendCardUpdates,
} from "./card_field_formatter.js";
import { hasDatasetPermission, primeDatasetPermissions } from "../../route_permission_checker.js";
import { buildRowArticleRelatedTabs } from "./row_article_child_tabs.js";
import { buildRowArticleImageGallery } from "./row_article_image_gallery.js";
import { buildRowArticleAttachmentList } from "./row_article_attachment_list.js";
import {
    resolveRowArticleAttachmentListChild,
    resolveRowArticleImageGalleryChild,
    resolveRowArticleParentImageRows,
    resolveRowArticleSharedAssetChild,
} from "./row_article_asset_resolver.js";
import { buildRowArticleContent } from "./row_article_content_builder.js";
import { loadRowArticleSectionDefaults } from "./row_article_section_defaults.js";
import { createRowArticleLoadSession } from "./row_article_load_session.js";
import { setChosenDatasetView } from "../../state_stores/dataset_view_choice_saver.js";
import { clearDatasetAccessRegistry, primeDatasetAccessRegistry } from "../../navigation/nav_engine/dataset_access_registry.js";

/** Supplies the article body that the shared drawing stub returns. */
export function createDefaultRowArticleContent() {
    const rowArticleContentElement = document.createElement("div");
    rowArticleContentElement.classList.add("big_card_content");
    rowArticleContentElement.textContent = "Article content";
    return { rowArticleContentElement };
}

/** Lets the opener's deferred media hydration settle before inspecting it. */
export async function flushRowArticleHydration() { await new Promise((resolve) => setTimeout(resolve, 0)); }

/** Registers an isolated page and the server's readable names for either suite. */
export function setupRowArticleOpenerTests() {
    beforeEach(() => {
        document.body.innerHTML = "";
        window.history.replaceState({}, "", "/");
        localStorage.clear();
        sessionStorage.clear();
        // Opening articles follows catalogue hydration in the real application.
        primeDatasetAccessRegistry({ datasets: [
            { table_uid: 7, dataset_name: "app_service_catalog", names: ["app_service_catalog", "service_catalog"],
                preferred_name: "service_catalog", can_read_rows: true },
            ...["events", "services", "tickets", "ordinary_dataset"].map((name, index) => ({
                table_uid: 10 + index, dataset_name: name, names: [name], preferred_name: name, can_read_rows: true,
            })),
        ] });
        articleUiSettings.showRelatedItems = true;
        vi.mocked(loadRowArticleSectionDefaults).mockReset();
        vi.mocked(loadRowArticleSectionDefaults).mockResolvedValue({});
        vi.mocked(primeDatasetPermissions).mockClear();
        vi.mocked(hasDatasetPermission).mockClear();
        ["events", "services", "service_catalog", "tickets", "app_service_catalog"].forEach((table) => setChosenDatasetView(table, "article_view"));
        vi.mocked(createArticleLanguageEditor).mockReset();
        vi.mocked(createArticleLanguageEditor).mockReturnValue(null);
        closeRowArticleMock.mockClear();
        dispatchCardArticleToggleMock.mockClear();
        fetchPermittedRowArticleDataMock.mockReset();
        fetchPermittedRowArticleDataMock.mockImplementation(async ({ rowItem }) => rowItem);
        vi.mocked(buildRowArticleRelatedTabs).mockReset();
        vi.mocked(buildRowArticleImageGallery).mockReset();
        vi.mocked(parseRoleString).mockReset();
        vi.mocked(collectCardUpdates).mockReset();
        vi.mocked(disableEditing).mockReset();
        vi.mocked(sendCardUpdates).mockReset();
        vi.mocked(collectCardUpdates).mockReturnValue({});
        vi.mocked(disableEditing).mockReturnValue({});
        vi.mocked(sendCardUpdates).mockResolvedValue({ successfulFields: [], failedFields: [] });
        vi.mocked(hasDatasetPermission).mockResolvedValue(false);
        vi.mocked(buildRowArticleAttachmentList).mockReset();
        vi.mocked(resolveRowArticleAttachmentListChild).mockReset();
        vi.mocked(resolveRowArticleSharedAssetChild).mockReset();
        vi.mocked(resolveRowArticleImageGalleryChild).mockReset();
        vi.mocked(resolveRowArticleParentImageRows).mockReset();
        vi.mocked(buildRowArticleContent).mockReset();
        vi.mocked(createRowArticleLoadSession).mockReset();
        vi.mocked(resolveRowArticleAttachmentListChild).mockReturnValue(null);
        vi.mocked(resolveRowArticleSharedAssetChild).mockReturnValue(null);
        vi.mocked(resolveRowArticleImageGalleryChild).mockReturnValue(null);
        vi.mocked(resolveRowArticleParentImageRows).mockReturnValue([]);
        vi.mocked(parseRoleString).mockReturnValue({ baseRoles: [] });
        vi.mocked(buildRowArticleContent).mockResolvedValue(createDefaultRowArticleContent());
        vi.mocked(createRowArticleLoadSession).mockReturnValue({
            fetchAttachmentLinking: vi.fn(),
            fetchDynamicChildren: vi.fn(),
        });
        getParamsMock.mockReturnValue({});
        setParamsMock.mockClear();
        vi.spyOn(console, "warn").mockImplementation(() => {});
        window.requestAnimationFrame = (callback) => {
            callback();
            return 1;
        };
        HTMLElement.prototype.scrollIntoView = vi.fn();
    });

    afterEach(() => {
        clearDatasetAccessRegistry();
        vi.restoreAllMocks();
    });
}

vi.mock("../../navigation/nav_engine/card_article_return_state.js", () => ({ captureCardArticleReturn: vi.fn(() => null), getCardArticleOriginEntry: vi.fn(() => null) }));

vi.mock("../../infinite_scroll/infinite_scroll_handler.js", () => ({
    captureInfiniteScrollState: vi.fn(() => ({ isLoading: false })),
    resumeInfiniteScrollState: vi.fn(), disconnectInfiniteScroll: vi.fn(),
}));
vi.mock("../../filterbar/text_search/dataset_search_runtime_state.js", () => ({
    ongoingSearchResultsStore: {}, syncSearchResultsCount: vi.fn(),
}));
vi.mock("../../../reusable_components/results_count/results_count_printer.js", () => ({
    setResultsCount: vi.fn(),
}));

export {
    closeRowArticleMock,
    dispatchCardArticleToggleMock,
    fetchPermittedRowArticleDataMock,
    getParamsMock,
    setParamsMock,
    articleUiSettings,
};
