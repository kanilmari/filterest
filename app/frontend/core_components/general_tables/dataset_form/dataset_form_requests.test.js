// dataset_form_requests.test.js
// Verifies the dataset form's pure request builders: the create request a new
// dataset's draft becomes, and the schema request an edited draft becomes.
// Exists so both persistence adapters send one draft shape faithfully, and a
// new folder with a parent but no name can never reach the server.

import { describe, expect, test } from 'vitest';
import { buildDatasetCreateRequest, buildDatasetEditRequest, toSavedColumn } from './dataset_form_requests.js';

const draft = (overrides = {}) => ({
    name: 'sample_table',
    columns: [{ name: 'id', dataType: 'SERIAL' }, { name: 'title', dataType: 'TEXT', role: 'header' }],
    links: [],
    readers: {},
    folder: { folderId: '', newFolder: null },
    ...overrides,
});

describe('create request', () => {
    test('builds a normalized payload from the draft', () => {
        const result = buildDatasetCreateRequest(draft({
            name: '  sample_table  ',
            columns: [
                { name: ' id ', dataType: 'SERIAL' },
                { name: ' title ', dataType: 'VARCHAR', length: 40 },
                { name: '', dataType: 'TEXT' },
                { name: 'price', dataType: 'NUMERIC(12,4)', role: 'description' },
            ],
            links: [
                { referencing_column: 'owner_id', referenced_dataset: 'users', referenced_column: 'id' },
                { referencing_column: 'category_id', referenced_dataset: '', referenced_column: '' },
            ],
            readers: { users: true, guests: false },
            preventDeletion: true,
            images: true,
            symbol: 'payments',
            folder: { folderId: '12', newFolder: null },
        }));

        expect(result).toEqual({
            ok: true,
            tableName: 'sample_table',
            requestData: {
                dataset_name: 'sample_table',
                columns: { id: 'SERIAL', title: 'VARCHAR(40)', price: 'NUMERIC(12,4)' },
                column_card_roles: { id: 'details', title: 'details', price: 'description' },
                foreign_keys: [{ referencing_column: 'owner_id', referenced_dataset: 'users', referenced_column: 'id' }],
                grant_users_read: true,
                grant_guests_read: false,
                prevent_deletion: true,
                folder_id: 12,
                create_folder: null,
            },
        });
        // The pictures and the symbol are set up once the dataset exists.
        expect(result.requestData).not.toHaveProperty('enable_images');
        expect(result.requestData).not.toHaveProperty('icon_key');
    });

    test.each([
        [{ name: '   ' }, 'table_name_required', 'name'],
        [{ name: 'bad name' }, 'invalid_table_name_chars', 'name'],
        [{ columns: [{ name: 'bad name', dataType: 'TEXT' }] }, 'invalid_column_name', 'columns'],
        [{ columns: [{ name: 'title', dataType: '' }] }, 'missing_data_type', 'columns'],
        [{ columns: [{ name: 'Name', dataType: 'TEXT' }, { name: 'name', dataType: 'TEXT' }] }, 'duplicate_column_name', 'columns'],
        [{ columns: [{ name: 'title', dataType: 'TEXT', role: 'arbitrary' }] }, 'invalid_card_role', 'columns'],
        [{ columns: [{ name: '', dataType: 'TEXT' }] }, 'add_at_least_one_column', 'columns'],
    ])('refuses %j with %s before building any payload', (overrides, warningKey, field) => {
        expect(buildDatasetCreateRequest(draft(overrides))).toEqual({ ok: false, warningKey, field });
    });

    test('no folder at all lets the server choose the current project folder', () => {
        const { requestData } = buildDatasetCreateRequest(draft());
        expect(requestData.folder_id).toBeNull();
        expect(requestData.create_folder).toBeNull();
    });

    test('a named new folder is made under its parent and replaces the folder choice', () => {
        const { requestData } = buildDatasetCreateRequest(draft({
            folder: { folderId: '8', newFolder: { name: '  reports  ', parentId: '3' } },
        }));
        expect(requestData.folder_id).toBeNull();
        expect(requestData.create_folder).toEqual({ folder_name: 'reports', parent_id: 3 });
    });

    // The fintravel.fi incident: a parent was chosen for a new folder that was
    // never named, and the dataset went to database / other_tables unnoticed.
    test('a new folder with a parent but no name is refused, never silently dropped', () => {
        for (const parentId of ['9', '']) {
            expect(buildDatasetCreateRequest(draft({
                folder: { folderId: '', newFolder: { name: '   ', parentId } },
            }))).toEqual({ ok: false, warningKey: 'dataset_new_folder_name_required', field: 'folder' });
        }
    });

    test('a dataset born multilingual says so; an unticked choice keeps the old request', () => {
        expect(buildDatasetCreateRequest(draft({ multilingualDefault: true })).requestData.new_columns_multilingual).toBe(true);
        for (const choice of [false, undefined]) {
            expect(buildDatasetCreateRequest(draft({ multilingualDefault: choice })).requestData)
                .not.toHaveProperty('new_columns_multilingual');
        }
    });
});

