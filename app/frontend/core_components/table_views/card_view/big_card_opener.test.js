// @vitest-environment jsdom
// big_card_opener.test.js
// Verifies row article opening outside the card layout shell.
// Bridges calendar/map/list callers and the shared big-card article opener host.
// Exists to keep every row-oriented view able to open the default row article experience.

import { beforeEach, describe, expect, test, vi } from "vitest";

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

vi.mock("../article_view/article_language_editor.js", () => ({ createArticleLanguageEditor: vi.fn(() => null) }));

vi.mock("../../endpoints/endpoint_router.js", () => ({
    endpoint_router: vi.fn(),
}));

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

vi.mock("./row_article_asset_resolver.js", () => ({
    filterRowArticleNonMediaChildTables: vi.fn((tables) => tables),
    resolveRowArticleAttachmentListChild: vi.fn(),
    resolveRowArticleDynamicAssetChildren: vi.fn(() => ({})),
    resolveRowArticleImageGalleryChild: vi.fn(),
    resolveRowArticleParentImageRows: vi.fn(() => []),
}));

vi.mock("../../dev_tools/function_counter.js", () => ({
    count_this_function: vi.fn(),
}));

vi.mock("../../state_stores/table_state_store.js", () => ({
    setUnifiedTableState: vi.fn(),
}));

vi.mock("../../navigation/nav_engine/query_params.js", () => ({
    DATASET_PREFIX: "",
    getParams: getParamsMock,
    setParams: setParamsMock,
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
        fetchImageLinking: vi.fn(),
    })),
}));

vi.mock("../../user_tools/current_user_profile_fetcher.js", () => ({
    fetchCurrentUserProfile: vi.fn(() => Promise.resolve({ user_id: 1 })),
}));

import { createArticleLanguageEditor } from "../article_view/article_language_editor.js";
import { openRowArticleView } from "./big_card_opener.js";
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
    resolveRowArticleDynamicAssetChildren,
    resolveRowArticleImageGalleryChild,
    resolveRowArticleParentImageRows,
} from "./row_article_asset_resolver.js";
import { buildRowArticleContent } from "./row_article_content_builder.js";
import { createRowArticleLoadSession } from "./row_article_load_session.js";
import { buildSlug } from "./row_article_opener_helpers.js";

function createDefaultRowArticleContent() {
    const rowArticleContentElement = document.createElement("div");
    rowArticleContentElement.classList.add("big_card_content");
    rowArticleContentElement.textContent = "Article content";
    return { rowArticleContentElement };
}

async function flushRowArticleHydration() { await new Promise((resolve) => setTimeout(resolve, 0)); }

