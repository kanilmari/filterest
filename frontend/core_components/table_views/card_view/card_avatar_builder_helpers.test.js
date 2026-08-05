// card_avatar_builder_helpers.test.js
// Unit tests for pure card avatar and image-alt helper functions.
// Bridges deterministic Vitest inputs and card_avatar_builder_helpers.js outputs.
// Exists to keep card media fallback and accessibility text stable during refactors.

import { describe, test, expect } from 'vitest';
import {
    buildImageAltContext,
    formatDatasetNameForAltText,
    hslColorFromHash,
    borderRadiusFromHash,
    fontFromHash,
    isPngImage,
    formatAvatarText,
    computeAvatarConfig,
} from './card_avatar_builder_helpers.js';

// ---------------------------------------------------------------------------
// hslColorFromHash
// ---------------------------------------------------------------------------
describe('hslColorFromHash', () => {
    test('computes hue from hash modulo 360', () => {
        expect(hslColorFromHash(0)).toBe('hsl(0, 30%, 40%)');
        expect(hslColorFromHash(180)).toBe('hsl(180, 30%, 40%)');
        expect(hslColorFromHash(360)).toBe('hsl(0, 30%, 40%)');
    });

    test('wraps large values', () => {
        expect(hslColorFromHash(721)).toBe('hsl(1, 30%, 40%)');
    });

    test('handles typical hash-derived number', () => {
        const hash = parseInt('a1b2c3d4', 16); // 2712847316
        const expectedHue = hash % 360;
        expect(hslColorFromHash(hash)).toBe(`hsl(${expectedHue}, 30%, 40%)`);
    });
});

// ---------------------------------------------------------------------------
// borderRadiusFromHash
// ---------------------------------------------------------------------------
describe('borderRadiusFromHash', () => {
    test('returns value between 1% and 30%', () => {
        expect(borderRadiusFromHash(0)).toBe('1%');
        expect(borderRadiusFromHash(29)).toBe('30%');
        expect(borderRadiusFromHash(30)).toBe('1%');
    });

    test('wraps correctly for large values', () => {
        expect(borderRadiusFromHash(100)).toBe('11%');
    });
});

