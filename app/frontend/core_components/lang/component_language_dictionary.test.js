// component_language_dictionary.test.js
// Verifies the extracted dictionary shares requests and follows replaced page state.
// Connects both module entrypoints to the real handler with a mocked language endpoint.
// Protects compatibility exports and live missing-key tracking across the module boundary.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { endpoint_router } from '../endpoints/endpoint_router.js';

vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn() }));
vi.mock('../table_views/dataset_value_localizer.js', () => ({
    refreshLocalizedDatasetValues: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./dev_lang_key_editor.js', () => ({ initDevLangKeyEditor: vi.fn() }));

beforeEach(() => {
    vi.resetModules();
    endpoint_router.mockReset();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    delete window.translationPromises;
    vi.stubGlobal('MutationObserver', class { observe() {} });
});

afterEach(() => {
    vi.unstubAllGlobals();
    delete window.translationPromises;
});

test('both entrypoints share in-flight requests and unwrap component responses without changing page language', async () => {
    const component = await import('./component_language_dictionary.js');
    const handler = await import('./translation_handler.js');
    expect(handler.loadTranslationsForLanguage).toBe(component.loadTranslationsForLanguage);
    expect(handler.getTranslationForKey).toBe(component.getTranslationForKey);

    let completeEnglish;
    endpoint_router.mockReturnValueOnce(new Promise(resolve => { completeEnglish = resolve; }));
    const page = handler.translatePage('en');
    const english = component.loadTranslationsForLanguage('en');
    expect(endpoint_router).toHaveBeenCalledExactlyOnceWith('translations', { url_params: '?lang=en' });
    completeEnglish({ translations: { notice: 'English notice' }, orphan_keys: [] });
    await Promise.all([page, english]);

    endpoint_router.mockResolvedValueOnce({ translations: { notice: '中文通知' }, orphan_keys: [] });
    await component.loadTranslationsForLanguage('ch');
    expect(component.getTranslationForKey('notice', { language: 'ch' })).toBe('中文通知');
    expect(handler.getTranslationForKey('notice')).toBe('English notice');
    expect(document.documentElement.lang).toBe('en');
    expect(endpoint_router).toHaveBeenCalledTimes(2);
});

test('lookup follows replaced page dictionaries and missing-key trackers', async () => {
    const handler = await import('./translation_handler.js');
    const component = await import('./component_language_dictionary.js');
    endpoint_router.mockImplementation((_endpoint, { url_params }) => Promise.resolve(
        url_params === '?lang=fi' ? { notice: 'Suomenkielinen ilmoitus' } : { notice: 'English notice' }
    ));
    await handler.translatePage('en');
    component.getTranslationForKey('first_missing', { fallback: 'Authored fallback' });
    const previousMissingKeys = handler.globalMissingKeys;
    expect(previousMissingKeys).toEqual(['first_missing']);

    await handler.translatePage('fi');
    expect(handler.globalMissingKeys).not.toBe(previousMissingKeys);
    expect(component.getTranslationForKey('notice')).toBe('Suomenkielinen ilmoitus');
    expect(component.getTranslationForKey('second_missing')).toBe('Second missing');
    expect(handler.globalMissingKeys).toEqual(['second_missing']);
    expect(handler.globalMissingKeySources).toEqual({ second_missing: 'code::getTranslationForKey' });
    component.getTranslationForKey('untracked_missing', { countUsage: false });
    expect(handler.globalMissingKeys).toEqual(['second_missing']);
});
