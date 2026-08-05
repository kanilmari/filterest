// @vitest-environment jsdom
// experimental_free_layout_card_helpers.test.js
// Verifies the pure row-to-block model and default layout generation for the experimental card style.
// Bridges card metadata and deterministic layout defaults without depending on DOM rendering.
// Exists to keep the removable prototype predictable while drag-and-resize UI details evolve.

import { describe, expect, test } from "vitest";

import {
    buildExperimentalCardModel,
    createDefaultExperimentalLayoutTemplate,
    getExperimentalLayoutRowCount,
    mergeExperimentalLayoutTemplate,
} from "./experimental_free_layout_card_helpers.js";

describe("experimental_free_layout_card_helpers", () => {
    test("builds semantic blocks from card roles and visible field settings", () => {
        const model = buildExperimentalCardModel({
            rowItem: {
                id: 16,
                title: "Binance",
                hero_image: "104/133/300/example.png",
                description: "Crypto exchange",
                website: "https://example.com",
                notes: "",
                status: "in_progress",
            },
            columns: [
                "title",
                "hero_image",
                "description",
                "website",
                "notes",
                "status",
            ],
            tableName: "services",
            preferredLang: "en",
            tableHasImageRole: true,
            dataTypes: {
                title: {
                    card_element: "header",
                    show_value_on_card: true,
                    show_key_on_card: false,
                },
                hero_image: {
                    card_element: "image",
                    show_value_on_card: true,
                    show_key_on_card: false,
                },
                description: {
                    card_element: "description1",
                    show_value_on_card: true,
                    show_key_on_card: false,
                },
                website: {
                    card_element: "details_link10",
                    show_value_on_card: true,
                    show_key_on_card: true,
                },
                notes: {
                    card_element: "details20",
                    show_value_on_card: true,
                    show_key_on_card: true,
                },
                status: {
                    card_element: "hidden",
                    show_value_on_card: true,
                    show_key_on_card: true,
                },
            },
        });

        expect(model.summary.headerText).toBe("Binance");
        expect(model.summary.statusValue).toBe("");
        expect(model.blocks.map((block) => block.id)).toEqual([
            "media:primary",
            "header:title",
            "description:description",
            "details_link:website",
            "details:notes",
            "action:show_more",
        ]);
    });

    test("merges stored layouts with defaults so new blocks stay placeable", () => {
        const blocks = [
            { id: "media:primary", type: "media" },
            { id: "header:title", type: "header" },
            { id: "details:website", type: "field" },
            { id: "action:show_more", type: "action" },
        ];

        const defaults = createDefaultExperimentalLayoutTemplate(blocks);
        const merged = mergeExperimentalLayoutTemplate(
            {
                version: 1,
                columns: 24,
                items: {
                    "header:title": { x: 5, y: 2, w: 8, h: 3 },
                },
            },
            blocks
        );

        expect(merged.items["header:title"]).toEqual({ x: 5, y: 2, w: 8, h: 3 });
        expect(merged.items["media:primary"]).toEqual(defaults.items["media:primary"]);
        expect(getExperimentalLayoutRowCount(merged)).toBeGreaterThanOrEqual(16);
    });
});
