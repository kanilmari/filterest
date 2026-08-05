import { describe, test, expect } from 'vitest';
import {
    buildGoogleMapsEmbedUrl,
    hasFallbackCardImageColumn,
    resolveImagePaths,
    resolveFallbackCardImageValue,
} from './card_element_builder_helpers.js';

// ---------------------------------------------------------------------------
// buildGoogleMapsEmbedUrl
// ---------------------------------------------------------------------------
describe('buildGoogleMapsEmbedUrl', () => {
    test('builds URL from full address', () => {
        const row = {
            street: 'Mannerheimintie',
            house_number: '1',
            postal_code: '00100',
            city: 'Helsinki',
            country_name: 'Finland',
        };
        const url = buildGoogleMapsEmbedUrl(row);
        expect(url).toBe(
            'https://maps.google.com/maps?q=' +
            encodeURIComponent('Mannerheimintie 1 00100 Helsinki Finland') +
            '&z=15&output=embed'
        );
    });

    test('builds URL from partial address', () => {
        const row = { city: 'Helsinki', country_name: 'Finland' };
        const url = buildGoogleMapsEmbedUrl(row);
        expect(url).toContain(encodeURIComponent('Helsinki Finland'));
    });

    test('returns null for empty address', () => {
        expect(buildGoogleMapsEmbedUrl({})).toBeNull();
    });

    test('returns null when all fields are falsy', () => {
        const row = { street: '', house_number: null, postal_code: undefined };
        expect(buildGoogleMapsEmbedUrl(row)).toBeNull();
    });

    test('skips falsy fields in the middle', () => {
        const row = { street: 'Main St', city: 'Turku' };
        const url = buildGoogleMapsEmbedUrl(row);
        expect(url).toContain(encodeURIComponent('Main St Turku'));
        // Should NOT contain double spaces
        expect(url).not.toContain(encodeURIComponent('Main St  Turku'));
    });

    test('encodes special characters', () => {
        const row = { street: 'Königstraße', house_number: '5' };
        const url = buildGoogleMapsEmbedUrl(row);
        expect(url).toContain(encodeURIComponent('Königstraße 5'));
    });
});

// ---------------------------------------------------------------------------
// resolveImagePaths
// ---------------------------------------------------------------------------
describe('resolveImagePaths', () => {
    test('returns external http URLs as-is', () => {
        const result = resolveImagePaths('http://example.com/img.jpg', '300');
        expect(result.displaySrc).toBe('http://example.com/img.jpg');
        expect(result.originalSrc).toBe('http://example.com/img.jpg');
    });

    test('returns external https URLs as-is', () => {
        const result = resolveImagePaths('https://cdn.example.com/photo.png', '300');
        expect(result.displaySrc).toBe('https://cdn.example.com/photo.png');
        expect(result.originalSrc).toBe('https://cdn.example.com/photo.png');
    });

    test('returns relative ./ paths as-is', () => {
        const result = resolveImagePaths('./assets/logo.png', '300');
        expect(result.displaySrc).toBe('./assets/logo.png');
        expect(result.originalSrc).toBe('./assets/logo.png');
    });

    test('returns absolute / paths as-is', () => {
        const result = resolveImagePaths('/static/img.jpg', '1000');
        expect(result.displaySrc).toBe('/static/img.jpg');
        expect(result.originalSrc).toBe('/static/img.jpg');
    });

    test('resolves full path format (tableId/rowId/size/filename)', () => {
        const result = resolveImagePaths('104/133/300/104_133_38.png', '300');
        expect(result.displaySrc).toBe('/storage/104/133/300/104_133_38.png');
        expect(result.originalSrc).toBe('/storage/104/133/original/104_133_38.png');
    });

    test('resolves full path format with original folder', () => {
        const result = resolveImagePaths('104/133/original/photo.jpg', '1000');
        expect(result.displaySrc).toBe('/storage/104/133/1000/photo.jpg');
        expect(result.originalSrc).toBe('/storage/104/133/original/photo.jpg');
    });

    test('uses correct mediaFolder for display path', () => {
        const result300 = resolveImagePaths('10/20/1000/file.png', '300');
        expect(result300.displaySrc).toBe('/storage/10/20/300/file.png');

        const result1000 = resolveImagePaths('10/20/300/file.png', '1000');
        expect(result1000.displaySrc).toBe('/storage/10/20/1000/file.png');
    });

    test('resolves flat filename format (tableId_rowId_id.ext)', () => {
        const result = resolveImagePaths('104_133_38.png', '300');
        expect(result.displaySrc).toBe('/storage/104/133/300/104_133_38.png');
        expect(result.originalSrc).toBe('/storage/104/133/original/104_133_38.png');
    });

    test('falls back to /storage/ prefix for unrecognized format', () => {
        const result = resolveImagePaths('some-random-file.jpg', '300');
        expect(result.displaySrc).toBe('/storage/some-random-file.jpg');
        expect(result.originalSrc).toBe('/storage/some-random-file.jpg');
    });
});

// ---------------------------------------------------------------------------
// resolveFallbackCardImageValue
// ---------------------------------------------------------------------------
describe('resolveFallbackCardImageValue', () => {
    test('prefers cached_image when metadata is missing an image role', () => {
        const result = resolveFallbackCardImageValue({
            cached_image: '104_161_55.png',
            image: 'fallback.jpg',
        });

        expect(result).toBe('104_161_55.png');
    });

    test('accepts multilingual JSON payloads that contain an image filename', () => {
        const result = resolveFallbackCardImageValue({
            cached_image: '{"fi":"104_161_55.png","en":"104_161_55.png"}',
        });

        expect(result).toBe('104_161_55.png');
    });

    test('accepts storage-relative row-scoped logo filenames', () => {
        const result = resolveFallbackCardImageValue({
            cached_image: '104_6005_7005.svg',
        });

        expect(result).toBe('104_6005_7005.svg');
    });

    test('scans conventional image-like keys beyond the preferred list', () => {
        const result = resolveFallbackCardImageValue({
            title: 'Binance',
            logo_avatar: '104/161/300/binance-logo.webp',
        });

        expect(result).toBe('104/161/300/binance-logo.webp');
    });

    test('ignores empty and non-image-like values', () => {
        const result = resolveFallbackCardImageValue({
            cached_image: '',
            image: 'not-an-image-value',
            title: 'Binance',
        });

        expect(result).toBe('');
    });
});

// ---------------------------------------------------------------------------
// hasFallbackCardImageColumn
// ---------------------------------------------------------------------------
describe('hasFallbackCardImageColumn', () => {
    test('recognizes cached_image as a table-level fallback image slot', () => {
        expect(hasFallbackCardImageColumn(['id', 'title', 'cached_image'])).toBe(true);
    });

    test('recognizes image-like custom column names', () => {
        expect(hasFallbackCardImageColumn(['id', 'logo_avatar'])).toBe(true);
    });

    test('ignores ordinary columns', () => {
        expect(hasFallbackCardImageColumn(['id', 'title', 'created'])).toBe(false);
    });

    test('handles invalid column lists defensively', () => {
        expect(hasFallbackCardImageColumn(null)).toBe(false);
    });
});
