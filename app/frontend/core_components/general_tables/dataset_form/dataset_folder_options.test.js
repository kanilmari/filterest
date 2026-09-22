// dataset_folder_options.test.js
// Verifies the dataset form's pure folder rules: the folder choices, where a new
// dataset goes by default, and where an existing dataset sits.
// Exists so a new dataset lands where the site navigation lists it — directly in
// the current project's folder — and database / other_tables stays the fallback.

import { describe, expect, test } from 'vitest';
import {
    buildFolderOptionsFromNodes,
    findCanonicalOtherTablesFolderValue,
    findDatasetPlacement,
    resolveFolderSelectionDefaults,
} from './dataset_folder_options.js';

// The folders of the fintravel.fi incident: the current project is apps / fintravel.
const fintravelNodes = [
    { id: 'f_1', db_id: 1, name: 'database', parent_id: 'null' },
    { id: 'f_4', db_id: 4, name: 'apps', parent_id: 'f_1' },
    { id: 'f_14', db_id: 14, name: 'other_tables', parent_id: 'f_1' },
    { id: 'f_10000', db_id: 10000, name: 'fintravel', parent_id: 'f_4', is_current_project: true },
    { id: 't_blogs', db_id: 10044, name: 'blogs', parent_id: 'f_14', table_uid: '10044' },
];

describe('dataset folder options', () => {
    test('builds sorted folder labels from flat tree nodes and marks the current project', () => {
        const result = buildFolderOptionsFromNodes([
            { id: 'f_150', db_id: 150, name: 'other_tables', parent_id: 'f_15' },
            { id: 'f_15', db_id: 15, name: 'database', parent_id: 'null' },
            { id: 'f_24', db_id: 24, name: 'agent_tools', parent_id: 'f_6', is_current_project: true },
            { id: 'f_6', db_id: 6, name: 'development', parent_id: 'f_15' },
        ]);

        expect(result).toEqual([
            { value: '15', label: 'database', isCurrentProject: false },
            { value: '6', label: 'database / development', isCurrentProject: false },
            { value: '24', label: 'database / development / agent_tools', isCurrentProject: true },
            { value: '150', label: 'database / other_tables', isCurrentProject: false },
        ]);
    });

    test('prefers the canonical database / other_tables folder when duplicates exist', () => {
        expect(findCanonicalOtherTablesFolderValue([
            { value: '151', label: 'other_tables' },
            { value: '150', label: 'database / other_tables' },
        ])).toBe('150');
    });

    test('a new dataset goes into the current project folder by default', () => {
        const options = buildFolderOptionsFromNodes(fintravelNodes);
        expect(resolveFolderSelectionDefaults(options)).toEqual({
            currentProjectValue: '10000',
            canonicalOtherTablesValue: '14',
            existingFolderValue: '10000',
            newFolderParentValue: '10000',
        });
        expect(options.find((option) => option.value === '10000').isCurrentProject).toBe(true);
    });

    test('without a current project, database / other_tables stays the default', () => {
        const defaults = resolveFolderSelectionDefaults([
            { value: '24', label: 'database / development / agent_tools' },
            { value: '150', label: 'database / other_tables' },
        ]);
        expect(defaults.existingFolderValue).toBe('150');
        expect(defaults.currentProjectValue).toBe('');
    });

    test('a folder the person chose is kept; a folder that no longer exists is not', () => {
        const options = buildFolderOptionsFromNodes(fintravelNodes);
        expect(resolveFolderSelectionDefaults(options, '14').existingFolderValue).toBe('14');
        expect(resolveFolderSelectionDefaults(options, '999').existingFolderValue).toBe('10000');
    });

    test('reports where a dataset sits, and stays silent about one it cannot find', () => {
        expect(findDatasetPlacement(fintravelNodes, 'blogs'))
            .toEqual({ folderId: '14', itemId: 10044, datasetUID: 10044 });
        expect(findDatasetPlacement(fintravelNodes, 'unknown_dataset'))
            .toEqual({ folderId: '', itemId: 0, datasetUID: 0 });
    });
});
