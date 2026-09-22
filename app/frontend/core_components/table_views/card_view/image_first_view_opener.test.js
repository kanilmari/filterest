// @vitest-environment jsdom
// Proves that image-first is a standalone, always-available image modal view.

import { beforeEach, describe, expect, test, vi } from "vitest";

const {
    buildContentMock,
    openImageModalContentMock,
    transitionImageFirstModalContentMock,
} = vi.hoisted(() => ({
    buildContentMock: vi.fn(),
    openImageModalContentMock: vi.fn(),
    transitionImageFirstModalContentMock: vi.fn(),
}));

vi.mock("./row_article_section_defaults.js", () => ({
    loadRowArticleSectionDefaults: vi.fn(async () => ({})),
}));

vi.mock("../../pipeline/navigation_pipeline.js", () => ({
    runNavigationPipeline: vi.fn(async context => context),
}));
vi.mock("../../navigation/nav_engine/dataset_aliases.js", () => ({
    buildDatasetPath: name => "/" + name,
}));
vi.mock("../../navigation/nav_engine/query_params.js", () => ({ DATASET_PREFIX: "/" }));
vi.mock("../../endpoints/endpoint_data_fetcher.js", () => ({ fetchDatasetData: vi.fn() }));

vi.mock("./card_image_modal.js", () => ({
    openImageModalContent: openImageModalContentMock,
    transitionImageFirstModalContent: transitionImageFirstModalContentMock,
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
    hasRoutePermission: vi.fn(route => route === "/ui/view/article_view"),
}));

vi.mock("../../user_tools/current_user_profile_fetcher.js", () => ({
    fetchCurrentUserProfile: vi.fn(async () => ({ user_id: 1 })),
}));

vi.mock("../../lang/translation_handler.js", () => ({
    getTranslationForKey: vi.fn((key) => key),
}));

vi.mock("../../../ui_config.js", () => ({
    enable_experimental_row_article_row_navigation: true,
    image_first_view_details_position: "after_description",
}));

