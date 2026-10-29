// @vitest-environment jsdom
// row_article_opener.test.js
// Verifies article opening, metadata, editing and navigation through the shared opener.
// Bridges the real opener and catalogue with shared drawing/network stubs.
// Keeps every original promise while allowing the media suite to live separately.

import { describe, expect, test, vi } from "vitest";
import {
    setupRowArticleOpenerTests, closeRowArticleMock, dispatchCardArticleToggleMock,
    fetchPermittedRowArticleDataMock, getParamsMock, setParamsMock,
    createDefaultRowArticleContent, flushRowArticleHydration,
} from "./row_article_opener_test_setup.js";
import { createArticleLanguageEditor } from "../article_view/article_language_editor.js";
import { openRowArticleView } from "./row_article_opener.js";
import { collectCardUpdates, disableEditing, parseRoleString, sendCardUpdates } from "./card_field_formatter.js";
import { hasDatasetPermission } from "../../route_permission_checker.js";
import { buildRowArticleRelatedTabs } from "./row_article_child_tabs.js";
import { buildRowArticleImageGallery } from "./row_article_image_gallery.js";
import { buildRowArticleAttachmentList } from "./row_article_attachment_list.js";
import { buildRowArticleContent } from "./row_article_content_builder.js";
import { loadRowArticleSectionDefaults } from "./row_article_section_defaults.js";
import { createRowArticleLoadSession } from "./row_article_load_session.js";
import { buildSlug } from "./row_article_opener_helpers.js";
import { setChosenDatasetView } from "../../state_stores/dataset_view_choice_saver.js";

