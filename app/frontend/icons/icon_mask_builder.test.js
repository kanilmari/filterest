// icon_mask_builder.test.js
// Verifies CSS-mask icon spans are built without inline SVG markup.
// Bridges icon asset paths with DOM style assertions in jsdom.
// Exists to keep compatibility cleanups from regressing back to injected <svg><path>.
// @vitest-environment jsdom

import { describe, expect, test } from "vitest";
import { createMaskIconSpan } from "./icon_mask_builder.js";

describe("createMaskIconSpan", () => {
    test("creates an aria-hidden span with mask-image styles", () => {
        const icon = createMaskIconSpan("/frontend/icons/general/chevron-down-icon.svg", [
            "demo-icon",
        ]);

        expect(icon.tagName).toBe("SPAN");
        expect(icon.classList.contains("demo-icon")).toBe(true);
        expect(icon.getAttribute("aria-hidden")).toBe("true");
        expect(icon.innerHTML).toBe("");
        expect(icon.style.webkitMaskImage).toContain("chevron-down-icon.svg");
        expect(icon.style.maskImage).toContain("chevron-down-icon.svg");
        expect(icon.querySelector("svg")).toBeNull();
    });
});