describe('edit request', () => {
    const row = (name) => ({ name });
    const saved = [toSavedColumn('legacy_col', 'text', null), toSavedColumn('code', 'VARCHAR', 20)];
    const column = (overrides) => ({
        row: row(overrides.name), originalName: null, name: '', dataType: '', length: null,
        role: 'details', roleChanged: false, ...overrides,
    });

    test('sends only what changed, measured against what the server holds', () => {
        const columns = [
            column({ originalName: 'legacy_col', name: 'modern_col', dataType: 'TEXT', roleChanged: true, role: 'header' }),
            column({ name: 'fresh_col', dataType: 'VARCHAR', length: 40, isMultilingual: true }),
            column({ name: 'half_done' }),
        ];
        const result = buildDatasetEditRequest({
            datasetName: 'demo_table', savedColumns: saved, columns,
            multilingualDefault: true, savedMultilingualDefault: false, preventDeletion: true,
        });
        expect(result.requestData).toEqual({
            dataset_name: 'demo_table',
            modified_columns: [{ original_name: 'legacy_col', new_name: 'modern_col', data_type: 'TEXT', length: null }],
            added_columns: [{
                original_name: '', new_name: 'fresh_col', data_type: 'VARCHAR', length: 40, is_multilingual: true,
            }],
            removed_columns: ['code'],
            // The half-finished row is not created, so its role is not sent.
            column_card_roles: { modern_col: 'header', fresh_col: 'details' },
            new_columns_multilingual: true,
            prevent_deletion: true,
        });
        expect(result.sentRows.get(result.added[0])).toBe(columns[1].row);
        expect(result.sentRoles.map(({ role }) => role)).toEqual(['header', 'details']);
    });

    test('an untouched draft sends nothing but its name', () => {
        const result = buildDatasetEditRequest({
            datasetName: 'demo_table', savedColumns: saved,
            columns: [
                column({ originalName: 'legacy_col', name: 'legacy_col', dataType: 'TEXT' }),
                column({ originalName: 'code', name: 'code', dataType: 'VARCHAR', length: 20 }),
            ],
            multilingualDefault: false, savedMultilingualDefault: false,
        });
        expect(result.requestData).toEqual({
            dataset_name: 'demo_table', modified_columns: [], added_columns: [], removed_columns: [],
        });
    });

    test('a changed length of limited text is a change of type', () => {
        const result = buildDatasetEditRequest({
            datasetName: 'demo_table', savedColumns: saved,
            columns: [
                column({ originalName: 'legacy_col', name: 'legacy_col', dataType: 'TEXT' }),
                column({ originalName: 'code', name: 'code', dataType: 'VARCHAR', length: 30 }),
            ],
            multilingualDefault: false, savedMultilingualDefault: false,
        });
        expect(result.requestData.modified_columns).toEqual([
            { original_name: 'code', new_name: 'code', data_type: 'VARCHAR', length: 30 },
        ]);
    });

    test('an invalid column name is refused before anything is sent', () => {
        expect(buildDatasetEditRequest({
            datasetName: 'demo_table', savedColumns: saved, columns: [column({ name: 'bad name', dataType: 'TEXT' })],
        })).toEqual({ ok: false, warningKey: 'invalid_column_name', field: 'columns' });
    });
});
