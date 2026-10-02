/* @vitest-environment jsdom */
// row_article_inline_media.test.js
// Exercises same-row image navigation and refresh in ordinary article content.
// Connects permitted image rows, caption localization and image-first activation.
// Guards against duplicate controls, stale credits and accidental article reopening.
import { beforeEach, describe, expect, test, vi } from "vitest";
const { bind, open, language } = vi.hoisted(() => ({
    bind: vi.fn(), open: vi.fn(), language: vi.fn(() => "fi"),
}));
vi.mock("./image_first_view_activation.js", () => ({ bindImageFirstViewActivation: bind }));
vi.mock("./row_article_opener.js", () => ({ openRowArticleView: open }));
vi.mock("../../../ui_config.js", () => ({ enable_experimental_row_article_row_navigation: true }));
vi.mock("../../lang/translation_handler.js", () => ({ getTranslationForKey: key => key }));
vi.mock("../../state_stores/lang_preference_reader.js", () => ({ getLanguageWithBrowserFallback: language }));
vi.mock("./card_avatar_builder.js", () => ({ createImageElement: src => {
    const wrapper = document.createElement("div");
    wrapper.className = "wrapper";
    wrapper.dataset.imageFirstSrc = src;
    const image = document.createElement("img");
    image.src = src; wrapper.append(image); return wrapper;
} }));
import { syncRowArticleInlineMedia, disposeRowArticleInlineMedia } from "./row_article_inline_media.js";
import { refreshLocalizedDatasetValues } from "../dataset_value_localizer.js";

