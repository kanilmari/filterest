// dataset_tree_availability_checker.test.js
// Verifies that tree availability follows real hierarchy metadata instead of column names.
// Bridges backend-style FK descriptors with selector and renderer availability decisions.
// Exists to prevent flat datasets from exposing an unusable tree presentation.

import { describe, expect, test } from "vitest";
import {
    datasetSupportsTreeView,
    resolveDatasetTreeStructure,
} from "./dataset_tree_availability_checker.js";

describe("dataset tree availability", () => {
    test("accepts a verified self-parent foreign key", () => {
        const dataTypes = {
            id: { data_type: "integer" },
            manager_id: {
                data_type: "integer",
                foreign_table: "team_members",
                foreign_column: "id",
            },
        };

        expect(resolveDatasetTreeStructure(
            "team_members",
            ["id", "manager_id", "name"],
            dataTypes
        )).toEqual({
            idColumn: "id",
            parentColumn: "manager_id",
        });
        expect(datasetSupportsTreeView(
            "team_members",
            ["id", "manager_id", "name"],
            dataTypes
        )).toBe(true);
    });

    test("rejects a parent-looking column without a real self relation", () => {
        expect(datasetSupportsTreeView(
            "services",
            ["id", "parent_id", "name"],
            {
                id: { data_type: "integer" },
                parent_id: { data_type: "integer" },
            }
        )).toBe(false);
    });

    test("rejects a foreign key that points to another dataset", () => {
        expect(datasetSupportsTreeView(
            "services",
            ["id", "category_id", "name"],
            {
                category_id: {
                    data_type: "integer",
                    foreign_table: "categories",
                    foreign_column: "id",
                },
            }
        )).toBe(false);
    });

    test.each(["system_table_folders", "system_db_tables"])(
        "accepts the existing catalog tree contract for %s",
        (datasetName) => {
            expect(datasetSupportsTreeView(datasetName, [], {})).toBe(true);
        }
    );
});
