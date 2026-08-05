// table_creator_helpers.test.js
// Verifies the pure table-creation request builder used by table_creator.js.
// Bridges plain form snapshots and the request payload shape without DOM setup.
// Exists so the submit flow can stay thin while the core transformation stays tested.

import { describe, expect, test } from 'vitest';
import { buildTableCreationRequestData } from './table_creator_helpers.js';

describe('buildTableCreationRequestData', () => {
    test('builds a normalized payload from the form snapshot', () => {
        const result = buildTableCreationRequestData({
            tableName: '  sample_table  ',
            columnNames: [' id ', ' title ', '', 'notes'],
            dataTypes: ['SERIAL', 'VARCHAR', 'TEXT', 'TEXT'],
            lengths: ['', '40', '', ''],
            referencingColumns: ['owner_id', '', 'category_id'],
            referencedTables: ['users', '', 'categories'],
            referencedColumns: ['id', '', 'id'],
            grantUsersRead: true,
            grantGuestsRead: false,
            preventDeletion: true,
            folderId: '12',
            createFolderName: '',
            createFolderParentId: '',
        });

        expect(result.ok).toBe(true);
        expect(result.tableName).toBe('sample_table');
        expect(result.columns).toEqual({
            id: 'SERIAL',
            title: 'VARCHAR(40)',
            notes: 'TEXT',
        });
        expect(result.foreignKeys).toEqual([
            {
                referencing_column: 'owner_id',
                referenced_dataset: 'users',
                referenced_column: 'id',
            },
            {
                referencing_column: 'category_id',
                referenced_dataset: 'categories',
                referenced_column: 'id',
            },
        ]);
        expect(result.requestData).toEqual({
            dataset_name: 'sample_table',
            columns: {
                id: 'SERIAL',
                title: 'VARCHAR(40)',
                notes: 'TEXT',
            },
            foreign_keys: [
                {
                    referencing_column: 'owner_id',
                    referenced_dataset: 'users',
                    referenced_column: 'id',
                },
                {
                    referencing_column: 'category_id',
                    referenced_dataset: 'categories',
                    referenced_column: 'id',
                },
            ],
            grant_users_read: true,
            grant_guests_read: false,
            prevent_deletion: true,
            folder_id: 12,
            create_folder: null,
        });
    });

    test('returns a table-name validation failure before building any payload', () => {
        const result = buildTableCreationRequestData({
            tableName: '   ',
            columnNames: ['name'],
            dataTypes: ['TEXT'],
            lengths: [''],
            referencingColumns: [],
            referencedTables: [],
            referencedColumns: [],
            grantUsersRead: false,
            grantGuestsRead: false,
            preventDeletion: false,
            folderId: '',
            createFolderName: '',
            createFolderParentId: '',
        });

        expect(result).toEqual({
            ok: false,
            warningKey: 'table_name_required',
            warningFallback: 'Taulun nimi on pakollinen.',
        });
    });

    test('returns the first column validation failure it encounters', () => {
        const result = buildTableCreationRequestData({
            tableName: 'valid_table',
            columnNames: ['valid_name', 'bad name'],
            dataTypes: ['TEXT', 'TEXT'],
            lengths: ['', ''],
            referencingColumns: [],
            referencedTables: [],
            referencedColumns: [],
            grantUsersRead: false,
            grantGuestsRead: false,
            preventDeletion: false,
            folderId: '',
            createFolderName: '',
            createFolderParentId: '',
        });

        expect(result).toEqual({
            ok: false,
            warningKey: 'invalid_column_name',
            warningFallback: 'Virheellinen sarakenimi "bad name". Käytä vain a-z, A-Z, numeroita ja alaviivaa.',
        });
    });

    test('returns a missing-data-type failure for a named column without a type', () => {
        const result = buildTableCreationRequestData({
            tableName: 'valid_table',
            columnNames: ['valid_name'],
            dataTypes: [''],
            lengths: [''],
            referencingColumns: [],
            referencedTables: [],
            referencedColumns: [],
            grantUsersRead: false,
            grantGuestsRead: false,
            preventDeletion: false,
            folderId: '',
            createFolderName: '',
            createFolderParentId: '',
        });

        expect(result).toEqual({
            ok: false,
            warningKey: 'missing_data_type',
            warningFallback: 'Tietotyyppi puuttuu sarakkeelle "valid_name".',
        });
    });

    test('allows backend default folder placement when neither an existing nor new folder is provided', () => {
        const result = buildTableCreationRequestData({
            tableName: 'valid_table',
            columnNames: ['id'],
            dataTypes: ['SERIAL'],
            lengths: [''],
            referencingColumns: [],
            referencedTables: [],
            referencedColumns: [],
            grantUsersRead: false,
            grantGuestsRead: false,
            preventDeletion: false,
            folderId: '',
            createFolderName: '   ',
            createFolderParentId: '',
        });

        expect(result.ok).toBe(true);
        expect(result.requestData.folder_id).toBeNull();
        expect(result.requestData.create_folder).toBeNull();
    });

    test('builds an inline folder creation payload when a new folder name is provided', () => {
        const result = buildTableCreationRequestData({
            tableName: 'valid_table',
            columnNames: ['id'],
            dataTypes: ['SERIAL'],
            lengths: [''],
            referencingColumns: [],
            referencedTables: [],
            referencedColumns: [],
            grantUsersRead: false,
            grantGuestsRead: true,
            preventDeletion: false,
            folderId: '8',
            createFolderName: '  reports  ',
            createFolderParentId: '3',
        });

        expect(result.ok).toBe(true);
        expect(result.requestData.folder_id).toBeNull();
        expect(result.requestData.create_folder).toEqual({
            folder_name: 'reports',
            parent_id: 3,
        });
    });
});
