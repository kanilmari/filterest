import { describe, test, expect } from 'vitest';
import {
    extractSuffixNumber,
    resolveImagePath,
    resolveStructuredStoragePath,
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
// resolveStructuredStoragePath
// ---------------------------------------------------------------------------
describe('resolveStructuredStoragePath', () => {
    test('finds the original folder of a structured name, keeping a query or fragment after it', () => {
        expect(resolveStructuredStoragePath('10_2_1.webp')).toBe('/storage/10/2/original/10_2_1.webp');
        expect(resolveStructuredStoragePath('10_2_1.webp?v=1')).toBe('/storage/10/2/original/10_2_1.webp?v=1');
        expect(resolveStructuredStoragePath('10_2_1.webp#zoom')).toBe('/storage/10/2/original/10_2_1.webp#zoom');
    });

    test.each(['avatar.png', 'avatar.png?v=1', '10_20.jpg', '104/133/300/104_133_38.png', '?v=1', ''])(
        'is empty for %j, which is no structured name',
        (value) => {
            expect(resolveStructuredStoragePath(value)).toBe('');
        },
    );
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

    test('keeps a query or fragment after a structured filename behind its storage path', () => {
        expect(resolveImagePath('10_2_1.webp?v=1')).toBe('/storage/10/2/original/10_2_1.webp?v=1');
        expect(resolveImagePath('10_2_1.webp#zoom')).toBe('/storage/10/2/original/10_2_1.webp#zoom');
        expect(resolveImagePath('  10_2_1.webp?v=1#zoom  ')).toBe('/storage/10/2/original/10_2_1.webp?v=1#zoom');
        // Only the first ? or # starts the suffix; a fragment may itself contain a ?.
        expect(resolveImagePath('10_2_1.webp#a?b')).toBe('/storage/10/2/original/10_2_1.webp#a?b');
    });

    test('resolves other values with a query or fragment as before', () => {
        expect(resolveImagePath('avatar.png?v=1')).toBe('/storage/avatar.png?v=1');
        expect(resolveImagePath('some_file.jpg#zoom')).toBe('/storage/some_file.jpg#zoom');
        expect(resolveImagePath('10_20.jpg?v=1')).toBe('/storage/10_20.jpg?v=1');
        expect(resolveImagePath('?v=1')).toBe('/storage/?v=1');
        expect(resolveImagePath('https://x.com/10_2_1.webp?v=1')).toBe('https://x.com/10_2_1.webp?v=1');
        expect(resolveImagePath('/storage/10/2/original/10_2_1.webp?v=1')).toBe('/storage/10/2/original/10_2_1.webp?v=1');
        expect(resolveImagePath('./10_2_1.webp#zoom')).toBe('./10_2_1.webp#zoom');
    });

    // Without a ? or #, every value resolves byte for byte as it did before suffixes
    // were separated from structured filenames.
    test.each([
        ['https://example.com/img.png', 'https://example.com/img.png'],
        ['http://example.com/img.png', 'http://example.com/img.png'],
        ['./images/foo.png', './images/foo.png'],
        ['/static/img.png', '/static/img.png'],
        ['/storage/10/2/original/10_2_1.webp', '/storage/10/2/original/10_2_1.webp'],
        ['10_20_30.jpg', '/storage/10/20/original/10_20_30.jpg'],
        ['1_2_3.png', '/storage/1/2/original/1_2_3.png'],
        ['1_2_3.PNG', '/storage/1/2/original/1_2_3.PNG'],
        ['100_200_300.webp', '/storage/100/200/original/100_200_300.webp'],
        ['  10_20_30.jpg  ', '/storage/10/20/original/10_20_30.jpg'],
        ['avatar.png', '/storage/avatar.png'],
        ['some_file.jpg', '/storage/some_file.jpg'],
        ['10_20.jpg', '/storage/10_20.jpg'],
        ['a_2_3.png', '/storage/a_2_3.png'],
        ['10_2_1.webp.png', '/storage/10_2_1.webp.png'],
        ['10_20_30.tar.gz', '/storage/10_20_30.tar.gz'],
        ['folder/10_2_1.webp', '/storage/folder/10_2_1.webp'],
        ['ftp://host/a.png', '/storage/ftp://host/a.png'],
        ['data:image/png;base64,AAAA', '/storage/data:image/png;base64,AAAA'],
        ['', ''],
        ['   ', ''],
    ])('resolves %j without a query or fragment exactly as before', (input, expected) => {
        expect(resolveImagePath(input)).toBe(expected);
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
