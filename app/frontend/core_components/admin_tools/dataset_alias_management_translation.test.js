// dataset_alias_management_translation.test.js
// Proves alias notices use the editor's language even when public menus use English.
// Connects migration 78's authored dictionary, the real API pipeline and alias view.
// Keeps refusal, saved/cleared and preserved-audit copy on one translation path.
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    error: vi.fn(), success: vi.fn(), refresh: vi.fn(),
}));
vi.mock('../../reusable_components/notifications/toast_notification_printer.js', () => ({
    showErrorToast: mocks.error, showSuccessToast: mocks.success,
    showInfoToast: vi.fn(), showWarningToast: vi.fn(), showAccessDeniedToast: vi.fn(), showToast: vi.fn(),
}));
vi.mock('../navigation/nav_engine/dataset_access_registry.js', () => ({ refreshDatasetCatalogue: mocks.refresh }));
vi.mock('../../reusable_components/vanilla_dropdown/vanilla_dropdown_builder.js', () => ({
    createVanillaDropdown: () => ({ setValue: vi.fn(), setPlaceholders: vi.fn() }),
}));
vi.mock('../lang/dev_lang_key_editor.js', () => ({ initDevLangKeyEditor: vi.fn() }));

// The HTTP fixture serves the actual seeded values, including the development
// response envelope. Expected notices below are independent assertions.
const migration = readFileSync(new NodeURL('../../../server_tools/migrations/20261009000078_enforce_dataset_name_namespace.sql', import.meta.url), 'utf8');
const dictionaries = { fi: {}, en: {}, ch: {}, yue: {} };
for (const match of migration.matchAll(/\('([^']+)', '([^']*)', '([^']*)', '([^']*)', '([^']*)'\)/g)) {
    ['fi', 'en', 'ch', 'yue'].forEach((locale, index) => { dictionaries[locale][match[1]] = match[index + 2]; });
}
const notices = [
    ['en', 'This name already belongs to another dataset or a reserved route. Choose another name.', 'Dataset alias saved', 'Dataset alias cleared', 'This alias was disabled because a real dataset owns the name. The alias record was preserved.'],
    ['fi', 'Nimi kuuluu jo toiselle aineistolle tai varatulle osoitteelle. Valitse toinen nimi.', 'Aineiston alias tallennettu.', 'Aineiston alias poistettu.', 'Alias on poistettu käytöstä, koska nimi kuuluu varsinaiselle aineistolle. Aliastiedot on säilytetty.'],
    ['ch', '此名称已属于其他数据集或保留网址。请选择其他名称。', '数据集别名已保存。', '数据集别名已清除。', '此别名因名称属于真实数据集而被停用。别名记录已保留。'],
    ['yue', '呢個名稱已屬於另一個資料集或保留網址。請揀另一個名稱。', '資料集別名已儲存。', '資料集別名已清除。', '呢個別名因名稱屬於真實資料集而停用。別名記錄已保留。'],
];
const auditKeys = ['dataset_namespace_real_name_conflict', 'dataset_namespace_automatic_conflict', 'dataset_namespace_alias_conflict'];
const entry = {
    dataset_name: 'app_orders', table_uid: 11, stored_primary_alias: 'orders',
    effective_public_alias: 'orders', alias_source: 'database_primary_active',
    raw_dataset_path: '/app_orders', canonical_dataset_path: '/orders', public_dataset_path: '/orders',
    disabled_aliases: auditKeys.map((reason_key, index) => ({ alias_slug: `collision-${index}`, reason_key })),
};
const NativeMutationObserver = globalThis.MutationObserver;
let observers;
let fetchMock;

beforeEach(() => {
    vi.resetModules();
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.refresh.mockResolvedValue(undefined);
    for (const method of ['warn', 'error', 'debug']) vi.spyOn(console, method).mockImplementation(() => {});
    localStorage.clear();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    delete window.translationPromises;
    observers = [];
    vi.stubGlobal('MutationObserver', class extends NativeMutationObserver {
        constructor(callback) { super(callback); observers.push(this); }
    });
});

afterEach(() => {
    observers.forEach(observer => observer.disconnect());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete window.translationPromises;
    document.body.innerHTML = '';
    localStorage.clear();
});

function response(body, status = 200) {
    return {
        ok: status === 200, status, redirected: false,
        headers: { get: () => 'application/json' },
        clone: () => response(body, status),
        text: async () => JSON.stringify(body), json: async () => body,
    };
}

