// @vitest-environment jsdom
// row_article_heading_match.test.js
// Proves strict, locale-aware article heading comparison and its first-block boundary.
// Connects normalization and DOM selection to representative authored content.
// Protects near matches and later headings from removal or advisory false positives.
import { describe, expect, test } from 'vitest';
import { normaliseHeadingText, findMatchingFirstHeading, resolveHeadingLanguage } from './row_article_heading_match.js';

describe('article heading comparison', () => {
    test.each([
        ['A &amp; B', 'a & b'], ['&lt;em&gt;Contact&lt;/em&gt;', 'contact'],
        ['<strong>Contact</strong>', 'contact'], ['A\u0308ITI', 'äiti'],
        [' \n CONTACT\t  us&nbsp; ', 'contact us'], ['Contact!', 'contact!'],
    ])('normalizes %s without dropping punctuation', (value, expected) => {
        expect(normaliseHeadingText(value, 'fi')).toBe(expected);
    });
    test('uses the row locale, with a safe lowercase fallback', () => {
        expect(normaliseHeadingText('I', 'tr')).toBe('ı');
        expect(normaliseHeadingText('I', 'en')).toBe('i');
        expect(normaliseHeadingText('I', 'invalid_locale')).toBe('i');
    });
    test('resolves language variants and fallback languages exactly as display extraction', () => {
        expect(resolveHeadingLanguage('{"fi":"Moi","en":"Hello"}', true, 'fi-FI')).toBe('fi');
        expect(resolveHeadingLanguage({ 'pt-BR': 'Olá', en: 'Hello' }, true, 'pt_BR')).toBe('pt-br');
        expect(resolveHeadingLanguage('{"en":"Hello"}', true, 'fi')).toBe('en');
        expect(resolveHeadingLanguage('{"fi":null,"en":"Hello"}', true, 'fi')).toBe('en');
        expect(resolveHeadingLanguage('Hello', false, 'fi')).toBe('');
        expect(findMatchingFirstHeading('<h2>Contact</h2>', 'Contact', 'fi', 'en')).toBeNull();
    });
    test.each(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])('accepts only the first %s after empty placeholders', tag => {
        const root = new DOMParser().parseFromString(`<p><br></p><div>&nbsp;</div><!-- comment -->\n<${tag}>CONTACT</${tag}><${tag}>Contact</${tag}>`, 'text/html').body;
        expect(findMatchingFirstHeading(root, 'Contact', 'en', 'en')).toBe(root.children[2]);
        expect(root.querySelectorAll(tag)).toHaveLength(2); // Matching never mutates the source.
    });
    test.each([
        '<h2>Contact us</h2>', '<h2>Contact!</h2>', '<p>Introduction</p><h2>Contact</h2>',
        'Introduction<h2>Contact</h2>', '<div><h2>Contact</h2></div>',
        '<p><hr></p><h2>Contact</h2>', '<ul><li>Contact</li></ul><h2>Contact</h2>', 'Contact',
        '<h2></h2><h2>Contact</h2>',
        '<div><ul><li></li></ul></div><h2>Contact</h2>', '<div><pre> </pre></div><h2>Contact</h2>',
    ])('keeps substantive preceding blocks and near matches: %s', content => {
        expect(findMatchingFirstHeading(content, 'Contact', 'en', 'en')).toBeNull();
    });
    test.each([undefined, null, '', ' '])('unknown language %s cannot match a heading', language => {
        expect(findMatchingFirstHeading('<h2>Contact</h2>', 'Contact', 'fi', language)).toBeNull();
        expect(findMatchingFirstHeading('<h2>Contact</h2>', 'Contact', language, 'fi')).toBeNull();
    });
});
