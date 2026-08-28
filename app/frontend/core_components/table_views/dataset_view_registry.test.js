// dataset_view_registry.test.js
// Verifies the canonical metadata for dataset view registration.
// Bridges renderer container IDs, selector options, permission routes, and translation fallbacks.
// Exists to keep duplicated view definitions from creeping back into view renderers or admin controls.

import { describe, expect, test } from "vitest";
import {
    DATASET_VIEW_PERMISSION_ROUTES,
    DATASET_VIEW_SELECTOR_GROUP_DIRECT,
    DATASET_VIEW_SELECTOR_GROUP_MORE,
    DATASET_VIEW_SELECTOR_TEXT,
    getDatasetViewContainerId,
    getDatasetViewLabelFallback,
    getDatasetViewLabelForLanguage,
    getDatasetViewLangKey,
    getDatasetViewLocalTranslationFallbacks,
    getDatasetViewScrollDirection,
    getDatasetViewSelectorOptions,
    getDatasetViewSelectorTextForLanguage,
    isDatasetViewSelectorAlias,
    resolveDatasetViewSelectionTarget,
    usesFullWidthDatasetContent,
} from "./dataset_view_registry.js";

describe("dataset_view_registry", () => {
    test("builds stable container IDs from registered suffixes", () => {
        expect(getDatasetViewContainerId("card", "demo_dataset"))
            .toBe("demo_dataset_card_view_container");
        expect(getDatasetViewContainerId("price_chart", "demo_dataset"))
            .toBe("demo_dataset_price_chart_view_container");
        expect(getDatasetViewContainerId("article", "demo_dataset")).toBe("");
    });

    test("keeps article as a selector alias for card view", () => {
        expect(isDatasetViewSelectorAlias("article")).toBe(true);
        expect(resolveDatasetViewSelectionTarget("article")).toBe("card");
        expect(resolveDatasetViewSelectionTarget("table")).toBe("table");
    });

    test("returns canonical selector groups in UI order", () => {
        expect(getDatasetViewSelectorOptions(DATASET_VIEW_SELECTOR_GROUP_DIRECT)
            .map((option) => option.viewKey))
            .toEqual(["card", "article", "table", "normal", "transposed"]);

        expect(getDatasetViewSelectorOptions(DATASET_VIEW_SELECTOR_GROUP_MORE)
            .map((option) => option.viewKey))
            .toEqual([
                "tree",
                "ticket",
                "product_card",
                "calendar",
                "map",
                "price_chart",
                "settings",
                "cloud_management",
            ]);
    });

    test("offers tree only when the dataset has a supported hierarchy", () => {
        const flatOptions = getDatasetViewSelectorOptions(
            DATASET_VIEW_SELECTOR_GROUP_MORE,
            {
                datasetName: "services",
                columns: ["id", "parent_id", "name"],
                dataTypes: {
                    parent_id: { data_type: "integer" },
                },
            }
        );
        expect(flatOptions.map((option) => option.viewKey)).not.toContain("tree");

        const treeOptions = getDatasetViewSelectorOptions(
            DATASET_VIEW_SELECTOR_GROUP_MORE,
            {
                datasetName: "services",
                columns: ["id", "parent_id", "name"],
                dataTypes: {
                    parent_id: {
                        data_type: "integer",
                        foreign_table: "services",
                        foreign_column: "id",
                    },
                },
            }
        );
        expect(treeOptions.map((option) => option.viewKey)).toContain("tree");
    });

    test("exports the existing permission route map from view metadata", () => {
        expect(DATASET_VIEW_PERMISSION_ROUTES).toEqual({
            card: "/ui/view/card",
            table: "/ui/view/table",
            normal: "/ui/view/list",
            transposed: "/ui/view/transposed",
            tree: "/ui/view/tree",
            ticket: "/ui/view/ticket",
            settings: "/ui/view/settings",
            cloud_management: "/ui/view/cloud_management",
        });
    });

    test("keeps layout and translation metadata queryable", () => {
        const fallbacks = getDatasetViewLocalTranslationFallbacks();

        expect(getDatasetViewLangKey("price_chart")).toBe("view_price_chart");
        expect(getDatasetViewLabelFallback("map")).toBe("Kartta");
        expect(getDatasetViewScrollDirection("transposed")).toBe("horizontal");
        expect(usesFullWidthDatasetContent("table")).toBe(true);
        expect(usesFullWidthDatasetContent("card")).toBe(false);
        expect(DATASET_VIEW_SELECTOR_TEXT.moreViews.langKey).toBe("add_more_views");
        expect(fallbacks.view_article.en).toBe("Article");
        expect(fallbacks.view_price_chart.fi).toBe("Hintagraafi");
        expect(fallbacks.view_cloud_management.en).toBe("Cloud management");
        expect(fallbacks.view_cloud_management.yue).toBe("\u96f2\u7aef\u7ba1\u7406");
        expect(fallbacks.views_and_presentations.en).toBe("Views and presentations");
        expect(getDatasetViewLabelForLanguage("tree", "yue"))
            .toBe("\u6a39\u72c0\u5716");
        expect(getDatasetViewLabelForLanguage("calendar", "zh-HK"))
            .toBe("\u65e5\u66c6");
        expect(getDatasetViewSelectorTextForLanguage(
            DATASET_VIEW_SELECTOR_TEXT.moreViews,
            "fi"
        )).toBe("Lis\u00e4\u00e4");
    });
});
