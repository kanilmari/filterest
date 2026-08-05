// @vitest-environment jsdom
// tree_view_printer.test.js
// Verifies dataset tree-view source selection for row trees and database catalog trees.
// Bridges tree_view_printer and the reusable vanilla tree renderer through mocked API data.
// Exists to keep catalog folders from rendering without their table leaves.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const renderTreeMock = vi.fn(async () => {});
const endpointRouterMock = vi.fn();

vi.mock('../../../reusable_components/vanilla_tree/vanilla_tree_builder.js', () => ({
    render_tree: renderTreeMock,
}));

vi.mock('../../endpoints/endpoint_router.js', () => ({
    endpoint_router: endpointRouterMock,
}));

describe('create_tree_view', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        localStorage.clear();
        document.body.innerHTML = '';
    });

    test('renders the database catalog tree with table leaves for system table folders', async () => {
        const catalogTreeData = {
            nodes: [
                { id: 'f_1', db_id: 1, name: 'apps', parent_id: 'null' },
                { id: 't_app_orders', db_id: 2, name: 'app_orders', parent_id: 'f_1', table_uid: '42' },
            ],
        };
        endpointRouterMock.mockResolvedValueOnce(catalogTreeData);
        document.body.innerHTML = '<div id="system_table_folders_tree_view_container"></div>';

        const { create_tree_view } = await import('./tree_view_printer.js');
        const treeHost = await create_tree_view(
            'system_table_folders',
            ['id', 'folder_name', 'parent_id'],
            []
        );

        expect(endpointRouterMock).toHaveBeenCalledWith('fetchTreeData');
        expect(renderTreeMock).toHaveBeenCalledWith(
            catalogTreeData.nodes,
            expect.objectContaining({
                container_id: treeHost.id,
                tree_model: 'flat',
                render_mode: 'button',
                use_data_lang_key: true,
            })
        );
        expect(renderTreeMock.mock.calls[0][0][1]).toMatchObject({
            id: 't_app_orders',
            parent_id: 'f_1',
            table_uid: '42',
        });
    });

    test('keeps ordinary dataset row trees inside the current dataset rows', async () => {
        document.body.innerHTML = '<div id="demo_dataset_tree_view_container"></div>';

        const { create_tree_view } = await import('./tree_view_printer.js');
        const treeHost = await create_tree_view(
            'demo_dataset',
            ['id', 'parent_id', 'type', 'name'],
            [
                { id: 1, parent_id: null, type: 'folder', name: 'Root' },
                { id: 2, parent_id: 1, type: 'item', name: 'Leaf' },
            ]
        );

        expect(endpointRouterMock).not.toHaveBeenCalled();
        expect(renderTreeMock).toHaveBeenCalledWith(
            [
                { id: 1, parent_id: null, name: 'Folder: Root' },
                { id: 2, parent_id: 1, name: 'Item: Leaf' },
            ],
            expect.objectContaining({
                container_id: treeHost.id,
                tree_model: 'flat',
                use_data_lang_key: false,
            })
        );
    });

    test.each([
        ['fi', 'Kansio: Suomenkielinen nimi'],
        ['en', 'Folder: English name'],
        ['yue', '資料夾: 粵語名稱'],
        ['sv', 'Folder: English name'],
    ])('shows only the %s value for multilingual tree labels', async (language, expectedLabel) => {
        localStorage.setItem('chosen_language', language);
        document.body.innerHTML = '<div id="demo_dataset_tree_view_container"></div>';

        const typeValue = JSON.stringify({
            en: 'folder',
            fi: 'kansio',
            yue: '資料夾',
        });
        const nameValue = JSON.stringify({
            en: 'English name',
            fi: 'Suomenkielinen nimi',
            yue: '粵語名稱',
        });
        const row = { id: 1, parent_id: null, type: typeValue, name: nameValue };

        const { create_tree_view } = await import('./tree_view_printer.js');
        await create_tree_view(
            'demo_dataset',
            ['id', 'parent_id', 'type', 'name'],
            [row],
            {
                type: { is_multilingual: true },
                name: { is_multilingual: true },
            }
        );

        expect(renderTreeMock.mock.calls.at(-1)[0]).toEqual([
            { id: 1, parent_id: null, name: expectedLabel },
        ]);
        expect(renderTreeMock.mock.calls.at(-1)[0][0].name).not.toContain('{"en"');
        expect(row.type).toBe(typeValue);
        expect(row.name).toBe(nameValue);
    });

    test('keeps ordinary JSON raw when the column is explicitly not multilingual', async () => {
        document.body.innerHTML = '<div id="demo_dataset_tree_view_container"></div>';
        const rawJson = JSON.stringify({ name: 'Raw value', value: 'Untouched' });

        const { create_tree_view } = await import('./tree_view_printer.js');
        await create_tree_view(
            'demo_dataset',
            ['id', 'name'],
            [{ id: 1, name: rawJson }],
            { name: { is_multilingual: false } }
        );

        expect(renderTreeMock.mock.calls.at(-1)[0][0].name).toBe(rawJson);
    });

    test('refreshes a mounted tree from retained rows without fetching again', async () => {
        localStorage.setItem('chosen_language', 'en');
        document.body.innerHTML = '<div id="demo_dataset_tree_view_container"></div>';
        const nameValue = JSON.stringify({ en: 'English name', fi: 'Suomenkielinen nimi' });
        const row = { id: 1, name: nameValue };

        const {
            create_tree_view,
            refresh_mounted_tree_view_languages,
        } = await import('./tree_view_printer.js');
        await create_tree_view(
            'demo_dataset',
            ['id', 'name'],
            [row],
            { name: { is_multilingual: true } }
        );
        expect(renderTreeMock.mock.calls.at(-1)[0][0].name).toBe('English name');

        localStorage.setItem('chosen_language', 'fi');
        const refreshedCount = await refresh_mounted_tree_view_languages();

        expect(refreshedCount).toBe(1);
        expect(renderTreeMock.mock.calls.at(-1)[0][0].name).toBe('Suomenkielinen nimi');
        expect(endpointRouterMock).not.toHaveBeenCalled();
        expect(row.name).toBe(nameValue);
    });
});
