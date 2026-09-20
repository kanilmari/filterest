/* @vitest-environment jsdom */

// Verifies add-row drafts remain dataset-scoped, schema-filtered, and optional.
// Bridges autosaved form state with guarded browser local storage behavior.
// Prevents refresh recovery from leaking values, attachments, or credentials.

import { beforeEach, describe, expect, test } from "vitest";
import {
    clearRowCreationDraft,
    createDraftBackedFormState,
    loadRowCreationDraft,
    saveRowCreationDraft,
} from "./row_draft_saver.js";

const COLUMNS = [
    { column_name: "name", data_type: "text" },
    { column_name: "price", data_type: "numeric(18,2)" },
    { column_name: "enabled", data_type: "boolean" },
    { column_name: "api_key", data_type: "text" },
];

beforeEach(() => {
    localStorage.clear();
});

describe("row creation drafts", () => {
    test("saves while fields change and restores only the same dataset", () => {
        const state = createDraftBackedFormState("subscriptions", COLUMNS);
        state.name = "Pro plan";
        state.price = "22.39";
        state.enabled = false;

        expect(loadRowCreationDraft("subscriptions", COLUMNS)).toEqual({
            name: "Pro plan",
            price: "22.39",
            enabled: false,
        });
        expect(loadRowCreationDraft("projects", COLUMNS)).toEqual({});
    });

    test("drops removed columns instead of rebuilding stale form structure", () => {
        saveRowCreationDraft("subscriptions", COLUMNS, {
            name: "Pro plan",
            price: "22.39",
        });

        expect(loadRowCreationDraft("subscriptions", [COLUMNS[0]])).toEqual({
            name: "Pro plan",
        });
    });

    test("never stores credential fields, files, or unrelated state", () => {
        saveRowCreationDraft("subscriptions", COLUMNS, {
            name: "Pro plan",
            api_key: "must-not-survive",
            _childRowsArray: [{ _actualFileObject: new File(["x"], "photo.png") }],
        });

        const rawDraft = Array.from({ length: localStorage.length }, (_unused, index) =>
            localStorage.getItem(localStorage.key(index))
        ).join("\n");
        expect(rawDraft).toContain("Pro plan");
        expect(rawDraft).not.toContain("must-not-survive");
        expect(rawDraft).not.toContain("photo.png");
    });

    test("clears only the requested dataset", () => {
        saveRowCreationDraft("subscriptions", COLUMNS, { name: "Pro plan" });
        saveRowCreationDraft("projects", COLUMNS, { name: "Migration" });

        clearRowCreationDraft("subscriptions");

        expect(loadRowCreationDraft("subscriptions", COLUMNS)).toEqual({});
        expect(loadRowCreationDraft("projects", COLUMNS)).toEqual({ name: "Migration" });
    });

    test("storage failures never prevent the form state from changing", () => {
        const unavailableStorage = {
            getItem() { throw new DOMException("blocked", "SecurityError"); },
            setItem() { throw new DOMException("full", "QuotaExceededError"); },
            removeItem() { throw new DOMException("blocked", "SecurityError"); },
        };

        expect(() => loadRowCreationDraft("subscriptions", COLUMNS, unavailableStorage))
            .not.toThrow();
        const state = createDraftBackedFormState(
            "subscriptions",
            COLUMNS,
            Object.create(null),
            unavailableStorage,
        );
        expect(() => { state.price = "22.39"; }).not.toThrow();
        expect(state.price).toBe("22.39");
        expect(() => clearRowCreationDraft("subscriptions", unavailableStorage)).not.toThrow();
    });
});
