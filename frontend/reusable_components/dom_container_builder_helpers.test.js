import { describe, test, expect } from 'vitest';
import {
    extract_id_from_text,
    isValidIdentifier,
    ALLOWED_HTML_TAGS,
    containsAllowedHtml,
} from './dom_container_builder_helpers.js';

// ---------------------------------------------------------------------------
// extract_id_from_text
// ---------------------------------------------------------------------------
describe('extract_id_from_text', () => {
    test('extracts id from "id (name)" format', () => {
        expect(extract_id_from_text('42 (Some Name)')).toBe('42');
    });

    test('extracts id from plain numeric string', () => {
        expect(extract_id_from_text('123')).toBe('123');
    });

    test('extracts leading digits only', () => {
        expect(extract_id_from_text('7abc')).toBe('7');
    });

    test('returns null for non-numeric start', () => {
        expect(extract_id_from_text('abc123')).toBeNull();
    });

    test('returns null for empty string', () => {
        expect(extract_id_from_text('')).toBeNull();
    });

    test('extracts multi-digit id', () => {
        expect(extract_id_from_text('99999 (long id)')).toBe('99999');
    });
});

// ---------------------------------------------------------------------------
// isValidIdentifier
// ---------------------------------------------------------------------------
describe('isValidIdentifier', () => {
    test('accepts simple alpha identifier', () => {
        expect(isValidIdentifier('myVar')).toBe(true);
    });

    test('accepts underscore-prefixed identifier', () => {
        expect(isValidIdentifier('_private')).toBe(true);
    });

    test('accepts identifier with digits', () => {
        expect(isValidIdentifier('item2')).toBe(true);
    });

    test('accepts all underscores', () => {
        expect(isValidIdentifier('___')).toBe(true);
    });

    test('rejects identifier starting with digit', () => {
        expect(isValidIdentifier('2fast')).toBe(false);
    });

    test('rejects identifier with spaces', () => {
        expect(isValidIdentifier('my var')).toBe(false);
    });

    test('rejects identifier with Finnish ä', () => {
        expect(isValidIdentifier('käyttäjä')).toBe(false);
    });

    test('rejects identifier with Finnish ö', () => {
        expect(isValidIdentifier('ölkö')).toBe(false);
    });

    test('rejects identifier with Finnish å', () => {
        expect(isValidIdentifier('åland')).toBe(false);
    });

    test('rejects identifier with uppercase Finnish diacritics', () => {
        expect(isValidIdentifier('YÄKÖ')).toBe(false);
    });

    test('rejects empty string', () => {
        expect(isValidIdentifier('')).toBe(false);
    });

    test('rejects hyphenated name', () => {
        expect(isValidIdentifier('my-var')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// ALLOWED_HTML_TAGS
// ---------------------------------------------------------------------------
describe('ALLOWED_HTML_TAGS', () => {
    test('is an array of strings', () => {
        expect(Array.isArray(ALLOWED_HTML_TAGS)).toBe(true);
        ALLOWED_HTML_TAGS.forEach(tag => expect(typeof tag).toBe('string'));
    });

    test('includes common tags', () => {
        expect(ALLOWED_HTML_TAGS).toContain('div');
        expect(ALLOWED_HTML_TAGS).toContain('strong');
        expect(ALLOWED_HTML_TAGS).toContain('a');
        expect(ALLOWED_HTML_TAGS).toContain('br');
    });

    test('does not include script or img', () => {
        expect(ALLOWED_HTML_TAGS).not.toContain('script');
        expect(ALLOWED_HTML_TAGS).not.toContain('img');
    });
});

// ---------------------------------------------------------------------------
// containsAllowedHtml
// ---------------------------------------------------------------------------
describe('containsAllowedHtml', () => {
    test('detects simple div tag', () => {
        expect(containsAllowedHtml('<div>hello</div>')).toBe(true);
    });

    test('detects self-closing br', () => {
        expect(containsAllowedHtml('line<br/>break')).toBe(true);
    });

    test('detects tag with attributes', () => {
        expect(containsAllowedHtml('<a href="x">link</a>')).toBe(true);
    });

    test('is case-insensitive', () => {
        expect(containsAllowedHtml('<DIV>hello</DIV>')).toBe(true);
        expect(containsAllowedHtml('<Strong>bold</Strong>')).toBe(true);
    });

    test('returns false for plain text', () => {
        expect(containsAllowedHtml('just plain text')).toBe(false);
    });

    test('returns false for disallowed tags', () => {
        expect(containsAllowedHtml('<script>alert(1)</script>')).toBe(false);
        expect(containsAllowedHtml('<img src="x">')).toBe(false);
    });

    test('returns false for non-string input', () => {
        expect(containsAllowedHtml(null)).toBe(false);
        expect(containsAllowedHtml(undefined)).toBe(false);
        expect(containsAllowedHtml(42)).toBe(false);
    });

    test('returns false for empty string', () => {
        expect(containsAllowedHtml('')).toBe(false);
    });

    test('detects tag with leading whitespace', () => {
        expect(containsAllowedHtml('< div>spaced</div>')).toBe(true);
    });
});