import { openImageFirstView } from "./image_first_view_opener.js";
import { loadRowArticleSectionDefaults } from "./row_article_section_defaults.js";

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
        history.replaceState({}, "", "/examples?view=table&search=needle");
        vi.mocked(loadRowArticleSectionDefaults).mockReset();
        vi.mocked(loadRowArticleSectionDefaults).mockResolvedValue({});
        buildContentMock.mockReset();
        openImageModalContentMock.mockReset();
        transitionImageFirstModalContentMock.mockReset();
        buildContentMock.mockImplementation(async () => ({
            rowArticleContentElement: buildArticleContent(),
        }));
        openImageModalContentMock.mockImplementation(({ contentElement }) => {
            document.body.appendChild(contentElement);
            return { modal: document.createElement("div"), close: vi.fn() };
        });
    });

    test("loads only image-first defaults once for this row opening", async () => {
        vi.mocked(loadRowArticleSectionDefaults).mockResolvedValueOnce({ details: false });
        await openImageFirstView({
            imageRows: [{ filename: "hero.png" }],
            rowItem: { id: 3, title: "Example" }, tableName: "examples",
        });
        expect(loadRowArticleSectionDefaults).toHaveBeenCalledExactlyOnceWith("examples", "image_first");
        expect(buildContentMock.mock.calls[0][8]).toEqual({ sectionDefaults: { details: false } });
    });

    test("opens globally without dataset activation and keeps a one-image stage bounded", async () => {
        await openImageFirstView({
            imageSrc: "/storage/hero.png",
            imageRows: [{ id: 11, asset_kind: "image", filename: "hero.png" }],
            activeImageRow: { id: 11, asset_kind: "image", filename: "hero.png" },
            rowItem: { id: 3, title: "Example", description: "Body" },
            tableName: "examples",
        });

        expect(new URL(location.href).searchParams.get("view")).toBe("image_first_view");
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
            overlayClassNames: ["image_first_view_overlay"],
        }));
        expect(transitionImageFirstModalContentMock).toHaveBeenCalledWith(
            expect.objectContaining({ contentElement: view }),
        );
        const closeView = openImageModalContentMock.mock.results[0].value.close;
        view.querySelector('[data-testid="row-article-image-first-stage"]').click();
        expect(closeView).toHaveBeenCalledOnce();
    });

    test("hands record navigation to the modal controls instead of the image shell", async () => {
        const cardContainer = document.createElement("div");
        cardContainer.className = "card_container";
        const cards = [2, 3, 4].map((id) => {
            const card = document.createElement("div");
            card.className = "card";
            card.dataset.id = String(id);
            card._row = { id, title: `Row ${id}` };
            cardContainer.appendChild(card);
            return card;
        });
        document.body.appendChild(cardContainer);

        await openImageFirstView({
            imageSrc: "/storage/hero.png",
            imageRows: [{ id: 11, asset_kind: "image", filename: "hero.png" }],
            rowItem: { id: 3, title: "Example", description: "Body" },
            tableName: "examples",
            selectedCard: cards[1],
        });

        const modalOptions = openImageModalContentMock.mock.calls[0][0];
        const navigation = modalOptions.topControlElements[0];
        expect(navigation).toBeInstanceOf(HTMLElement);
        expect(navigation.classList).toContain("row_article_row_navigation");
        expect(modalOptions.contentElement.contains(navigation)).toBe(false);
        expect(modalOptions.contentElement.firstElementChild.classList)
            .toContain("row_article_image_first_stage");
    });
    test("closes from the text gutter through the current modal close lifecycle", async () => {
        await openImageFirstView({
            imageSrc: "/storage/hero.png",
            imageRows: [{ id: 11, asset_kind: "image", filename: "hero.png" }],
            rowItem: { id: 3, title: "Example", description: "Body" },
            tableName: "examples",
        });
        const view = document.querySelector('[data-testid="image-first-view"]');
        const closeView = openImageModalContentMock.mock.results[0].value.close;

        view.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
        view.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));

        expect(closeView).toHaveBeenCalledOnce();
    });

    test("keeps article text, links, disclosure buttons and editors interactive", async () => {
        await openImageFirstView({
            imageSrc: "/storage/hero.png",
            imageRows: [{ id: 11, asset_kind: "image", filename: "hero.png" }],
            rowItem: { id: 3, title: "Example", description: "Body" },
            tableName: "examples",
        });
        const view = document.querySelector('[data-testid="image-first-view"]');
        const article = view.querySelector(".image_first_view_article_content");
        const closeView = openImageModalContentMock.mock.results[0].value.close;
        const link = document.createElement("a");
        link.href = "https://example.test/original-photo";
        const linkAction = vi.fn((event) => event.preventDefault());
        link.addEventListener("click", linkAction);
        const disclosure = document.createElement("button");
        const disclosureAction = vi.fn();
        disclosure.addEventListener("click", disclosureAction);
        const input = document.createElement("input");
        input.value = "Unsaved title";
        const editor = document.createElement("div");
        editor.contentEditable = "true";
        editor.textContent = "Unsaved article";
        article.append(link, disclosure, input, editor);

        for (const target of [article, ...article.children]) {
            target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
            target.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, cancelable: true }));
        }

        expect(closeView).not.toHaveBeenCalled();
        expect(linkAction).toHaveBeenCalledOnce();
        expect(disclosureAction).toHaveBeenCalledOnce();
        expect(input.value).toBe("Unsaved title");
        expect(editor.textContent).toBe("Unsaved article");
        // Releasing a text-selection drag in the gutter must not dismiss it.
        editor.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
        view.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
        expect(closeView).not.toHaveBeenCalled();
        // A subsequent intentional background click still closes normally.
        view.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
        view.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
        expect(closeView).toHaveBeenCalledOnce();
    });

    test("keeps gutter closing connected after an existing image-first record transition", async () => {
        const closeView = vi.fn();
        transitionImageFirstModalContentMock.mockImplementation(({ contentElement }) => {
            document.body.appendChild(contentElement);
            return { modal: document.createElement("div"), close: closeView };
        });
        await openImageFirstView({
            imageSrc: "/storage/hero.png",
            imageRows: [{ id: 11, asset_kind: "image", filename: "hero.png" }],
            rowItem: { id: 4, title: "Next example", description: "Body" },
            tableName: "examples",
        });
        const view = document.querySelector('[data-testid="image-first-view"]');
        view.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
        view.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
        expect(closeView).toHaveBeenCalledOnce();
        expect(openImageModalContentMock).not.toHaveBeenCalled();
    });

});

