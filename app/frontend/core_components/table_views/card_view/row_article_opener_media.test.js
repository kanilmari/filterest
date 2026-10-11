// @vitest-environment jsdom
// row_article_opener_media.test.js
// Verifies article gallery, inline-image and caption behavior through the shared opener.
// Bridges the real opener and catalogue with shared drawing/network stubs.
// Keeps every original promise while allowing the media suite to live separately.

import { describe, expect, test, vi } from "vitest";
import { setupRowArticleOpenerTests, articleUiSettings, flushRowArticleHydration } from "./row_article_opener_test_setup.js";
import { openRowArticleView } from "./row_article_opener.js";
import { parseRoleString } from "./card_field_formatter.js";
import { hasDatasetPermission, primeDatasetPermissions } from "../../route_permission_checker.js";
import { buildRowArticleRelatedTabs } from "./row_article_child_tabs.js";
import { buildRowArticleImageGallery } from "./row_article_image_gallery.js";
import { buildRowArticleAttachmentList } from "./row_article_attachment_list.js";
import { resolveRowArticleImageGalleryChild, resolveRowArticleParentImageRows, resolveRowArticleSharedAssetChild } from "./row_article_asset_resolver.js";
import { buildRowArticleContent } from "./row_article_content_builder.js";
import { createRowArticleLoadSession } from "./row_article_load_session.js";
import { setChosenDatasetView } from "../../state_stores/dataset_view_choice_saver.js";

