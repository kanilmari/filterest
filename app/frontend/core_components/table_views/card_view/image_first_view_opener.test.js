// @vitest-environment jsdom
// Proves that image-first is a standalone, always-available image modal view.

import { beforeEach, describe, expect, test, vi } from "vitest";

const {
    buildContentMock,
    loadSession,
    openImageModalContentMock,
    transitionImageFirstModalContentMock,
} = vi.hoisted(() => ({
    buildContentMock: vi.fn(),
    loadSession: { fetchDynamicChildren: vi.fn() },
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

vi.mock("./row_article_load_session.js", () => ({
    createRowArticleLoadSession: vi.fn(() => loadSession),
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
import { resolveRowArticleDataTypes } from "./row_article_data_types_resolver.js";

/** Reads every stage image from the active one onwards through the stage's own Next control. */
function readStageImageSources() {
    const view = document.querySelector('[data-testid="image-first-view"]');
    const next = view.querySelector('[data-testid="row-article-image-next"]');
    const readActive = () => view
        .querySelector('[data-testid="row-article-image-first-media"]')
        .getAttribute("src");
    const sources = [readActive()];
    while (!next.disabled) {
        next.click();
        sources.push(readActive());
    }
    return sources;
}

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
        loadSession.fetchDynamicChildren.mockReset();
    });

    describe("image rows", () => {
        const pictureTypes = {
            title: { card_element: "header" },
            cached_image: { card_element: "image" },
        };
        const galleryRelation = { dataset: "examples_assets", column: "examples_id" };
        const second = { id: 2, asset_kind: "image", filename: "second.png", sort_order: 9 };
        const first = { id: 1, asset_kind: "image", filename: "first.png", is_primary: true };

        beforeEach(() => {
            vi.mocked(resolveRowArticleDataTypes).mockReturnValueOnce(pictureTypes);
        });

        test("shows only the fresh gallery, card-only picture first, never the row fields or the opened image", async () => {
            loadSession.fetchDynamicChildren.mockResolvedValueOnce({
                gallery_relation: galleryRelation,
                card_picture: "https://cdn.example/card.png",
                child_tables: [{ ...galleryRelation, relation_kind: "shared_asset", rows: [second, first] }],
            });

            await openImageFirstView({
                imageSrc: "/storage/stale.png",
                rowItem: { id: 3, title: "Example", cached_image: "stale.png" },
                tableName: "examples",
            });

            expect(readStageImageSources()).toEqual([
                "https://cdn.example/card.png",
                "/storage/second.png",
                "/storage/first.png",
            ]);
        });

        test("never opens a picture the fresh gallery no longer lists", async () => {
            loadSession.fetchDynamicChildren.mockResolvedValueOnce({
                gallery_relation: galleryRelation,
                card_picture: "",
                child_tables: [{ ...galleryRelation, relation_kind: "shared_asset", rows: [] }],
            });

            const result = await openImageFirstView({
                imageSrc: "/storage/deleted.png",
                rowItem: { id: 3, title: "Example", cached_image: "deleted.png" },
                tableName: "examples",
            });

            expect(result).toBeNull();
            expect(openImageModalContentMock).not.toHaveBeenCalled();
            expect(transitionImageFirstModalContentMock).not.toHaveBeenCalled();
        });

        test("falls back to the row fields, the opened image first, only when the lookup fails", async () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            loadSession.fetchDynamicChildren.mockRejectedValueOnce(new Error("Unavailable"));

            await openImageFirstView({
                imageSrc: "/storage/opened.png",
                rowItem: { id: 3, title: "Example", cached_image: "row.png" },
                tableName: "examples",
            });

            expect(readStageImageSources()).toEqual(["/storage/opened.png", "/storage/row.png"]);
            expect(warn).toHaveBeenCalledWith("image-first media lookup failed", "Unavailable");
            warn.mockRestore();
        });

        test("shows only the card's picture, never the opened image or the row fields, when the response has no gallery", async () => {
            loadSession.fetchDynamicChildren.mockResolvedValueOnce({ child_tables: [], card_picture: "card.png" });

            await openImageFirstView({
                imageSrc: "/storage/opened.png",
                rowItem: { id: 3, title: "Example", cached_image: "row.png" },
                tableName: "examples",
            });

            expect(readStageImageSources()).toEqual(["/storage/card.png"]);
        });

        test.each([
            ["an empty card picture", { child_tables: [], card_picture: "" }],
            ["no card picture", { child_tables: [] }],
            // Only the relation the response names is the gallery; the browser never picks another.
            ["pictures only in a relation it does not name", { child_tables: [{ ...galleryRelation, rows: [second, first] }] }],
        ])("opens nothing for a response with no gallery and %s", async (_label, response) => {
            loadSession.fetchDynamicChildren.mockResolvedValueOnce(response);

            const result = await openImageFirstView({
                imageSrc: "/storage/stale.png",
                rowItem: { id: 3, title: "Example", cached_image: "stale.png" },
                tableName: "examples",
            });

            expect(result).toBeNull();
            expect(openImageModalContentMock).not.toHaveBeenCalled();
        });

        test("opens on the card's picture when a later gallery row shows it, keeping the gallery order", async () => {
            const primary = { id: 1, asset_kind: "image", filename: "primary.png", is_primary: true };
            const logo = { id: 2, asset_kind: "image", filename: "logo.png" };
            loadSession.fetchDynamicChildren.mockResolvedValueOnce({
                gallery_relation: galleryRelation,
                card_picture: "logo.png",
                child_tables: [{ ...galleryRelation, relation_kind: "shared_asset", rows: [primary, logo] }],
            });

            // The card showed a picture the gallery no longer lists.
            await openImageFirstView({
                imageSrc: "/storage/stale.png",
                rowItem: { id: 3, title: "Example", cached_image: "stale.png" },
                tableName: "examples",
            });

            const view = document.querySelector('[data-testid="image-first-view"]');
            const activeSource = () => view
                .querySelector('[data-testid="row-article-image-first-media"]')
                .getAttribute("src");
            expect(activeSource()).toBe("/storage/logo.png");
            expect(view.querySelector('[data-testid="row-article-image-next"]').disabled).toBe(true);
            view.querySelector('[data-testid="row-article-image-previous"]').click();
            expect(activeSource()).toBe("/storage/primary.png");
            expect(view.querySelector('[data-testid="row-article-image-previous"]').disabled).toBe(true);
        });

        test("starts on the card's picture even when the gallery also lists the row's earlier picture it opened from", async () => {
            const primary = { id: 1, asset_kind: "image", filename: "primary.png", is_primary: true };
            const logo = { id: 2, asset_kind: "image", filename: "logo.png" };
            loadSession.fetchDynamicChildren.mockResolvedValueOnce({
                gallery_relation: galleryRelation,
                card_picture: "logo.png",
                child_tables: [{ ...galleryRelation, relation_kind: "shared_asset", rows: [primary, logo] }],
            });

            // The card still showed the row's earlier picture; the fresh response decides.
            await openImageFirstView({
                imageSrc: "/storage/primary.png",
                rowItem: { id: 3, title: "Example", cached_image: "primary.png" },
                tableName: "examples",
            });

            const view = document.querySelector('[data-testid="image-first-view"]');
            expect(view.querySelector('[data-testid="row-article-image-first-media"]').getAttribute("src"))
                .toBe("/storage/logo.png");
            view.querySelector('[data-testid="row-article-image-previous"]').click();
            expect(view.querySelector('[data-testid="row-article-image-first-media"]').getAttribute("src"))
                .toBe("/storage/primary.png");
        });

        test("opens on the picture the viewer chose in the article, not on the card's picture", async () => {
            const primary = { id: 1, asset_kind: "image", filename: "primary.png", is_primary: true };
            const logo = { id: 2, asset_kind: "image", filename: "logo.png" };

            await openImageFirstView({
                imageSrc: "/storage/primary.png",
                imageRows: [primary, logo],
                activeImageRow: primary,
                rowItem: { id: 3, title: "Example", cached_image: "logo.png" },
                tableName: "examples",
            });

            expect(readStageImageSources()).toEqual(["/storage/primary.png", "/storage/logo.png"]);
            expect(loadSession.fetchDynamicChildren).not.toHaveBeenCalled();
        });

        // The same path on another host, or with another query, is another picture.
        test.each([
            ["another host", "https://old.example/logo.png", "https://new.example/logo.png", "https://new.example/logo.png"],
            ["another query", "pic.png?v=1", "pic.png?v=2", "/storage/pic.png?v=2"],
        ])("opens on the picture clicked, not another at the same path on %s", async (
            _label, otherPicture, clickedPicture, clickedAddress,
        ) => {
            await openImageFirstView({
                imageSrc: clickedAddress,
                imageRows: [
                    { id: 1, asset_kind: "image", filename: otherPicture },
                    { id: 2, asset_kind: "image", filename: clickedPicture },
                ],
                rowItem: { id: 3, title: "Example" },
                tableName: "examples",
            });

            expect(document.querySelector('[data-testid="row-article-image-first-media"]').getAttribute("src"))
                .toBe(clickedAddress);
        });

        test("starts on a multilingual card picture in the viewer's language", async () => {
            const { setLanguage } = await import("../../state_stores/lang_preference_reader.js");
            const fiPicture = { id: 1, asset_kind: "image", filename: "fi.png" };
            const enPicture = { id: 2, asset_kind: "image", filename: "en.png" };
            loadSession.fetchDynamicChildren.mockResolvedValueOnce({
                gallery_relation: galleryRelation,
                card_picture: JSON.stringify({ fi: "fi.png", en: "en.png" }),
                child_tables: [{ ...galleryRelation, relation_kind: "shared_asset", rows: [enPicture, fiPicture] }],
            });
            setLanguage("fi");
            try {
                await openImageFirstView({
                    imageSrc: "/storage/en.png",
                    rowItem: { id: 3, title: "Example", cached_image: "en.png" },
                    tableName: "examples",
                });
            } finally {
                localStorage.clear();
            }

            expect(document.querySelector('[data-testid="row-article-image-first-media"]').getAttribute("src"))
                .toBe("/storage/fi.png");
        });

        test("reopens on the picture its address names rather than the card's picture", async () => {
            const { fetchDatasetData } = await import("../../endpoints/endpoint_data_fetcher.js");
            const primary = { id: 1, asset_kind: "image", filename: "primary.png", is_primary: true };
            const logo = { id: 2, asset_kind: "image", filename: "logo.png" };
            vi.mocked(fetchDatasetData).mockResolvedValueOnce({
                data: [{ id: 3, title: "Example", cached_image: "logo.png" }],
                types: pictureTypes,
            });
            loadSession.fetchDynamicChildren.mockResolvedValueOnce({
                gallery_relation: galleryRelation,
                card_picture: "logo.png",
                child_tables: [{ ...galleryRelation, relation_kind: "shared_asset", rows: [primary, logo] }],
            });
            history.replaceState(
                { imageFirstView: { dataset: "examples", rowId: "3" } },
                "",
                "/examples/3?view=image_first_view#image=primary.png",
            );

            await openImageFirstView({ tableName: "examples", rowItem: { id: 3 }, restoringHistory: true });

            expect(document.querySelector('[data-testid="row-article-image-first-media"]').getAttribute("src"))
                .toBe("/storage/primary.png");
        });

        test("uses the rows an article hands over as given, without adding the row fields", async () => {
            await openImageFirstView({
                imageSrc: "/storage/second.png",
                imageRows: [second, first],
                rowItem: { id: 3, title: "Example", cached_image: "stale.png" },
                tableName: "examples",
            });

            expect(readStageImageSources()).toEqual(["/storage/second.png", "/storage/first.png"]);
            expect(loadSession.fetchDynamicChildren).not.toHaveBeenCalled();
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
