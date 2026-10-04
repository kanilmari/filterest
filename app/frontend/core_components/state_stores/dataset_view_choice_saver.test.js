// @vitest-environment jsdom
// dataset_view_choice_saver.test.js
// Verifies that a dataset's chosen view is kept per browser tab and reached only through its saver.
// Bridges the saver's read, save and forget with sessionStorage, localStorage and the frontend sources.
// Exists because a view kept in storage shared by every tab let one tab erase or replace another's (K143).

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
    forgetChosenDatasetView,
    getChosenDatasetView,
    setChosenDatasetView,
} from "./dataset_view_choice_saver.js";
import { forgetTabSessionFallback } from "./tab_session_storage.js";

const FRONTEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SAVER_PATH = "core_components/state_stores/dataset_view_choice_saver.js";

describe("dataset_view_choice_saver", () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        forgetTabSessionFallback();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test("saves, reads and forgets a dataset's view in this tab's session storage", () => {
        expect(getChosenDatasetView("travel_deals")).toBeNull();

        setChosenDatasetView("travel_deals", "article_view");
        expect(getChosenDatasetView("travel_deals")).toBe("article_view");
        expect(sessionStorage.getItem("travel_deals_view")).toBe("article_view");

        forgetChosenDatasetView("travel_deals");
        expect(getChosenDatasetView("travel_deals")).toBeNull();
    });

    // (a) The choice never reaches the storage every tab shares.
    test("saving a view never writes to localStorage", () => {
        const writes = vi.spyOn(Storage.prototype, "setItem");

        setChosenDatasetView("travel_deals", "table");

        expect(writes.mock.contexts).toEqual([sessionStorage]);
        expect(localStorage.length).toBe(0);
    });

    test("never reads a view another tab or an earlier version left in localStorage", () => {
        localStorage.setItem("travel_deals_view", "article_view");
        expect(getChosenDatasetView("travel_deals")).toBeNull();

        forgetChosenDatasetView("travel_deals");
        expect(localStorage.getItem("travel_deals_view")).toBe("article_view");
    });

    test("a second tab starts without the first tab's choice", () => {
        setChosenDatasetView("travel_deals", "article_view");

        sessionStorage.clear(); // a new tab's own session storage

        expect(getChosenDatasetView("travel_deals")).toBeNull();
    });

    // A full storage still reads, so the older stored view must not win over
    // the choice this page just made.
    test("a refused write is kept in this page's memory and read back", () => {
        setChosenDatasetView("travel_deals", "card");
        const refuse = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("QuotaExceededError");
        });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        expect(() => setChosenDatasetView("travel_deals", "table")).not.toThrow();

        refuse.mockRestore();
        expect(getChosenDatasetView("travel_deals")).toBe("table");
        expect(sessionStorage.getItem("travel_deals_view")).toBe("card");
        expect(warn).toHaveBeenCalledTimes(1);
    });

    test("a browser that refuses session storage keeps this page's choice in memory", () => {
        for (const method of ["getItem", "setItem", "removeItem"]) {
            vi.spyOn(Storage.prototype, method).mockImplementation(() => {
                throw new Error("SecurityError");
            });
        }
        vi.spyOn(console, "warn").mockImplementation(() => {});

        expect(getChosenDatasetView("travel_deals")).toBeNull();
        setChosenDatasetView("travel_deals", "article_view");
        expect(getChosenDatasetView("travel_deals")).toBe("article_view");
        expect(() => forgetChosenDatasetView("travel_deals")).not.toThrow();
        expect(getChosenDatasetView("travel_deals")).toBeNull();
    });
});

/** Every production JavaScript file of the frontend, relative to its root. */
function listProductionSources(directory = FRONTEND_ROOT) {
    const sources = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            if (!["dist", "node_modules"].includes(entry.name)) sources.push(...listProductionSources(path));
        } else if (entry.name.endsWith(".js") && !/\.test\.js$|_test_setup\.js$/.test(entry.name)) {
            sources.push(relative(FRONTEND_ROOT, path));
        }
    }
    return sources;
}

// A module that reached the stored view directly would bring back the storage
// every tab shares, or a second copy of the choice. Those keys have one owner.
test("no frontend module reaches a dataset's stored view except through the saver", () => {
    const directViewAccess = /(?:local|session)Storage\.(?:get|set|remove)Item\([^)]*(?:_view[`'"]|\+\s*['"]_view['"])/;
    const offenders = listProductionSources()
        .filter((source) => source !== SAVER_PATH)
        .filter((source) => directViewAccess.test(readFileSync(join(FRONTEND_ROOT, source), "utf8")));

    expect(offenders).toEqual([]);
});
