// dataset_row_selection_store.test.js
// Verifies stable selected-row identity independently from the active renderer.
// Bridges table/card selection updates with deterministic action payloads.
// Exists so view switches and hidden ID columns cannot silently retarget bulk operations.

import { beforeEach, describe, expect, test, vi } from "vitest";

import {
    clearDatasetRowSelection,
    getDatasetRowSelection,
    isDatasetRowSelected,
    resetDatasetRowSelectionStoreForTests,
    setDatasetRowSelected,
} from "./dataset_row_selection_store.js";

describe("dataset row selection store", () => {
    beforeEach(() => {
        resetDatasetRowSelectionStoreForTests();
        document.body.replaceChildren();
    });

    test("keeps stable sorted IDs and row objects across renderer changes", () => {
        setDatasetRowSelected("services", 9, { id: 9, title: "Nine" }, true);
        setDatasetRowSelected("services", 2, { id: 2, title: "Two" }, true);

        expect(getDatasetRowSelection("services")).toEqual({
            ids: [2, 9],
            rows: [
                { id: 2, title: "Two" },
                { id: 9, title: "Nine" },
            ],
        });
        expect(isDatasetRowSelected("services", 9)).toBe(true);
    });

    test("emits only real selection membership changes and clears one dataset", () => {
        const listener = vi.fn();
        document.addEventListener("dataset-row-selection-change", listener);

        setDatasetRowSelected("services", 3, { id: 3 }, true);
        setDatasetRowSelected("services", 3, { id: 3, title: "updated" }, true);
        expect(listener).toHaveBeenCalledTimes(1);

        clearDatasetRowSelection("services");
        expect(listener).toHaveBeenCalledTimes(2);
        expect(getDatasetRowSelection("services")).toEqual({ ids: [], rows: [] });
        document.removeEventListener("dataset-row-selection-change", listener);
    });

    test("rejects missing datasets and unsafe row identifiers", () => {
        expect(setDatasetRowSelected("", 1, { id: 1 }, true)).toBe(false);
        expect(setDatasetRowSelected("services", 0, { id: 0 }, true)).toBe(false);
        expect(setDatasetRowSelected("services", Number.MAX_SAFE_INTEGER + 1, {}, true)).toBe(false);
    });
});
