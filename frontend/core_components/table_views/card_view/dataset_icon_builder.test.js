// dataset_icon_builder.test.js
// Verifies dataset-level icon metadata renders through the shared tab icon registry.
// Bridges local table metadata and card/article heading icon DOM assertions.
// Exists to keep table icons consistent outside the main navigation tabs.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test } from "vitest";

import { createDatasetIconElement } from "./dataset_icon_builder.js";
import { getTabIconPath } from "../../navigation/main_tabs/tab_icon_library.js";

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
        expect(icon.querySelector("path")?.getAttribute("d")).toBe(
            getTabIconPath("building")
        );
    });

    test("falls back to the default table icon when metadata is missing", () => {
        const icon = createDatasetIconElement("dev_agent_tasks");

        expect(icon.querySelector("path")?.getAttribute("d")).toBe(
            getTabIconPath(undefined)
        );
    });
});
