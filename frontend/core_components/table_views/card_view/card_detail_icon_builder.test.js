// card_detail_icon_builder.test.js
// Verifies card-detail icon keys resolve through the curated icon registry.
// Bridges column metadata keys and safe SVG strings consumed by card detail renderers.
// Exists to keep metadata-driven card icons predictable without framework packages.

import { describe, expect, test } from "vitest";

import {
    getCardDetailIconOptions,
    normalizeClientCardDetailIconKey,
    resolveCardDetailIconKey,
} from "./card_detail_icon_builder.js";

describe("card_detail_icon_builder", () => {
    test("normalizes safe registry keys and rejects paths or markup", () => {
        expect(normalizeClientCardDetailIconKey(" Calendar ")).toBe("calendar");
        expect(normalizeClientCardDetailIconKey("travel-map")).toBe("travel-map");
        expect(normalizeClientCardDetailIconKey("../../secret")).toBe("");
        expect(normalizeClientCardDetailIconKey("<svg>")).toBe("");
    });

    test("uses explicit metadata keys before column-name fallback", () => {
        expect(resolveCardDetailIconKey("tag", "created_at")).toBe("tag");
        expect(resolveCardDetailIconKey("", "created_at")).toBe("calendar");
    });

    test("returns safe registry keys for semantic column names", () => {
        expect(resolveCardDetailIconKey("user")).toBe("user");
        expect(resolveCardDetailIconKey("info")).toBe("info");
        expect(resolveCardDetailIconKey("", "price_euros")).toBe("euro");
        expect(resolveCardDetailIconKey("", "pulttijako")).toBe("bolt-pattern");
        expect(resolveCardDetailIconKey("", "tuumakoko")).toBe("ruler");
        expect(resolveCardDetailIconKey("", "plain_text")).toBe("");
    });

    test("offers an empty option plus named icon choices for admin controls", () => {
        const options = getCardDetailIconOptions();

        expect(options[0]).toEqual({ value: "", label: "none" });
        expect(options.some((option) => option.value === "bolt-pattern")).toBe(true);
        expect(options.some((option) => option.value === "calendar")).toBe(true);
        expect(options.some((option) => option.value === "info")).toBe(true);
    });
});
