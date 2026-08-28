// @vitest-environment jsdom
// filterbar_visibility_handler.test.js
// Verifies whole-filterbar visibility persistence and legacy preference migration.
// Exists so reloads and viewport changes keep one user-selected panel state.

import { beforeEach, describe, expect, test } from "vitest";
import {
    getStoredVisibility,
    getVisibilityKey,
    setStoredVisibility,
} from "./filterbar_visibility_handler.js";

describe("filterbar visibility persistence", () => {
    beforeEach(() => {
        localStorage.clear();
        Object.defineProperty(window, "innerWidth", {
            configurable: true,
            value: 1440,
        });
    });

    test("stores one canonical preference that survives viewport changes", () => {
        setStoredVisibility("tickets", true);
        expect(getVisibilityKey("tickets")).toBe("tickets_filterbar_visible");

        Object.defineProperty(window, "innerWidth", {
            configurable: true,
            value: 800,
        });

        expect(getStoredVisibility("tickets")).toBe(true);
    });

    test("migrates the current breakpoint's previous preference once", () => {
        localStorage.setItem("tickets_filterbar_visible_wide", "false");

        expect(getStoredVisibility("tickets")).toBe(false);
        expect(localStorage.getItem("tickets_filterbar_visible")).toBe("false");
    });

    test("prefers the canonical state over stale breakpoint-specific values", () => {
        localStorage.setItem("tickets_filterbar_visible", "true");
        localStorage.setItem("tickets_filterbar_visible_wide", "false");

        expect(getStoredVisibility("tickets")).toBe(true);
    });
});
