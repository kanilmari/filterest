// @vitest-environment jsdom
// vanilla_tree_builder.test.js
// Verifies animated expand/collapse state handling in the reusable vanilla tree.
// Bridges rendered tree DOM and the height controller with a jsdom harness that avoids real browser layout dependencies.
// Exists to prevent tree node toggling regressions in navigation, admin tools, and table tree views.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render_tree } from "./vanilla_tree_builder.js";

describe("render_tree", () => {
    let originalMatchMedia;
    let originalResizeObserver;
    let resizeObserverCtorCount;

    beforeEach(() => {
        document.body.innerHTML = '<div id="tree_host"></div>';
        localStorage.clear();
        originalMatchMedia = window.matchMedia;
        originalResizeObserver = globalThis.ResizeObserver;
        resizeObserverCtorCount = 0;

        window.matchMedia = vi.fn().mockImplementation(() => ({
            matches: true,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));

        globalThis.ResizeObserver = class {
            constructor() {
                resizeObserverCtorCount += 1;
            }
            observe() {}
            disconnect() {}
        };
    });

    afterEach(() => {
        vi.useRealTimers();
        window.matchMedia = originalMatchMedia;
        if (originalResizeObserver === undefined) {
            delete globalThis.ResizeObserver;
        } else {
            globalThis.ResizeObserver = originalResizeObserver;
        }
    });

    test("toggles folder children through the shared collapsible-height controller", async () => {
        await render_tree(
            [
                { id: "folder", db_id: "folder", name: "Folder", parent_id: null },
                { id: "leaf", db_id: "leaf", name: "Leaf", parent_id: "folder", table_uid: 12 },
            ],
            {
                container_id: "tree_host",
                id_suffix: "_spec",
                show_search: false,
                use_icons: false,
            }
        );

        const folderNode = document.getElementById("tree_node_folder_spec");
        const children = folderNode.querySelector(":scope > .children");
        Object.defineProperty(children, "scrollHeight", {
            configurable: true,
            get: () => 48,
        });

        const row = folderNode.querySelector(".node-row");
        const toggle = folderNode.querySelector(":scope > .node-row > .toggle");

        expect(children.hidden).toBe(true);
        expect(toggle.getAttribute("aria-expanded")).toBe("false");

        row.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(children.hidden).toBe(false);
        expect(folderNode.dataset.expanded).toBe("true");
        expect(toggle.getAttribute("aria-expanded")).toBe("true");

        row.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(children.hidden).toBe(true);
        expect(folderNode.dataset.expanded).toBe("false");
        expect(toggle.getAttribute("aria-expanded")).toBe("false");
        expect(resizeObserverCtorCount).toBe(0);
    });

    test("reopens a folder cleanly when collapse is interrupted by a second toggle", async () => {
        vi.useFakeTimers();
        window.matchMedia = vi.fn().mockImplementation(() => ({
            matches: false,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));

        await render_tree(
            [
                { id: "folder", db_id: "folder", name: "Folder", parent_id: null },
                { id: "leaf", db_id: "leaf", name: "Leaf", parent_id: "folder", table_uid: 12 },
            ],
            {
                container_id: "tree_host",
                id_suffix: "_anim",
                show_search: false,
                use_icons: false,
                render_mode: "button",
                checkbox_mode: "none",
            }
        );

        const folderNode = document.getElementById("tree_node_folder_anim");
        const children = folderNode.querySelector(":scope > .children");
        Object.defineProperty(children, "scrollHeight", {
            configurable: true,
            get: () => 48,
        });

        const row = folderNode.querySelector(".node-row");

        await vi.runOnlyPendingTimersAsync();

        row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await vi.advanceTimersByTimeAsync(400);

        expect(folderNode.dataset.expanded).toBe("true");
        expect(children.hidden).toBe(false);

        row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await vi.advanceTimersByTimeAsync(400);

        expect(folderNode.dataset.expanded).toBe("true");
        expect(children.hidden).toBe(false);
        expect(children.style.height).toBe("auto");
    });
});
