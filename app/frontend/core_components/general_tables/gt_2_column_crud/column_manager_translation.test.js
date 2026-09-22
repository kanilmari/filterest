// column_manager_translation.test.js
// Exercises real page translation against both open management layers without writes.
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { endpoint_router } from '../../endpoints/endpoint_router.js';
import { translatePage } from '../../lang/translation_handler.js';
import { open_column_management_modal } from './column_manager.js';

const cleanup = [];
vi.mock('../../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn() }));
vi.mock('../../endpoints/endpoint_column_fetcher.js', () => ({
    fetch_columns_for_table: vi.fn().mockResolvedValue([
        { column_name: 'title', data_type: 'VARCHAR', character_maximum_length: 100 },
    ]),
}));
vi.mock('../../table_views/card_view/card_view_printer.js', () => ({ refreshCardLanguages: vi.fn().mockResolvedValue() }));
vi.mock('../../table_views/dataset_value_localizer.js', () => ({ refreshLocalizedDatasetValues: vi.fn().mockResolvedValue() }));
vi.mock('../../lang/dev_lang_key_editor.js', () => ({ initDevLangKeyEditor: vi.fn() }));
vi.mock('../gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js', () => ({ refreshTableUnified: vi.fn() }));
vi.mock('../../navigation/root_redirect_handler.js', () => ({ redirectToRootInSpa: vi.fn() }));
vi.mock('../../../reusable_components/notifications/toast_notification_printer.js', () => ({
    showToast: vi.fn(), showSuccessToast: vi.fn(), showWarningToast: vi.fn(),
}));
vi.mock('../../../reusable_components/modal/modal_builder.js', () => ({
    createModal: ({ titleDataLangKey, contentElements, cleanupCallback }) => {
        const title = document.createElement('h2');
        title.dataset.langKey = titleDataLangKey;
        document.body.append(title, ...contentElements);
        cleanup.push(cleanupCallback);
    },
    showModal: vi.fn(),
    hideModal: vi.fn(),
    createStackedModal: ({ contentElements, cleanupCallback }) => {
        const modal = document.createElement('section');
        modal.append(document.createElement('h2'), ...contentElements);
        document.body.appendChild(modal);
        cleanup.push(cleanupCallback);
        return { modal, show: vi.fn(), hide: () => { modal.remove(); cleanupCallback(); } };
    },
}));

beforeEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
    endpoint_router.mockReset();
    endpoint_router.mockResolvedValue({ dataset_name: 'demo', ui_hidden: false });
    window.translationPromises = Object.fromEntries(['fi', 'en', 'ch', 'yue'].map(lang => [lang, Promise.resolve({})]));
});
afterEach(() => {
    cleanup.splice(0).forEach(fn => fn());
    document.body.replaceChildren();
    delete window.translationPromises;
});

test('FI→EN→Chinese→Cantonese→FI keeps editor and permanent-confirmation drafts with real translator', async () => {
    await translatePage('fi');
    await open_column_management_modal('demo');
    const draft = document.querySelector('[name="column_name"]');
    draft.value = 'draft_title';
    const type = document.querySelector('[name="data_type"]');
    const length = document.querySelector('[name="length"]');
    length.value = '77';
    document.querySelector('[data-testid="btn-delete-table"]').click();
    document.querySelector('[data-testid="dataset-removal-mode-permanent"]').click();
    const confirmation = document.querySelector('[data-testid="dataset-removal-confirm-name"]');
    confirmation.value = 'de';
    confirmation.focus();
    confirmation.setSelectionRange(0, 1);
    for (const [lang, name, save, removal, typeText] of [
        ['fi', 'Sarakkeen nimi', 'Tallenna', 'Poista pysyvästi', 'Rajattu teksti (VARCHAR)'],
        ['en', 'Column name', 'Save', 'Delete permanently', 'Limited text (VARCHAR)'],
        ['ch', '列名', '保存', '永久删除', '有限长度文本 (VARCHAR)'],
        ['yue', '欄位名稱', '儲存', '永久刪除', '限長文字 (VARCHAR)'],
        ['fi', 'Sarakkeen nimi', 'Tallenna', 'Poista pysyvästi', 'Rajattu teksti (VARCHAR)'],
    ]) {
        await translatePage(lang);
        expect(draft.parentElement.querySelector('span').textContent).toBe(name);
        expect(document.querySelector('[data-testid="dataset-form-submit"]').textContent).toBe(save);
        expect(document.querySelector('[data-testid="dataset-removal-confirm"]').textContent).toBe(removal);
        expect(type.selectedOptions[0].textContent).toBe(typeText);
        expect(type.value).toBe('VARCHAR');
        expect(draft.value).toBe('draft_title');
        expect(length.value).toBe('77');
        expect(confirmation.value).toBe('de');
        expect(document.activeElement).toBe(confirmation);
        expect([confirmation.selectionStart, confirmation.selectionEnd]).toEqual([0, 1]);
    }
    expect(endpoint_router.mock.calls.filter(([, options]) => options?.method === 'POST')).toEqual([]);
});
