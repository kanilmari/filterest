// dataset_icon_builder.test.js
// Verifies dataset-level icon metadata renders through the shared tab icon registry.
// Bridges local table metadata and card/article heading icon DOM assertions.
// Exists to keep table icons consistent outside the main navigation tabs.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test } from "vitest";

import { createDatasetIconElement } from "./dataset_icon_builder.js";

describe("dataset_icon_builder", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    test("uses icon_key from stored table metadata", () => {
        localStorage.setItem(
            "app_service_catalog_tableMeta",
            JSON.stringify({ icon_key: "building" })
        );

        const icon = createDatasetIconElement(
            "app_service_catalog",
            "card_header_dataset_icon"
        );

        expect(icon.classList.contains("dataset_table_icon")).toBe(true);
        expect(icon.classList.contains("card_header_dataset_icon")).toBe(true);
        expect(icon.getAttribute("aria-hidden")).toBe("true");
        expect(icon.dataset.symbolKey).toBe("building");
        expect(icon.style.getPropertyValue("--metadata-symbol-url"))
            .toContain("/symbol-assets/building.svg");
        expect(icon.innerHTML).toBe("");
    });

    test("omits the icon when metadata does not configure one", () => {
        const icon = createDatasetIconElement("dev_agent_tasks");

        expect(icon).toBeNull();
    });

    test("renders the table symbol when icon_key explicitly configures it", () => {
        localStorage.setItem(
            "dev_agent_tasks_tableMeta",
            JSON.stringify({ icon_key: "table" })
        );

        const icon = createDatasetIconElement("dev_agent_tasks");

        expect(icon?.dataset.symbolKey).toBe("table");
        expect(icon?.style.getPropertyValue("--metadata-symbol-url"))
            .toContain("/symbol-assets/table.svg");
    });
});