// ---------------------------------------------------------------------------
// fontFromHash
// ---------------------------------------------------------------------------
describe('fontFromHash', () => {
    test('returns Arial for hash 0', () => {
        // (0 >>> 8) % 7 = 0
        expect(fontFromHash(0)).toBe('Arial, sans-serif');
    });

    test('selects different fonts for different hashes', () => {
        // (256 >>> 8) = 1, 1 % 7 = 1
        expect(fontFromHash(256)).toBe('"Times New Roman", Times, serif');
    });

    test('wraps around the font list', () => {
        // (7 * 256 >>> 8) = 7, 7 % 7 = 0
        expect(fontFromHash(7 * 256)).toBe('Arial, sans-serif');
    });

    test('returns a valid font string for large hash', () => {
        const result = fontFromHash(parseInt('a1b2c3d4', 16));
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// isPngImage
// ---------------------------------------------------------------------------
describe('isPngImage', () => {
    test('returns true for .png extension', () => {
        expect(isPngImage('avatar.png')).toBe(true);
    });

    test('returns true case-insensitively', () => {
        expect(isPngImage('photo.PNG')).toBe(true);
        expect(isPngImage('image.Png')).toBe(true);
    });

    test('returns false for non-png extensions', () => {
        expect(isPngImage('photo.jpg')).toBe(false);
        expect(isPngImage('image.gif')).toBe(false);
        expect(isPngImage('file.svg')).toBe(false);
    });

    test('returns false for paths containing png but not ending with it', () => {
        expect(isPngImage('png-folder/image.jpg')).toBe(false);
    });

    test('handles empty string', () => {
        expect(isPngImage('')).toBe(false);
    });

    test('handles full URLs', () => {
        expect(isPngImage('https://example.com/img.png')).toBe(true);
        expect(isPngImage('https://example.com/img.jpg')).toBe(false);
    });

    test('ignores query strings and hash fragments after the file extension', () => {
        expect(isPngImage('/storage/logo.PNG?v=123')).toBe(true);
        expect(isPngImage('/storage/logo.png#preview')).toBe(true);
        expect(isPngImage('/storage/logo.png?cache=1#preview')).toBe(true);
        expect(isPngImage('/storage/logo.jpg?name=logo.png')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// formatDatasetNameForAltText
// ---------------------------------------------------------------------------
describe('formatDatasetNameForAltText', () => {
    test('replaces underscores and capitalises the dataset name', () => {
        expect(formatDatasetNameForAltText('system_users')).toBe('System users');
    });

    test('normalises repeated whitespace', () => {
        expect(formatDatasetNameForAltText('  team__members  ')).toBe('Team members');
    });

    test('returns empty string for empty input', () => {
        expect(formatDatasetNameForAltText('')).toBe('');
        expect(formatDatasetNameForAltText(null)).toBe('');
    });
});

// ---------------------------------------------------------------------------
// buildImageAltContext
// ---------------------------------------------------------------------------
describe('buildImageAltContext', () => {
    test('combines row label and dataset name when both exist', () => {
        expect(buildImageAltContext('system_users', 'Jane Doe'))
            .toBe('Jane Doe (System users)');
    });

    test('returns row label when dataset name is missing', () => {
        expect(buildImageAltContext('', 'Jane Doe')).toBe('Jane Doe');
    });

    test('returns formatted dataset name when row label is missing', () => {
        expect(buildImageAltContext('system_users', '')).toBe('System users');
    });
});

// ---------------------------------------------------------------------------
// formatAvatarText
// ---------------------------------------------------------------------------
describe('formatAvatarText', () => {
    test('uppercases text', () => {
        expect(formatAvatarText('hello')).toBe('HELLO');
    });

    test('returns ? for null', () => {
        expect(formatAvatarText(null)).toBe('?');
    });

    test('returns ? for undefined', () => {
        expect(formatAvatarText(undefined)).toBe('?');
    });

    test('returns ? for empty string', () => {
        expect(formatAvatarText('')).toBe('?');
    });

    test('truncates text longer than maxChars with ellipsis', () => {
        const long = 'abcdefghijklmnopqrstuvwxyz';
        expect(formatAvatarText(long, 16)).toBe('ABCDEFGHIJKLMNOP...');
    });

    test('does not truncate text at exactly maxChars', () => {
        const exact = 'abcdefghijklmnop'; // 16 chars
        expect(formatAvatarText(exact, 16)).toBe('ABCDEFGHIJKLMNOP');
    });

    test('respects custom maxChars', () => {
        expect(formatAvatarText('abcdef', 3)).toBe('ABC...');
    });

    test('uses default maxChars of 16', () => {
        const text17 = 'a'.repeat(17);
        expect(formatAvatarText(text17)).toBe('A'.repeat(16) + '...');
    });
});

// ---------------------------------------------------------------------------
// computeAvatarConfig
// ---------------------------------------------------------------------------
describe('computeAvatarConfig', () => {
    // SHA-256 of "test" starts with "9f86d081884c7d65..."
    const testHash = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

    test('returns all expected properties', () => {
        const config = computeAvatarConfig(testHash, 'AB');
        expect(config).toHaveProperty('text');
        expect(config).toHaveProperty('color');
        expect(config).toHaveProperty('borderRadius');
        expect(config).toHaveProperty('font');
        expect(config).toHaveProperty('containerSize');
        expect(config).toHaveProperty('avatarBoxSize');
    });

    test('uppercases the letter', () => {
        const config = computeAvatarConfig(testHash, 'ab');
        expect(config.text).toBe('AB');
    });

    test('returns ? for null letter', () => {
        const config = computeAvatarConfig(testHash, null);
        expect(config.text).toBe('?');
    });

    test('uses small size by default', () => {
        const config = computeAvatarConfig(testHash, 'X');
        expect(config.containerSize).toBe(120);
        expect(config.avatarBoxSize).toBe(120);
    });

    test('uses large size when requested', () => {
        const config = computeAvatarConfig(testHash, 'X', true);
        expect(config.containerSize).toBe(300);
        expect(config.avatarBoxSize).toBe(220);
    });

    test('is deterministic for same hash', () => {
        const a = computeAvatarConfig(testHash, 'X');
        const b = computeAvatarConfig(testHash, 'X');
        expect(a).toEqual(b);
    });

    test('produces different colors for different hashes', () => {
        const hash2 = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
        const a = computeAvatarConfig(testHash, 'X');
        const b = computeAvatarConfig(hash2, 'X');
        expect(a.color).not.toBe(b.color);
    });
});
