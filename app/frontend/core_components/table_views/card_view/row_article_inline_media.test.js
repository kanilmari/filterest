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
