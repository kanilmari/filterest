// @vitest-environment jsdom
// row_article_data_types_resolver.test.js
// Verifies row article metadata lookup across selected-card state and dataset aliases.
// Bridges public service_catalog routes and canonical app_service_catalog card metadata.
// Exists to keep image/detail roles available when opening row article views.

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../navigation/nav_engine/dataset_aliases.js", () => ({
    getInternalDatasetName: vi.fn((datasetName) => (
        datasetName === "service_catalog" ? "app_service_catalog" : datasetName
    )),
}));

import { resolveRowArticleDataTypes } from "./row_article_data_types_resolver.js";

describe("resolveRowArticleDataTypes", () => {
    beforeEach(() => {
        localStorage.clear();
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    test("uses selected-card data types before stored metadata", () => {
        const selectedCard = document.createElement("div");
        const cardDataTypes = {
            cached_image: { card_element: "image" },
        };
        selectedCard._data_types = cardDataTypes;
        localStorage.setItem("service_catalog_dataTypes", JSON.stringify({
            cached_image: { card_element: "details" },
        }));

        expect(resolveRowArticleDataTypes("service_catalog", selectedCard)).toBe(cardDataTypes);
    });

    test("falls back from public dataset alias to canonical stored metadata", () => {
        const canonicalDataTypes = {
            cached_image: { card_element: "image" },
        };
        localStorage.setItem("app_service_catalog_dataTypes", JSON.stringify(canonicalDataTypes));

        expect(resolveRowArticleDataTypes("service_catalog")).toEqual(canonicalDataTypes);
    });
});
