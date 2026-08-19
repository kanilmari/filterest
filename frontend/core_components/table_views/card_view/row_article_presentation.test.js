/* @vitest-environment jsdom */

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../lang/translation_handler.js", () => ({
    getTranslationForKey: vi.fn((key) => ({
        article_records: "Article records",
        next_row: "Next record",
        open_article: "Open article",
        previous_row: "Previous record",
    })[key] || ""),
}));

import {
    buildRowArticleRowNavigation,
    normalizeRowArticleDetailsPosition,
    placeRowArticleDetails,
} from "./row_article_presentation.js";

describe("row article presentation", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        localStorage.clear();
    });

    test("normalizes unsupported detail positions to the stable default", () => {
        expect(normalizeRowArticleDetailsPosition("between_title_and_description"))
            .toBe("between_title_and_description");
        expect(normalizeRowArticleDetailsPosition("floating")).toBe("after_description");
    });

    test("places details on the selected side of the description", () => {
        const content = document.createElement("div");
        const title = document.createElement("h1");
        title.className = "big_card_header";
        const description = document.createElement("div");
        description.className = "big_card_description_container";
        const details = document.createElement("section");
        details.className = "row_article_details_section";
        content.append(title, description, details);

        placeRowArticleDetails(content, "between_title_and_description");
        expect(Array.from(content.children)).toEqual([title, details, description]);

        placeRowArticleDetails(content, "after_description");
        expect(Array.from(content.children)).toEqual([title, description, details]);
    });

    test("navigates only inside the active rendered result order", () => {
        const container = document.createElement("div");
        [1, 2, 3].forEach((id) => {
            const card = document.createElement("div");
            card.className = "card";
            card.dataset.id = String(id);
            card._row = { id };
            container.appendChild(card);
        });
        const onNavigate = vi.fn();
        const navigation = buildRowArticleRowNavigation({
            cardContainer: container,
            currentRowId: 2,
            onNavigate,
        });

        expect(navigation.getAttribute("aria-label")).toBe("Article records");
        navigation.querySelector("[data-testid='row-article-previous-row']").click();
        navigation.querySelector("[data-testid='row-article-next-row']").click();

        expect(onNavigate.mock.calls.map(([row]) => row.id)).toEqual([1, 3]);
    });
});
