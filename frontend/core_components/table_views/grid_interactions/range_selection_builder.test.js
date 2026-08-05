import { describe, expect, test } from "vitest";
import {
    enumerateSelectedCells,
    isCoordinateInsideRange,
    isSameColumnRange,
    isSameRowRange,
    isSingleCellRange,
    normalizeGridCoordinate,
    normalizeRangeBounds,
    normalizeRangeSelection,
} from "./range_selection_builder.js";

describe("range_selection_builder coordinate normalization", () => {
    test("normalizes list-style dataset row and column coordinates", () => {
        const coordinate = normalizeGridCoordinate({
            dataset: {
                row: "3",
                col: "2",
            },
        });

        expect(coordinate).toEqual({
            rowIndex: 3,
            columnIndex: 2,
        });
    });

    test("normalizes table-style rowIndex and cellIndex coordinates with control-column offsets", () => {
        const coordinate = normalizeGridCoordinate(
            {
                rowIndex: 4,
                cellIndex: 6,
            },
            {
                columnOffset: -2,
            }
        );

        expect(coordinate).toEqual({
            rowIndex: 4,
            columnIndex: 4,
        });
    });

    test("rejects malformed and below-minimum coordinates", () => {
        expect(normalizeGridCoordinate({ dataset: { row: "", col: "1" } })).toBeNull();
        expect(normalizeGridCoordinate({ rowIndex: 1, cellIndex: 1 }, { columnOffset: -2 })).toBeNull();
    });
});

describe("range_selection_builder range math", () => {
    test("normalizes a backwards drag into rectangular bounds while preserving endpoints", () => {
        const range = normalizeRangeSelection(
            { rowIndex: 5, columnIndex: 4 },
            { rowIndex: 3, columnIndex: 2 }
        );

        expect(range).toMatchObject({
            startCoordinate: { rowIndex: 5, columnIndex: 4 },
            currentCoordinate: { rowIndex: 3, columnIndex: 2 },
            minRowIndex: 3,
            maxRowIndex: 5,
            minColumnIndex: 2,
            maxColumnIndex: 4,
            rowCount: 3,
            columnCount: 3,
        });
    });

    test("accepts the legacy minRow/minCol range shape from the current list renderer", () => {
        expect(normalizeRangeBounds({
            minRow: 2,
            maxRow: 4,
            minCol: 1,
            maxCol: 3,
        })).toMatchObject({
            minRowIndex: 2,
            maxRowIndex: 4,
            minColumnIndex: 1,
            maxColumnIndex: 3,
        });
    });

    test("enumerates selected cells in row-major order", () => {
        expect(enumerateSelectedCells({
            minRowIndex: 1,
            maxRowIndex: 2,
            minColumnIndex: 0,
            maxColumnIndex: 2,
        })).toEqual([
            { rowIndex: 1, columnIndex: 0 },
            { rowIndex: 1, columnIndex: 1 },
            { rowIndex: 1, columnIndex: 2 },
            { rowIndex: 2, columnIndex: 0 },
            { rowIndex: 2, columnIndex: 1 },
            { rowIndex: 2, columnIndex: 2 },
        ]);
    });

    test("recognizes single-cell, same-row, and same-column ranges", () => {
        expect(isSingleCellRange({
            minRowIndex: 2,
            maxRowIndex: 2,
            minColumnIndex: 1,
            maxColumnIndex: 1,
        })).toBe(true);
        expect(isSameRowRange({
            minRowIndex: 2,
            maxRowIndex: 2,
            minColumnIndex: 1,
            maxColumnIndex: 4,
        })).toBe(true);
        expect(isSameColumnRange({
            minRowIndex: 2,
            maxRowIndex: 5,
            minColumnIndex: 1,
            maxColumnIndex: 1,
        })).toBe(true);
    });

    test("checks whether renderer-style coordinates are inside a range", () => {
        const range = {
            minRowIndex: 2,
            maxRowIndex: 4,
            minColumnIndex: 1,
            maxColumnIndex: 3,
        };

        expect(isCoordinateInsideRange(range, { dataset: { row: "3", col: "2" } })).toBe(true);
        expect(isCoordinateInsideRange(range, { rowIndex: 3, cellIndex: 5 }, { columnOffset: -2 })).toBe(true);
        expect(isCoordinateInsideRange(range, { rowIndex: 1, columnIndex: 2 })).toBe(false);
    });
});
