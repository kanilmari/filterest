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
        const uiConfig = fs.readFileSync(
            path.join(directory, "../../../ui_config.js"),
            "utf8",
        );
        const variablesCss = fs.readFileSync(
            path.join(directory, "../../../styles/variables.css"),
            "utf8",
        );
        const filterbarContentCss = fs.readFileSync(
            path.join(directory, "../../filterbar/morphing_filterbar_content.css"),
            "utf8",
        );

        expect(galleryCss).toMatch(/\.row_article_image_first_stage\s*\{[^}]*height:\s*100dvh;/s);
        expect(galleryCss).toMatch(/\.row_article_image_first_media\s*\{[^}]*height:\s*100dvh;[^}]*object-fit:\s*contain;/s);
        expect(galleryCss).toMatch(/\.image_first_view\s*\{[^}]*animation:\s*image-first-view-grow-reveal[^;]*var\(--transition-time/s);
        expect(galleryCss).toMatch(/@keyframes image-first-view-grow-reveal\s*\{[\s\S]*opacity:\s*0\.12;[\s\S]*clip-path:\s*inset\([\s\S]*50dvh[\s\S]*opacity:\s*1;[\s\S]*clip-path:\s*inset\(0\)/s);
        expect(galleryCss).toMatch(/\.row_article_image_first_stage::before\s*\{[^}]*filter:\s*blur\(/s);
        expect(galleryCss).toMatch(/\.row_article_image_first_scroll_hint\s*\{/s);
        expect(galleryCss).toContain("@media (width <= 720px)");
        expect(galleryCss).toMatch(/\.image_first_view_article_content\s*\{[^}]*max-width:\s*800px/s);
        expect(galleryCss).toMatch(/\.image_first_view_modal\s*\{[^}]*height:\s*100dvh;/s);
        expect(modalCss).toMatch(
            /\.image_modal\.image_first_view_modal \.modal_body\s*\{[^}]*overflow:\s*hidden auto;/s,
        );
        expect(modalCss.indexOf(".image_modal.image_first_view_modal .modal_body"))
            .toBeGreaterThan(modalCss.indexOf(".image_modal .modal_body"));
        expect(modalCss).not.toContain('.image_modal :is(button, a[href], input, select, [role="button"])');
        expect(modalCss).toMatch(/\.image_modal \.modal_close_button\s*\{[^}]*border:\s*1px solid var\(--image-modal-control-color\)/s);
        expect(modalCss).toMatch(/transition:\s*opacity var\(--transition-time, 0\.5s\) ease/s);
        expect(galleryCss).toMatch(/\.image_first_view > \.row_article_row_navigation\s*\{[^}]*background:\s*transparent;[^}]*pointer-events:\s*none;/s);
        expect(galleryCss).toMatch(/\.image_first_view_article_content > \.big_card_header\s*\{[^}]*max-width:\s*1200px !important;/s);
        const bigCardCss = fs.readFileSync(
            path.join(directory, "cards_big.css"),
            "utf8",
        );
        expect(bigCardCss).toMatch(/\.big_card_header\s*\{[^}]*justify-content:\s*center;[^}]*text-align:\s*center;/s);
        expect(galleryCss).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.image_first_view,[^}]*animation:\s*none;/s);
        expect(variablesCss).toContain("--filterbar-hero-title-max-width: 1200px");
        expect(filterbarContentCss).toContain("var(--filterbar-hero-title-max-width, 1200px)");
        expect(filterbarContentCss).toMatch(/\.filterbar-inline-hero \.filter-content-inner\s*\{[^}]*max-width:\s*var\(--filterbar-hero-title-max-width, 1200px\)/s);
        expect(filterbarContentCss).toMatch(/\.filterbar-inline-hero \.filter-content-inner > :not\(\.morphing-header\)\s*\{[^}]*max-width:\s*var\(--filterbar-hero-content-max-width, 550px\)/s);
        expect(uiConfig).toMatch(/enable_experimental_row_article_row_navigation\s*=\s*true/);
    });
});
