// row_article_disclosure_sections_css.test.js
// Verifies article disclosure headers follow the filterbar disclosure chrome.
// Bridges the shared disclosure CSS variables with article-only section styling.
// Exists so right-side vertical chevrons and undifferentiated section mass do not return.

import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cssPath = path.join(__dirname, "row_article_disclosure_sections.css");
const css = fs.readFileSync(cssPath, "utf8");

function ruleBody(selectorPattern) {
    return css.match(new RegExp(`${selectorPattern}\\s*\\{(?<body>[^}]+)\\}`, "s"))
        ?.groups?.body || "";
}

describe("row_article_disclosure_sections.css", () => {
    test("uses left-side sideways-to-down chevrons with filterbar outlines", () => {
        const sectionRule = ruleBody("\\.row_article_disclosure_section");
        const adjacentSectionRule = ruleBody(
            "\\.row_article_disclosure_section \\+ \\.row_article_disclosure_section"
        );
        const chevronRule = ruleBody(
            "\\.row_article_disclosure_section > \\.row_article_disclosure_header "
            + "\\.animated-disclosure-chevron"
        );

        expect(sectionRule).toContain(
            "--animated-disclosure-chevron-collapsed-rotation: -90deg"
        );
        expect(sectionRule).toContain(
            "--animated-disclosure-chevron-expanded-rotation: 0deg"
        );
        expect(sectionRule).toContain("background: var(--bg_color_extreme)");
        expect(sectionRule).toContain(
            "border-block: 2px solid var(--fw-color-border)"
        );
        expect(sectionRule).toContain("border-radius: 0");
        expect(sectionRule).toContain("margin: 0");
        expect(adjacentSectionRule).toContain("margin-top: -2px");
        expect(chevronRule).toContain("order: -1");
    });

    test("matches filterbar header alignment while retaining article content spacing", () => {
        const headerRule = ruleBody(
            "\\.row_article_disclosure_section > \\.row_article_disclosure_header"
        );
        const titleGroupRule = ruleBody(
            "\\.row_article_disclosure_section \\.animated-disclosure-title-group"
        );
        const contentRule = ruleBody("\\.row_article_disclosure_content");

        expect(headerRule).toContain("justify-content: flex-start");
        expect(headerRule).toContain("min-height: 56px");
        expect(headerRule).toContain("padding: 0 14px 0 22px");
        expect(headerRule).toContain(
            "background: var(--row-article-disclosure-heading-bg)"
        );
        expect(headerRule).not.toContain("border-bottom");
        expect(titleGroupRule).toContain("gap: 14px");
        expect(contentRule).toContain("padding: 0.75rem 0.25rem 0.95rem");
    });
});
