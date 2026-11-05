/* @vitest-environment jsdom */
// row_article_record_bar.test.js
// Proves the record bar shares row buttons and dismissal with ordinary articles.
// Connects a controlled viewport and rendered card list to the article scroll content.
// Guards focus, busy state, missing-list behavior and teardown without a browser.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { syncRowArticleRecordBar, disposeRowArticleRecordBar } from "./row_article_record_bar.js";
import { buildSharedTopBarArticleCloseButton } from "../../filterbar/filterbar_heading_builder.js";
const { open } = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("./row_article_opener.js", () => ({ openRowArticleView: open }));
vi.mock("../../lang/translation_handler.js", () => ({ getTranslationForKey: key => ({
    previous: "Edellinen", next: "Seuraava", close: "Sulje", previous_row: "Edellinen rivi",
    next_row: "Seuraava rivi", article_records: "Artikkelit",
})[key] || key }));

const byId = id => document.querySelector(`[data-testid="${id}"]`);
function build({ image = true, list = true, rowId = 2 } = {}) {
    const dataset = document.createElement("div");
    dataset.id = "places_container";
    dataset.innerHTML = '<div class="card_container"></div><article class="active_row_article"><button class="big_card_close"></button><div class="big_card_content row_article_content"><h1 class="big_card_header">Otsikko</h1></div></article>';
    document.body.append(dataset);
    const cards = dataset.querySelector(".card_container");
    if (list) for (const id of [1, 2, 3]) {
        const card = document.createElement("div");
        card.className = "card";
        card.dataset.id = id;
        card._row = { id };
        cards.append(card);
    }
    const content = dataset.querySelector(".row_article_content");
    if (image) content.insertAdjacentHTML("beforeend", '<div class="row_article_inline_media"></div>');
    const context = { rowItem: { id: rowId }, tableName: "places", selectedCard: cards.children[1] };
    syncRowArticleRecordBar(content, context);
    return { content, context, cards, dataset };
}
beforeEach(() => {
    document.body.replaceChildren();
    vi.clearAllMocks();
    open.mockResolvedValue(undefined);
});
afterEach(() => {
    for (const content of document.querySelectorAll(".row_article_content")) disposeRowArticleRecordBar(content);
    vi.unstubAllGlobals();
});
describe("article record bar", () => {
    test("starts the actual scrolling content before its title, with localized labels and long meanings", () => {
        const { content } = build();
        const bar = byId("row-article-record-bar");
        expect(bar.tagName).toBe("NAV");
        expect(content.firstElementChild).toBe(bar);
        expect(bar.nextElementSibling.tagName).toBe("H1");
        expect(bar.parentElement.classList.contains("big_card_content")).toBe(true);
        expect([...bar.querySelectorAll("button")].map(button => button.dataset.testid)).toEqual([
            "row-article-previous-row", "row-article-next-row", "row-article-record-bar-close",
        ]);
        expect(byId("row-article-previous-row").textContent).toBe("Edellinen");
        expect(byId("row-article-next-row").title).toBe("Seuraava rivi");
        expect(byId("row-article-record-bar-close").textContent).toBe("Sulje");
        expect(byId("row-article-record-bar-close").getAttribute("aria-label"))
            .toBe(buildSharedTopBarArticleCloseButton(() => {}).getAttribute("aria-label"));
        expect(byId("row-article-record-bar-close").firstElementChild.style.maskImage).toContain("modal-close-icon.svg");
        expect(bar.querySelector("img")).toBeNull();
        const rows = byId("row-article-record-bar-rows");
        expect(rows.getAttribute("role")).toBe("group");
        expect(rows.hasAttribute("aria-label")).toBe(false);
        expect(bar.querySelector('[data-testid="row-article-row-navigation"]')).toBeNull();
    });
    test("keeps Close visible to assistive technology and in the keyboard tab order", () => {
        build();
        const close = byId("row-article-record-bar-close");
        expect(close.tabIndex).toBe(0);
        expect(close.getAttribute("tabindex")).toBe("0");
        expect(close.hidden).toBe(false);
        expect(close.hasAttribute("aria-hidden")).toBe(false);
    });
    test.each([390, 700, 701, 1024, 1440])("keeps a single bar above an imageless article at %i px", width => {
        vi.stubGlobal("innerWidth", width);
        const { content, context } = build({ image: false });
        const bar = content.firstElementChild;
        const next = byId("row-article-next-row");
        next.focus();
        syncRowArticleRecordBar(content, context);
        window.dispatchEvent(new Event("resize"));
        expect(content.firstElementChild).toBe(bar);
        expect(bar.hidden).toBe(false);
        expect(bar.contains(next)).toBe(true);
        expect(document.activeElement).toBe(next);
        expect(document.querySelectorAll('[data-testid="row-article-next-row"]')).toHaveLength(1);
    });
    test.each([{ list: false }, { rowId: 99 }])("keeps both buttons disabled without a rendered current row: %j", async options => {
        build(options);
        for (const direction of ["previous", "next"]) {
            const button = byId(`row-article-${direction}-row`);
            expect(button.disabled).toBe(true); button.click();
        }
        await Promise.resolve();
        expect(open).not.toHaveBeenCalled();
        expect(byId("row-article-record-bar").contains(byId("row-article-next-row"))).toBe(true);
    });
    test("uses the ordinary opener once while busy, including across a resize and media refresh", async () => {
        let finish;
        open.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        const { content, context, cards } = build();
        const navigation = byId("row-article-record-bar-rows");
        const next = byId("row-article-next-row");
        next.click();
        await vi.waitFor(() => expect(open).toHaveBeenCalledWith({ id: 3 }, "places", cards.children[2]));
        window.dispatchEvent(new Event("resize"));
        syncRowArticleRecordBar(content, context);
        next.click();
        expect(open).toHaveBeenCalledTimes(1);
        expect(navigation.getAttribute("aria-busy")).toBe("true");
        finish();
        await vi.waitFor(() => expect(navigation.hasAttribute("aria-busy")).toBe(false));
    });
    test("updates bounded neighbours when the rendered list gains a page", async () => {
        const { content, context, cards } = build();
        context.rowItem.id = 3;
        // A row's controller is rebuilt by its opener; use a fresh content instance.
        disposeRowArticleRecordBar(content); content.remove();
        const fresh = document.createElement("div"); fresh.className = "row_article_content";
        document.body.append(fresh);
        syncRowArticleRecordBar(fresh, context);
        expect(byId("row-article-next-row").disabled).toBe(true);
        const fourth = cards.firstElementChild.cloneNode(); fourth.dataset.id = "4"; fourth._row = { id: 4 }; cards.append(fourth);
        await vi.waitFor(() => expect(byId("row-article-next-row").disabled).toBe(false));
    });
    test("clicks the legacy close and delegates its missing-control fallback to the existing top-bar path", () => {
        const { dataset } = build();
        const legacy = dataset.querySelector(".big_card_close"), dismiss = vi.fn(), fallback = vi.fn();
        legacy.addEventListener("click", dismiss);
        const topbar = buildSharedTopBarArticleCloseButton(() => {
            const target = dataset.querySelector(".big_card_close");
            if (target) target.click(); else fallback();
        });
        dataset.append(topbar);
        byId("row-article-record-bar-close").click(); topbar.click();
        expect(dismiss).toHaveBeenCalledTimes(2);
        legacy.remove(); byId("row-article-record-bar-close").click();
        expect(fallback).toHaveBeenCalledOnce();
    });
    test("removes listeners when the article's whole dataset is removed", async () => {
        const { dataset } = build(); dataset.remove();
        await vi.waitFor(() => expect(dataset.querySelector(".row_article_record_bar")).toBeNull());
    });
});
