// @vitest-environment node
// row_article_phone_css.test.js
// Guards shared phone details and record navigation across article presentations.
// Connects existing selectors to the toolbar's 700px viewport boundary.
// Preserves desktop/tablet labels, thumbnails and control dimensions.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { expectPhoneRule, withoutPhone } from "./row_article_phone_css_test_helpers.js";

const read = file => readFileSync(new URL(file, import.meta.url), "utf8");
const css = read("./cards_big.css");

describe("shared phone article layout", () => {
    test("stacks every detail with wrapping labels and values only through 700px", () => {
        expectPhoneRule(css, ".big_card_details_container .two_line_field", {
            "flex-direction": "column", "align-items": "stretch", "min-width": "0",
        });
        expectPhoneRule(css, ".big_card_details_container .two_line_label", { flex: "0 0 auto" });
        expectPhoneRule(css, ".big_card_details_container .two_line_label_text", {
            overflow: "visible", "text-overflow": "clip", "white-space": "normal", "overflow-wrap": "anywhere",
        });
        expectPhoneRule(css, ".big_card_details_container .two_line_value", {
            "min-width": "0", "white-space": "normal", "overflow-wrap": "anywhere",
        });
        const desktop = withoutPhone(css);
        expect(desktop).toMatch(/\.big_card_details_container \.two_line_field\s*\{[^}]*align-items: baseline;/s);
        expect(desktop).toMatch(/\.big_card_details_container \.two_line_label\s*\{[^}]*flex: 0 0 14rem;/s);
        expect(desktop).toMatch(/\.big_card_details_container \.two_line_label_text\s*\{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;/s);
    });

    test("uses shared 44px icon-only record buttons without changing the tablet gallery", () => {
        expectPhoneRule(css,
            "body :is(.image_first_view_modal, .row_article_inline_media) .row_article_row_navigation_button", {
                width: "44px", "min-width": "44px", height: "44px", "min-height": "44px", padding: "0", gap: "0",
            });
        expectPhoneRule(css, "body .row_article_row_navigation_preview_slot", { display: "none" });
        expectPhoneRule(css, ".row_article_row_navigation", { padding: "0" });
        const gallery = read("./big_card_image_gallery.css");
        expect(gallery).toMatch(/:is\(\.image_first_view_modal, \.row_article_inline_media\) \.row_article_row_navigation_button\s*\{[^}]*width: auto;[^}]*min-width: 48px;[^}]*height: 44px;/s);
        expect(gallery).toMatch(/@media \(width <= 720px\)\s*\{[\s\S]*?\.image_first_view_modal \.row_article_row_navigation_button\s*\{[^}]*min-width: 42px;[^}]*height: 40px;/s);
        expect(gallery).toMatch(/\.row_article_row_navigation_preview_slot\s*\{[^}]*width: 34px;[^}]*height: 34px;/s);
        expect(withoutPhone(css)).not.toMatch(/\.row_article_row_navigation_preview_slot\s*\{[^}]*display: none;/s);
    });
});
