// @vitest-environment jsdom
// history_entry_state.test.js
// Verifies entry identity and state ownership across URL changes.
// Bridges list and row-article history operations in jsdom.
// Exists to prevent stale article flags and lost owner state.
import { beforeEach, expect, test, vi } from "vitest";
import { HISTORY_ENTRY_ID, ensureHistoryEntryId, ensureRootEntryIdentity, writeHistoryEntry, rememberHistoryDatasetView, getHistoryDatasetView } from "./history_entry_state.js";

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

test("an unchanged replacement writes nothing; a cold entry gets only its identity (G5)", () => {
    history.replaceState(null, "", "/");
    const replace = vi.spyOn(history, "replaceState");
    try {
        const entry = writeHistoryEntry("/", {}, { replace: true });
        expect(replace).toHaveBeenCalledTimes(1);
        expect(history.state).toEqual({ [HISTORY_ENTRY_ID]: entry });
        history.replaceState({ ...history.state, otherOwner: "kept", count: 0, flag: false, none: null }, "", "/");
        replace.mockClear();
        expect(writeHistoryEntry("/", {}, { replace: true })).toBe(entry);
        expect(writeHistoryEntry(location.href, {}, { replace: true })).toBe(entry);
        expect(replace).not.toHaveBeenCalled();
        writeHistoryEntry("/", { dataset: "catalog" }, { replace: true });
        writeHistoryEntry("/?view=card", {}, { replace: true });
        expect(replace).toHaveBeenCalledTimes(2);
        expect(history.state).toEqual({ [HISTORY_ENTRY_ID]: entry, otherOwner: "kept", count: 0, flag: false, none: null });
    } finally {
        replace.mockRestore();
    }
});

test("only an all-primitive state is skipped; undefined vs null and any object-holding state are written", () => {
    history.replaceState(null, "", "/");
    const entry = ensureHistoryEntryId();
    history.replaceState({ [HISTORY_ENTRY_ID]: entry, owner: null }, "", "/");
    const replace = vi.spyOn(history, "replaceState");
    const cyclic = value => { const owner = { value }; owner.self = owner; return owner; };
    try {
        writeHistoryEntry("/", { owner: undefined }, { replace: true });
        expect(replace).toHaveBeenCalledTimes(1);
        expect(Object.prototype.hasOwnProperty.call(history.state, "owner")).toBe(true);
        expect(history.state.owner).toBeUndefined();
        // Equal or not, a state holding an object is written exactly as before the skip existed.
        const owners = [{ a: 1 }, new Date(1000), new Set([1]), [], new Array(1), cyclic(1), cyclic(2)];
        for (const owner of owners) expect(writeHistoryEntry("/", { owner }, { replace: true })).toBe(entry);
        expect(replace).toHaveBeenCalledTimes(1 + owners.length);
        expect(history.state.owner.value).toBe(2);
        expect(writeHistoryEntry("/", { owner: history.state.owner }, { replace: true })).toBe(entry);
        expect(replace).toHaveBeenCalledTimes(2 + owners.length);
    } finally {
        replace.mockRestore();
    }
});

test("only the bare root gets its identity at boot; a denied bookmark or an entry shell keeps its loaded state", () => {
    for (const url of ["/catalog/3?view=article_view", "/catalog", "/?register-entry=1"]) {
        history.replaceState(null, "", url);
        expect(ensureRootEntryIdentity()).toBeNull();
        expect(history.state).toBeNull();
    }
    history.replaceState(null, "", "/");
    const entry = ensureRootEntryIdentity();
    expect(history.state).toEqual({ [HISTORY_ENTRY_ID]: entry });
    expect(ensureRootEntryIdentity()).toBe(entry);
});

test("navigation replaces only its IFAV identity while retaining another history owner", () => {
    history.replaceState({ imageFirstView: { dataset: "events", rowId: "2" }, otherOwner: "kept" }, "", "/events/2?view=image_first_view");
    writeHistoryEntry("/events?view=table", {}, { replace: true });
    expect(history.state.imageFirstView).toBeUndefined();
    expect(history.state.otherOwner).toBe("kept");
});
