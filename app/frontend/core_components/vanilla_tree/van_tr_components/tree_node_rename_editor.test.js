// @vitest-environment jsdom
// tree_node_rename_editor.test.js
// Checks what the rename dialog tells the server it showed and what the user typed.
// Connects the prefill hydration with the request body sent to /api/rename-tree-node.
// An untouched prefill or an interface-language fallback must never be saved as a translation (#937).
import { beforeEach, expect, test, vi } from 'vitest';

const routerCalls = [];
let routerAnswer = {};
vi.mock('../../endpoints/endpoint_router.js', () => ({
    endpoint_router: vi.fn(async (name, options) => {
        routerCalls.push({ name, options });
        return routerAnswer;
    }),
}));
let uiLanguage = 'fi';
vi.mock('../../state_stores/lang_preference_reader.js', () => ({ getLanguageWithBrowserFallback: () => uiLanguage }));
vi.mock('../../lang/translation_handler.js', () => ({
    getTranslationForKey: vi.fn((key) => (key === 'app_orders' ? 'Orders' : '')),
    getTranslationsForKey: vi.fn(async () => ({ fi: '', en: 'Orders' })),
}));
vi.mock('../../navigation/nav_engine/dataset_aliases.js', () => ({ getDatasetRouteUniquenessHint: () => '' }));
vi.mock('../../../reusable_components/notifications/toast_notification_printer.js', () => ({ showWarningToast: vi.fn() }));

import { buildRenameRequestBody, hydratePrefill, openRenameDialog, showKeptTranslationsNotice } from './tree_node_rename_editor.js';
import { showWarningToast } from '../../../reusable_components/notifications/toast_notification_printer.js';
import { TREE_NODE_RENAME_TRANSLATION_FALLBACKS } from './tree_node_rename_copy.js';
import { LOCAL_TRANSLATION_FALLBACKS } from '../../lang/local_translation_fallback_catalog.js';

function field(value) {
    const input = document.createElement('input');
    input.value = value;
    input.dataset.initialValue = value;
    return input;
}

beforeEach(() => {
    routerCalls.length = 0;
    routerAnswer = {};
    uiLanguage = 'fi';
    showWarningToast.mockClear();
    document.body.innerHTML = '';
});

test('hydration replaces an untouched fallback, even with an empty stored text, and records what was shown', () => {
    const fi = field('Orders'); // the interface-language label the dialog opened with
    hydratePrefill(fi, '');
    expect(fi.value).toBe('');
    expect(fi.dataset.shownValue).toBe('');

    const en = field('');
    hydratePrefill(en, 'Orders');
    expect(en.value).toBe('Orders');
    expect(en.dataset.shownValue).toBe('Orders');
});

test('hydration leaves a field the user already typed in and does not claim it was shown', () => {
    const fi = field('');
    fi.value = 'Tilaukset';
    fi.dataset.userEdited = 'true';
    hydratePrefill(fi, 'Vanha');
    expect(fi.value).toBe('Tilaukset');
    expect(fi.dataset.shownValue).toBeUndefined();
});

test('the request lists only the shown texts the dialog actually displayed', () => {
    const fi = field('');
    hydratePrefill(fi, 'Tilaukset');
    fi.value = ' Tilauskanta ';
    const en = field('');
    en.value = 'Typed before hydration';
    en.dataset.userEdited = 'true';
    expect(buildRenameRequestBody({ itemId: 4, itemType: 'table', newName: 'app_orders', fiInput: fi, enInput: en })).toEqual({
        item_id: 4,
        item_type: 'table',
        new_name: 'app_orders',
        translations: { fi: 'Tilauskanta', en: 'Typed before hydration' },
        shown_translations: { fi: 'Tilaukset' },
    });
    expect(buildRenameRequestBody({ itemId: 4, itemType: 'folder', newName: 'x', fiInput: field(''), enInput: field('') }))
        .toEqual({ item_id: 4, item_type: 'folder', new_name: 'x', translations: {} });
});

