import { describe, test, expect } from 'vitest';
import {
    extractSuffixNumber,
    matchesRole,
    splitKeywords,
    resolveImagePath,
    coerceToString,
    classifyRole,
} from './big_card_content_builder_helpers.js';

// ---------------------------------------------------------------------------
// extractSuffixNumber
// ---------------------------------------------------------------------------
describe('extractSuffixNumber', () => {
    test('extracts number from role with suffix', () => {
        expect(extractSuffixNumber('details3')).toBe(3);
        expect(extractSuffixNumber('description12')).toBe(12);
        expect(extractSuffixNumber('details_link42')).toBe(42);
    });

    test('returns MAX_SAFE_INTEGER when no suffix', () => {
        expect(extractSuffixNumber('details')).toBe(Number.MAX_SAFE_INTEGER);
        expect(extractSuffixNumber('description')).toBe(Number.MAX_SAFE_INTEGER);
        expect(extractSuffixNumber('hidden')).toBe(Number.MAX_SAFE_INTEGER);
    });

    test('extracts first number from multi-digit string', () => {
        expect(extractSuffixNumber('details100')).toBe(100);
    });

    test('handles zero suffix', () => {
        expect(extractSuffixNumber('details0')).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// matchesRole
// ---------------------------------------------------------------------------
describe('matchesRole', () => {
    test('matches exact base name without suffix', () => {
        expect(matchesRole('details', 'details')).toBe(true);
        expect(matchesRole('hidden', 'hidden')).toBe(true);
    });

    test('matches base name with numeric suffix', () => {
        expect(matchesRole('details3', 'details')).toBe(true);
        expect(matchesRole('description12', 'description')).toBe(true);
        expect(matchesRole('details_link42', 'details_link')).toBe(true);
    });

    test('rejects non-matching roles', () => {
        expect(matchesRole('header', 'details')).toBe(false);
        expect(matchesRole('details', 'description')).toBe(false);
        expect(matchesRole('details_link3', 'details')).toBe(false);
    });

    test('rejects role with non-numeric suffix', () => {
        expect(matchesRole('detailsABC', 'details')).toBe(false);
    });

    test('rejects empty string', () => {
        expect(matchesRole('', 'details')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// splitKeywords
// ---------------------------------------------------------------------------
describe('splitKeywords', () => {
    test('splits comma-separated string', () => {
        expect(splitKeywords('foo, bar, baz')).toEqual(['foo', 'bar', 'baz']);
    });

    test('trims whitespace from each token', () => {
        expect(splitKeywords('  foo ,  bar  , baz  ')).toEqual(['foo', 'bar', 'baz']);
    });

    test('filters out empty tokens', () => {
        expect(splitKeywords('foo, , bar,, baz')).toEqual(['foo', 'bar', 'baz']);
    });

    test('returns empty array for empty string', () => {
        expect(splitKeywords('')).toEqual([]);
    });

    test('handles single keyword', () => {
        expect(splitKeywords('only')).toEqual(['only']);
    });

    test('handles all-whitespace tokens', () => {
        expect(splitKeywords(', , ,')).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// resolveImagePath
// ---------------------------------------------------------------------------
describe('resolveImagePath', () => {
    test('returns absolute URL unchanged', () => {
        expect(resolveImagePath('https://example.com/img.png')).toBe('https://example.com/img.png');
        expect(resolveImagePath('http://example.com/img.png')).toBe('http://example.com/img.png');
    });

    test('returns relative path starting with ./ unchanged', () => {
        expect(resolveImagePath('./images/foo.png')).toBe('./images/foo.png');
    });

    test('returns absolute path starting with / unchanged', () => {
        expect(resolveImagePath('/static/img.png')).toBe('/static/img.png');
    });

    test('resolves structured filename to storage path', () => {
        expect(resolveImagePath('10_20_30.jpg')).toBe('/storage/10/20/original/10_20_30.jpg');
        expect(resolveImagePath('1_2_3.png')).toBe('/storage/1/2/original/1_2_3.png');
    });

    test('resolves unstructured filename to flat storage path', () => {
        expect(resolveImagePath('avatar.png')).toBe('/storage/avatar.png');
        expect(resolveImagePath('some_file.jpg')).toBe('/storage/some_file.jpg');
    });

    test('trims whitespace', () => {
        expect(resolveImagePath('  https://x.com/a.png  ')).toBe('https://x.com/a.png');
        expect(resolveImagePath('  10_20_30.jpg  ')).toBe('/storage/10/20/original/10_20_30.jpg');
    });

    test('returns empty string for empty/whitespace input', () => {
        expect(resolveImagePath('')).toBe('');
        expect(resolveImagePath('   ')).toBe('');
    });
});

// ---------------------------------------------------------------------------
// coerceToString
// ---------------------------------------------------------------------------
describe('coerceToString', () => {
    test('returns empty string for null', () => {
        expect(coerceToString(null)).toBe('');
    });

    test('returns empty string for undefined', () => {
        expect(coerceToString(undefined)).toBe('');
    });

    test('returns string values unchanged', () => {
        expect(coerceToString('hello')).toBe('hello');
        expect(coerceToString('')).toBe('');
    });

    test('converts numbers to string', () => {
        expect(coerceToString(42)).toBe('42');
        expect(coerceToString(0)).toBe('0');
    });

    test('converts boolean to string', () => {
        expect(coerceToString(true)).toBe('true');
        expect(coerceToString(false)).toBe('false');
    });
});

// ---------------------------------------------------------------------------
// classifyRole
// ---------------------------------------------------------------------------
describe('classifyRole', () => {
    test('classifies hidden roles', () => {
        expect(classifyRole('hidden')).toBe('hidden');
        expect(classifyRole('hidden3')).toBe('hidden');
    });

    test('classifies details_link roles', () => {
        expect(classifyRole('details_link')).toBe('details_link');
        expect(classifyRole('details_link5')).toBe('details_link');
    });

    test('classifies details roles', () => {
        expect(classifyRole('details')).toBe('details');
        expect(classifyRole('details2')).toBe('details');
    });

    test('classifies description roles', () => {
        expect(classifyRole('description')).toBe('description');
        expect(classifyRole('description7')).toBe('description');
    });

    test('classifies exact-match roles', () => {
        expect(classifyRole('keywords')).toBe('keywords');
        expect(classifyRole('username')).toBe('username');
        expect(classifyRole('image')).toBe('image');
        expect(classifyRole('header')).toBe('header');
        expect(classifyRole('creation_spec')).toBe('creation_spec');
    });

    test('returns fallback for unknown roles', () => {
        expect(classifyRole('unknown')).toBe('fallback');
        expect(classifyRole('foobar')).toBe('fallback');
    });

    test('details_link is classified before details', () => {
        // Ensures "details_link3" doesn't match "details" first
        expect(classifyRole('details_link3')).toBe('details_link');
    });
});
