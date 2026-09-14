// @vitest-environment jsdom
// history_entry_state.test.js
// Verifies entry identity and state ownership across URL changes.
// Bridges list and row-article history operations in jsdom.
// Exists to prevent stale article flags and lost owner state.
import { beforeEach, expect, test } from "vitest";
import { HISTORY_ENTRY_ID, ensureHistoryEntryId, writeHistoryEntry, rememberHistoryDatasetView, getHistoryDatasetView } from "./history_entry_state.js";

beforeEach(() => history.replaceState({}, "", "/catalog?search=harbour"));

test("replace keeps the current identity and unrelated state; push owns a new entry", () => {
    history.replaceState({ otherOwner: { value: 7 } }, "", "/catalog?search=harbour");
    const origin = ensureHistoryEntryId();
    writeHistoryEntry("/catalog?search=harbour&view=card", {}, { replace: true });
    expect(history.state).toMatchObject({ [HISTORY_ENTRY_ID]: origin, otherOwner: { value: 7 } });
    writeHistoryEntry("/catalog/3?search=harbour&view=article_view", {
        bigCard: true, dataset: "catalog", rowId: "3", articleOriginEntry: origin,
    });
    expect(history.state[HISTORY_ENTRY_ID]).not.toBe(origin);
    expect(history.state.otherOwner).toBeUndefined();
    expect(history.state.articleOriginEntry).toBe(origin);
});

test("replacing an article with a list clears only obsolete navigation fields", () => {
    history.replaceState({ bigCard: true, rowId: "3", articleOriginEntry: "old", articleReturnAvailable: true, otherOwner: 9 }, "", "/catalog/3");
    const entry = ensureHistoryEntryId();
    writeHistoryEntry("/catalog?search=harbour", {}, { replace: true });
    expect(history.state).toEqual({ [HISTORY_ENTRY_ID]: entry, otherOwner: 9 });
});


test("two entries at the same path keep their own views, and other datasets cannot reuse them", () => {
    const url = "/catalog?search=harbour";
    history.replaceState({ otherOwner: 7 }, "", url);
    rememberHistoryDatasetView("catalog", "table");
    const tableEntry = structuredClone(history.state);
    writeHistoryEntry(url);
    rememberHistoryDatasetView("catalog", "card");
    const cardEntry = structuredClone(history.state);
    expect(cardEntry[HISTORY_ENTRY_ID]).not.toBe(tableEntry[HISTORY_ENTRY_ID]);
    expect(getHistoryDatasetView("catalog")).toBe("card");
    history.replaceState(tableEntry, "", url);
    expect(getHistoryDatasetView("catalog")).toBe("table");
    expect(history.state.otherOwner).toBe(7);
    expect(getHistoryDatasetView("other")).toBeNull();
    history.replaceState(tableEntry, "", "/other");
    expect(getHistoryDatasetView("catalog")).toBeNull();
    history.replaceState(cardEntry, "", url);
    expect(getHistoryDatasetView("catalog")).toBe("card");
    writeHistoryEntry("/other", {}, { replace: true });
    expect(history.state.__filterestDatasetView).toBeUndefined();
});

test("navigation replaces only its IFAV identity while retaining another history owner", () => {
    history.replaceState({ imageFirstView: { dataset: "events", rowId: "2" }, otherOwner: "kept" }, "", "/events/2?view=image_first_view");
    writeHistoryEntry("/events?view=table", {}, { replace: true });
    expect(history.state.imageFirstView).toBeUndefined();
    expect(history.state.otherOwner).toBe("kept");
});
