/* @vitest-environment jsdom */

import { describe, expect, test, vi } from "vitest";

vi.mock("../../lang/translation_handler.js", () => ({
    getTranslationForKey: vi.fn((key) => ({
        next_image: "Next image",
        previous_image: "Previous image",
        show_more: "Show article",
    })[key] || ""),
}));

import { buildRowArticleImageFirstStage } from "./row_article_image_first_stage.js";

function createStage(rows, options = {}) {
    let activeRow = rows[0];
    const selected = [];
    const onBackdropActivate = vi.fn();
    const result = buildRowArticleImageFirstStage({
        imageEntries: rows.map((row) => ({ row })),
        getActiveRow: () => activeRow,
        onSelectRow: (row) => {
            activeRow = row;
            selected.push(row.id);
        },
        resolvePath: (filename) => `/storage/${filename}`,
        resolveAlt: (row) => row.alt,
        onBackdropActivate,
        tableName: options.tableName || "",
        rowLabel: options.rowLabel || "",
    });
    return { ...result, onBackdropActivate, selected };
}

describe("row article image-first stage", () => {
    test("disables both navigation arrows for one image", () => {
        const { element } = createStage([{ id: 1, filename: "one.jpg", alt: "One" }]);

        expect(element.querySelector("[data-testid='row-article-image-previous']").disabled)
            .toBe(true);
        expect(element.querySelector("[data-testid='row-article-image-next']").disabled)
            .toBe(true);
        expect(element.querySelector("img").alt).toBe("One");
        expect(element.querySelector("[aria-live='polite']").textContent).toBe("1 / 1");
        expect(element.getAttribute("aria-label")).toBe("Images");
    });

    test("supports buttons, arrow keys, and horizontal touch gestures", () => {
        const rows = [
            { id: 1, filename: "one.jpg", alt: "One" },
            { id: 2, filename: "two.jpg", alt: "Two" },
            { id: 3, filename: "three.jpg", alt: "Three" },
        ];
        const { element, selected } = createStage(rows);

        element.querySelector("[data-testid='row-article-image-next']").click();
        element.dispatchEvent(new KeyboardEvent("keydown", {
            key: "ArrowRight",
            bubbles: true,
            cancelable: true,
        }));

        const touchStart = new Event("touchstart", { bubbles: true });
        Object.defineProperty(touchStart, "touches", { value: [{ clientX: 120 }] });
        element.dispatchEvent(touchStart);
        const touchEnd = new Event("touchend", { bubbles: true });
        Object.defineProperty(touchEnd, "changedTouches", { value: [{ clientX: 190 }] });
        element.dispatchEvent(touchEnd);

        expect(selected).toEqual([2, 3, 2]);
        expect(element.querySelector("img").getAttribute("src")).toBe("/storage/two.jpg");
        expect(element.querySelector("[data-testid='row-article-image-previous']")
            .getAttribute("aria-label")).toBe("Previous image");
    });

    test("shows the article cue and treats raster letterbox space as the backdrop", () => {
        const { element, onBackdropActivate } = createStage([
            { id: 1, filename: "one.jpg", alt: "One" },
        ]);
        const articleContent = document.createElement("article");
        articleContent.scrollIntoView = vi.fn();
        document.body.append(element, articleContent);

        expect(element.style.getPropertyValue("--row-article-image-first-backdrop"))
            .toContain("/storage/one.jpg");
        const image = element.querySelector("img");
        image.click();
        expect(onBackdropActivate).not.toHaveBeenCalled();

        element.querySelector(".row_article_image_first_media").click();
        expect(onBackdropActivate).toHaveBeenCalledOnce();

        element.click();
        expect(onBackdropActivate).toHaveBeenCalledTimes(2);

        const scrollHint = element.querySelector("[data-testid='row-article-image-scroll-hint']");
        expect(scrollHint.textContent).toContain("Show article");
        scrollHint.click();
        expect(articleContent.scrollIntoView).toHaveBeenCalledWith({
            behavior: "smooth",
            block: "start",
        });
    });

    test("uses the shared SVG mark-and-label presentation in the full-height viewer", () => {
        const { element, onBackdropActivate } = createStage(
            [{ id: 1, filename: "firefox.svg", alt: "Firefox logo" }],
            { tableName: "app_service_catalog", rowLabel: "Firefox" },
        );

        const mediaHost = element.querySelector(".row_article_image_first_media");
        expect(mediaHost?.dataset.imagePresentationKind).toBe("svg-logo");
        expect(mediaHost?.querySelector(".record_svg_image_presentation__label")?.textContent)
            .toBe("Firefox");
        expect(mediaHost?.querySelector("img")?.getAttribute("src"))
            .toBe("/storage/firefox.svg");
        mediaHost.click();
        expect(onBackdropActivate).not.toHaveBeenCalled();
    });
});
