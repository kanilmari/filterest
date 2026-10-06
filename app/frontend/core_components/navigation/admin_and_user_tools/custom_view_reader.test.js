// @vitest-environment node
// custom_view_reader.test.js
// Verifies heavy views stay lazy so light shells do not download them.
// Bridges the custom-view registry source with the login/catalog module graph.
// Exists so shared shells do not acquire unrelated static view dependencies.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const sourcePath = fileURLToPath(new URL("./custom_view_reader.js", import.meta.url));

describe("custom_view_reader module graph", () => {
    test("keeps translation_handler free of a static card-view import", () => {
        const translationPath = path.resolve(
            path.dirname(sourcePath),
            "../../lang/translation_handler.js"
        );
        const source = fs.readFileSync(translationPath, "utf8");
        expect(source).not.toMatch(
            /import\s*\{[^}]*refreshCardLanguages[^}]*\}\s*from\s*['"][^'"]*card_view_printer\.js['"]/
        );
        expect(source).toContain("await import('../table_views/card_view/card_view_printer.js')");
    });
});

// The code registry owns tool identity; no server-side duplicate catalogue exists.
test("visible administrator tools have unique permission routes", () => {
    const source = fs.readFileSync(sourcePath, "utf8");
    const entries = source.split(/\n {4}\{/).filter((entry) => /group: 'admin_tools'/.test(entry));
    const routes = entries.filter((entry) => !/navigationHidden: true/.test(entry))
        .map((entry) => entry.match(/requiredPermission: '([^']+)'/)?.[1]).filter(Boolean);
    expect(routes.length).toBeGreaterThan(15);
    expect(new Set(routes).size).toBe(routes.length);
});
