// @vitest-environment jsdom
// ui_config.test.js
// Verifies shared frontend layout breakpoints for viewport and container card modes.
// Bridges responsive CSS expectations and JS media-folder decisions.
// Exists to prevent the card/filterbar threshold split from drifting silently.

import { describe, expect, test } from "vitest";

import {
    isCardStackViewport,
    resolveCardMediaFolder,
} from "./ui_config.js";

describe("ui_config card stack breakpoints", () => {
    test("forces stacked card behavior at the viewport breakpoint", () => {
        expect(isCardStackViewport(1550)).toBe(true);
        expect(isCardStackViewport(1551)).toBe(false);
        expect(resolveCardMediaFolder(1550, { basis: "viewport" })).toBe("1000");
        expect(resolveCardMediaFolder(1551, { basis: "viewport" })).toBe("300");
    });

    test("keeps the container threshold separate for measured card widths", () => {
        expect(resolveCardMediaFolder(1060)).toBe("1000");
        expect(resolveCardMediaFolder(1061)).toBe("300");
    });
});
