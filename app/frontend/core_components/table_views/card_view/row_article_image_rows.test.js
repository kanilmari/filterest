// row_article_image_rows.test.js
// Verifies picture identity, gallery ordering, and multilingual card-picture selection.
// Between stored image references and the rows article galleries and image-first views show.
// Keeps pure row selection covered independently of gallery rendering and endpoint mocks.
/* @vitest-environment jsdom */

import { afterEach, describe, expect, test } from 'vitest';

import {
    composeRowArticleImageRows,
    resolveRowArticleImageRows,
    resolveRowArticleMainImageRow,
    resolveRowArticlePictureIdentity,
} from './row_article_image_rows.js';
import { setLanguage } from '../../state_stores/lang_preference_reader.js';

describe('resolveRowArticlePictureIdentity', () => {
    const identity = resolveRowArticlePictureIdentity;

    test('treats a bare stored name and its full storage address as the same picture', () => {
        expect(identity('10_2_1.webp')).toBe(identity('/storage/10/2/original/10_2_1.webp'));
        expect(identity('hero.png')).toBe(identity('/storage/hero.png'));
        expect(identity(`${window.location.origin}/storage/hero.png`)).toBe(identity(' hero.png '));
    });

    test('keeps the host and the query, so the same path elsewhere is another picture', () => {
        expect(identity('https://old.example/logo.png')).not.toBe(identity('https://new.example/logo.png'));
        expect(identity('pic.png?v=1')).not.toBe(identity('pic.png?v=2'));
        expect(identity('https://cdn.example/a.png?v=1')).not.toBe(identity('https://cdn.example/a.png'));
    });

    test('drops only a #fragment', () => {
        expect(identity('https://cdn.example/a.png?v=1#zoom')).toBe(identity('https://cdn.example/a.png?v=1'));
    });

    test('finds the storage folder of a structured stored name written with a query or fragment', () => {
        expect(identity('10_2_1.webp#zoom')).toBe(identity('10_2_1.webp'));
        expect(identity('10_2_1.webp?v=1')).toBe(identity('/storage/10/2/original/10_2_1.webp?v=1'));
        expect(identity('10_2_1.webp?v=1')).not.toBe(identity('10_2_1.webp?v=2'));
    });

    test.each(['', '   ', null, undefined])('is empty for the empty value %j', (value) => {
        expect(identity(value)).toBe('');
    });
});

describe('resolveRowArticleImageRows', () => {
    test('keeps explicit image asset rows from shared asset tables', () => {
        const rows = [
            { id: 1, asset_kind: 'image', filename: 'hero.png' },
            { id: 2, asset_kind: 'pdf', filename: 'offer.pdf' },
        ];

        expect(resolveRowArticleImageRows(rows).map(row => row.id)).toEqual([1]);
    });

    test('keeps legacy filename rows without asset_kind for backward compatibility', () => {
        const rows = [
            { id: 1, filename: 'legacy.png' },
            { id: 2, asset_kind: 'archive', filename: 'backup.zip' },
        ];

        expect(resolveRowArticleImageRows(rows).map(row => row.id)).toEqual([1]);
    });

    test('keeps the server gallery order as given instead of sorting by primary, sort order or id', () => {
        const rows = [
            { id: 11, asset_kind: 'image', filename: 'older.png', is_primary: false, sort_order: 1 },
            { id: 12, asset_kind: 'image', filename: 'hero.png', is_primary: true, sort_order: 99 },
            { id: 3, asset_kind: 'image', filename: 'early.png', sort_order: 0 },
        ];

        expect(resolveRowArticleImageRows(rows).map(row => row.id)).toEqual([11, 12, 3]);
    });

    test('drops a later row whose picture an earlier row already shows, compared by resolved path', () => {
        const canonical = { id: 12, asset_kind: 'image', filename: 'hero.png' };
        const samePicture = { asset_kind: 'image', filename: '/storage/hero.png', is_parent_row_image: true };

        expect(resolveRowArticleImageRows([canonical, samePicture])).toEqual([canonical]);
    });

    test('keeps pictures at the same path on another host or with another query', () => {
        const rows = [
            { id: 1, asset_kind: 'image', filename: 'https://old.example/logo.png' },
            { id: 2, asset_kind: 'image', filename: 'https://new.example/logo.png' },
            { id: 3, asset_kind: 'image', filename: 'pic.png?v=1' },
            { id: 4, asset_kind: 'image', filename: 'pic.png?v=2' },
        ];

        expect(resolveRowArticleImageRows(rows)).toEqual(rows);
    });
});