describe("openRowArticleView", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        window.history.replaceState({}, "", "/");
        localStorage.clear();
        articleUiSettings.showRelatedItems = true;
        vi.mocked(primeDatasetPermissions).mockClear();
        vi.mocked(hasDatasetPermission).mockClear();
        ["events", "services", "service_catalog", "tickets", "app_service_catalog"].forEach((table) => localStorage.setItem(`${table}_view`, "article_view"));
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
        vi.mocked(resolveRowArticleDynamicAssetChildren).mockReset();
        vi.mocked(resolveRowArticleImageGalleryChild).mockReset();
        vi.mocked(resolveRowArticleParentImageRows).mockReset();
        vi.mocked(buildRowArticleContent).mockReset();
        vi.mocked(createRowArticleLoadSession).mockReset();
        vi.mocked(resolveRowArticleAttachmentListChild).mockReturnValue(null);
        vi.mocked(resolveRowArticleDynamicAssetChildren).mockReturnValue({});
        vi.mocked(resolveRowArticleImageGalleryChild).mockReturnValue(null);
        vi.mocked(resolveRowArticleParentImageRows).mockReturnValue([]);
        vi.mocked(parseRoleString).mockReturnValue({ baseRoles: [] });
        vi.mocked(buildRowArticleContent).mockResolvedValue(createDefaultRowArticleContent());
        vi.mocked(createRowArticleLoadSession).mockReturnValue({
            fetchAttachmentLinking: vi.fn(),
            fetchDynamicChildren: vi.fn(),
            fetchImageLinking: vi.fn(),
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

    test("does not create a standalone article host when the current view has no card container", async () => {
        await openRowArticleView(
            { id: 42, title: "Calendar row" },
            "events",
            document.createElement("button"),
        );

        expect(document.querySelector(".active_row_article")).toBeNull();
        expect(document.querySelector(".row_article_standalone_host")).toBeNull();
        expect(console.warn).toHaveBeenCalledWith("could not find card container");
        expect(closeRowArticleMock).not.toHaveBeenCalled();
    });

    test("uses the selected card wrapper and preserves editing after a failed save", async () => {
        document.body.innerHTML = `
            <div id="events_article_view_container">
                <div class="card_view_wrapper">
                    <div class="card_container">
                        <div class="card" data-id="42"></div>
                    </div>
                    <div class="big_card_placeholder row_article_placeholder"></div>
                </div>
            </div>
        `;
        vi.mocked(hasDatasetPermission).mockImplementation((route) => (
            Promise.resolve(route === "/api/update-row")
        ));
        vi.mocked(collectCardUpdates).mockReturnValue({ title: "Unsaved draft" });
        vi.mocked(sendCardUpdates).mockRejectedValue(Object.assign(
            new Error("One or more article fields could not be saved."),
            { status: 503, isServiceUnavailable: true },
        ));
        const selectedCard = document.querySelector(".card[data-id='42']");

        await openRowArticleView(
            { id: 42, title: "Calendar row" },
            "events",
            selectedCard,
        );

        const host = document.querySelector(".row_article_standalone_host");
        const article = document.querySelector(".active_row_article");
        expect(host).toBeNull();
        expect(article).not.toBeNull();
        expect(document.querySelector(".card_container .small-card")).toBe(selectedCard);
        expect(dispatchCardArticleToggleMock).toHaveBeenCalledWith("events", true);

        const editButton = document.querySelector('[data-testid="big-card-edit-button"]');
        const cancelButton = document.querySelector('[data-testid="big-card-cancel-button"]');
        editButton.click();
        expect(editButton.dataset.langKey).toBe("save");

        editButton.click();
        await vi.waitFor(() => expect(sendCardUpdates).toHaveBeenCalledTimes(1));

        expect(disableEditing).not.toHaveBeenCalled();
        expect(editButton.dataset.langKey).toBe("save");
        expect(editButton.disabled).toBe(false);
        expect(cancelButton.hidden).toBe(false);

        article?.querySelector(".big_card_close")?.click();

        expect(closeRowArticleMock).toHaveBeenCalled();
    });

    test("resolves the current result card before composing direct article media", async () => {
        document.body.innerHTML = `
            <div id="events_article_view_container">
                <div class="card_view_wrapper">
                    <div class="card_container">
                        <div class="card" data-id="41"></div>
                        <div class="card" data-id="42"></div>
                    </div>
                    <div class="big_card_placeholder row_article_placeholder"></div>
                </div>
            </div>
        `;
        const resolvedCard = document.querySelector(".card[data-id='42']");

        await openRowArticleView(
            { id: 42, title: "Direct article row" },
            "events",
        );

        expect(buildRowArticleContent).toHaveBeenCalledWith(
            expect.any(Object),
            "events",
            expect.any(Object),
            expect.any(Array),
            expect.any(String),
            expect.any(String),
            false,
            1,
            { selectedCard: resolvedCard },
        );
    });

    test("uses the active-language header for the article avatar and URL slug", async () => {
        document.body.innerHTML = `
            <div id="services_article_view_container">
                <div class="card_view_wrapper">
                    <div class="card_container">
                        <div class="card" data-id="42"></div>
                    </div>
                    <div class="big_card_placeholder row_article_placeholder"></div>
                </div>
            </div>
        `;
        const selectedCard = document.querySelector(".card[data-id='42']");
        selectedCard._data_types = {
            title: { card_element: "header", is_multilingual: true },
        };
        vi.mocked(parseRoleString).mockImplementation((roleString = "") => ({
            baseRoles: String(roleString).split(/\s+/).filter(Boolean),
        }));

        await openRowArticleView(
            { id: 42, title: JSON.stringify({ en: "Services", fi: "Palvelut" }) },
            "services",
            selectedCard,
        );

        expect(buildRowArticleContent).toHaveBeenCalledWith(
            expect.any(Object),
            "services",
            selectedCard._data_types,
            expect.any(Array),
            expect.any(String),
            "S",
            false,
            1,
            { selectedCard },
        );
        expect(buildSlug).toHaveBeenCalledWith("Services");
        expect(document.body.textContent).not.toContain('{"en"');
        expect(fetchPermittedRowArticleDataMock).toHaveBeenCalled();
    });

    test("preserves active search params and marks row URLs as article view", async () => {
        document.body.innerHTML = `
            <div id="events_article_view_container">
                <div class="card_view_wrapper">
                    <div class="card_container">
                        <div class="card" data-id="42"></div>
                    </div>
                    <div class="big_card_placeholder row_article_placeholder"></div>
                </div>
            </div>
        `;
        getParamsMock.mockReturnValue({ search: "firefox", view: "table" });
        const selectedCard = document.querySelector(".card[data-id='42']");

        await openRowArticleView(
            { id: 42, title: "Firefox" },
            "events",
            selectedCard,
        );

        expect(window.location.pathname).toBe("/events/42");
        expect(window.location.search).toBe("?search=firefox&view=article_view");
        expect(setParamsMock).toHaveBeenCalledWith("events", {
            search: "firefox",
            view: "article_view",
        });
    });

    test("canonicalizes an already-current row path without adding a history entry", async () => {
        document.body.innerHTML = `
            <div id="events_article_view_container">
                <div class="card_view_wrapper">
                    <div class="card_container">
                        <div class="card" data-id="42"></div>
                    </div>
                    <div class="big_card_placeholder row_article_placeholder"></div>
                </div>
            </div>
        `;
        window.history.replaceState({}, "", "/events/42-old-title");
        getParamsMock.mockReturnValue({ view: "article_view" });
        const pushStateSpy = vi.spyOn(window.history, "pushState");
        const replaceStateSpy = vi.spyOn(window.history, "replaceState");
        const selectedCard = document.querySelector(".card[data-id='42']");

        await openRowArticleView(
            { id: 42, title: "Firefox" },
            "events",
            selectedCard,
        );

        expect(pushStateSpy).not.toHaveBeenCalled();
        expect(replaceStateSpy).toHaveBeenCalledWith(
            { bigCard: true, dataset: "events", rowId: "42", articleReturnAvailable: false },
            "",
            "/events/42?view=article_view",
        );
        expect(window.location.pathname).toBe("/events/42");
        expect(window.location.search).toBe("?view=article_view");
        expect(window.history.state).toEqual({
            bigCard: true,
            dataset: "events",
            rowId: "42",
            articleReturnAvailable: false,
        });
    });

    test("uses selected-card data types before stored data types", async () => {
        document.body.innerHTML = `
            <div id="service_catalog_article_view_container">
                <div class="card_view_wrapper">
                    <div class="card_container">
                        <div class="card" data-id="42"></div>
                    </div>
                    <div class="big_card_placeholder row_article_placeholder"></div>
                </div>
            </div>
        `;
        const selectedCard = document.querySelector(".card[data-id='42']");
        const cardDataTypes = {
            cached_image: { card_element: "image" },
        };
        selectedCard._data_types = cardDataTypes;
        localStorage.setItem("service_catalog_dataTypes", JSON.stringify({
            cached_image: { card_element: "details" },
        }));

        await openRowArticleView(
            { id: 42, header: "Firefox", cached_image: "firefox.svg" },
            "service_catalog",
            selectedCard,
        );

        expect(buildRowArticleContent).toHaveBeenCalledWith(
            expect.any(Object),
            "service_catalog",
            cardDataTypes,
            expect.any(Array),
            expect.any(String),
            expect.any(String),
            expect.any(Boolean),
            expect.any(Number),
            { selectedCard },
        );
    });

    test("falls back from public dataset alias to canonical stored data types", async () => {
        document.body.innerHTML = `
            <div id="service_catalog_article_view_container">
                <div class="card_view_wrapper">
                    <div class="card_container">
                        <div class="card" data-id="42"></div>
                    </div>
                    <div class="big_card_placeholder row_article_placeholder"></div>
                </div>
            </div>
        `;
        const selectedCard = document.querySelector(".card[data-id='42']");
        const canonicalDataTypes = {
            cached_image: { card_element: "image" },
        };
        localStorage.setItem("app_service_catalog_dataTypes", JSON.stringify(canonicalDataTypes));

        await openRowArticleView(
            { id: 42, header: "Firefox", cached_image: "firefox.svg" },
            "service_catalog",
            selectedCard,
        );

        expect(buildRowArticleContent).toHaveBeenCalledWith(
            expect.any(Object),
            "service_catalog",
            canonicalDataTypes,
            expect.any(Array),
            expect.any(String),
            expect.any(String),
            expect.any(Boolean),
            expect.any(Number),
            { selectedCard },
        );
    });

    function prepareInlineCaptionArticle({ parentRows = [], childRows = [] } = {}) {
        document.body.innerHTML = `<div id="tickets_article_view_container"><div class="card_view_wrapper"><div class="card_container"><div class="card" data-id="2"></div></div><div class="row_article_placeholder"></div></div></div>`;
        const content = document.createElement("div");
        const inlineImage = document.createElement("div");
        inlineImage.className = "big_card_image";
        inlineImage.dataset.rowArticleImageColumn = "cached_image";
        const image = document.createElement("img");
        image.src = "/storage/10_2_1.webp";
        inlineImage.appendChild(image);
        content.appendChild(inlineImage);
        vi.mocked(buildRowArticleContent).mockResolvedValueOnce({ rowArticleContentElement: content });
        vi.mocked(resolveRowArticleParentImageRows).mockReturnValueOnce(parentRows);
        const child = { dataset: "tickets_assets", column: "tickets_id", rows: childRows };
        vi.mocked(resolveRowArticleDynamicAssetChildren).mockReturnValue({ assetsChild: child });
        vi.mocked(resolveRowArticleImageGalleryChild).mockReturnValue(child);
        const session = {
            fetchDynamicChildren: vi.fn(async () => ({ child_tables: [child] })),
            fetchImageLinking: vi.fn(async () => ({ child_table: "tickets_assets" })),
            fetchAttachmentLinking: vi.fn(async () => null),
        };
        vi.mocked(createRowArticleLoadSession).mockReturnValueOnce(session);
        return { inlineImage, session, selectedCard: document.querySelector(".card") };
    }

    test("loads classic image credits without optional related sections or editing permission checks", async () => {
        articleUiSettings.showRelatedItems = false;
        const { inlineImage, session, selectedCard } = prepareInlineCaptionArticle({
            childRows: [{ filename: "10_2_1.webp", description: "Child photo credit" }],
        });
        await openRowArticleView({ id: 2, cached_image: "10_2_1.webp" }, "tickets", selectedCard);
        await flushRowArticleHydration();

        expect(inlineImage.querySelector(".row_article_inline_image_caption")?.textContent).toBe("Child photo credit");
        expect(session.fetchDynamicChildren).toHaveBeenCalledTimes(1);
        expect(session.fetchImageLinking).toHaveBeenCalledTimes(1);
        expect(session.fetchAttachmentLinking).not.toHaveBeenCalled();
        expect(buildRowArticleImageGallery).not.toHaveBeenCalled();
        expect(buildRowArticleAttachmentList).not.toHaveBeenCalled();
        expect(buildRowArticleRelatedTabs).not.toHaveBeenCalled();
        expect(primeDatasetPermissions).not.toHaveBeenCalledWith("tickets_assets", expect.anything());
        expect(hasDatasetPermission.mock.calls.some(([, dataset]) => dataset === "tickets_assets")).toBe(false);
    });

    test.each([
        ["missing response", undefined],
        ["missing child tables", {}],
        ["failed request", new Error("Unavailable")],
    ])("keeps permitted parent credits when child loading has a %s", async (_label, response) => {
        articleUiSettings.showRelatedItems = false;
        const { inlineImage, session, selectedCard } = prepareInlineCaptionArticle({
            parentRows: [{ filename: "10_2_1.webp", description: "Parent photo credit" }],
        });
        session.fetchDynamicChildren.mockImplementationOnce(async () => {
            if (response instanceof Error) throw response;
            return response;
        });
        await openRowArticleView({ id: 2, cached_image: "10_2_1.webp" }, "tickets", selectedCard);
        await flushRowArticleHydration();

        expect(inlineImage.querySelector(".row_article_inline_image_caption")?.textContent).toBe("Parent photo credit");
        expect(buildRowArticleImageGallery).not.toHaveBeenCalled();
    });

    test("clears stale parent credits when the authoritative child has no images", async () => {
        articleUiSettings.showRelatedItems = false;
        const { inlineImage, selectedCard } = prepareInlineCaptionArticle({
            parentRows: [{ filename: "10_2_1.webp", description: "Deleted photo credit" }],
            childRows: [],
        });
        await openRowArticleView({ id: 2, cached_image: "10_2_1.webp" }, "tickets", selectedCard);
        await flushRowArticleHydration();
        expect(inlineImage.querySelector(".row_article_inline_image_caption")).toBeNull();
    });

    test.each(["superseded", "disconnected"])("does not hydrate captions after the article becomes %s", async (state) => {
        articleUiSettings.showRelatedItems = false;
        const { inlineImage, session, selectedCard } = prepareInlineCaptionArticle({
            childRows: [{ filename: "10_2_1.webp", description: "Late photo credit" }],
        });
        let resolveLinking;
        let current = true;
        session.fetchImageLinking.mockImplementationOnce(() => new Promise((resolve) => { resolveLinking = resolve; }));
        await openRowArticleView(
            { id: 2, cached_image: "10_2_1.webp" }, "tickets", selectedCard,
            { isCurrent: () => current },
        );
        await flushRowArticleHydration();
        expect(session.fetchImageLinking).toHaveBeenCalledTimes(1);
        if (state === "superseded") current = false;
        else document.querySelector(".active_row_article").remove();
        resolveLinking({ child_table: "tickets_assets" });
        await flushRowArticleHydration();

        expect(inlineImage.querySelector(".row_article_inline_image_caption")).toBeNull();
        expect(buildRowArticleImageGallery).not.toHaveBeenCalled();
    });

    test("passes parent image-role values to the gallery even without an image child relation", async () => {
        document.body.innerHTML = `
            <div id="tickets_article_view_container">
                <div class="card_view_wrapper">
                    <div class="card_container">
                        <div class="card" data-id="2"></div>
                    </div>
                    <div class="big_card_placeholder row_article_placeholder"></div>
                </div>
            </div>
        `;
        const selectedCard = document.querySelector(".card[data-id='2']");
        selectedCard._data_types = {
            cached_image: { card_element: "image" },
            title: { card_element: "header" },
        };
        const parentImageRows = [{
            asset_kind: "image",
            filename: "10_2_1.webp",
            is_parent_row_image: true,
            is_primary: true,
        }];
        vi.mocked(parseRoleString).mockImplementation((roleString = "") => ({
            baseRoles: String(roleString).split(/\s+/).filter(Boolean),
        }));
        vi.mocked(resolveRowArticleParentImageRows).mockReturnValueOnce(parentImageRows);
        vi.mocked(createRowArticleLoadSession).mockReturnValueOnce({
            fetchAttachmentLinking: vi.fn(() => Promise.resolve(null)),
            fetchDynamicChildren: vi.fn(() => Promise.resolve({ child_tables: [] })),
            fetchImageLinking: vi.fn(() => Promise.resolve(null)),
        });

        await openRowArticleView(
            { id: 2, title: "VPN disconnects", cached_image: "10_2_1.webp" },
            "tickets",
            selectedCard,
        );
        await flushRowArticleHydration();

        expect(resolveRowArticleParentImageRows).toHaveBeenCalledWith(
            expect.objectContaining({ cached_image: "10_2_1.webp" }),
            ["cached_image"],
        );
        expect(buildRowArticleImageGallery).toHaveBeenCalledWith(
            "tickets",
            2,
            null,
            expect.any(Function),
            expect.objectContaining({ parentImageRows }),
        );
    });

    test("does not resurrect a deleted cached image after the authoritative child gallery refreshes", async () => {
        document.body.innerHTML = `
            <div id="tickets_article_view_container">
                <div class="card_view_wrapper">
                    <div class="card_container">
                        <div class="card" data-id="2"></div>
                    </div>
                    <div class="big_card_placeholder row_article_placeholder"></div>
                </div>
            </div>
        `;
        const selectedCard = document.querySelector(".card[data-id='2']");
        selectedCard._data_types = {
            cached_image: { card_element: "image" },
            title: { card_element: "header" },
        };
        const staleParentImageRows = [{
            asset_kind: "image",
            filename: "deleted-image.webp",
            is_parent_row_image: true,
            is_primary: true,
        }];
        const authoritativeImageChild = {
            dataset: "tickets_assets",
            column: "tickets_id",
            relation_kind: "shared_asset",
            rows: [],
        };
        vi.mocked(parseRoleString).mockImplementation((roleString = "") => ({
            baseRoles: String(roleString).split(/\s+/).filter(Boolean),
        }));
        vi.mocked(resolveRowArticleParentImageRows).mockReturnValueOnce(staleParentImageRows);
        vi.mocked(createRowArticleLoadSession).mockReturnValueOnce({
            fetchAttachmentLinking: vi.fn(() => Promise.resolve(null)),
            fetchDynamicChildren: vi.fn(() => Promise.resolve({ child_tables: [authoritativeImageChild] })),
            fetchImageLinking: vi.fn(() => Promise.resolve({ child_table: "tickets_assets" })),
        });
        vi.mocked(resolveRowArticleDynamicAssetChildren).mockReturnValueOnce({
            assetsChild: authoritativeImageChild,
            imagesChild: null,
        });
        vi.mocked(resolveRowArticleImageGalleryChild).mockReturnValueOnce(authoritativeImageChild);
        vi.mocked(buildRowArticleImageGallery).mockReturnValueOnce(document.createElement("div"));

        await openRowArticleView(
            { id: 2, title: "VPN disconnects", cached_image: "deleted-image.webp" },
            "tickets",
            selectedCard,
        );
        await flushRowArticleHydration();

        expect(buildRowArticleImageGallery).toHaveBeenCalledWith(
            "tickets",
            2,
            authoritativeImageChild,
            expect.any(Function),
            expect.objectContaining({ parentImageRows: [] }),
        );
    });

    test("keeps service-catalog inline cached image and suppresses duplicate gallery hero", async () => {
        document.body.innerHTML = `
            <div id="app_service_catalog_article_view_container">
                <div class="card_view_wrapper">
                    <div class="card_container">
                        <div class="card" data-id="42"></div>
                    </div>
                    <div class="big_card_placeholder row_article_placeholder"></div>
                </div>
            </div>
        `;
        const selectedCard = document.querySelector(".card[data-id='42']");
        const assetsChild = {
            dataset: "app_service_catalog_assets",
            column: "app_service_catalog_id",
            relation_kind: "shared_asset",
            rows: [{ id: 7, asset_kind: "image", filename: "canonical.svg" }],
        };
        const inlineImage = document.createElement("div");
        inlineImage.classList.add("big_card_image");
        inlineImage.dataset.rowArticleImageColumn = "cached_image";

        vi.mocked(buildRowArticleContent).mockResolvedValueOnce({
            rowArticleContentElement: (() => {
                const content = document.createElement("div");
                content.classList.add("big_card_content");
                content.appendChild(inlineImage);
                return content;
            })(),
        });
        vi.mocked(createRowArticleLoadSession).mockReturnValueOnce({
            fetchAttachmentLinking: vi.fn(() => Promise.resolve(null)),
            fetchDynamicChildren: vi.fn(() => Promise.resolve({ child_tables: [assetsChild] })),
            fetchImageLinking: vi.fn(() => Promise.resolve({ child_table: "app_service_catalog_assets" })),
        });
        vi.mocked(resolveRowArticleDynamicAssetChildren).mockReturnValueOnce({
            assetsChild,
            imagesChild: null,
        });
        vi.mocked(resolveRowArticleImageGalleryChild).mockReturnValueOnce(assetsChild);
        vi.mocked(buildRowArticleImageGallery).mockImplementationOnce(() => {
            const gallery = document.createElement("div");
            gallery.classList.add("big_card_image_gallery", "row_article_image_gallery");
            const hero = document.createElement("div");
            hero.classList.add("big_card_hero_image");
            hero.appendChild(document.createElement("img"));
            gallery.appendChild(hero);
            return gallery;
        });

        await openRowArticleView(
            { id: 42, title: "Firefox", cached_image: "/storage/104/42/original/firefox.svg" },
            "app_service_catalog",
            selectedCard,
        );
        await flushRowArticleHydration();

        const gallery = document.querySelector(".row_article_image_gallery");
        const galleryHero = gallery?.querySelector(".big_card_hero_image");
        expect(gallery).not.toBeNull();
        expect(inlineImage.hidden).toBe(false);
        expect(inlineImage.dataset.serviceCatalogInlineImageSuppressed).toBe("false");
        expect(inlineImage.dataset.serviceCatalogInlineImagePrimary).toBe("true");
        expect(galleryHero?.hidden).toBe(true);
        expect(galleryHero?.dataset.serviceCatalogGalleryHeroSuppressed).toBe("true");
    });

    test("keeps service-catalog inline cached image visible when gallery has no hero image", async () => {
        document.body.innerHTML = `
            <div id="app_service_catalog_article_view_container">
                <div class="card_view_wrapper">
                    <div class="card_container">
                        <div class="card" data-id="42"></div>
                    </div>
                    <div class="big_card_placeholder row_article_placeholder"></div>
                </div>
            </div>
        `;
        const selectedCard = document.querySelector(".card[data-id='42']");
        const inlineImage = document.createElement("div");
        inlineImage.classList.add("big_card_image");
        inlineImage.dataset.rowArticleImageColumn = "cached_image";

        vi.mocked(buildRowArticleContent).mockResolvedValueOnce({
            rowArticleContentElement: (() => {
                const content = document.createElement("div");
                content.classList.add("big_card_content");
                content.appendChild(inlineImage);
                return content;
            })(),
        });
        vi.mocked(createRowArticleLoadSession).mockReturnValueOnce({
            fetchAttachmentLinking: vi.fn(() => Promise.resolve(null)),
            fetchDynamicChildren: vi.fn(() => Promise.resolve({ child_tables: [] })),
            fetchImageLinking: vi.fn(() => Promise.resolve(null)),
        });
        vi.mocked(buildRowArticleImageGallery).mockImplementationOnce(() => {
            const gallery = document.createElement("div");
            gallery.classList.add("big_card_image_gallery", "row_article_image_gallery");
            const hero = document.createElement("div");
            hero.classList.add("big_card_hero_image");
            gallery.appendChild(hero);
            return gallery;
        });

        await openRowArticleView(
            { id: 42, title: "Firefox", cached_image: "/storage/104/42/original/firefox.svg" },
            "app_service_catalog",
            selectedCard,
        );
        await flushRowArticleHydration();

        expect(inlineImage.hidden).toBe(false);
        expect(inlineImage.dataset.serviceCatalogInlineImageSuppressed).toBe("false");
        expect(inlineImage.dataset.serviceCatalogInlineImagePrimary).toBe("false");
    });

    test("a superseded article fetch cannot write DOM or history", async () => {
        document.body.innerHTML = `<div id="events_article_view_container"><div class="card_view_wrapper"><div class="card_container"></div><div class="row_article_placeholder"></div></div></div>`;
        let resolveRow;
        let current = true;
        fetchPermittedRowArticleDataMock.mockImplementationOnce(() => new Promise((resolve) => { resolveRow = resolve; }));
        const opening = openRowArticleView({ id: 42 }, "events", null, { isCurrent: () => current });
        current = false;
        resolveRow({ id: 42, title: "Stale" });
        await opening;
        expect(document.querySelector(".active_row_article")).toBeNull();
        expect(window.location.pathname).toBe("/");
        expect(dispatchCardArticleToggleMock).not.toHaveBeenCalled();
        expect(buildRowArticleContent).not.toHaveBeenCalled();
    });

    test("article content follows its assigned field order", async () => {
        document.body.innerHTML = `<div id="events_article_view_container"><div class="card_view_wrapper"><div class="card_container"></div><div class="row_article_placeholder"></div></div></div>`;
        const row = { id: 42, title: "Title", description: "Body" };
        Object.defineProperty(row, "__articleColumns", { value: ["description", "title"] });
        fetchPermittedRowArticleDataMock.mockResolvedValueOnce(row);
        await openRowArticleView(row, "events");
        expect(buildRowArticleContent.mock.calls[0][3]).toEqual(["description", "title"]);
    });

    test("integrates the language editor and excludes simultaneous whole-article editing", async () => {
        document.body.innerHTML = '<div id="events_article_view_container"><div class="card_view_wrapper"><div class="card_container"><div class="card" data-id="42"></div></div><div class="row_article_placeholder"></div></div></div>';
        vi.mocked(hasDatasetPermission).mockImplementation((route) => Promise.resolve(route === "/api/update-row"));
        const controller = { button: document.createElement("button"), panel: document.createElement("section"), setDisabled: vi.fn() };
        vi.mocked(createArticleLanguageEditor).mockReturnValue(controller);
        await openRowArticleView({ id: 42, title: '{"en":"Test"}' }, "events", document.querySelector(".card"));
        expect(controller.panel.isConnected).toBe(true);
        expect(controller.button.isConnected).toBe(true);
        const options = vi.mocked(createArticleLanguageEditor).mock.calls[0][0];
        expect(options).toMatchObject({ tableName: "events", canUpdateRow: true, row: { id: 42 } });
        const edit = document.querySelector('[data-testid="big-card-edit-button"]');
        options.onActiveChange(true);
        expect(edit.disabled).toBe(true);
        options.onActiveChange(false);
        edit.click();
        expect(controller.setDisabled).toHaveBeenCalledWith(true);
        document.querySelector('[data-testid="big-card-cancel-button"]').click();
        expect(controller.setDisabled).toHaveBeenLastCalledWith(false);
    });

});
