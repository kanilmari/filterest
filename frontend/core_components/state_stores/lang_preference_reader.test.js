// @vitest-environment jsdom
// lang_preference_reader.test.js
// Verifies localStorage-backed language preference helpers and browser fallback logic.
// Bridges language selection UIs and preference readers with deterministic jsdom state.
// Exists to keep language selection behavior stable across reloads and empty storage cases.

import { describe, test, expect, beforeEach } from 'vitest';
import {
  getLanguage,
  getLanguageWithBrowserFallback,
  getBrowserLanguageCandidates,
  getPreferredAvailableLanguage,
  hasStoredLanguagePreference,
  setLanguage,
} from './lang_preference_reader.js';

describe('lang_preference_reader', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('reads and writes the chosen language in localStorage', () => {
    setLanguage('fi');
    expect(localStorage.getItem('chosen_language')).toBe('fi');
    expect(getLanguage()).toBe('fi');
    expect(hasStoredLanguagePreference()).toBe(true);
  });

  test('returns the stored language before using browser fallback', () => {
    Object.defineProperty(window.navigator, 'languages', { value: ['sv-SE', 'en-US'], configurable: true });
    Object.defineProperty(window.navigator, 'language', { value: 'sv-SE', configurable: true });
    localStorage.setItem('chosen_language', 'en');

    expect(getLanguageWithBrowserFallback()).toBe('en');
  });

  test('uses navigator.languages before navigator.language for browser fallback order', () => {
    Object.defineProperty(window.navigator, 'languages', { value: ['fi-FI', 'en-US'], configurable: true });
    Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true });

    expect(getLanguageWithBrowserFallback()).toBe('fi');
    expect(getBrowserLanguageCandidates()).toEqual(['fi', 'en']);
  });

  test('falls back to en when navigator.language is unavailable', () => {
    Object.defineProperty(window.navigator, 'languages', { value: [], configurable: true });
    Object.defineProperty(window.navigator, 'language', { value: '', configurable: true });

    expect(getLanguageWithBrowserFallback()).toBe('en');
  });

  test('prefers the first browser-supported language from navigator.languages', () => {
    Object.defineProperty(window.navigator, 'languages', { value: ['sv-SE', 'fi-FI', 'en-US'], configurable: true });
    Object.defineProperty(window.navigator, 'language', { value: 'sv-SE', configurable: true });

    expect(getPreferredAvailableLanguage(['en', 'fi'])).toBe('fi');
  });

  test('preserves Cantonese codes and maps Hong Kong Traditional Chinese to yue', () => {
    Object.defineProperty(window.navigator, 'languages', { value: ['zh-HK', 'en-US'], configurable: true });
    Object.defineProperty(window.navigator, 'language', { value: 'zh-HK', configurable: true });

    expect(getBrowserLanguageCandidates()).toEqual(['yue', 'en']);
    expect(getPreferredAvailableLanguage(['en', 'fi', 'yue'])).toBe('yue');

    setLanguage('yue');
    expect(getPreferredAvailableLanguage(['en', 'fi', 'yue'])).toBe('yue');
  });

  test('falls back to supported fallback language when nothing matches', () => {
    Object.defineProperty(window.navigator, 'languages', { value: ['sv-SE'], configurable: true });
    Object.defineProperty(window.navigator, 'language', { value: 'sv-SE', configurable: true });

    expect(getPreferredAvailableLanguage(['en', 'fi'])).toBe('en');
  });

  test('reports false when no manual language preference is stored', () => {
    expect(hasStoredLanguagePreference()).toBe(false);
  });
});
