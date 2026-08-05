// dataset_search_executor_helpers.test.js
// Verifies pure search-cache helpers used by the intelligent search UI.
// Bridges streamed dataset rows, active filters, and deduplication rules in isolation.
// Exists to lock helper behavior before and after UI-level refactors.

import { describe, expect, test } from "vitest";
import {
    countVisibleRows,
    deduplicateRows,
    filterRows,
    initSearchCache,
    sortRows,
} from "./dataset_search_executor_helpers.js";

describe("dataset_search_executor_helpers", () => {
    test("initSearchCache returns the default cache shape", () => {
        expect(initSearchCache()).toEqual({
            columns: [],
            data: [],
            aiData: [],
            types: {},
            filters: {},
            renderedOnce: false,
        });
    });

    test("deduplicateRows removes rows already present in text or ai pools", () => {
        const uniqueRows = deduplicateRows(
            [{ header: "alpha" }],
            [{ header: "beta" }],
            [{ header: "alpha" }, { header: "beta" }, { header: "gamma" }],
            ["header", "title"]
        );

        expect(uniqueRows).toEqual([{ header: "gamma" }]);
    });

    test("deduplicateRows removes duplicates within the incoming batch", () => {
        const uniqueRows = deduplicateRows(
            [],
            [],
            [{ id: 1, name: "A" }, { id: 1, name: "A" }, { id: 2, name: "B" }],
            ["id", "name"]
        );

        expect(uniqueRows).toEqual([
            { id: 1, name: "A" },
            { id: 2, name: "B" },
        ]);
    });

    test("filterRows returns only rows matching active filters", () => {
        const rows = [
            { name: "Alice", active: true },
            { name: "Bob", active: false },
        ];
        const filters = { users_name: "ali", users_active: "true" };
        const columnTypes = { active: "boolean" };

        expect(filterRows(rows, filters, "users", columnTypes)).toEqual([
            { name: "Alice", active: true },
        ]);
    });

    test("filterRows returns the original rows when no filters exist", () => {
        const rows = [{ name: "Alice" }];

        expect(filterRows(rows, {}, "users", {})).toBe(rows);
    });

    test("countVisibleRows counts only rows passing filters", () => {
        const rows = [
            { name: "Alice", age: 20 },
            { name: "Bob", age: 30 },
            { name: "Carla", age: 40 },
        ];
        const filters = { age_from: "25", age_to: "35" };
        const columnTypes = { age: "integer" };

        expect(countVisibleRows(rows, filters, "users", columnTypes)).toBe(1);
    });

    test("sortRows sorts numeric rows ascending and descending", () => {
        const rows = [
            { id: 7, header: "Gamma" },
            { id: 2, header: "Alpha" },
            { id: 5, header: "Beta" },
        ];

        expect(sortRows(rows, "id", "ASC", { id: "integer" })).toEqual([
            { id: 2, header: "Alpha" },
            { id: 5, header: "Beta" },
            { id: 7, header: "Gamma" },
        ]);
        expect(sortRows(rows, "id", "DESC", { id: "integer" })).toEqual([
            { id: 7, header: "Gamma" },
            { id: 5, header: "Beta" },
            { id: 2, header: "Alpha" },
        ]);
    });

    test("sortRows keeps nulls at the end and breaks timestamp ties with id in the same direction", () => {
        const rows = [
            { id: 12, created_at: "2026-04-24T12:00:00Z", header: "Newest A" },
            { id: 7, created_at: null, header: "No date" },
            { id: 15, created_at: "2026-04-24T12:00:00Z", header: "Newest B" },
            { id: 3, created_at: "2026-04-20T08:00:00Z", header: "Older" },
        ];

        expect(sortRows(rows, "created_at", "ASC", { created_at: "timestamp" })).toEqual([
            { id: 3, created_at: "2026-04-20T08:00:00Z", header: "Older" },
            { id: 12, created_at: "2026-04-24T12:00:00Z", header: "Newest A" },
            { id: 15, created_at: "2026-04-24T12:00:00Z", header: "Newest B" },
            { id: 7, created_at: null, header: "No date" },
        ]);

        expect(sortRows(rows, "created_at", "DESC", { created_at: "timestamp" })).toEqual([
            { id: 15, created_at: "2026-04-24T12:00:00Z", header: "Newest B" },
            { id: 12, created_at: "2026-04-24T12:00:00Z", header: "Newest A" },
            { id: 3, created_at: "2026-04-20T08:00:00Z", header: "Older" },
            { id: 7, created_at: null, header: "No date" },
        ]);
    });

    test("sortRows puts image-bearing rows first and uses newest id as the tie-breaker", () => {
        const rows = [
            { id: 4, cached_image: null, header: "No image" },
            { id: 2, cached_image: "2/2/en/older.jpg", header: "Older image" },
            { id: 9, cached_image: "9/9/en/newer.jpg", header: "Newer image" },
            { id: 7, cached_image: "   ", header: "Blank image" },
        ];
        const types = {
            id: { data_type: "integer" },
            cached_image: { data_type: "image", card_element: "image" },
        };

        expect(sortRows(rows, "__images_first", "DESC", types)).toEqual([
            rows[2],
            rows[1],
            rows[3],
            rows[0],
        ]);
    });

    test("sortRows keeps image-first deterministic for datasets without an image column", () => {
        const rows = [{ id: 3 }, { id: 8 }, { id: 1 }];

        expect(sortRows(rows, "__images_first", "DESC", { id: "integer" })).toEqual([
            rows[1],
            rows[0],
            rows[2],
        ]);
    });
});
