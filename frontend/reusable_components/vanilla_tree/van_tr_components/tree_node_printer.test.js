// @vitest-environment jsdom
// tree_node_printer.test.js
// Verifies node-level checkbox interaction and dataset metadata in the shared vanilla tree.
// Bridges tree row click handling and checkbox defaults through a minimal DOM harness.
// Exists to prevent row-level event handling from breaking native checkbox toggling.

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createTreeNode } from './tree_node_printer.js';

function buildContext(overrides = {}) {
    return {
        global_config: {
            checkbox_mode: 'all',
            use_data_lang_key: true,
            show_node_count: false,
            initial_open_level: 0,
        },
        render_mode: 'checkbox',
        id_suffix: '_test',
        nodes_to_open: [],
        toggleChildrenVisibility: () => {},
        handle_checkbox_change: vi.fn(),
        collectSelectedLeafNodesWithFolders: () => [],
        update_parent_state: () => {},
        updateCheckboxStates: vi.fn(),
        ...overrides,
    };
}

describe('createTreeNode', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="vanillaTree_test"></div>';
    });

    test('stores dataset metadata on table nodes', () => {
        const node = createTreeNode(
            { id: 'users', db_id: 'users', table_uid: 55, name: 'users' },
            0,
            buildContext()
        );

        expect(node.getAttribute('data-table-uid')).toBe('55');
    });

    test('preserves native checkbox toggling when the checkbox itself is clicked', () => {
        const handleCheckboxChange = vi.fn();
        const node = createTreeNode(
            { id: 'users', db_id: 'users', table_uid: 55, name: 'users' },
            0,
            buildContext({ handle_checkbox_change: handleCheckboxChange })
        );
        document.getElementById('vanillaTree_test').appendChild(node);

        const checkbox = node.querySelector('input[type="checkbox"]');
        checkbox.click();

        expect(checkbox.checked).toBe(true);
        expect(handleCheckboxChange).toHaveBeenCalledTimes(1);
    });

    test('renders radios in single-selection mode and selects one on row click', () => {
        const node = createTreeNode(
            { id: 'users', db_id: 'users', table_uid: 55, name: 'users' },
            0,
            buildContext({
                global_config: {
                    checkbox_mode: 'leaf',
                    selection_mode: 'single',
                    use_data_lang_key: true,
                    show_node_count: false,
                    initial_open_level: 0,
                },
            })
        );
        document.getElementById('vanillaTree_test').appendChild(node);

        const radio = node.querySelector('input[type="radio"]');
        expect(radio).not.toBeNull();

        const row = node.querySelector('.node-row');
        row.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(radio.checked).toBe(true);
    });

    test('still toggles the checkbox when clicking the row background', () => {
        const handleCheckboxChange = vi.fn();
        const node = createTreeNode(
            { id: 'users', db_id: 'users', table_uid: 55, name: 'users' },
            0,
            buildContext({ handle_checkbox_change: handleCheckboxChange })
        );
        document.getElementById('vanillaTree_test').appendChild(node);

        const row = node.querySelector('.node-row');
        const checkbox = node.querySelector('input[type="checkbox"]');
        row.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(checkbox.checked).toBe(true);
        expect(handleCheckboxChange).toHaveBeenCalledTimes(1);
    });

    test('does not rely on inline user-select styles for Safari compatibility', () => {
        const node = createTreeNode(
            { id: 'users', db_id: 'users', table_uid: 55, name: 'users' },
            0,
            buildContext()
        );
        const row = node.querySelector('.node-row');

        expect(node.style.userSelect).toBe('');
        expect(row.style.userSelect).toBe('');
    });
});
