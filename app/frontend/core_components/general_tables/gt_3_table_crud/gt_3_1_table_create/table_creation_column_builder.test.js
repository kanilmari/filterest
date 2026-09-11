// @vitest-environment jsdom
// Exercises the actual open creation form and shared translator without data writes.
import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';
import { endpoint_router } from '../../../endpoints/endpoint_router.js';
import { translatePage } from '../../../lang/translation_handler.js';
import { generate_table_creation_view } from './table_creator.js';
import { isValidCardRole, getCardRoleOptions } from '../../../table_views/card_view/card_role_catalog.js';

vi.mock('../../../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn() }));
vi.mock('../../../endpoints/endpoint_column_fetcher.js', () => ({ fetch_columns_for_table: vi.fn().mockResolvedValue([]) }));
vi.mock('../../../table_views/card_view/card_view_printer.js', () => ({ refreshCardLanguages: vi.fn().mockResolvedValue() }));
vi.mock('../../../table_views/dataset_value_localizer.js', () => ({ refreshLocalizedDatasetValues: vi.fn().mockResolvedValue() }));
vi.mock('../../../lang/dev_lang_key_editor.js', () => ({ initDevLangKeyEditor: vi.fn() }));
vi.mock('../../../vanilla_tree/van_tr_components/admin_tree_builder.js', () => ({ initializeTreeCallAdmin: vi.fn().mockResolvedValue() }));
vi.mock('../../../../reusable_components/notifications/toast_notification_printer.js', () => ({
    showToast: vi.fn(), showSuccessToast: vi.fn(), showWarningToast: vi.fn(),
}));

describe('dataset creation card roles', () => {
    beforeEach(() => {
        document.body.replaceChildren();
        localStorage.clear();
        endpoint_router.mockReset();
        endpoint_router.mockImplementation(async (name) => name === 'datasetNames' ? [] : { nodes: [] });
        window.translationPromises = Object.fromEntries(['fi','en','ch','yue'].map((lang) => [lang, Promise.resolve({})]));
    });
    afterEach(() => {
        document.body.replaceChildren();
        delete window.translationPromises;
        vi.restoreAllMocks();
    });

    test('updates all role labels FI→EN→Chinese→Cantonese→FI without replacing controls or submitting', async () => {
        await translatePage('fi');
        const host = document.createElement('div');
        document.body.appendChild(host);
        await generate_table_creation_view(host);
        const form = host.querySelector('form');
        const role = form.querySelectorAll('[name="card_role"]')[3];
        const columnName = form.querySelectorAll('[name="column_name"]')[3];
        columnName.value = 'title';
        role.value = 'header';
        const fieldCount = form.querySelectorAll('input,select').length;
        for (const [lang, title, additional] of [
            ['fi','Otsikko','Lisätieto'], ['en','Title','Additional information'],
            ['ch','标题','补充信息'], ['yue','標題','補充資料'], ['fi','Otsikko','Lisätieto'],
        ]) {
            await translatePage(lang);
            expect(role.querySelector('[value="header"]').textContent).toBe(title);
            expect(role.querySelector('[value="details"]').textContent).toBe(additional);
            expect(role.value).toBe('header');
            expect(columnName.value).toBe('title');
            expect(form.querySelectorAll('input,select')).toHaveLength(fieldCount);
            expect(form.querySelectorAll('[name="card_role"]')[3]).toBe(role);
            expect(form.querySelector('#create_table_new_folder_parent_id')).not.toBeNull();
        }
        expect(endpoint_router.mock.calls.filter(([, options]) => options?.method === 'POST')).toEqual([]);
    });

    test('keeps column, length and role FormData aligned through type changes and removal', async () => {
        await translatePage('en');
        const host = document.createElement('div');
        document.body.appendChild(host);
        await generate_table_creation_view(host);
        const form = host.querySelector('form');
        const rows = form.querySelectorAll('.column-field');
        const row = rows[3];
        row.querySelector('[name="column_name"]').value = 'summary';
        const type = row.querySelector('[name="data_type"]');
        type.value = 'VARCHAR';
        type.dispatchEvent(new Event('change'));
        row.querySelector('[name="length"]').value = '255';
        row.querySelector('[name="card_role"]').value = 'description';
        rows[2].querySelector('button').click();
        const data = new FormData(form);
        expect(data.getAll('column_name')).toEqual(['id','created','summary']);
        expect(data.getAll('length')).toEqual(['','','255']);
        expect(data.getAll('card_role')).toEqual(['details','details','description']);
        type.value = 'TEXT';
        type.dispatchEvent(new Event('change'));
        expect(new FormData(form).getAll('length')).toEqual(['','','']);
        expect(row.querySelector('[name="length"]').required).toBe(false);
    });

    test('submits chosen roles in the existing create request, without additional metadata writes', async () => {
        await translatePage('en');
        const host = document.createElement('div');
        document.body.appendChild(host);
        await generate_table_creation_view(host);
        const form = host.querySelector('form');
        form.querySelector('[name="table_name"]').value = 'demo';
        const row = form.querySelectorAll('.column-field')[3];
        row.querySelector('[name="column_name"]').value = 'title';
        row.querySelector('[name="data_type"]').value = 'TEXT';
        row.querySelector('[name="card_role"]').value = 'header';
        vi.spyOn(console, 'debug').mockImplementation(() => {});
        endpoint_router.mockImplementation(async (name) => {
            if (name === 'createDataset') throw new Error('test stops before creation');
            return [];
        });
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(endpoint_router).toHaveBeenCalledWith('createDataset', expect.objectContaining({
            method: 'POST',
            body_data: expect.objectContaining({
                column_card_roles: {id:'details',created:'details',updated:'details',title:'header'},
            }),
        })));
        expect(endpoint_router.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
    });

    test('retains supported legacy combinations and rejects unknown protocol values', () => {
        for (const role of ['details1100','description2','details_link10','header+lang_key','image,header+lang-key','\tdescription']) {
            expect(isValidCardRole(role), role).toBe(true);
        }
        for (const role of ['title','header2','details_bad','header+lang_key+extra','header,']) {
            expect(isValidCardRole(role), role).toBe(false);
        }
        for (const { value } of getCardRoleOptions({ includeLegacyVariants: true })) expect(isValidCardRole(value)).toBe(true);
    });
});
