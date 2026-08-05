// card_detail_icon_builder.test.js
// Verifies card-detail icon keys resolve through the curated icon registry.
// Bridges column metadata keys and safe SVG strings consumed by card detail renderers.
// Exists to keep metadata-driven card icons predictable without framework packages.

import { describe, expect, test } from "vitest";

import {
    getCardDetailIconOptions,
    getCardDetailIconSvgMarkup,
    normalizeClientCardDetailIconKey,
    resolveCardDetailIconKey,
} from "./card_detail_icon_builder.js";

describe("card_detail_icon_builder", () => {
    test("normalizes known icon keys and rejects unknown keys", () => {
        expect(normalizeClientCardDetailIconKey(" Calendar ")).toBe("calendar");
        expect(normalizeClientCardDetailIconKey("not-real")).toBe("");
    });

    test("uses explicit metadata keys before column-name fallback", () => {
        expect(resolveCardDetailIconKey("tag", "created_at")).toBe("tag");
        expect(resolveCardDetailIconKey("", "created_at")).toBe("calendar");
    });

    test("returns SVG markup only for registry-backed or matched keys", () => {
        expect(getCardDetailIconSvgMarkup("user")).toContain("<svg");
        expect(getCardDetailIconSvgMarkup("info")).toContain("<svg");
        expect(getCardDetailIconSvgMarkup("", "price_euros")).toContain("<svg");
        expect(resolveCardDetailIconKey("", "pulttijako")).toBe("bolt-pattern");
        expect(resolveCardDetailIconKey("", "tuumakoko")).toBe("ruler");
        expect(getCardDetailIconSvgMarkup("", "plain_text")).toBe("");
    });

    test("uses the shared Material Symbols registry for common card labels", () => {
        const calendarSvg = getCardDetailIconSvgMarkup("calendar");
        const descriptionSvg = getCardDetailIconSvgMarkup("file-text");
        const tagSvg = getCardDetailIconSvgMarkup("tag");

        expect(calendarSvg).toContain('viewBox="0 -960 960 960"');
        expect(descriptionSvg).toContain('viewBox="0 -960 960 960"');
        expect(tagSvg).toContain('viewBox="0 -960 960 960"');
        expect(calendarSvg).toContain('fill="currentColor"');
    });

    test("keeps the euro icon as one compact symbol instead of detached strokes", () => {
        const euroSvg = getCardDetailIconSvgMarkup("euro");

        expect(euroSvg).toContain("M18 6.4");
        expect(euroSvg).not.toContain("M4 10h12");
    });

    test("offers an empty option plus named icon choices for admin controls", () => {
        const options = getCardDetailIconOptions();

        expect(options[0]).toEqual({ value: "", label: "none" });
        expect(options.some((option) => option.value === "bolt-pattern")).toBe(true);
        expect(options.some((option) => option.value === "calendar")).toBe(true);
        expect(options.some((option) => option.value === "info")).toBe(true);
    });
});