describe("openRowArticleView", () => {
    setupRowArticleOpenerTests();

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
        vi.mocked(resolveRowArticleSharedAssetChild).mockReturnValue(child);
        vi.mocked(resolveRowArticleImageGalleryChild).mockReturnValue(child);
        const session = {
            fetchDynamicChildren: vi.fn(async () => ({
                gallery_relation: { dataset: "tickets_assets", column: "tickets_id" },
                child_tables: [child],
            })),
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
        // The response names the gallery, so no linking status is asked for the pictures.
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
        let resolveChildren;
        let current = true;
        session.fetchDynamicChildren.mockImplementationOnce(() => new Promise((resolve) => { resolveChildren = resolve; }));
        await openRowArticleView(
            { id: 2, cached_image: "10_2_1.webp" }, "tickets", selectedCard,
            { isCurrent: () => current },
        );
        await flushRowArticleHydration();
        expect(session.fetchDynamicChildren).toHaveBeenCalledTimes(1);
        if (state === "superseded") current = false;
        else document.querySelector(".active_row_article").remove();
        resolveChildren({
            gallery_relation: { dataset: "tickets_assets", column: "tickets_id" },
            child_tables: [{ dataset: "tickets_assets", column: "tickets_id", rows: [{ filename: "10_2_1.webp", description: "Late photo credit" }] }],
        });
        await flushRowArticleHydration();

        expect(inlineImage.querySelector(".row_article_inline_image_caption")).toBeNull();
        expect(buildRowArticleImageGallery).not.toHaveBeenCalled();
    });

    test("passes only the card's picture, not the row's image fields, to the gallery when the response carries no gallery", async () => {
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
        }];
        vi.mocked(parseRoleString).mockImplementation((roleString = "") => ({
            baseRoles: String(roleString).split(/\s+/).filter(Boolean),
        }));
        vi.mocked(resolveRowArticleParentImageRows).mockReturnValueOnce(parentImageRows);
        vi.mocked(createRowArticleLoadSession).mockReturnValueOnce({
            fetchAttachmentLinking: vi.fn(() => Promise.resolve(null)),
            fetchDynamicChildren: vi.fn(() => Promise.resolve({ child_tables: [], card_picture: "10_2_3.webp" })),
        });

        await openRowArticleView(
            { id: 2, title: "VPN disconnects", cached_image: "10_2_1.webp" },
            "tickets",
            selectedCard,
        );
        await flushRowArticleHydration();

        // The row's image fields only stand in until the response arrives.
        expect(resolveRowArticleParentImageRows).toHaveBeenCalledWith(
            expect.objectContaining({ cached_image: "10_2_1.webp" }),
            ["cached_image"],
        );
        expect(buildRowArticleImageGallery).toHaveBeenCalledWith(
            "tickets",
            2,
            null,
            expect.any(Function),
            expect.objectContaining({
                imageRows: [{ asset_kind: "image", filename: "10_2_3.webp", is_card_only_picture: true }],
                cardPicture: "10_2_3.webp",
            }),
        );
    });

    test("does not resurrect a deleted cached image once the response carries the gallery", async () => {
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
        }];
        const authoritativeImageChild = {
            dataset: "tickets_assets",
            column: "tickets_id",
            relation_kind: "shared_asset",
            rows: [],
        };
        const freshResponse = {
            gallery_relation: { dataset: "tickets_assets", column: "tickets_id" },
            card_picture: "",
            child_tables: [authoritativeImageChild],
        };
        vi.mocked(parseRoleString).mockImplementation((roleString = "") => ({
            baseRoles: String(roleString).split(/\s+/).filter(Boolean),
        }));
        vi.mocked(resolveRowArticleParentImageRows).mockReturnValueOnce(staleParentImageRows);
        vi.mocked(createRowArticleLoadSession).mockReturnValueOnce({
            fetchAttachmentLinking: vi.fn(() => Promise.resolve(null)),
            fetchDynamicChildren: vi.fn(() => Promise.resolve(freshResponse)),
        });
        vi.mocked(resolveRowArticleSharedAssetChild).mockReturnValueOnce(authoritativeImageChild);
        vi.mocked(resolveRowArticleImageGalleryChild).mockReturnValueOnce(authoritativeImageChild);
        vi.mocked(buildRowArticleImageGallery).mockReturnValueOnce(document.createElement("div"));

        await openRowArticleView(
            { id: 2, title: "VPN disconnects", cached_image: "deleted-image.webp" },
            "tickets",
            selectedCard,
        );
        await flushRowArticleHydration();

        // The gallery comes from the response alone, never from linking metadata.
        expect(resolveRowArticleImageGalleryChild).toHaveBeenCalledWith(freshResponse);
        expect(buildRowArticleImageGallery).toHaveBeenCalledWith(
            "tickets",
            2,
            authoritativeImageChild,
            expect.any(Function),
            expect.objectContaining({ imageRows: [] }),
        );
    });

    test.each(["app_service_catalog", "ordinary_dataset"])("keeps %s inline image and gallery thumbnails visible", async (tableName) => {
        setChosenDatasetView(tableName, "article_view");
        document.body.innerHTML = `
            <div id="${tableName}_article_view_container">
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
            fetchDynamicChildren: vi.fn(() => Promise.resolve({
                gallery_relation: { dataset: "app_service_catalog_assets", column: "app_service_catalog_id" },
                child_tables: [assetsChild],
            })),
        });
        vi.mocked(resolveRowArticleSharedAssetChild).mockReturnValueOnce(assetsChild);
        vi.mocked(resolveRowArticleImageGalleryChild).mockReturnValueOnce(assetsChild);
        vi.mocked(buildRowArticleImageGallery).mockImplementationOnce(() => {
            const gallery = document.createElement("div");
            gallery.classList.add("big_card_image_gallery", "row_article_image_gallery");
            const thumbnails = document.createElement("div");
            thumbnails.classList.add("big_card_thumbnail_row");
            thumbnails.appendChild(document.createElement("img"));
            gallery.appendChild(thumbnails);
            return gallery;
        });

        await openRowArticleView(
            { id: 42, title: "Firefox", cached_image: "/storage/104/42/original/firefox.svg" },
            tableName,
            selectedCard,
        );
        await flushRowArticleHydration();

        const gallery = document.querySelector(".row_article_image_gallery");
        const thumbnails = gallery?.querySelector(".big_card_thumbnail_row");
        expect(gallery).not.toBeNull();
        expect(inlineImage.hidden).toBe(false);
        expect(thumbnails?.hidden).toBe(false);
        expect(thumbnails?.querySelector("img")).not.toBeNull();
        expect(gallery.querySelector(".big_card_hero_image")).toBeNull();
        expect(inlineImage.dataset.serviceCatalogInlineImagePrimary).toBeUndefined();
    });

    test("keeps an inline image visible when its gallery is empty", async () => {
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
        });
        vi.mocked(buildRowArticleImageGallery).mockImplementationOnce(() => {
            const gallery = document.createElement("div");
            gallery.classList.add("big_card_image_gallery", "row_article_image_gallery");
            return gallery;
        });

        await openRowArticleView(
            { id: 42, title: "Firefox", cached_image: "/storage/104/42/original/firefox.svg" },
            "app_service_catalog",
            selectedCard,
        );
        await flushRowArticleHydration();

        expect(inlineImage.hidden).toBe(false);
        expect(document.querySelector(".row_article_image_gallery")?.hidden).toBe(false);
        expect(document.querySelector(".big_card_hero_image")).toBeNull();
    });


});
