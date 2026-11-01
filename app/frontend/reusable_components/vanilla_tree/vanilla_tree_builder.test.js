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

    test("search then clear restores the reader's expansion without a row commit (HEAD contract)", async () => {
        vi.useFakeTimers();
        await render_tree([
            { id: 'folder', name: 'Folder', parent_id: null },
            { id: 'inner', name: 'Inner', parent_id: 'folder' },
            { id: 'leaf', name: 'Needle', parent_id: 'inner', table_uid: 12 },
            { id: 'other', name: 'Other', parent_id: null },
            { id: 'other_leaf', name: 'Other leaf', parent_id: 'other', table_uid: 13 },
        ], { container_id: 'tree_host', id_suffix: '_search', initial_open_level: 2,
            render_mode: 'button', use_data_lang_key: false });
        await vi.runAllTimersAsync();
        for (const id of ['folder', 'other']) {
            document.getElementById(`tree_node_${id}_search`).querySelector(':scope > .node-row > .toggle').click();
        }
        const saved = () => JSON.parse(localStorage.getItem('tree_state_v2_search'));
        const beforeSearch = saved();
        const search = document.getElementById('tree_search_search');
        search.value = 'Needle'; search.dispatchEvent(new Event('input'));
        expect(document.getElementById('tree_node_folder_search').dataset.expanded).toBe('true');
        search.value = ''; search.dispatchEvent(new Event('input'));
        expect(saved()).toEqual(beforeSearch);
        expect(document.getElementById('tree_node_folder_search').dataset.expanded).toBe('false');
        expect(document.getElementById('tree_node_inner_search').dataset.expanded).toBe('true');
        expect(document.getElementById('tree_node_other_search').dataset.expanded).toBe('false');
        expect(document.querySelectorAll('.node.hidden')).toHaveLength(0);
    });

    test('an explicit close overrides initial opening on every fresh render', async () => {
        vi.useFakeTimers();
        const rows = [{ id: 'folder', name: 'Folder', parent_id: null },
            { id: 'leaf', name: 'Leaf', parent_id: 'folder', table_uid: 12 }];
        const config = { container_id: 'tree_host', id_suffix: '_defaults', initial_open_level: 1 };
        await render_tree(rows, config);
        await vi.runAllTimersAsync();
        expect(localStorage.getItem('tree_state_v2_defaults')).toBeNull();
        document.getElementById('tree_node_folder_defaults').querySelector(':scope > .node-row > .toggle').click();
        await render_tree(rows, config);
        await vi.runAllTimersAsync();
        expect(document.getElementById('tree_node_folder_defaults').dataset.expanded).toBe('false');
    });

    const navRows = [
        { id: 'a', name: 'A', parent_id: null },
        { id: 'a_inner', name: 'Inner', parent_id: 'a' },
        { id: 'needle', name: 'Neula', parent_id: 'a_inner', table_uid: 12 },
        { id: 'b', name: 'B', parent_id: null },
        { id: 'b_leaf', name: 'B leaf', parent_id: 'b', table_uid: 13 },
        { id: 'untouched', name: 'Untouched', parent_id: null },
        { id: 'other_leaf', name: 'Other', parent_id: 'untouched', table_uid: 14 },
    ];
    const navConfig = { container_id: 'tree_host', id_suffix: '_nav',
        render_mode: 'button', checkbox_mode: 'none', initial_open_level: 0,
        show_node_count: false, use_data_lang_key: false };
    const node = id => document.getElementById(`tree_node_${id}_nav`);
    const toggle = id => node(id).querySelector(':scope > .node-row > .toggle').click();
    const savedNav = () => JSON.parse(localStorage.getItem('tree_state_v2_nav'));
    const searchNav = term => {
        const search = document.getElementById('tree_search_nav');
        search.value = term;
        search.dispatchEvent(new Event('input'));
    };
    const expectNav = (openIds = []) => {
        for (const id of ['a', 'a_inner', 'b', 'untouched']) {
            const expanded = openIds.includes(id);
            expect(node(id).dataset.expanded === 'true', id).toBe(expanded);
            expect(node(id).querySelector(':scope > .children').hidden, id).toBe(!expanded);
            expect(node(id).querySelector(':scope > .node-row > .toggle')
                .getAttribute('aria-expanded'), id).toBe(String(expanded));
        }
    };

    test('reload restores explicit open AND closed choices, ignoring polluted legacy opens', async () => {
        localStorage.setItem('expanded_nodes_nav', JSON.stringify([
            'tree_node_b_nav', 'tree_node_untouched_nav',
        ]));
        await render_tree(navRows, navConfig);
        expectNav();
        toggle('a'); toggle('b'); toggle('b');
        const choices = { open: ['tree_node_a_nav'], closed: ['tree_node_b_nav'] };
        expect(savedNav()).toEqual(choices);
        document.body.innerHTML = '<div id="tree_host"></div>';
        await render_tree(structuredClone(navRows), navConfig);
        expectNav(['a']);
        expect(savedNav()).toEqual(choices);
        expect(localStorage.getItem('expanded_nodes_nav')).toBeNull();
        toggle('a'); toggle('b');
        document.body.innerHTML = '<div id="tree_host"></div>';
        await render_tree(navRows, navConfig);
        expectNav(['b']);
    });

    test('cached then fresh render restores choices, including new untouched folders', async () => {
        await render_tree(navRows, navConfig);
        toggle('a'); toggle('b'); toggle('b');
        const choices = savedNav();
        document.body.innerHTML = '<div id="tree_host"></div>';
        await render_tree(navRows.slice(0, 5), navConfig);
        expect(node('a').dataset.expanded).toBe('true');
        expect(node('b').dataset.expanded).toBe('false');
        // Browser form restoration can set a cached render's value without input.
        document.getElementById('tree_search_nav').value = 'Neula';
        await render_tree(navRows, navConfig);
        expectNav(['a']);
        expect(document.getElementById('tree_search_nav').value).toBe('');
        expect(savedNav()).toEqual(choices);
    });

    test('search reveal and a restored search value never become reload choices', async () => {
        await render_tree(navRows, navConfig);
        toggle('b'); toggle('b');
        const choices = savedNav();
        searchNav('Neula');
        expectNav(['a', 'a_inner']);
        expect(savedNav()).toEqual(choices);
        // The cached tree can have a browser-restored search field before the fresh render.
        await render_tree(navRows, { ...navConfig, preserveSearch: true });
        expect(document.getElementById('tree_search_nav').value).toBe('Neula');
        expectNav(['a', 'a_inner']);
        searchNav('');
        expectNav();
        searchNav('Neula');
        document.body.innerHTML = '<div id="tree_host"></div>';
        await render_tree(navRows, navConfig);
        expectNav();
        expect(savedNav()).toEqual(choices);
    });

    test('an opened descendant survives reload inside a closed parent and its later reopening', async () => {
        await render_tree(navRows, navConfig);
        toggle('a'); toggle('a_inner'); toggle('a');
        document.body.innerHTML = '<div id="tree_host"></div>';
        await render_tree(navRows, navConfig);
        expectNav(['a_inner']);
        toggle('a');
        expectNav(['a', 'a_inner']);
    });

    test('search query changes discard temporary paths, while deliberate search toggles survive clearing', async () => {
        await render_tree(navRows, navConfig);
        searchNav('Neula');
        expectNav(['a', 'a_inner']);
        searchNav('B leaf');
        expectNav(['b']);
        expect(savedNav()).toBeNull();
        toggle('b'); // Close a search-opened branch explicitly.
        searchNav('');
        expectNav();
        expect(savedNav()).toEqual({ open: [], closed: ['tree_node_b_nav'] });
        document.body.innerHTML = '<div id="tree_host"></div>';
        await render_tree(navRows, { ...navConfig, initial_open_level: 1 });
        expectNav(['a', 'untouched']);
    });

    test('preserveExpansion keeps old branches and gives new branches defaults without saving them', async () => {
        const config = { ...navConfig, initial_open_level: 2, preserveExpansion: true,
            preserveSearch: true };
        await render_tree(navRows.slice(0, 5), config);
        expect(savedNav()).toBeNull();
        toggle('a'); toggle('b');
        const choices = savedNav();
        searchNav('Neula');
        await render_tree(navRows, config);
        searchNav('');
        expectNav(['a_inner', 'untouched']);
        expect(savedNav()).toEqual(choices);
    });
});
