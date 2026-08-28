import { describe, test, expect } from 'vitest';
import { extractLangValue, looksLikeLangValue } from './lang_value_reader.js';

describe('extractLangValue', () => {
  test('null/undefined returns empty string', () => {
    expect(extractLangValue(null)).toBe('');
    expect(extractLangValue(undefined)).toBe('');
  });

  test('plain string passes through', () => {
    expect(extractLangValue('hello')).toBe('hello');
    expect(extractLangValue('123')).toBe('123');
  });

  test('extracts chosen language from lang object', () => {
    const json = JSON.stringify({ fi: 'Moi', en: 'Hello', sv: 'Hej' });
    expect(extractLangValue(json, 'fi')).toBe('Moi');
    expect(extractLangValue(json, 'en')).toBe('Hello');
    expect(extractLangValue(json, 'sv')).toBe('Hej');
  });

  test('falls back to first available language', () => {
    const json = JSON.stringify({ fi: 'Moi', sv: 'Hej' });
    expect(extractLangValue(json, 'de')).toBe('Moi');
  });

  test('uses English before the first stored language as the controlled fallback', () => {
    const json = JSON.stringify({ fi: 'Moi', en: 'Hello', sv: 'Hej' });
    expect(extractLangValue(json, 'de')).toBe('Hello');
  });

  test('accepts an already parsed multilingual object without exposing object syntax', () => {
    expect(extractLangValue({ en: 'Services', fi: 'Palvelut' }, 'fi', true)).toBe('Palvelut');
  });

  test('preserves JSON when metadata explicitly marks the field non-multilingual', () => {
    const json = JSON.stringify({ en: 'ordinary value', fi: 'another value' });
    expect(extractLangValue(json, 'fi', false)).toBe(json);
  });

  test('falls back from a regional language code to its primary language', () => {
    const json = JSON.stringify({ en: 'Services', fi: 'Palvelut' });
    expect(extractLangValue(json, 'fi-FI', true)).toBe('Palvelut');
  });

  test('defaults to en when no chosenLang', () => {
    const json = JSON.stringify({ fi: 'Moi', en: 'Hello' });
    expect(extractLangValue(json)).toBe('Hello');
  });

  test('non-language JSON with mixed values stays intact when metadata is missing', () => {
    const json = JSON.stringify({ name: 'test', count: 5 });
    expect(extractLangValue(json)).toBe(json);
  });

  test('ordinary JSON with long keys stays intact when metadata is missing', () => {
    const json = JSON.stringify({ longkey: 'val', anotherlong: 'val2' });
    expect(extractLangValue(json)).toBe(json);
  });

  test('recognizes language codes and rejects ordinary short-looking JSON keys', () => {
    expect(looksLikeLangValue({ en: 'Hello', 'fi-FI': 'Hei' })).toBe(true);
    expect(looksLikeLangValue({ name: 'test', value: 'x' })).toBe(false);
  });

  test('isMultilingual=false with long keys returns raw string', () => {
    // keys fail lang regex AND isMultilingual=false → returns raw
    const json = JSON.stringify({ longkey: 'val', anotherlong: 'val2' });
    expect(extractLangValue(json, 'en', false)).toBe(json);
  });

  test('invalid JSON passes through', () => {
    expect(extractLangValue('{broken')).toBe('{broken');
  });

  test('isMultilingual=false skips non-lang objects with long keys', () => {
    const json = JSON.stringify({ longkey: 'test', another: 'x' });
    expect(extractLangValue(json, 'en', false)).toBe(json);
  });

  test('isMultilingual=false preserves even JSON with short string keys', () => {
    const json = JSON.stringify({ name: 'test', value: 'x' });
    expect(extractLangValue(json, 'name', false)).toBe(json);
  });

  test('isMultilingual=true treats lang-like object as multilingual', () => {
    const json = JSON.stringify({ fi: 'Moi', en: 'Hello' });
    expect(extractLangValue(json, 'fi', true)).toBe('Moi');
  });

  test('number input converts to string', () => {
    expect(extractLangValue(42)).toBe('42');
  });

  test('empty object returns raw string', () => {
    expect(extractLangValue('{}')).toBe('{}');
  });

  test('array JSON returns raw string', () => {
    const json = JSON.stringify([1, 2, 3]);
    expect(extractLangValue(json)).toBe(json);
  });
});