const rows = [
    { id: 4, asset_kind: "image", filename: "first.jpg", description: { fi: "Ensimmäinen", en: "First" } },
    { id: 5, asset_kind: "image", filename: "second.jpg", description: { fi: "Toinen", en: "Second" } },
    { id: 6, asset_kind: "image", filename: "third.jpg", description: { fi: "Kolmas", en: "Third" } },
];
function build(src = "/storage/second.jpg") {
    const article = document.createElement("article");
    article.className = "row_article_content";
    article.innerHTML = '<div class="big_card_image" data-row-article-image-column="cached_image"><div class="wrapper"><img></div></div>';
    article.querySelector("img").src = src;
    article.querySelector(".wrapper").dataset.imageFirstSrc = src;
    document.body.append(article);
    return article;
}
const button = (article, direction) => article.querySelector('[data-testid="row-article-image-' + direction + '"]');
const caption = article => article.querySelector(".row_article_inline_image_caption");
beforeEach(() => {
    document.body.replaceChildren(); vi.clearAllMocks(); language.mockReturnValue("fi");
    bind.mockImplementation(element => { element.tabIndex = 0; });
});
describe("ordinary article image controls", () => {
    test("keeps the existing active image, browses authorized images and updates linked opening context", () => {
        const article = build();
        const context = { rowItem: { id: 12 }, tableName: "places", rowLabel: "Place" };
        syncRowArticleInlineMedia(article, rows, context);
        expect(article.querySelector("[data-testid='row-article-image-position']").textContent).toBe("2 / 3");
        expect(caption(article).textContent).toBe("Toinen");
        button(article, "next").click();
        expect(article.querySelector(".row_article_inline_media img").src).toContain("/storage/third.jpg");
        expect(caption(article).textContent).toBe("Kolmas");
        expect(bind.mock.calls.at(-1)[1]).toMatchObject({ rowItem: context.rowItem, tableName: context.tableName, activeImageRow: rows[2], imageRows: rows });
        expect(button(article, "next").disabled).toBe(true);
        button(article, "previous").click();
        expect(caption(article).textContent).toBe("Toinen");
        expect(open).not.toHaveBeenCalled();
        expect(article.querySelector("[data-testid='row-article-image-scroll-hint']")).toBeNull();
    });
    test("does not duplicate controls or captions during asynchronous media refresh", () => {
        const article = build();
        syncRowArticleInlineMedia(article, rows);
        button(article, "next").click();
        syncRowArticleInlineMedia(article, [...rows]);
        expect(article.querySelectorAll(".row_article_inline_media")).toHaveLength(1);
        expect(article.querySelectorAll(".row_article_inline_image_caption")).toHaveLength(1);
        expect(caption(article).textContent).toBe("Kolmas");
        expect(article.querySelectorAll(".row_article_image_first_arrow")).toHaveLength(2);
    });
    test("replaces a removed selected asset and clears pixels and activation when none remain", () => {
        const article = build();
        syncRowArticleInlineMedia(article, rows);
        syncRowArticleInlineMedia(article, [rows[0], rows[2]]);
        expect(caption(article).textContent).toBe("Ensimmäinen");
        expect(article.querySelector(".row_article_inline_media img").src).toContain("first.jpg");
        syncRowArticleInlineMedia(article, []);
        expect(article.querySelector(".row_article_inline_media img")).toBeNull();
        expect(article.querySelector("[data-image-first-src]")).toBeNull();
        expect(caption(article)).toBeNull();
        expect(button(article, "next").disabled).toBe(true);
    });
    test("supports keyboard image browsing and translated credits", async () => {
        const article = build();
        syncRowArticleInlineMedia(article, rows);
        const frame = article.querySelector(".row_article_inline_media");
        const key = new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true });
        frame.dispatchEvent(key);
        expect(key.defaultPrevented).toBe(true);
        expect(caption(article).textContent).toBe("Ensimmäinen");
        expect(button(article, "previous").disabled).toBe(true);
        await refreshLocalizedDatasetValues("en");
        expect(caption(article).textContent).toBe("First");
    });
    test("keeps keyboard focus when the focused image is replaced", () => {
        const article = build();
        syncRowArticleInlineMedia(article, rows);
        const current = article.querySelector(".row_article_inline_media > .wrapper");
        current.tabIndex = 0;
        current.focus();
        current.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
        expect(document.activeElement).toBe(article.querySelector(".row_article_inline_media > .wrapper"));
        expect(caption(article).textContent).toBe("Ensimmäinen");
    });
    test("obsolete or disposed articles cannot browse through their old controls", () => {
        const article = build();
        let active = true;
        syncRowArticleInlineMedia(article, rows, { canCommit: () => active });
        active = false;
        button(article, "next").click();
        expect(caption(article).textContent).toBe("Toinen");
        active = true;
        disposeRowArticleInlineMedia(article);
        button(article, "next").click();
        expect(caption(article).textContent).toBe("Toinen");
    });
    test("gives an image the fresh rows no longer list way to the first row, a card-only picture first", () => {
        const article = build("/storage/stale.jpg");
        syncRowArticleInlineMedia(article, [{ asset_kind: "image", filename: "stale.jpg" }]);
        const cardOnly = { asset_kind: "image", filename: "https://cdn.example/card.jpg", is_card_only_picture: true };
        syncRowArticleInlineMedia(article, [cardOnly, ...rows]);
        expect(article.querySelector(".row_article_inline_media img").src).toBe("https://cdn.example/card.jpg");
        expect(article.querySelector("[data-testid='row-article-image-position']").textContent).toBe("1 / 4");
        expect(bind.mock.calls.at(-1)[1]).toMatchObject({ activeImageRow: cardOnly, imageRows: [cardOnly, ...rows] });
    });
    test("gives a removed image way to the card's picture where the rows list it later, keeping their order", () => {
        const article = build("/storage/stale.jpg");
        syncRowArticleInlineMedia(article, [{ asset_kind: "image", filename: "stale.jpg" }]);
        syncRowArticleInlineMedia(article, rows, { cardPicture: "third.jpg" });
        expect(article.querySelector(".row_article_inline_media img").src).toContain("/storage/third.jpg");
        expect(article.querySelector("[data-testid='row-article-image-position']").textContent).toBe("3 / 3");
        expect(caption(article).textContent).toBe("Kolmas");
        expect(bind.mock.calls.at(-1)[1]).toMatchObject({ activeImageRow: rows[2], imageRows: rows });
    });
    test("keeps a browsed image selected while refreshed rows still list it", () => {
        const article = build();
        syncRowArticleInlineMedia(article, rows, { fromResponse: true, cardPicture: "second.jpg" });
        button(article, "next").click();
        syncRowArticleInlineMedia(article, [
            { asset_kind: "image", filename: "https://cdn.example/card.jpg", is_card_only_picture: true },
            ...rows,
        ], { fromResponse: true, cardPicture: "https://cdn.example/card.jpg" });
        expect(caption(article).textContent).toBe("Kolmas");
        expect(article.querySelector("[data-testid='row-article-image-position']").textContent).toBe("4 / 4");
    });
    test("starts on the card's picture at the first response even when it also lists the row's earlier picture", () => {
        const article = build("/storage/first.jpg");
        // Before the response the row's own picture stands in and stays shown.
        syncRowArticleInlineMedia(article, [{ asset_kind: "image", filename: "first.jpg" }]);
        expect(article.querySelector(".row_article_inline_media img").src).toContain("/storage/first.jpg");
        syncRowArticleInlineMedia(article, rows, { fromResponse: true, cardPicture: "second.jpg" });
        expect(article.querySelector(".row_article_inline_media img").src).toContain("/storage/second.jpg");
        expect(article.querySelector("[data-testid='row-article-image-position']").textContent).toBe("2 / 3");
        expect(caption(article).textContent).toBe("Toinen");
        expect(bind.mock.calls.at(-1)[1]).toMatchObject({ activeImageRow: rows[1], imageRows: rows });
    });
    test("lets the first response decide even after the viewer browsed the row's own pictures", () => {
        const article = build("/storage/first.jpg");
        syncRowArticleInlineMedia(article, [rows[0], rows[1]]);
        button(article, "next").click();
        expect(caption(article).textContent).toBe("Toinen");
        syncRowArticleInlineMedia(article, rows, { fromResponse: true, cardPicture: "first.jpg" });
        expect(caption(article).textContent).toBe("Ensimmäinen");
        expect(article.querySelector("[data-testid='row-article-image-position']").textContent).toBe("1 / 3");
    });
    test("a later response keeps the image the viewer browsed to while it is listed", () => {
        const article = build("/storage/first.jpg");
        syncRowArticleInlineMedia(article, rows, { fromResponse: true, cardPicture: "first.jpg" });
        button(article, "next").click();
        // After an upload or a field save the card's picture may change; the viewer's choice stays.
        syncRowArticleInlineMedia(article, rows, { fromResponse: true, cardPicture: "third.jpg" });
        expect(caption(article).textContent).toBe("Toinen");
        expect(article.querySelector("[data-testid='row-article-image-position']").textContent).toBe("2 / 3");
        // Once the chosen image is gone, the main image takes over again.
        syncRowArticleInlineMedia(article, [rows[0], rows[2]], { fromResponse: true, cardPicture: "third.jpg" });
        expect(caption(article).textContent).toBe("Kolmas");
        expect(article.querySelector("[data-testid='row-article-image-position']").textContent).toBe("2 / 2");
    });
    // The same path on another host, or with another query, is another picture: its
    // pixels replace the old ones, and the opening binding follows the same picture.
    const samePathPictures = [
        ["another host", "https://old.example/logo.png", "https://new.example/logo.png", "https://new.example/logo.png"],
        ["another query", "/storage/pic.png?v=1", "pic.png?v=2", "/storage/pic.png?v=2"],
    ];
    test.each(samePathPictures)(
        "the first response replaces the row's earlier picture at the same path on %s",
        (_label, oldPicture, newPicture, newAddress) => {
            const article = build(oldPicture);
            syncRowArticleInlineMedia(article, [{ asset_kind: "image", filename: oldPicture }]);
            syncRowArticleInlineMedia(
                article,
                [{ id: 9, asset_kind: "image", filename: newPicture }],
                { fromResponse: true, cardPicture: newPicture },
            );
            expect(article.querySelector(".row_article_inline_media img").getAttribute("src")).toBe(newAddress);
            expect(bind.mock.calls.at(-1)[1]).toMatchObject({ imageSrc: newAddress });
        },
    );
    test.each(samePathPictures)(
        "a later response replaces a main picture the card no longer shows at the same path on %s",
        (_label, oldPicture, newPicture, newAddress) => {
            const article = build(oldPicture);
            syncRowArticleInlineMedia(
                article,
                [{ id: 8, asset_kind: "image", filename: oldPicture }],
                { fromResponse: true, cardPicture: oldPicture },
            );
            syncRowArticleInlineMedia(
                article,
                [{ id: 9, asset_kind: "image", filename: newPicture }],
                { fromResponse: true, cardPicture: newPicture },
            );
            expect(article.querySelector(".row_article_inline_media img").getAttribute("src")).toBe(newAddress);
            expect(bind.mock.calls.at(-1)[1]).toMatchObject({ imageSrc: newAddress });
        },
    );
    test("a later response moves an image the viewer did not choose to the card's new picture", () => {
        const article = build("/storage/first.jpg");
        syncRowArticleInlineMedia(article, rows, { fromResponse: true, cardPicture: "first.jpg" });
        expect(caption(article).textContent).toBe("Ensimmäinen");
        syncRowArticleInlineMedia(article, rows, { fromResponse: true, cardPicture: "third.jpg" });
        expect(caption(article).textContent).toBe("Kolmas");
        expect(article.querySelector("[data-testid='row-article-image-position']").textContent).toBe("3 / 3");
    });
    test("shows no invented images when no related image is permitted", () => {
        const article = build();
        syncRowArticleInlineMedia(article, []);
        expect(button(article, "next").disabled).toBe(true);
        expect(button(article, "previous").disabled).toBe(true);
        expect(caption(article)).toBeNull();
        expect(article.querySelector("[data-testid='row-article-image-position']").hidden).toBe(true);
    });
    test("browses only the currently loaded result rows through the ordinary article opener", async () => {
        const cards = document.createElement("div");
        cards.className = "card_container";
        cards.innerHTML = '<div class="card" data-id="12"></div><div class="card" data-id="13"></div>';
        cards.children[0]._row = { id: 12 }; cards.children[1]._row = { id: 13 };
        document.body.append(cards);
        const article = build();
        syncRowArticleInlineMedia(article, rows, { tableName: "places", rowItem: { id: 12 }, selectedCard: cards.children[0] });
        article.querySelector("[data-testid='row-article-next-row']").click();
        await vi.waitFor(() => expect(open).toHaveBeenCalledWith({ id: 13 }, "places", cards.children[1]));
    });
});
