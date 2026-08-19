import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const directory = path.dirname(fileURLToPath(import.meta.url));

describe("image-first article CSS contract", () => {
    test("keeps the active media viewport-height and the article at 800 pixels", () => {
        const galleryCss = fs.readFileSync(
            path.join(directory, "big_card_image_gallery.css"),
            "utf8",
        );
        const modalCss = fs.readFileSync(
            path.join(directory, "../../../reusable_components/modal/modals.css"),
            "utf8",
        );

        expect(galleryCss).toMatch(/\.row_article_image_first_stage\s*\{[^}]*height:\s*100dvh;/s);
        expect(galleryCss).toMatch(/\.row_article_image_first_media\s*\{[^}]*object-fit:\s*contain;/s);
        expect(galleryCss).toContain("@media (width <= 720px)");
        expect(galleryCss).toMatch(/\.image_first_view_article_content\s*\{[^}]*max-width:\s*800px/s);
        expect(galleryCss).toMatch(/\.image_first_view_modal\s*\{[^}]*height:\s*100dvh;/s);
        expect(modalCss).toMatch(
            /\.image_modal\.image_first_view_modal \.modal_body\s*\{[^}]*overflow:\s*hidden auto;/s,
        );
        expect(modalCss.indexOf(".image_modal.image_first_view_modal .modal_body"))
            .toBeGreaterThan(modalCss.indexOf(".image_modal .modal_body"));
        expect(modalCss).not.toContain('.image_modal :is(button, a[href], input, select, [role="button"])');
    });
});