async function openEditor(locale, { refused = false, translations = dictionaries } = {}) {
    localStorage.setItem('chosen_language', locale);
    fetchMock = vi.fn(async (url, options) => {
        const parsed = new URL(url, 'https://example.test');
        if (parsed.pathname === '/api/translations') return response({ translations: translations[parsed.searchParams.get('lang')] || {}, orphan_keys: [] });
        if (parsed.pathname === '/api/csrf-token') return response({ csrf_token: 'synthetic-token' });
        if (parsed.pathname === '/api/dataset-alias-management') return response({ datasets: [entry] });
        if (parsed.pathname === '/api/dataset-alias-management/save') {
            if (refused) return response({ code: 409, error_lang_key: 'dataset_namespace_conflict', error: dictionaries.en.dataset_namespace_conflict }, 409);
            const alias = JSON.parse(options.body).alias_slug;
            return response({ message: alias ? 'Dataset alias saved' : 'Dataset alias cleared', dataset: {
                ...entry, stored_primary_alias: alias, effective_public_alias: alias || 'orders',
                canonical_dataset_path: `/${alias || 'orders'}`, public_dataset_path: `/${alias || 'orders'}`,
            } });
        }
        throw new Error(`Unexpected fixture request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const handler = await import('../lang/translation_handler.js');
    const { getPreferredAvailableLanguage } = await import('../state_stores/lang_preference_reader.js');
    // Public selectors offer en/fi; the stored legacy ch/yue preference still
    // drives the administrator editor. Reproduce the shell's real selection.
    await handler.translatePage(getPreferredAvailableLanguage(['en', 'fi'], 'en'));
    const { generate_dataset_alias_management_view } = await import('./dataset_alias_management_view.js');
    const container = document.createElement('div');
    document.body.append(container);
    await generate_dataset_alias_management_view(container);
    return { container, handler };
}

test.each(notices)('%s: seeded namespace refusal reaches the toast despite the public-menu language', async (locale, refusal) => {
    const { container } = await openEditor(locale, { refused: true });
    const input = container.querySelector('input');
    input.value = 'Reports';
    container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(mocks.error).toHaveBeenCalledExactlyOnceWith(refusal));
    expect(input.value).toBe('Reports');
    expect(input.disabled).toBe(false);
    expect(container.textContent).toContain('/orders');
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
});

test.each(notices)('%s: seeded saved notice reaches the toast', async (locale, _refusal, saved) => {
    const { container } = await openEditor(locale);
    container.querySelector('input').value = 'shop-orders';
    container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(mocks.success).toHaveBeenCalledExactlyOnceWith(saved));
    expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith({ force: true });
});

test.each(notices)('%s: seeded cleared notice reaches the toast and preserves the translated audit', async (locale, _refusal, _saved, cleared, audit) => {
    const { container } = await openEditor(locale);
    container.querySelector('[data-testid="dataset-alias-management-clear"]').click();
    await vi.waitFor(() => expect(mocks.success).toHaveBeenCalledExactlyOnceWith(cleared));
    expect(container.querySelector('[data-testid="dataset-alias-management-audit"]').textContent).toContain(audit);
});

test.each(notices)('%s: every collision-audit reason uses its seeded translation', async (locale, _refusal, _saved, _cleared, audit) => {
    const { container } = await openEditor(locale);
    const node = container.querySelector('[data-testid="dataset-alias-management-audit"]');
    expect(node.textContent).toContain(audit);
    for (const key of auditKeys) expect(node.textContent).toContain(dictionaries[locale][key]);
});

test.each(['ch', 'yue', 'de'])('%s: site translations win, English fills only missing copy and menu language stays unchanged', async locale => {
    const translations = {
        ...dictionaries,
        en: { ...dictionaries.en, dataset_site_only_notice: 'English fallback' },
        [locale]: { ...dictionaries[locale], dataset_alias_saved: `${locale}: site wording`, dataset_site_only_notice: '   ' },
    };
    const { handler } = await openEditor(locale, { translations });
    const { aliasCopy } = await import('./dataset_alias_management_copy.js');
    expect(aliasCopy('dataset_alias_saved')).toBe(`${locale}: site wording`);
    expect(aliasCopy('dataset_site_only_notice')).toBe('English fallback');
    expect(handler.getTranslationForKey('dataset_alias_saved')).toBe('Dataset alias saved');
    expect(document.documentElement.lang).toBe('en');
    expect(fetchMock.mock.calls.filter(([url]) => url === `/api/translations?lang=${locale}`)).toHaveLength(1);
});

test('live language changes preserve drafts and refresh notices from the same cached dictionaries', async () => {
    const { container, handler } = await openEditor('en');
    const { aliasCopy } = await import('./dataset_alias_management_copy.js');
    const input = container.querySelector('input');
    input.value = 'My-Draft';
    for (const [locale, refusal, saved, cleared, audit] of notices.slice(1)) {
        localStorage.setItem('chosen_language', locale);
        await handler.translatePage(locale);
        expect(aliasCopy('dataset_namespace_conflict')).toBe(refusal);
        expect(aliasCopy('dataset_alias_saved')).toBe(saved);
        expect(aliasCopy('dataset_alias_cleared')).toBe(cleared);
        expect(container.querySelector('[data-testid="dataset-alias-management-audit"]').textContent).toContain(audit);
        expect(input.value).toBe('My-Draft');
    }
});

test.each([undefined, null, '', '   '])('English is used for missing/blank translation %s in a component dictionary', async missing => {
    const translations = {
        ...dictionaries,
        en: { ...dictionaries.en, dataset_site_only_notice: 'English fallback' },
        ch: { ...dictionaries.ch, dataset_site_only_notice: missing },
    };
    await openEditor('ch', { translations });
    const { aliasCopy } = await import('./dataset_alias_management_copy.js');
    expect(aliasCopy('dataset_site_only_notice')).toBe('English fallback');
});
