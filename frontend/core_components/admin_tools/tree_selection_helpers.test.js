// @vitest-environment jsdom
// tree_selection_helpers.test.js
// Verifies dataset-only extraction from shared vanilla-tree selection ids.
// Bridges DOM node metadata and admin-tool table selection expectations in isolation.
// Exists to prevent empty folders or non-table nodes from being treated as datasets.

import { beforeEach, describe, expect, test } from 'vitest';
import {
    extractFirstSelectedTableName,
    extractSelectedTableNames,
} from './tree_selection_helpers.js';

describe('tree_selection_helpers', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    test('extractSelectedTableNames ignores folders and deduplicates table nodes', () => {
        document.body.innerHTML = `
            <div id="tree_node_folder">
                <span data-lang-key="apps"></span>
            </div>
            <div id="tree_node_users" data-table-uid="101">
                <span data-lang-key="users"></span>
            </div>
            <div id="tree_node_orders" data-table-uid="202">
                <button data-lang-key="orders"></button>
            </div>
        `;

        expect(
            extractSelectedTableNames([
                'tree_node_folder',
                'tree_node_users',
                'tree_node_orders',
                'tree_node_users',
            ])
        ).toEqual(['users', 'orders']);
    });

    test('extractFirstSelectedTableName skips non-table nodes', () => {
        document.body.innerHTML = `
            <div id="tree_node_folder">
                <span data-lang-key="system"></span>
            </div>
            <div id="tree_node_users" data-table-uid="101">
                <span data-lang-key="users"></span>
            </div>
        `;

        expect(extractFirstSelectedTableName(['tree_node_folder', 'tree_node_users'])).toBe('users');
    });

    test('returns empty results for missing or invalid selections', () => {
        expect(extractSelectedTableNames()).toEqual([]);
        expect(extractSelectedTableNames(['tree_node_missing'])).toEqual([]);
        expect(extractFirstSelectedTableName(['tree_node_missing'])).toBeNull();
    });
});
