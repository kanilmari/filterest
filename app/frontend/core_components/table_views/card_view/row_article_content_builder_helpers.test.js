import { describe, test, expect } from 'vitest';
import {
    extractSuffixNumber,
    resolveImagePath,
    classifyRole,
} from './row_article_content_builder_helpers.js';

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

    // Only a numeric suffix repeats a role; these two cases used to be asserted
    // against the internal matchesRole helper, which is no longer exported.
    test('a non-numeric suffix does not repeat a role', () => {
        expect(classifyRole('detailsABC')).toBe('fallback');
    });

    test('an empty role falls back instead of matching a base name', () => {
        expect(classifyRole('')).toBe('fallback');
    });

    test('details_link is classified before details', () => {
        // Ensures "details_link3" doesn't match "details" first
        expect(classifyRole('details_link3')).toBe('details_link');
    });
});
