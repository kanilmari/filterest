// @vitest-environment jsdom
// experimental_free_layout_card_store.test.js
// Verifies localStorage persistence for the removable experimental card-style prototype.
// Bridges the store API and browser storage without rendering the actual cards.
// Exists to keep the prototype's low-coupling storage contract stable while the UI evolves.

import { beforeEach, describe, expect, test } from "vitest";

import {
    buildCardStyleStorageKey,
    buildExperimentalLayoutStorageKey,
    clearExperimentalLayoutTemplate,
    EXPERIMENTAL_FREE_LAYOUT_CARD_STYLE_VARIANT,
    getEffectiveCardStyleVariant,
    getCardStyleVariant,
    isExperimentalFreeLayoutAvailable,
    isExperimentalDesignModeEnabled,
    loadExperimentalLayoutTemplate,
    saveExperimentalLayoutTemplate,
    setCardStyleVariant,
    setExperimentalDesignModeEnabled,
    STANDARD_CARD_STYLE_VARIANT,
} from "./experimental_free_layout_card_store.js";

describe("experimental_free_layout_card_store", () => {
    beforeEach(() => {
        localStorage.clear();
        document.head.innerHTML = "";
    });

    test("falls back to the standard style for missing or invalid storage values", () => {
        expect(getCardStyleVariant("orders")).toBe(STANDARD_CARD_STYLE_VARIANT);

        localStorage.setItem(buildCardStyleStorageKey("orders"), "mystery-style");
        expect(getCardStyleVariant("orders")).toBe(STANDARD_CARD_STYLE_VARIANT);
    });

    test("persists the selected card style variant", () => {
        expect(
            setCardStyleVariant(
                "orders",
                EXPERIMENTAL_FREE_LAYOUT_CARD_STYLE_VARIANT
            )
        ).toBe(EXPERIMENTAL_FREE_LAYOUT_CARD_STYLE_VARIANT);
        expect(getCardStyleVariant("orders")).toBe(
            EXPERIMENTAL_FREE_LAYOUT_CARD_STYLE_VARIANT
        );
    });

    test("treats the experimental card style as dev-only", () => {
        setCardStyleVariant(
            "orders",
            EXPERIMENTAL_FREE_LAYOUT_CARD_STYLE_VARIANT
        );

        expect(isExperimentalFreeLayoutAvailable()).toBe(false);
        expect(getEffectiveCardStyleVariant("orders")).toBe(
            STANDARD_CARD_STYLE_VARIANT
        );

        document.head.innerHTML =
            '<meta name="app-env" content="dev">';

        expect(isExperimentalFreeLayoutAvailable()).toBe(true);
        expect(getEffectiveCardStyleVariant("orders")).toBe(
            EXPERIMENTAL_FREE_LAYOUT_CARD_STYLE_VARIANT
        );
    });

    test("round-trips the experimental layout template", () => {
        saveExperimentalLayoutTemplate("orders", {
            columns: 24,
            items: {
                "header:title": { x: 3, y: 2, w: 10, h: 3 },
            },
        });

        expect(localStorage.getItem(buildExperimentalLayoutStorageKey("orders"))).toContain(
            '"header:title"'
        );
        expect(loadExperimentalLayoutTemplate("orders")).toEqual({
            version: 1,
            columns: 24,
            items: {
                "header:title": { x: 3, y: 2, w: 10, h: 3 },
            },
        });

        clearExperimentalLayoutTemplate("orders");
        expect(loadExperimentalLayoutTemplate("orders")).toBeNull();
    });

    test("stores the local designer mode separately from the layout template", () => {
        expect(isExperimentalDesignModeEnabled("orders")).toBe(false);

        setExperimentalDesignModeEnabled("orders", true);
        expect(isExperimentalDesignModeEnabled("orders")).toBe(true);
    });
});