describe("openRowArticleView", () => {
    setupRowArticleOpenerTests();

    test('mounts the shared heading DOM unchanged in the ordinary article', async () => {
        document.body.innerHTML = '<div id="events_article_view_container"><div class="card_view_wrapper">'
            + '<div class="card_container"><div class="card" data-id="42"></div></div>'
            + '<div class="row_article_placeholder"></div></div></div>';
        const content = document.createElement('div');
        content.className = 'big_card_content row_article_content';
        content.innerHTML = '<h1 class="big_card_header">Contact</h1><h2 data-demoted-from="h1">Section</h2>';
        vi.mocked(buildRowArticleContent).mockResolvedValueOnce({ rowArticleContentElement: content, rowArticleHeaderText: 'Contact' });
        await openRowArticleView({ id: 42, title: 'Contact' }, 'events');
        expect(document.querySelector('.active_row_article .row_article_content')).toBe(content);
        expect(content.querySelectorAll('h1')).toHaveLength(1);
        expect(content.querySelector('h2').dataset.demotedFrom).toBe('h1');
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

    test("uses defaults once and retains manual media state on same-row refresh", async () => {
        document.body.innerHTML = `
            <div id="events_article_view_container"><div class="card_view_wrapper">
                <div class="card_container"><div class="card" data-id="42"></div></div>
                <div class="row_article_placeholder"></div>
            </div></div>`;
        vi.mocked(buildRowArticleContent).mockImplementation(async () => createDefaultRowArticleContent());
        const defaults = { details: false, images: false, attachments: true, related_rows: false };
        vi.mocked(loadRowArticleSectionDefaults).mockResolvedValue(defaults);
        vi.mocked(createRowArticleLoadSession).mockReturnValue({
            fetchAttachmentLinking: vi.fn(async () => null),
            fetchDynamicChildren: vi.fn(async () => ({ child_tables: [] })),
        });
        vi.mocked(buildRowArticleImageGallery).mockImplementation(() => document.createElement("div"));
        vi.mocked(buildRowArticleAttachmentList).mockImplementation(() => document.createElement("div"));
        vi.mocked(buildRowArticleRelatedTabs).mockImplementation(() => document.createElement("div"));
        const row = { id: 42, title: "Example" };
        await openRowArticleView(row, "events");
        await flushRowArticleHydration();
        expect(loadRowArticleSectionDefaults).toHaveBeenCalledExactlyOnceWith("events", "classic");
        expect(buildRowArticleContent.mock.calls[0][8].sectionDefaults).toBe(defaults);
        const gallery = document.querySelector(".row_article_image_gallery_section");
        const attachments = document.querySelector(".row_article_attachment_list_section");
        expect(gallery.dataset.disclosureState).toBe("collapsed");
        expect(attachments.dataset.disclosureState).toBe("expanded");
        expect(document.querySelector(".row_article_related_items_section").dataset.disclosureState).toBe("collapsed");
        gallery.querySelector("button").click();
        attachments.querySelector("button").click();
        const refresh = buildRowArticleImageGallery.mock.calls[0][3];
        await refresh();
        expect(document.querySelector(".row_article_image_gallery_section").dataset.disclosureState).toBe("expanded");
        expect(document.querySelector(".row_article_attachment_list_section").dataset.disclosureState).toBe("collapsed");
        expect(loadRowArticleSectionDefaults).toHaveBeenCalledTimes(1);
        await openRowArticleView({ id: 43, title: "Next row" }, "events");
        await flushRowArticleHydration();
        expect(loadRowArticleSectionDefaults).toHaveBeenCalledTimes(2);
        expect(document.querySelector(".row_article_image_gallery_section").dataset.disclosureState).toBe("collapsed");
        expect(document.querySelector(".row_article_attachment_list_section").dataset.disclosureState).toBe("expanded");
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
            { selectedCard: resolvedCard, sectionDefaults: {} },
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
            { selectedCard, sectionDefaults: {} },
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


    test("opening a collection article URL selects its row in the same history entry", async () => {
        document.body.innerHTML = '<div id="events_article_view_container"><div class="card_view_wrapper"><div class="card_container"><div class="card" data-id="42"></div></div><div class="big_card_placeholder row_article_placeholder"></div></div></div>';
        history.replaceState({ __filterestEntryId: "article-bookmark" }, "", "/events?view=article_view&search=harbour");
        getParamsMock.mockReturnValue({ view: "article_view", search: "harbour" });
        const push = vi.spyOn(history, "pushState");
        try {
            await openRowArticleView({ id: 42 }, "events", document.querySelector(".card"));
            expect(push).not.toHaveBeenCalled();
            expect(location.pathname).toBe("/events/42");
            expect(history.state).toMatchObject({ __filterestEntryId: "article-bookmark", bigCard: true, articleReturnAvailable: false });
        } finally { push.mockRestore(); }
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
            expect.objectContaining({ bigCard: true, dataset: "events", rowId: "42", articleReturnAvailable: false }),
            "",
            "/events/42?view=article_view",
        );
        expect(window.location.pathname).toBe("/events/42");
        expect(window.location.search).toBe("?view=article_view");
        expect(window.history.state).toMatchObject({
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
            { selectedCard, sectionDefaults: {} },
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
            { selectedCard, sectionDefaults: {} },
        );
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
        expect(options).toMatchObject({ tableName: "events", canUpdateRow: true, currentUserID: 1, row: { id: 42 } });
        const edit = document.querySelector('[data-testid="big-card-edit-button"]');
        options.onActiveChange(true);
        expect(edit.disabled).toBe(true);
        options.onActiveChange(false);
        edit.click();
        expect(controller.setDisabled).toHaveBeenCalledWith(true);
        document.querySelector('[data-testid="big-card-cancel-button"]').click();
        expect(controller.setDisabled).toHaveBeenLastCalledWith(false);
    });

    test("expanded article uses fresh article metadata instead of its reused compact-list types", async () => {
        const types = { title: { card_element: "header", is_multilingual: true } };
        const row = { id: 42, title: '{"en":"Article"}' };
        Object.defineProperty(row, "__articleTypes", { value: types });
        Object.defineProperty(row, "__articleColumns", { value: ["title"] });
        fetchPermittedRowArticleDataMock.mockResolvedValueOnce(row);
        await openRowArticleView({ id: 42, title: "Preview" }, "events", document.querySelector(".card"));
        expect(buildRowArticleContent.mock.calls.at(-1)).toContain(types);
    });

    test("captures the card return before changing view and passes only its token to refresh", async () => {
        const { captureCardArticleReturn } = await import("../../navigation/nav_engine/card_article_return_state.js");
        const { refreshTableUnified } = await import("../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js");
        const token = {};
        const rowsToken = {};
        const { captureLoadedDatasetRows } = await import("../dataset_loaded_rows.js");
        captureLoadedDatasetRows.mockImplementationOnce((dataset) => {
            expect(sessionStorage.getItem(dataset + "_view")).toBe("card");
            return rowsToken;
        });
        captureCardArticleReturn.mockImplementationOnce((dataset, adapter) => {
            expect(sessionStorage.getItem(dataset + "_view")).toBe("card");
            expect(adapter.listPath).toBe("/service_catalog");
            return token;
        });
        setChosenDatasetView("app_service_catalog", "card");
        await openRowArticleView({ id: 42 }, "app_service_catalog");
        expect(refreshTableUnified).toHaveBeenCalledWith("app_service_catalog", { skipUrlParams: true, preserveCardReturn: token, loadedRows: rowsToken });
        expect(sessionStorage.getItem("app_service_catalog_view")).toBe("article_view");
    });

});
