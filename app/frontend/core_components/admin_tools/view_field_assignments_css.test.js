// @vitest-environment node
// view_field_assignments_css.test.js
// Verifies that the administrator field list participates in page scrolling.
// Exists so a nested, height-limited scrollbar does not return to the long editor.

import { describe, expect, test } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));

describe("view field assignments CSS", () => {
    test("keeps the field list in normal page flow", () => {
        const css = readFileSync(resolve(CURRENT_DIR, "view_field_assignments_view.css"), "utf8");
        const rule = css.match(/\.view-field-assignments__field-list\s*\{([^}]*)\}/)?.[1] || "";

        expect(rule).not.toMatch(/max-height\s*:/);
        expect(rule).not.toMatch(/overflow(?:-y)?\s*:/);
    });
});
