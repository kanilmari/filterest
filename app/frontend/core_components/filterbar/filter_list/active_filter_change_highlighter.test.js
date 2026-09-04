// active_filter_change_highlighter.test.js
// Verifies filter chips acknowledge semantic additions and removals without rerender flicker.
// Bridges stable filter signatures with the short active-filter highlight CSS state.
// Exists to keep the visual acknowledgement tied to real state changes only.
// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from "vitest";
import { highlightActiveFilterSetChange } from "./active_filter_change_highlighter.js";

describe("highlightActiveFilterSetChange", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    test("skips first render and repeated signatures but highlights a real change", () => {
        vi.useFakeTimers();
        const container = document.createElement("div");

        expect(highlightActiveFilterSetChange(container, ["status::open"])).toBe(false);
        expect(container.classList.contains("active-filters--change-highlight")).toBe(false);
        expect(highlightActiveFilterSetChange(container, ["status::open"])).toBe(false);

        expect(
            highlightActiveFilterSetChange(container, ["status::open", "owner::7"])
        ).toBe(true);
        expect(container.classList.contains("active-filters--change-highlight")).toBe(true);

        vi.advanceTimersByTime(720);
        expect(container.classList.contains("active-filters--change-highlight")).toBe(false);
    });

    test("does not highlight after the last active filter is removed", () => {
        const container = document.createElement("div");
        highlightActiveFilterSetChange(container, ["status::open"]);

        expect(highlightActiveFilterSetChange(container, [])).toBe(false);
        expect(container.classList.contains("active-filters--change-highlight")).toBe(false);
    });
});
