// card_detail_layout_options.test.js
// Verifies persisted card-detail layout values normalize to renderable frontend modes.
// Bridges table metadata strings and the card-detail rendering dispatcher.
// Exists to keep legacy multiline data compatible while adding selectable layout modes.

import { describe, expect, test } from "vitest";
import {
    CARD_DETAILS_LAYOUT_VALUES,
    CARD_STYLE_VARIANT_VALUES,
    normalizeClientCardDetailsLayout,
    normalizeClientCardStyleVariant,
    resolveKvLayoutModeForCardDetails,
} from "./card_detail_layout_options.js";

describe("card_detail_layout_options", () => {
    test("normalizes supported card detail layout values", () => {
        expect(normalizeClientCardDetailsLayout("single_line")).toBe(CARD_DETAILS_LAYOUT_VALUES.SINGLE_LINE);
        expect(normalizeClientCardDetailsLayout("stacked")).toBe(CARD_DETAILS_LAYOUT_VALUES.STACKED);
        expect(normalizeClientCardDetailsLayout("inline")).toBe(CARD_DETAILS_LAYOUT_VALUES.INLINE);
        expect(normalizeClientCardDetailsLayout("conditional_multiline")).toBe(
            CARD_DETAILS_LAYOUT_VALUES.CONDITIONAL_MULTILINE
        );
    });

    test("treats legacy multiline and unknown values as conditional multiline", () => {
        expect(normalizeClientCardDetailsLayout("multiline")).toBe(
            CARD_DETAILS_LAYOUT_VALUES.CONDITIONAL_MULTILINE
        );
        expect(normalizeClientCardDetailsLayout("")).toBe(CARD_DETAILS_LAYOUT_VALUES.CONDITIONAL_MULTILINE);
        expect(normalizeClientCardDetailsLayout("unexpected")).toBe(
            CARD_DETAILS_LAYOUT_VALUES.CONDITIONAL_MULTILINE
        );
    });

    test("maps selectable layouts to kv renderer modes", () => {
        expect(resolveKvLayoutModeForCardDetails("stacked")).toBe("stacked");
        expect(resolveKvLayoutModeForCardDetails("inline")).toBe("inline");
        expect(resolveKvLayoutModeForCardDetails("conditional_multiline")).toBe("conditional");
        expect(resolveKvLayoutModeForCardDetails("multiline")).toBe("conditional");
    });

    test("normalizes supported card style variants", () => {
        expect(normalizeClientCardStyleVariant("modern")).toBe(CARD_STYLE_VARIANT_VALUES.MODERN);
        expect(normalizeClientCardStyleVariant("standard")).toBe(CARD_STYLE_VARIANT_VALUES.STANDARD);
        expect(normalizeClientCardStyleVariant("unknown")).toBe(CARD_STYLE_VARIANT_VALUES.STANDARD);
    });
});