describe('composeRowArticleImageRows', () => {
    const second = { id: 2, asset_kind: 'image', filename: 'second.png', sort_order: 9 };
    const first = { id: 1, asset_kind: 'image', filename: 'first.png', is_primary: true };

    test('leads with a card-only tile when no gallery row carries the card picture', () => {
        expect(composeRowArticleImageRows([second, first], ' https://cdn.example/card.png ')).toEqual([
            { asset_kind: 'image', filename: 'https://cdn.example/card.png', is_card_only_picture: true },
            second,
            first,
        ]);
    });

    test('keeps the gallery rows as they are when one carries the card picture, compared by resolved path', () => {
        const stored = { id: 7, asset_kind: 'image', filename: '10_2_1.webp' };

        expect(composeRowArticleImageRows([second, stored], '/storage/10/2/original/10_2_1.webp'))
            .toEqual([second, stored]);
        expect(composeRowArticleImageRows([stored], '10_2_1.webp')).toEqual([stored]);
    });

    test.each(['', '   ', null, undefined])('adds no card-only tile for the empty card picture %j', (cardPicture) => {
        expect(composeRowArticleImageRows([second, first], cardPicture)).toEqual([second, first]);
    });

    test('adds a card-only tile when a gallery row has the card picture\'s path on another host or query', () => {
        const oldHost = { id: 3, asset_kind: 'image', filename: 'https://old.example/logo.png' };
        const oldQuery = { id: 4, asset_kind: 'image', filename: 'pic.png?v=1' };

        expect(composeRowArticleImageRows([oldHost], 'https://new.example/logo.png')).toEqual([
            { asset_kind: 'image', filename: 'https://new.example/logo.png', is_card_only_picture: true },
            oldHost,
        ]);
        expect(composeRowArticleImageRows([oldQuery], 'pic.png?v=2')).toEqual([
            { asset_kind: 'image', filename: 'pic.png?v=2', is_card_only_picture: true },
            oldQuery,
        ]);
    });

    test('adds no second tile for a gallery file the card picture names with a query or fragment', () => {
        const stored = { id: 7, asset_kind: 'image', filename: '/storage/10/2/original/10_2_1.webp?v=1' };
        const plain = { id: 8, asset_kind: 'image', filename: '10_2_1.webp' };

        expect(composeRowArticleImageRows([stored], '10_2_1.webp?v=1')).toEqual([stored]);
        expect(composeRowArticleImageRows([plain], '10_2_1.webp#zoom')).toEqual([plain]);
    });

    test('shows only the card picture, or nothing, when the response has no gallery rows', () => {
        expect(composeRowArticleImageRows([], 'hero.png'))
            .toEqual([{ asset_kind: 'image', filename: 'hero.png', is_card_only_picture: true }]);
        expect(composeRowArticleImageRows(undefined, '')).toEqual([]);
    });
});

describe('resolveRowArticleMainImageRow', () => {
    const primary = { id: 1, asset_kind: 'image', filename: 'primary.png', is_primary: true };
    const logo = { id: 2, asset_kind: 'image', filename: '10_2_2.webp' };

    test('picks the row showing the card picture even when it is not the first, compared by resolved path', () => {
        expect(resolveRowArticleMainImageRow([primary, logo], '10_2_2.webp')).toBe(logo);
        expect(resolveRowArticleMainImageRow([primary, logo], '/storage/10/2/original/10_2_2.webp')).toBe(logo);
    });

    test.each([
        ['an empty card picture', ''],
        ['no card picture', undefined],
        ['a card picture no row shows', 'elsewhere.png'],
    ])('falls back to the first row for %s', (_label, cardPicture) => {
        expect(resolveRowArticleMainImageRow([primary, logo], cardPicture)).toBe(primary);
    });

    test('picks the row with the card picture\'s own host or query among rows at the same path', () => {
        const oldHost = { id: 3, asset_kind: 'image', filename: 'https://old.example/logo.png' };
        const newHost = { id: 4, asset_kind: 'image', filename: 'https://new.example/logo.png' };
        const oldQuery = { id: 5, asset_kind: 'image', filename: 'pic.png?v=1' };
        const newQuery = { id: 6, asset_kind: 'image', filename: 'pic.png?v=2' };

        expect(resolveRowArticleMainImageRow([oldHost, newHost], 'https://new.example/logo.png')).toBe(newHost);
        expect(resolveRowArticleMainImageRow([oldQuery, newQuery], 'pic.png?v=2')).toBe(newQuery);
    });

    test('returns null without rows', () => {
        expect(resolveRowArticleMainImageRow([], 'primary.png')).toBeNull();
        expect(resolveRowArticleMainImageRow(null)).toBeNull();
    });
});

// The server reports a multilingual card picture whole; the article reads it in the
// viewer's language, as the card reads its image field.
describe("the card picture in the viewer's language", () => {
    const fiRow = { id: 1, asset_kind: 'image', filename: 'fi.png' };
    const enRow = { id: 2, asset_kind: 'image', filename: 'en.png' };
    const twoLanguages = JSON.stringify({ fi: 'fi.png', en: 'en.png' });

    afterEach(() => {
        localStorage.clear();
    });

    test("picks the viewer's language for the main picture and for the card-only tile", () => {
        setLanguage('fi');
        expect(resolveRowArticleMainImageRow([enRow, fiRow], twoLanguages)).toBe(fiRow);
        expect(composeRowArticleImageRows([enRow], twoLanguages)).toEqual([
            { asset_kind: 'image', filename: 'fi.png', is_card_only_picture: true },
            enRow,
        ]);

        setLanguage('en');
        expect(resolveRowArticleMainImageRow([fiRow, enRow], twoLanguages)).toBe(enRow);
        expect(composeRowArticleImageRows([enRow], twoLanguages)).toEqual([enRow]);
    });

    test("an empty value in the viewer's language is no card picture, so the first gallery row leads", () => {
        setLanguage('fi');
        const emptyInFinnish = JSON.stringify({ fi: '', en: 'en.png' });

        expect(composeRowArticleImageRows([enRow, fiRow], emptyInFinnish)).toEqual([enRow, fiRow]);
        expect(resolveRowArticleMainImageRow([enRow, fiRow], emptyInFinnish)).toBe(enRow);
    });

    test('reads plain values and JSON that is no language map as they are', () => {
        setLanguage('fi');
        const notLanguages = '{"width":"fi.png"}';

        expect(resolveRowArticleMainImageRow([enRow, fiRow], ' fi.png ')).toBe(fiRow);
        expect(composeRowArticleImageRows([enRow], ' fi.png ')).toEqual([
            { asset_kind: 'image', filename: 'fi.png', is_card_only_picture: true },
            enRow,
        ]);
        expect(composeRowArticleImageRows([enRow], notLanguages)).toEqual([
            { asset_kind: 'image', filename: notLanguages, is_card_only_picture: true },
            enRow,
        ]);
    });
});
