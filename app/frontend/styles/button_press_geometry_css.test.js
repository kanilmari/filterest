// button_press_geometry_css.test.js
// Verifies that source CSS never changes control geometry in a pressed state.
// Bridges the shared stationary-button interaction rule with independently styled controls.
// Exists so active-state feedback cannot make buttons jump, shrink, or lose centring.

import fs from "node:fs";
import path from "node:path";

import { globSync } from "glob";
import { describe, expect, test } from "vitest";

const FORBIDDEN_GEOMETRY_DECLARATION = /(?:^|;)\s*(?:transform|translate|scale|rotate|top|right|bottom|left|inset(?:-[a-z]+)?|margin(?:-[a-z]+)?|width|height)\s*:/i;

describe("stationary pressed controls", () => {
    test("active CSS rules never alter geometry", () => {
        const violations = [];
        const files = globSync("frontend/**/*.css", {
            cwd: process.cwd(),
            ignore: ["frontend/dist/**"],
        });

        files.forEach((relativePath) => {
            const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
            const rulePattern = /([^{}]*:active[^{}]*)\{([^{}]*)\}/g;
            for (const match of source.matchAll(rulePattern)) {
                if (FORBIDDEN_GEOMETRY_DECLARATION.test(match[2])) {
                    violations.push(`${relativePath}: ${match[1].trim()}`);
                }
            }
        });

        expect(violations).toEqual([]);
    });
});