test('saving before the stored texts arrive leaves the interface-language fallback out', async () => {
    const { getTranslationsForKey } = await import('../../lang/translation_handler.js');
    let deliver;
    getTranslationsForKey.mockImplementationOnce(() => new Promise((resolve) => { deliver = resolve; }));
    const result = openRenameDialog({ itemId: 7, itemType: 'table', currentName: 'app_orders' });
    // The Finnish field opens with the English interface label "Orders" as a placeholder value.
    expect(document.querySelector('[data-testid="rename-tree-node-fi-input"]').value).toBe('Orders');
    document.querySelector('[data-testid="rename-tree-node-save"]').click();
    await expect(result).resolves.toBe(true);
    expect(routerCalls[0].options.body_data).toEqual({
        item_id: 7, item_type: 'table', new_name: 'app_orders', translations: {},
    });
    deliver({ fi: 'Tilaukset', en: 'Orders' });
});

test('saving an untouched dialog sends the stored texts as shown, not the fallback as Finnish', async () => {
    const result = openRenameDialog({ itemId: 7, itemType: 'table', currentName: 'app_orders' });
    await vi.waitFor(() => expect(document.querySelector('[data-testid="rename-tree-node-en-input"]').value).toBe('Orders'));
    document.querySelector('[data-testid="rename-tree-node-name-input"]').value = 'app_sales_orders';
    document.querySelector('[data-testid="rename-tree-node-save"]').click();
    await expect(result).resolves.toBe(true);
    expect(routerCalls).toEqual([{
        name: 'renameTreeNode',
        options: {
            method: 'POST',
            body_data: {
                item_id: 7,
                item_type: 'table',
                new_name: 'app_sales_orders',
                translations: { fi: '', en: 'Orders' },
                shown_translations: { fi: '', en: 'Orders' },
            },
        },
    }]);
});

// Owner, 22.11.2026: a shared key is not changed from the rename dialog, and the person is told.
test('a rename onto an existing key tells the person, in their language, which text was not saved', async () => {
    routerAnswer = { message: 'Renamed successfully.', label_kept: { lang_key: 'purchase_orders', languages: ['fi', 'en'] } };
    const result = openRenameDialog({ itemId: 7, itemType: 'folder', currentName: 'app_orders' });
    await vi.waitFor(() => expect(document.querySelector('[data-testid="rename-tree-node-en-input"]').value).toBe('Orders'));
    document.querySelector('[data-testid="rename-tree-node-name-input"]').value = 'purchase_orders';
    document.querySelector('[data-testid="rename-tree-node-save"]').click();
    await expect(result).resolves.toBe(true);
    expect(showWarningToast).toHaveBeenCalledTimes(1);
    const [notice, duration] = showWarningToast.mock.calls[0];
    expect(notice).toBe('Nimellä ”purchase_orders” on jo käännökset, joten se käyttää niitä. Kirjoittamaasi tekstiä ei tallennettu kielille: FI, EN. Muuta tekstiä kieliavainten ylläpidossa.');
    expect(duration).toBeGreaterThanOrEqual(10000);
});

test('the notice follows the interface language and stays silent when nothing was kept', () => {
    uiLanguage = 'zh-HK';
    expect(showKeptTranslationsNotice({ label_kept: { lang_key: 'orders', languages: ['en'] } }))
        .toBe('名稱「orders」已經有翻譯，所以會用現有翻譯。以下語言你輸入嘅文字冇儲存：EN。請喺語言鍵維護入面修改文字。');
    uiLanguage = 'en-US';
    expect(showKeptTranslationsNotice({ label_kept: { lang_key: 'orders', languages: ['en'] } }))
        .toContain('The name “orders” already has translations');
    showWarningToast.mockClear();
    expect(showKeptTranslationsNotice({ message: 'Renamed successfully.' })).toBe('');
    expect(showKeptTranslationsNotice({ label_kept: { lang_key: 'orders', languages: [] } })).toBe('');
    expect(showWarningToast).not.toHaveBeenCalled();
});

test('the notice copy is registered in every bootstrap language', () => {
    const key = 'rename_tree_node_kept_existing_translations';
    expect(LOCAL_TRANSLATION_FALLBACKS[key]).toBe(TREE_NODE_RENAME_TRANSLATION_FALLBACKS[key]);
    for (const language of ['fi', 'en', 'ch', 'yue']) {
        expect(TREE_NODE_RENAME_TRANSLATION_FALLBACKS[key][language]).toMatch(/\$key[^]*\$languages/);
    }
});
