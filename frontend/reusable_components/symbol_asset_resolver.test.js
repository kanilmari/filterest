// symbol_asset_resolver.test.js
// Verifies metadata symbol keys become same-origin mask URLs without HTML injection.
// Bridges database icon metadata and the shared dataset/field symbol renderer.
// Exists so unsafe paths or markup never become browser asset URLs.
// @vitest-environment jsdom

import { describe, expect, test } from "vitest";

import {
    createSymbolMaskElement,
    getSymbolAssetUrl,
    normalizeSymbolKey,
} from "./symbol_asset_resolver.js";

describe("symbol_asset_resolver", () => {
    test("accepts safe keys and falls back for paths or markup", () => {
        expect(normalizeSymbolKey(" Travel-Map ")).toBe("travel-map");
        expect(normalizeSymbolKey("../../secret")).toBe("table");
        expect(normalizeSymbolKey("<svg>")).toBe("table");
        expect(getSymbolAssetUrl("travel-map")).toBe("/symbol-assets/travel-map.svg");
    });

    test("creates a CSS mask without inserting SVG markup", () => {
        const icon = createSymbolMaskElement("payments");

        expect(icon.classList.contains("metadata-symbol-icon")).toBe(true);
        expect(icon.dataset.symbolKey).toBe("payments");
        expect(icon.style.getPropertyValue("--metadata-symbol-url"))
            .toContain("/symbol-assets/payments.svg");
        expect(icon.innerHTML).toBe("");
    });
});
