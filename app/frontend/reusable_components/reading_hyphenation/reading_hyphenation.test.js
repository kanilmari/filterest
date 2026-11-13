// @vitest-environment jsdom
// reading_hyphenation.test.js
// Exercises shipped FI/EN patterns, source-text integrity and presentation-only scopes.
import { expect, test, vi } from 'vitest';
import { hyphenateReadingField } from './reading_hyphenation.js';
import { resolveLangValue } from '../lang_value_reader.js';

const breaks = field => [...field.childNodes].map(node => node.nodeType === 3 ? node.data : '|').join('');

test.each([
    ['fi-FI', { fi: 'tietojenkäsittelyjärjestelmä' }, 'fi', 'tie|to|jen|kä|sit|te|ly|jär|jes|tel|mä'],
    ['fi', { en: 'internationalization' }, 'en', 'in|ter|na|tion|al|iza|tion'],
])('uses the selected field language for %s', async (ui, raw, expectedLanguage, expected) => {
    const { text, language } = resolveLangValue(raw, ui, true);
    const field = document.createElement('div');
    field.textContent = text;
    await hyphenateReadingField(field, language);
    expect(field.lang).toBe(expectedLanguage);
    expect(field.textContent).toBe(text);
    expect(breaks(field)).toBe(expected);
});

test('retains rich markup, addresses, literal soft hyphens, preformatted text and edit controls', async () => {
    const field = document.createElement('div');
    field.innerHTML = '<em>tietojenkäsittely</em> https://esimerkki.fi tieto@esimerkki.fi esimerkki.fi foo/bar ' +
        'oma\u00adsana <a href="/x">tietojenkäsittely</a> <pre>tietojenkäsittely</pre> ' +
        '<textarea>tietojenkäsittely</textarea>';
    const original = field.textContent;
    const em = field.firstElementChild;
    await hyphenateReadingField(field, 'fi');
    expect(field.firstElementChild).toBe(em);
    expect(em.querySelector('.reading-hyphen')).toBeTruthy();
    expect(field.querySelectorAll('.reading-hyphen')).toHaveLength(em.querySelectorAll('.reading-hyphen').length);
    expect(field.textContent).toBe(original);
    expect(field.querySelector('a').getAttribute('href')).toBe('/x');
});

test.each(['sv', '', undefined])('passes %s through', async language => {
    const field = document.createElement('div');
    field.textContent = 'internationalization';
    await hyphenateReadingField(field, language);
    expect(field.innerHTML).toBe('internationalization');
});

test.each(['en', 'fi'])('hyphenation in %s keeps article words out of the shared exception dictionary', async language => {
    const { default: patterns } = language === 'fi' ? await import('./vendor/fi.js') : await import('./vendor/en-us.js');
    const original = structuredClone(patterns[2]);
    const field = document.createElement('div');
    field.textContent = 'Confidentialreadingexample';
    await hyphenateReadingField(field, language);
    expect(field.querySelector('.reading-hyphen')).toBeTruthy();
    expect(patterns[2]).toEqual(original);
});

test('a rejected pattern download preserves the original field and markup', async () => {
    vi.doMock('./vendor/fi.js', () => { throw new Error('unavailable'); });
    try {
        const field = document.createElement('div');
        field.innerHTML = '<em>tietojenkäsittelyjärjestelmä</em>';
        const original = field.firstChild;
        await hyphenateReadingField(field, 'fi');
        expect(field.innerHTML).toBe('<em>tietojenkäsittelyjärjestelmä</em>');
        expect(field.firstChild).toBe(original);
    } finally {
        vi.doUnmock('./vendor/fi.js');
    }
});