test("Forward fetches the row and metadata again and restores the selected image", async () => {
    document.body.innerHTML = "";
    const { fetchDatasetData } = await import("../../endpoints/endpoint_data_fetcher.js");
    fetchDatasetData.mockResolvedValue({ data: [{ id: 3, title: "Fresh" }], types: { title: { card_element: "header", is_multilingual: true } } });
    history.replaceState({ imageFirstView: { dataset: "examples", rowId: "3" } }, "", "/examples/3?view=image_first_view#image=second.png");
    await openImageFirstView({ tableName: "examples", rowItem: { id: 3 },
        restoringHistory: true, imageRows: [{ filename: "first.png" }, { filename: "second.png" }] });
    expect(fetchDatasetData).toHaveBeenCalledWith(expect.objectContaining({ filters: { id: 3 }, view_key: "article_view" }));
    expect(buildContentMock).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Fresh" }), "examples",
        { title: { card_element: "header", is_multilingual: true } }, expect.anything(), expect.anything(),
        expect.anything(), expect.anything(), expect.anything(), { sectionDefaults: {} });
    expect(document.querySelector('[data-testid="row-article-image-first-media"]').getAttribute("src")).toContain("second.png");
});

test("a denied Forward or a row removed by current permissions never opens stale content", async () => {
    const { runNavigationPipeline } = await import("../../pipeline/navigation_pipeline.js");
    const { fetchDatasetData } = await import("../../endpoints/endpoint_data_fetcher.js");
    openImageModalContentMock.mockClear(); transitionImageFirstModalContentMock.mockClear(); fetchDatasetData.mockClear();
    runNavigationPipeline.mockResolvedValueOnce({ abort: true, reason: "permission_denied" });
    expect(await openImageFirstView({ tableName: "examples", rowItem: { id: 3 }, restoringHistory: true })).toBeNull();
    expect(fetchDatasetData).not.toHaveBeenCalled();
    fetchDatasetData.mockResolvedValueOnce({ data: [], types: {} });
    expect(await openImageFirstView({ tableName: "examples", rowItem: { id: 3 }, restoringHistory: true })).toBeNull();
    expect(openImageModalContentMock).not.toHaveBeenCalled();
    expect(transitionImageFirstModalContentMock).not.toHaveBeenCalled();
});

test("an old media build cannot resurrect IFAV after the URL changed", async () => {
    let release;
    buildContentMock.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    openImageModalContentMock.mockClear(); transitionImageFirstModalContentMock.mockClear();
    history.replaceState({}, "", "/examples?view=card");
    const opening = openImageFirstView({ tableName: "examples", rowItem: { id: 3 },
        imageRows: [{ filename: "first.png" }], imageSrc: "/storage/first.png" });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    history.replaceState({}, "", "/elsewhere?view=table");
    release({ rowArticleContentElement: buildArticleContent() });
    expect(await opening).toBeNull();
    expect(openImageModalContentMock).not.toHaveBeenCalled();
    expect(transitionImageFirstModalContentMock).not.toHaveBeenCalled();
    expect(location.pathname).toBe("/elsewhere");
});
