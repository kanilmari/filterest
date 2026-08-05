import { describe, expect, test } from "vitest";
import {
    GRID_COPY_ACTION_IDS,
    buildGridCopyPayload,
    deriveGridContextMenuPayload,
} from "./context_menu_payload_builder.js";

const sampleColumns = [
    { key: "name", label: "Name" },
    { key: "status", label: "Status" },
    { key: "owner", label: "Owner" },
];

const sampleRows = [
    { name: "Ada", status: "Ready", owner: "Hannu" },
    { name: "Linus", status: "Review", owner: "Kaisa" },
    { name: "Grace", status: "Done", owner: "Maija" },
];

describe("buildGridCopyPayload", () => {
    test("builds a table-style copy payload with headers", () => {
        const payload = buildGridCopyPayload({
            range: {
                minRowIndex: 1,
                maxRowIndex: 2,
                minColumnIndex: 0,
                maxColumnIndex: 1,
            },
            rows: sampleRows,
            columns: sampleColumns,
            includeHeaders: true,
        });

        expect(payload.headers).toEqual(["Name", "Status"]);
        expect(payload.rows).toEqual([
            ["Linus", "Review"],
            ["Grace", "Done"],
        ]);
        expect(payload.text).toBe("Name\tStatus\nLinus\tReview\nGrace\tDone");
        expect(payload.cells.slice(0, 2)).toMatchObject([
            {
                rowIndex: 1,
                sourceRowIndex: 1,
                columnIndex: 0,
                columnKey: "name",
                value: "Linus",
            },
            {
                rowIndex: 1,
                sourceRowIndex: 1,
                columnIndex: 1,
                columnKey: "status",
                value: "Review",
            },
        ]);
    });

    test("builds a list-style copy payload where grid row one maps to rows zero", () => {
        const payload = buildGridCopyPayload({
            range: {
                minRowIndex: 1,
                maxRowIndex: 2,
                minColumnIndex: 0,
                maxColumnIndex: 1,
            },
            rows: sampleRows,
            columns: ["name", "status", "owner"],
            includeHeaders: false,
            dataRowStartIndex: 1,
            delimiter: ",",
        });

        expect(payload.headers).toEqual([]);
        expect(payload.rows).toEqual([
            ["Ada", "Ready"],
            ["Linus", "Review"],
        ]);
        expect(payload.text).toBe("Ada,Ready\nLinus,Review");
    });

    test("uses a custom value resolver for renderer-specific row shapes", () => {
        const payload = buildGridCopyPayload({
            range: {
                minRowIndex: 0,
                maxRowIndex: 0,
                minColumnIndex: 0,
                maxColumnIndex: 1,
            },
            rows: [{ cells: ["A1", "B1"] }],
            columns: ["a", "b"],
            valueResolver: ({ row, columnIndex }) => row.cells[columnIndex],
        });

        expect(payload.text).toBe("A1\tB1");
    });
});

describe("deriveGridContextMenuPayload", () => {
    test("opens over a selected list-style coordinate and exposes both copy actions", () => {
        const menuPayload = deriveGridContextMenuPayload({
            range: {
                minRowIndex: 1,
                maxRowIndex: 2,
                minColumnIndex: 0,
                maxColumnIndex: 1,
            },
            triggerCoordinate: {
                dataset: {
                    row: "2",
                    col: "1",
                },
            },
            menuPosition: {
                pageX: "40",
                pageY: "80",
            },
            rows: sampleRows,
            columns: sampleColumns,
            copyOptions: {
                dataRowStartIndex: 1,
            },
        });

        expect(menuPayload.shouldOpen).toBe(true);
        expect(menuPayload.reason).toBeNull();
        expect(menuPayload.menuPosition).toEqual({ x: 40, y: 80 });
        expect(menuPayload.selectionShape).toBe("rectangle");
        expect(menuPayload.copyActions.map((action) => action.id)).toEqual([
            GRID_COPY_ACTION_IDS.COPY_WITH_HEADERS,
            GRID_COPY_ACTION_IDS.COPY_WITHOUT_HEADERS,
        ]);
        expect(menuPayload.copyActions[0]).toMatchObject({
            labelKey: "copy_headers_and_cells",
            includeHeaders: true,
            enabled: true,
        });
        expect(menuPayload.copyActions[0].payload.text).toBe("Name\tStatus\nAda\tReady\nLinus\tReview");
        expect(menuPayload.copyActions[1].payload.text).toBe("Ada\tReady\nLinus\tReview");
    });

    test("opens over a selected table-style coordinate with a control-column offset", () => {
        const menuPayload = deriveGridContextMenuPayload({
            range: {
                minRowIndex: 0,
                maxRowIndex: 0,
                minColumnIndex: 1,
                maxColumnIndex: 2,
            },
            triggerCoordinate: {
                rowIndex: 0,
                cellIndex: 3,
            },
            coordinateOptions: {
                columnOffset: -2,
            },
            rows: sampleRows,
            columns: sampleColumns,
        });

        expect(menuPayload.shouldOpen).toBe(true);
        expect(menuPayload.selectionShape).toBe("row");
        expect(menuPayload.copyActions[1].payload.text).toBe("Ready\tHannu");
    });

    test("stays closed when the context-menu trigger is outside the selected range", () => {
        const menuPayload = deriveGridContextMenuPayload({
            range: {
                minRowIndex: 1,
                maxRowIndex: 2,
                minColumnIndex: 0,
                maxColumnIndex: 1,
            },
            triggerCoordinate: {
                rowIndex: 4,
                columnIndex: 1,
            },
            rows: sampleRows,
            columns: sampleColumns,
        });

        expect(menuPayload).toMatchObject({
            shouldOpen: false,
            reason: "outside-selection",
            copyActions: [],
        });
    });
});
