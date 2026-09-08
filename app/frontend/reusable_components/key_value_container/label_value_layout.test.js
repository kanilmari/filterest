// label_value_layout.test.js
// Verifies explicit field arrangements preserve content, link safety and absent labels.
// Connects shared column metadata with existing renderer DOM.
// Protects inherited behavior when the optional default is null or unsupported.
// @vitest-environment jsdom

import { describe, expect, test } from "vitest";
import { applyLabelValueLayout, normalizeLabelValueLayout } from "./label_value_layout.js";

describe("shared field label/value layout", () => {
    test.each([undefined, null, "", "INLINE", "unknown", false, {}])(
        "leaves legacy DOM and measurements unchanged for %s", (setting) => {
            const pair = document.createElement("div");
            pair.innerHTML = '<span>Label</span><span class="kv-dropped">Value</span>';
            pair.style.cssText = "display: grid; grid-template-columns: 1fr 2fr";
            const before = pair.outerHTML;
            expect(normalizeLabelValueLayout(setting)).toBeNull();
            expect(applyLabelValueLayout(pair, pair.firstChild, pair.lastChild, setting)).toBe(false);
            expect(pair.outerHTML).toBe(before);
        },
    );
    test.each(["auto", "inline", "stacked"])(
        "changes only arrangement for %s and preserves the existing safe link", (setting) => {
            const pair = document.createElement("div");
            pair.innerHTML = '<span lang="fi">Osoite</span><div data-raw-value="original"><a href="https://example.test" target="_blank" rel="noopener noreferrer">Open</a></div>';
            pair.style.display = "grid";
            const label = pair.firstChild;
            const value = pair.lastChild;
            const link = value.firstChild;
            value.className = "kv-dropped";
            value.style.marginLeft = "120px";
            expect(applyLabelValueLayout(pair, label, value, setting)).toBe(true);
            expect(pair.dataset.labelValueLayout).toBe(setting);
            expect(pair.firstChild).toBe(label);
            expect(pair.lastChild).toBe(value);
            expect(value.firstChild).toBe(link);
            expect(value.dataset.rawValue).toBe("original");
            expect(link.getAttribute("href")).toBe("https://example.test");
            expect(link.getAttribute("rel")).toBe("noopener noreferrer");
            expect(label.textContent).toBe("Osoite");
            expect(value.classList.contains("kv-dropped")).toBe(false);
            expect(value.style.marginLeft).toBe("");
        },
    );
    test("does not restore a deliberately hidden label", () => {
        const pair = document.createElement("div");
        const value = document.createElement("div");
        value.textContent = "Visible value";
        pair.append(value);
        applyLabelValueLayout(pair, null, value, "stacked");
        expect(pair.children).toHaveLength(1);
        expect(pair.classList.contains("label-value-layout--value-only")).toBe(true);
        expect(pair.querySelector(".label-value-layout__label")).toBeNull();
    });
});
