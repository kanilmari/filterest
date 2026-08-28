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
        const svgPresentationCss = fs.readFileSync(
            path.join(directory, "svg_image_presentation.css"),
            "utf8",
        );

        expect(galleryCss).toMatch(/\.row_article_image_first_stage\s*\{[^}]*height:\s*100dvh;/s);
        expect(galleryCss).toMatch(/\.row_article_image_first_media\s*\{[^}]*height:\s*100dvh;[^}]*object-fit:\s*contain;/s);
        expect(galleryCss).toMatch(/\.image_first_view\s*\{[^}]*opacity:\s*1;[^}]*clip-path:\s*inset\(0\);[^}]*animation:\s*none;/s);
        expect(galleryCss).toMatch(/\.row_article_image_first_reveal_cluster\s*\{[^}]*position:\s*relative;[^}]*backface-visibility:\s*hidden;[^}]*will-change:\s*transform;[^}]*animation:\s*image-first-foreground-grow[^;]*300ms/s);
        expect(galleryCss).toMatch(/\.row_article_image_first_reveal_title\s*\{[^}]*position:\s*absolute;[^}]*inset-block-start:\s*100%;[^}]*animation:\s*image-first-reveal-title[^;]*300ms/s);
        expect(galleryCss).toMatch(/@keyframes image-first-foreground-grow\s*\{[\s\S]*transform:\s*translate3d\(0, 0, 0\) scale3d\(0\.001, 0\.001, 1\);[\s\S]*transform:\s*translate3d\(0, 0, 0\) scale3d\(1, 1, 1\);/s);
        expect(galleryCss).toMatch(/@keyframes image-first-view-shrink-conceal\s*\{[\s\S]*clip-path:\s*inset\(0\)[\s\S]*clip-path:\s*inset\([\s\S]*50dvh/s);
        expect(galleryCss).toMatch(/\.image_first_view_overlay\.image-first-view-closing \.image_first_view\s*\{[^}]*animation:\s*image-first-view-shrink-conceal[^;]*300ms/s);
        expect(galleryCss).toMatch(/@keyframes image-first-foreground-shrink\s*\{[\s\S]*transform:\s*translate3d\(0, 0, 0\) scale3d\(1, 1, 1\);[\s\S]*transform:\s*translate3d\(0, 0, 0\) scale3d\(0\.001, 0\.001, 1\);/s);
        expect(galleryCss).toMatch(/\.image_first_view_overlay\.image-first-view-closing[\s\S]*\.row_article_image_first_reveal_cluster\s*\{[^}]*animation:\s*image-first-foreground-shrink[^;]*300ms/s);
        expect(galleryCss).toMatch(/\.image-first-record-transitioning[\s\S]*\.image_first_view--outgoing[\s\S]*\.row_article_image_first_reveal_cluster\s*\{[^}]*animation:\s*image-first-record-media-shrink[^;]*300ms/s);
        expect(galleryCss).toMatch(/\.image-first-record-transitioning[\s\S]*\.image_first_view--incoming[\s\S]*\.row_article_image_first_reveal_cluster\s*\{[^}]*animation:\s*image-first-record-media-grow[^;]*300ms/s);
        expect(galleryCss).toMatch(/\.image-first-record-transitioning[\s\S]*\.image_first_view--incoming[\s\S]*\.row_article_image_first_stage::before\s*\{[^}]*content:\s*none;/s);
        expect(galleryCss).toMatch(/\.image_first_view\.image_first_view--settled\s*\{[^}]*animation:\s*none;/s);
        expect(galleryCss).toMatch(/\.row_article_image_first_stage::before\s*\{[^}]*position:\s*fixed;[^}]*background-image:\s*linear-gradient\([^}]*var\(--image-first-theme-scrim\)[^}]*var\(--row-article-image-first-backdrop, none\);[^}]*backface-visibility:\s*hidden;[^}]*filter:\s*blur\(var\(--image-first-backdrop-blur\)\)[^}]*opacity:\s*var\(--image-first-backdrop-opacity\);[^}]*pointer-events:\s*none;[^}]*transform:\s*translate3d\(0, 0, 0\);[^}]*will-change:\s*opacity;[^}]*animation:\s*image-first-backdrop-reveal var\(--image-first-reveal-duration, 300ms\)[^;]*linear both;/s);
        expect(galleryCss).toMatch(/\.image_first_view_modal\s*\{[^}]*--image-first-backdrop-opacity:\s*0\.78;[^}]*--image-first-theme-scrim:\s*color-mix\([^}]*var\(--bg_color_extreme\) 78%/s);
        expect(galleryCss).toMatch(/body\.dark-mode \.image_first_view_modal\s*\{[^}]*--image-first-theme-scrim:\s*color-mix\([^}]*var\(--bg_color_extreme\) 90%/s);
        expect(galleryCss).not.toMatch(/\.row_article_image_first_stage::before\s*\{[^}]*backdrop-filter:/s);
        expect(galleryCss).toMatch(/\.row_article_image_first_stage\s*\{[^}]*overflow:\s*visible;/s);
        expect(galleryCss).not.toMatch(/\.row_article_image_first_stage\s*\{[^}]*backdrop-filter:/s);
        expect(galleryCss).toMatch(/@keyframes image-first-backdrop-reveal\s*\{[\s\S]*from\s*\{[^}]*opacity:\s*0;[\s\S]*to\s*\{[^}]*opacity:\s*var\(--image-first-backdrop-opacity\);/s);
        expect(galleryCss).toMatch(/@keyframes image-first-backdrop-conceal\s*\{[\s\S]*from\s*\{[^}]*opacity:\s*var\(--image-first-backdrop-opacity\);[\s\S]*to\s*\{[^}]*opacity:\s*0;/s);
        expect(galleryCss).toMatch(/\.row_article_image_first_stage\s*\{[^}]*background:\s*transparent;/s);
        expect(galleryCss).toMatch(/\.image_first_view\s*\{[^}]*background:\s*transparent;/s);
        expect(svgPresentationCss).toMatch(/\.row_article_image_first_media\.service_catalog_logo_frame\[[\s\S]*data-service-catalog-logo-render-mode="css"[\s\S]*\]\s*\{[^}]*width:\s*min\(100%, 100dvh\);[^}]*height:\s*min\(100dvh, 100vw\);[^}]*aspect-ratio:\s*1;/s);
        expect(svgPresentationCss).toMatch(/\.row_article_image_first_media\.service_catalog_logo_frame--contrast-safe\s*\{[^}]*background-color:\s*transparent !important;[^}]*background-image:\s*none !important;/s);
        expect(modalCss).toMatch(/\.modal_overlay_blur\.image_first_view_overlay\s*\{[^}]*--image-first-reveal-duration:\s*300ms;[^}]*--image-first-application-blur:\s*12px;[^}]*background:\s*transparent;[^}]*backdrop-filter:\s*blur\(var\(--image-first-application-blur\)\);[^}]*animation:\s*image-first-application-blur-reveal[^;]*300ms/s);
        expect(modalCss).toMatch(/@keyframes image-first-application-blur-reveal\s*\{[\s\S]*backdrop-filter:\s*blur\(0\);[\s\S]*backdrop-filter:\s*blur\(var\(--image-first-application-blur\)\);/s);
        expect(modalCss).toMatch(/\.modal_overlay_blur\.image_first_view_overlay\.image-first-view-closing\s*\{[^}]*pointer-events:\s*none;[^}]*animation:\s*image-first-application-blur-conceal[^;]*300ms/s);
        expect(modalCss).not.toMatch(/\.modal_overlay_blur\.image_first_view_overlay::before\s*\{/s);
        expect(modalCss).toMatch(/\.image_modal\.image_first_view_modal\s*\{[^}]*background:\s*transparent;[^}]*backdrop-filter:\s*none;/s);
        expect(modalCss).not.toContain("image-first-modal-background-reveal");
        expect(galleryCss).toMatch(/\.row_article_image_first_media\s*\{[^}]*z-index:\s*1;/s);
        expect(galleryCss).toMatch(/\.row_article_image_first_scroll_hint\s*\{/s);
        expect(galleryCss).toMatch(/\.row_article_image_first_arrow\s*\{[^}]*top:\s*50%;/s);
        expect(galleryCss).toContain("@media (width <= 720px)");
        expect(galleryCss).toMatch(/\.image_first_view_article_content\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*1;[^}]*max-width:\s*800px/s);
        expect(galleryCss).toMatch(/\.image_first_view_modal\s*\{[^}]*height:\s*100dvh;/s);
        expect(modalCss).toMatch(
            /\.image_modal\.image_first_view_modal \.modal_body\s*\{[^}]*overflow:\s*hidden auto;/s,
        );
        expect(modalCss.indexOf(".image_modal.image_first_view_modal .modal_body"))
            .toBeGreaterThan(modalCss.indexOf(".image_modal .modal_body"));
        expect(modalCss).toMatch(
            /\.image_modal \.row_article_image_first_media:not\(\.wrapper\)\s*\{[^}]*display:\s*block;/s,
        );
        expect(modalCss).not.toMatch(
            /\.image_modal \.row_article_image_first_media\s*\{[^}]*display:\s*block;/s,
        );
        expect(modalCss).not.toContain('.image_modal :is(button, a[href], input, select, [role="button"])');
        expect(modalCss).toMatch(/\.image_modal_top_controls\s*\{[^}]*position:\s*fixed;[^}]*display:\s*flex;[^}]*pointer-events:\s*none;/s);
        expect(modalCss).toMatch(/\.image_modal \.image_modal_top_controls \.modal_close_button\s*\{[^}]*position:\s*static;[^}]*border:\s*1px solid var\(--image-modal-control-color\)/s);
        expect(modalCss).toMatch(/transition:\s*opacity var\(--transition-time, 0\.5s\) ease/s);
        expect(galleryCss).toMatch(/\.image_modal_top_controls > \.row_article_row_navigation\s*\{[^}]*display:\s*flex;[^}]*background:\s*transparent;[^}]*pointer-events:\s*none;/s);
        expect(galleryCss).not.toMatch(/\.image_first_view > \.row_article_row_navigation/);
        expect(galleryCss).toMatch(/\.row_article_image_first_arrow\s*\{[^}]*position:\s*absolute;[^}]*top:\s*50%;/s);
        expect(galleryCss).toMatch(/\.row_article_row_navigation_preview_slot\s*\{[^}]*width:\s*34px;[^}]*height:\s*34px;[^}]*display:\s*grid;/s);
        expect(galleryCss).toMatch(/\.row_article_row_navigation_preview\s*\{[^}]*object-fit:\s*contain;/s);
        expect(modalCss).toMatch(/\.image_modal :is\([^)]*\.row_article_image_first_scroll_hint[^)]*\)\s*\{[^}]*opacity:\s*0;/s);
        expect(modalCss).toMatch(/\.image-modal-content-scrolled[\s\S]*\.row_article_image_first_scroll_hint\s*\{[^}]*opacity:\s*0;/s);
        expect(modalCss).toMatch(/@media \(hover:\s*none\), \(pointer:\s*coarse\)[\s\S]*\.row_article_row_navigation_button[\s\S]*opacity:\s*1;[\s\S]*pointer-events:\s*auto;/s);
        expect(modalCss).toMatch(/\.image_modal\s*\{[^}]*--image-modal-disabled-control-opacity:\s*0\.52;/s);
        expect(modalCss).toMatch(/\.image-modal-controls-active[\s\S]*\.row_article_row_navigation_button[\s\S]*:disabled\s*\{[^}]*opacity:\s*var\(--image-modal-disabled-control-opacity\);[^}]*pointer-events:\s*auto;[^}]*cursor:\s*not-allowed;/s);
        expect(galleryCss).not.toMatch(/\.image_first_view_article_content > \.big_card_header\s*\{/s);
        const bigCardCss = fs.readFileSync(
            path.join(directory, "cards_big.css"),
            "utf8",
        );
        expect(bigCardCss).toMatch(/\.big_card_header\s*\{[^}]*justify-content:\s*flex-start;[^}]*width:\s*calc\(100% - 20px\);[^}]*margin:\s*0px 10px 30px 10px;[^}]*text-align:\s*left;/s);
        expect(modalCss).not.toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.image_first_view_overlay::before[\s\S]*animation:\s*none;/s);
        expect(galleryCss).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.image_first_view,[^}]*\.row_article_image_first_stage::before,[^}]*animation:\s*none;/s);
        expect(variablesCss).toContain("--filterbar-hero-title-max-width: 1200px");
        expect(filterbarContentCss).toContain("var(--filterbar-hero-title-max-width, 1200px)");
        expect(filterbarContentCss).toMatch(/\.filterbar-inline-hero \.filter-content-inner\s*\{[^}]*max-width:\s*var\(--filterbar-hero-title-max-width, 1200px\)/s);
        expect(filterbarContentCss).toMatch(/\.filterbar-inline-hero \.filter-content-inner > :not\(\.morphing-header\)\s*\{[^}]*max-width:\s*var\(--filterbar-hero-content-max-width, 550px\)/s);
        expect(uiConfig).toMatch(/enable_experimental_row_article_row_navigation\s*=\s*true/);
    });
});
