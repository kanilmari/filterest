// field_view_editor_helpers.test.js
// Verifies deterministic field ordering and global-hidden field collection.
// Bridges drag/drop gestures with the ordered API payload used by the editor.
// Exists so UI re-rendering cannot silently duplicate or drop field metadata.

import { describe, expect, test } from "vitest";

import {
    hiddenFieldNameSet,
    moveFieldBefore,
    moveFieldByOffset,
    normalizeFieldViewColumns,
} from "./field_view_editor_helpers.js";

const columns = [
    { column_uid: 1, column_name: "id", co_number: 9 },
    { column_uid: 2, column_name: "title", co_number: 4 },
    { column_uid: 3, column_name: "summary", co_number: 1 },
];

describe("field_view_editor_helpers", () => {
    test("normalizes the rendered array into contiguous global order", () => {
        expect(normalizeFieldViewColumns(columns).map((column) => column.co_number))
            .toEqual([1, 2, 3]);
    });

    test("moves one field before a drop target without losing metadata", () => {
        const result = moveFieldBefore(columns, 3, 1);

        expect(result.map((column) => column.column_uid)).toEqual([3, 1, 2]);
        expect(result.map((column) => column.co_number)).toEqual([1, 2, 3]);
        expect(result[0].column_name).toBe("summary");
    });

    test("supports accessible one-step movement and boundary no-ops", () => {
        expect(moveFieldByOffset(columns, 2, -1).map((column) => column.column_uid))
            .toEqual([2, 1, 3]);
        expect(moveFieldByOffset(columns, 1, -1).map((column) => column.column_uid))
            .toEqual([1, 2, 3]);
    });

    test("collects only globally hidden field names", () => {
        expect(Array.from(hiddenFieldNameSet([
            { column_uid: 1, column_name: "id", hide_everywhere: false },
            { column_uid: 2, column_name: "summary", hide_everywhere: true },
        ]))).toEqual(["summary"]);
    });
});
