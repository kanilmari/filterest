// @vitest-environment node
// article_view_seam_css.test.js
// Verifies the article selector and content panels join the shared top bar cleanly.
// Exists to prevent duplicate top borders from recreating a visible horizontal seam.

import { describe, expect, test } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const currentDirectory = dirname(fileURLToPath(import.meta.url));

function readCss(fileName) {
    return readFileSync(resolve(currentDirectory, fileName), "utf8");
}

describe("article view top seam", () => {
    test("removes the empty top-controls grid row from article mode", () => {
        const css = readCss("cards.css");
        const controlsRule = css.match(
            /\.scrollable_content:has\(\.card_view_wrapper\.big-card-open\) > \.dataset-results-surface > \.card_top_controls\s*\{([^}]*)\}/
        )?.[1] || "";
        const wrapperRule = css.match(
            /\.scrollable_content:has\(\.card_view_wrapper\.big-card-open\) > \.dataset-results-surface > \.card_view_wrapper\.big-card-open\s*\{([^}]*)\}/
        )?.[1] || "";

        expect(controlsRule).toContain("display: none");
        const parentRule = css.match(
            /\.scrollable_content:has\(\.card_view_wrapper\.big-card-open\)\s*\{([^}]*)\}/
        )?.[1] || "";

        expect(parentRule).toContain("grid-template-rows: minmax(0, 1fr)");
        expect(wrapperRule).toContain("grid-row: 1");
        expect(wrapperRule).toContain("margin-block-start: -1px");
    });

    test("removes the selector rail's own top border", () => {
        const css = readCss("cards.css");
        const rule = css.match(
            /\.card_view_wrapper\.big-card-open \.card_sidebar_panel\s*\{([^}]*)\}/
        )?.[1] || "";

        expect(rule).toContain("border-top: 0");
    });

    test("removes the article content panel's own top border", () => {
        const css = readCss("cards_big.css");
        const rule = css.match(
            /\.card_view_wrapper\.big-card-open \.big_card_container\s*\{([^}]*)\}/
        )?.[1] || "";

        expect(rule).toContain("border-top: 0");
    });

    test("keeps article chrome full-width while padding text and action controls", () => {
        const css = readCss("cards_big.css");
        const containerRule = css.match(
            /\.big_card_container\.row_article_container\s*\{([^}]*)\}/
        )?.[1] || "";
        const headerRule = css.match(/\.big_card_header\s*\{([^}]*)\}/)?.[1] || "";
        const descriptionRule = css.match(
            /\.big_card_description_container\s*\{([^}]*)\}/
        )?.[1] || "";
        const actionBarRule = css.match(/\.big_card_action_bar\s*\{([^}]*)\}/)?.[1] || "";

        expect(containerRule).toContain("padding: 0");
        expect(headerRule).toContain("padding-block-start: 19px");
        expect(headerRule).toContain("padding-inline: 1rem");
        expect(descriptionRule).toContain("padding: 20px 1rem");
        expect(actionBarRule).toContain("border-top: 1px solid var(--border_color)");
        expect(actionBarRule).toContain("padding: 0.75rem 1rem 1rem");
    });

    test("does not animate a temporary gap above the article panes", () => {
        const css = readCss("../../filterbar/filterbar_layout.css");
        const rule = css.match(
            /\.tab_parts_container:has\(\.card_view_wrapper\.big-card-open\) \.scrollable_content\s*\{([^}]*)\}/
        )?.[1] || "";

        expect(rule).toContain("padding-top: 0");
        expect(rule).toContain("transition: none");
    });
});
