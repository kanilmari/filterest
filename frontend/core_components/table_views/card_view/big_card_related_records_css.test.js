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
});
