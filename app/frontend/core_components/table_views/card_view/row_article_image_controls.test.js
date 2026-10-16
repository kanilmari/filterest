// row_article_image_controls.test.js
// Verifies decorative image chevrons and their accessible button contract.
// Connects the shared builder to inline/IFAV and thumbnail navigation callers.
// Prevents font-dependent glyphs and activation of disabled image arrows.
import { describe, expect, test, vi } from "vitest";
vi.mock("../../lang/translation_handler.js", () => ({
    getTranslationForKey: key => ({ previous_image: "Edellinen kuva", next_image: "Seuraava kuva" })[key],
}));
import { buildRowArticleImageArrow, buildRowArticleImageArrowIcon } from "./row_article_image_controls.js";

describe("article image arrow builder", () => {
    test.each([["previous", "back", "Edellinen kuva"], ["next", "forward", "Seuraava kuva"]])(
        "%s keeps its accessible name and centres a decorative SVG mask instead of text",
        (direction, asset, label) => {
            const activate = vi.fn();
            const button = buildRowArticleImageArrow(direction, activate);
            expect(button.textContent).toBe("");
            expect(button.childNodes).toHaveLength(1);
            const icon = button.firstElementChild;
            expect(icon.tagName).toBe("SPAN");
            expect(icon.className).toBe("row_article_image_arrow_icon");
            expect(icon.getAttribute("aria-hidden")).toBe("true");
            expect(icon.style.maskImage).toContain(`nav-history-${asset}-icon.svg`);
            expect(icon.style.maskPosition).toBe("center");
            expect(button.getAttribute("aria-label")).toBe(label);
            expect(button.title).toBe(label);
            button.click();
            expect(activate).toHaveBeenCalledOnce();
            button.disabled = true;
            expect(button.hasAttribute("disabled")).toBe(true);
            button.click();
            expect(activate).toHaveBeenCalledOnce();
        },
    );

    test("shares exactly the same mask box with the thumbnail carousel", () => {
        expect(buildRowArticleImageArrowIcon("next").outerHTML)
            .toBe(buildRowArticleImageArrow("next", () => {}).firstElementChild.outerHTML);
    });
});
