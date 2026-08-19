// @vitest-environment jsdom
// Proves that image-first is a standalone, always-available image modal view.

import { beforeEach, describe, expect, test, vi } from "vitest";

const {
    buildContentMock,
    openImageModalContentMock,
} = vi.hoisted(() => ({
    buildContentMock: vi.fn(),
    openImageModalContentMock: vi.fn(),
}));

vi.mock("./card_image_modal.js", () => ({
    openImageModalContent: openImageModalContentMock,
}));

vi.mock("./row_article_content_builder.js", () => ({
    buildRowArticleContent: buildContentMock,
}));

vi.mock("./row_article_data_types_resolver.js", () => ({
    resolveRowArticleDataTypes: vi.fn(() => ({
        title: { card_element: "header" },
        description: { card_element: "description" },
    })),
}));

vi.mock("./row_article_asset_resolver.js", () => ({
    resolveRowArticleDynamicAssetChildren: vi.fn(() => ({ imagesChild: null, assetsChild: null })),
    resolveRowArticleImageGalleryChild: vi.fn(() => null),
    resolveRowArticleParentImageRows: vi.fn(() => []),
}));

vi.mock("../../route_permission_checker.js", () => ({
    hasRoutePermission: vi.fn(() => false),
}));

vi.mock("../../user_tools/current_user_profile_fetcher.js", () => ({
    fetchCurrentUserProfile: vi.fn(async () => ({ user_id: 1 })),
}));

vi.mock("../../lang/translation_handler.js", () => ({
    getTranslationForKey: vi.fn((key) => key),
}));

vi.mock("../../../ui_config.js", () => ({
    enable_experimental_row_article_row_navigation: false,
    image_first_view_details_position: "after_description",
}));

import { openImageFirstView } from "./image_first_view_opener.js";

function buildArticleContent() {
    const content = document.createElement("div");
    content.classList.add("row_article_content");

    const title = document.createElement("div");
    title.classList.add("big_card_header");
    const description = document.createElement("div");
    description.classList.add("big_card_description_container");
    const details = document.createElement("section");
    details.classList.add("row_article_details_section");
    const inlineImage = document.createElement("div");
    inlineImage.classList.add("big_card_image");
    content.append(title, details, description, inlineImage);
    return content;
}

describe("openImageFirstView", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        buildContentMock.mockReset();
        openImageModalContentMock.mockReset();
        buildContentMock.mockImplementation(async () => ({
            rowArticleContentElement: buildArticleContent(),
        }));
        openImageModalContentMock.mockImplementation(({ contentElement }) => {
            document.body.appendChild(contentElement);
            return { modal: document.createElement("div") };
        });
    });

    test("opens globally without dataset activation and keeps a one-image stage bounded", async () => {
        await openImageFirstView({
            imageSrc: "/storage/hero.png",
            imageRows: [{ id: 11, asset_kind: "image", filename: "hero.png" }],
            activeImageRow: { id: 11, asset_kind: "image", filename: "hero.png" },
            rowItem: { id: 3, title: "Example", description: "Body" },
            tableName: "examples",
        });

        const view = document.querySelector('[data-testid="image-first-view"]');
        const article = view.querySelector(".image_first_view_article_content");
        expect(view).not.toBeNull();
        expect(view.querySelector('[data-testid="row-article-image-first-media"]')?.getAttribute("src"))
            .toBe("/storage/hero.png");
        expect(view.querySelector('[data-testid="row-article-image-previous"]').disabled).toBe(true);
        expect(view.querySelector('[data-testid="row-article-image-next"]').disabled).toBe(true);
        expect(article.querySelector(":scope > .big_card_image")).toBeNull();
        expect(article.querySelector(".big_card_description_container")?.nextElementSibling)
            .toBe(article.querySelector(".row_article_details_section"));
        expect(openImageModalContentMock).toHaveBeenCalledWith(expect.objectContaining({
            classNames: ["image_first_view_modal"],
        }));
    });
});
