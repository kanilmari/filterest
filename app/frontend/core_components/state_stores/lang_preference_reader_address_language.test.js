// @vitest-environment jsdom
// lang_preference_reader_address_language.test.js
// Verifies that an enabled ?lang= page address chooses the interface language without being saved.
// Bridges the page address, the shared language catalogue, the stored choice and the language selector.
// Exists so a search engine opening one article address per language gets the app in that language (WL175).

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../lang/translation_handler.js', () => ({ translatePage: vi.fn(async () => {}) }));

const ENABLED_EN_FI = [
  { language_code: 'en', english_name: 'English', native_name: 'English', is_enabled: true, is_default: true, public_selector_ready: true, sort_order: 10 },
  { language_code: 'fi', english_name: 'Finnish', native_name: 'Suomi', is_enabled: true, is_default: false, public_selector_ready: true, sort_order: 20 },
  { language_code: 'yue', english_name: 'Cantonese', native_name: '廣東話', is_enabled: false, is_default: false, public_selector_ready: true, sort_order: 30 },
];

// The store reads the address once when it loads, so every case loads a fresh
// copy of it (and of the catalogue it shares) at the address under test.
async function loadStoreAt(address, { enabledLanguages = ENABLED_EN_FI } = {}) {
  vi.resetModules();
  window.history.replaceState(null, '', address);
  const store = await import('./lang_preference_reader.js');
  const catalogue = await import('../lang/ui_language_catalog.js');
  if (enabledLanguages) {
    await catalogue.loadPublicUiLanguageCatalog({
      fetchImpl: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ languages: enabledLanguages }) }),
    });
  }
  return { store, catalogue };
}

describe('lang_preference_reader address language', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window.navigator, 'languages', { value: ['en-US'], configurable: true });
    Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true });
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/');
    vi.resetModules();
  });

  test('an enabled address language wins over the stored choice and the browser languages', async () => {
    localStorage.setItem('chosen_language', 'en');
    const { store } = await loadStoreAt('/travel_deals/287-helsinki-to-vienna?lang=fi');

    expect(store.getLanguageWithBrowserFallback()).toBe('fi');
    expect(store.getPreferredAvailableLanguage(['en', 'fi'], 'en')).toBe('fi');
    // A caller that cannot show the address language keeps its own order.
    expect(store.getPreferredAvailableLanguage(['en'], 'en')).toBe('en');
  });

  test('the address language is never saved as the visitor\'s own choice', async () => {
    const { store } = await loadStoreAt('/travel_deals/287?lang=fi');

    expect(store.getLanguageWithBrowserFallback()).toBe('fi');
    expect(localStorage.getItem('chosen_language')).toBeNull();
    expect(store.getLanguage()).toBeNull();
    expect(store.hasStoredLanguagePreference()).toBe(false);
  });

  test.each([
    ['a disabled language', '?lang=yue'],
    ['an unknown language', '?lang=sv'],
    ['a code that is not exactly the enabled one', '?lang=FI'],
    ['a regional variant of an enabled code', '?lang=fi-FI'],
    ['an empty value', '?lang='],
    ['markup', '?lang=%3Cscript%3E'],
  ])('ignores %s in the address', async (_case, query) => {
    const { store } = await loadStoreAt(`/travel_deals/287${query}`);

    expect(store.getLanguageWithBrowserFallback()).toBe('en');
    expect(store.getPreferredAvailableLanguage(['en', 'fi'], 'en')).toBe('en');
  });

  test('a bundled language counts until the loaded catalogue says it is not enabled', async () => {
    const { store, catalogue } = await loadStoreAt('/travel_deals/287?lang=yue', { enabledLanguages: null });
    expect(store.getLanguageWithBrowserFallback()).toBe('yue');

    await catalogue.loadPublicUiLanguageCatalog({
      fetchImpl: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ languages: ENABLED_EN_FI }) }),
    });
    expect(store.getLanguageWithBrowserFallback()).toBe('en');
  });

  test('keeps the address language after in-app navigation drops it from the address', async () => {
    const { store } = await loadStoreAt('/travel_deals/287-helsinki-to-vienna?lang=fi');

    window.history.pushState(null, '', '/travel_deals');
    window.history.replaceState(null, '', '/travel_deals/288-helsinki-to-rome');

    expect(store.getLanguageWithBrowserFallback()).toBe('fi');
  });

  test('an explicit language choice ends the address language from then on', async () => {
    localStorage.setItem('chosen_language', 'fi');
    const { store } = await loadStoreAt('/travel_deals/287?lang=fi');

    store.setLanguage('en');

    expect(localStorage.getItem('chosen_language')).toBe('en');
    expect(store.getLanguageWithBrowserFallback()).toBe('en');
    expect(store.getPreferredAvailableLanguage(['en', 'fi'], 'en')).toBe('en');
  });

  test('the language selector starts on the address language and a visitor\'s pick replaces it', async () => {
    const { store } = await loadStoreAt('/travel_deals/287?lang=fi');
    const { initializeLanguageSelector } = await import('../lang/lang_panel_printer.js');
    const selector = document.createElement('div');
    document.body.appendChild(selector);

    expect(initializeLanguageSelector(selector)).toBe('fi');
    expect(selector.querySelector('[data-testid="language-menu-option-fi"]').checked).toBe(true);
    expect(localStorage.getItem('chosen_language')).toBeNull();

    const englishOption = selector.querySelector('[data-testid="language-menu-option-en"]');
    englishOption.checked = true;
    englishOption.dispatchEvent(new Event('change'));

    expect(localStorage.getItem('chosen_language')).toBe('en');
    expect(store.getLanguageWithBrowserFallback()).toBe('en');
    selector.remove();
  });
});
