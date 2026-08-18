// big_card_related_records_css.test.js
// Verifies related-record article tabs keep header and row columns visually aligned.
// Bridges the child-tab CSS grid contract and DOM builders that emit compact related rows.
// Exists so audit timestamp columns do not drift per row content width.

import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cssPath = path.join(__dirname, "big_card_related_records.css");
const css = fs.readFileSync(cssPath, "utf8");

function ruleBody(selectorPattern) {
    return css.match(new RegExp(`${selectorPattern}\\s*\\{(?<body>[^}]+)\\}`, "s"))
        ?.groups?.body || "";
}

describe("big_card_related_records.css", () => {
    test("uses shared fixed grid tracks for related headers and rows", () => {
        const sharedRule = css.match(
            /\.child_record_list_header,\s*\.child_record_summary_row\s*\{(?<body>[^}]+)\}/s
        )?.groups?.body || "";

        expect(sharedRule).toContain("--child-record-list-columns");
        expect(sharedRule).toContain("grid-template-columns: var(--child-record-list-columns)");
        expect(sharedRule).toContain("10rem");
        expect(sharedRule).not.toContain("max-content");
    });

    test("renders flat edge-to-edge tabs without a top spacer or duplicate rule", () => {
        const containerRule = ruleBody("\\.child_tabs_container");
        const barRule = ruleBody("\\.child_tabs_bar");
        const buttonRule = ruleBody("\\.child_tab_button");
        const activeRule = ruleBody("\\.child_tab_button\\.active");

        expect(containerRule).toContain("margin: 0");
        expect(containerRule).toContain("border-top: 0");
        expect(containerRule).toContain("padding-top: 0");
        expect(barRule).toContain("width: 100%");
        expect(barRule).toContain("border-bottom: 2px solid var(--border_color)");
        expect(buttonRule).toContain("border-radius: 0");
        expect(buttonRule).toContain("box-shadow: none");
        expect(activeRule).toContain("border-bottom-color: var(--accent_color");
        expect(activeRule).toContain("background: color-mix(");
        expect(activeRule).toContain("font-weight: 700");
    });

    test("gives the comments panel ten extra pixels before the following article action row", () => {
        const commentsPanelRule = ruleBody("\\.comments_tab_panel");

        expect(commentsPanelRule).toContain("padding-bottom: calc(0.75rem + 10px)");
        expect(commentsPanelRule).toContain("overflow: visible");
    });
});
