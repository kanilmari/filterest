// table_creator_folder_helpers.test.js
// Verifies pure folder-option shaping used by the create-table form.
// Bridges tree-cache folder nodes and default select choices without DOM setup.
// Exists so canonical other_tables placement stays stable across future refactors.

import { describe, expect, test } from 'vitest';
import {
    buildFolderOptionsFromNodes,
    findCanonicalOtherTablesFolderValue,
    resolveFolderSelectionDefaults,
} from './table_creator_folder_helpers.js';

describe('table_creator_folder_helpers', () => {
    test('builds sorted folder labels from flat tree nodes', () => {
        const result = buildFolderOptionsFromNodes([
            { id: 'f_150', db_id: 150, name: 'other_tables', parent_id: 'f_15' },
            { id: 'f_15', db_id: 15, name: 'database', parent_id: 'null' },
            { id: 'f_24', db_id: 24, name: 'agent_tools', parent_id: 'f_6' },
            { id: 'f_6', db_id: 6, name: 'development', parent_id: 'f_15' },
        ]);

        expect(result).toEqual([
            { value: '15', label: 'database' },
            { value: '6', label: 'database / development' },
            { value: '24', label: 'database / development / agent_tools' },
            { value: '150', label: 'database / other_tables' },
        ]);
    });

    test('prefers the canonical database / other_tables folder when duplicates exist', () => {
        const value = findCanonicalOtherTablesFolderValue([
            { value: '151', label: 'other_tables' },
            { value: '150', label: 'database / other_tables' },
        ]);

        expect(value).toBe('150');
    });

    test('uses canonical other_tables defaults when no folder has been preselected', () => {
        const defaults = resolveFolderSelectionDefaults([
            { value: '24', label: 'database / development / agent_tools' },
            { value: '150', label: 'database / other_tables' },
        ]);

        expect(defaults).toEqual({
            canonicalOtherTablesValue: '150',
            existingFolderValue: '150',
            newFolderParentValue: '150',
        });
    });

    test('preserves the user-selected folder while still reporting the canonical fallback', () => {
        const defaults = resolveFolderSelectionDefaults([
            { value: '24', label: 'database / development / agent_tools' },
            { value: '150', label: 'database / other_tables' },
        ], '24');

        expect(defaults).toEqual({
            canonicalOtherTablesValue: '150',
            existingFolderValue: '24',
            newFolderParentValue: '24',
        });
    });
});
