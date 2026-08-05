// card_detail_tile_builder.test.js
// Verifies modern card detail tiles render icons, labels, values, and links.
// Bridges card_style_variant=modern behavior and per-column card_detail_icon_key metadata.
// Exists to keep the new modern card variant independent from legacy KV renderers.
// @vitest-environment jsdom

import { describe, expect, test } from "vitest";

import { renderModernCardDetails } from "./card_detail_tile_builder.js";

describe("card_detail_tile_builder", () => {
    test("renders configured icon keys with label and value text", () => {
        const container = document.createElement("div");

        renderModernCardDetails(container, [{
            column: "created_at",
            label: "Created",
            rawValue: "2026-05-07",
        }], {
            created_at: {
                card_detail_icon_key: "calendar",
                card_detail_label_mode: "both",
            },
        });

        expect(container.classList.contains("card_details_modern_tiles")).toBe(true);
        expect(container.querySelector(".card_detail_tile_icon svg")).not.toBeNull();
        expect(container.querySelector(".card_detail_tile_label")?.textContent).toBe("Created");
        expect(container.querySelector(".card_detail_tile_value")?.textContent).toBe("2026-05-07");
    });

    test("preserves detail hover text from titleValue", () => {
        const container = document.createElement("div");

        renderModernCardDetails(container, [{
            column: "created_at",
            label: "Created",
            rawValue: "2026-06-15 21:36",
            titleValue: "2026-06-15 21:36:10",
        }]);

        const value = container.querySelector(".card_detail_tile_value");

        expect(value?.textContent).toBe("2026-06-15 21:36");
        expect(value?.title).toBe("2026-06-15 21:36:10");
    });

    test("falls back to column-name icon heuristics and handles links", () => {
        const container = document.createElement("div");

        renderModernCardDetails(container, [{
            column: "website_url",
            label: "Website",
            rawValue: "https://example.test",
            isLink: true,
        }]);

        const link = container.querySelector(".card_detail_tile_value_link");
        expect(container.querySelector(".card_detail_tile_icon svg")).not.toBeNull();
        expect(link?.getAttribute("href")).toBe("https://example.test");
        expect(link?.getAttribute("target")).toBe("_blank");
    });

    test("keeps icon-only labels accessible through tile metadata", () => {
        const container = document.createElement("div");

        renderModernCardDetails(container, [{
            column: "priority",
            label: "Priority",
            rawValue: "high",
        }], {
            priority: {
                card_detail_icon_key: "alert-circle",
                card_detail_label_mode: "icon",
            },
        });

        expect(container.querySelector(".card_detail_tile_label")).toBeNull();
        expect(container.querySelector(".card_detail_tile")?.getAttribute("aria-label")).toBe("Priority");
        expect(container.querySelector(".card_detail_tile")?.classList.contains("card_detail_tile--value-only")).toBe(true);
    });

    test("sets one shared label column width from the longest visible label", () => {
        const container = document.createElement("div");

        renderModernCardDetails(container, [
            { column: "website", label: "Website", rawValue: "https://example.test" },
            { column: "contact_details", label: "Contact details", rawValue: "support@example.test" },
        ]);

        expect(
            container.style.getPropertyValue("--card-detail-tile-label-width")
        ).toBe("16ch");
        for (const tile of Array.from(container.querySelectorAll(".card_detail_tile"))) {
            const text = tile.querySelector(".card_detail_tile_text");
            expect(tile.children[0]?.classList.contains("card_detail_tile_icon")).toBe(true);
            expect(tile.children[1]?.classList.contains("card_detail_tile_text")).toBe(true);
            expect(text?.children[0]?.classList.contains("card_detail_tile_label")).toBe(true);
            expect(text?.children[1]?.classList.contains("card_detail_tile_value")).toBe(true);
        }
    });

    test("sets desktop rows for column-first visual ordering", () => {
        const container = document.createElement("div");

        renderModernCardDetails(container, [
            { column: "one", label: "One", rawValue: "1" },
            { column: "two", label: "Two", rawValue: "2" },
            { column: "three", label: "Three", rawValue: "3" },
            { column: "four", label: "Four", rawValue: "4" },
        ]);

        expect(
            container.style.getPropertyValue("--card-details-modern-rows")
        ).toBe("2");
        expect(
            Array.from(container.querySelectorAll(".card_detail_tile_value"))
                .map((valueElement) => valueElement.textContent)
        ).toEqual(["1", "2", "3", "4"]);

        const tiles = Array.from(container.querySelectorAll(".card_detail_tile"));
        expect(tiles[0].classList.contains("card_detail_tile--row-separated")).toBe(false);
        expect(tiles[0].classList.contains("card_detail_tile--column-separated")).toBe(false);
        expect(tiles[1].classList.contains("card_detail_tile--row-separated")).toBe(true);
        expect(tiles[1].classList.contains("card_detail_tile--column-separated")).toBe(false);
        expect(tiles[2].classList.contains("card_detail_tile--row-separated")).toBe(false);
        expect(tiles[2].classList.contains("card_detail_tile--column-separated")).toBe(true);
        expect(tiles[3].classList.contains("card_detail_tile--row-separated")).toBe(true);
        expect(tiles[3].classList.contains("card_detail_tile--column-separated")).toBe(true);
    });
});
