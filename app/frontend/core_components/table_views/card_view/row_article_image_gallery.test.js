/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const {
    endpointRouterMock,
    openImageFirstViewMock,
    showConfirmModalMock,
    showErrorToastMock,
    showSuccessToastMock,
} = vi.hoisted(() => ({
    endpointRouterMock: vi.fn(),
    openImageFirstViewMock: vi.fn(),
    showConfirmModalMock: vi.fn(),
    showErrorToastMock: vi.fn(),
    showSuccessToastMock: vi.fn(),
}));

vi.mock('../../endpoints/endpoint_router.js', () => ({
    endpoint_router: endpointRouterMock,
}));

vi.mock('./image_first_view_activation.js', () => ({
    activateImageFirstView: openImageFirstViewMock,
}));

vi.mock('../../../reusable_components/modal/confirm_modal_builder.js', () => ({
    showConfirmModal: showConfirmModalMock,
}));

vi.mock('../../../reusable_components/notifications/toast_notification_printer.js', () => ({
    showErrorToast: showErrorToastMock,
    showSuccessToast: showSuccessToastMock,
}));

import {
    buildRowArticleImageGallery,
    canUploadImageToChildDataset,
} from './row_article_image_gallery.js';
import {
    composeRowArticleImageRows,
    resolveRowArticleImageRows,
    resolveRowArticleMainImageRow,
    resolveRowArticlePictureIdentity,
} from './row_article_image_rows.js';
import { setLanguage } from '../../state_stores/lang_preference_reader.js';

beforeEach(() => {
    endpointRouterMock.mockReset();
    endpointRouterMock.mockResolvedValue({ ok: true });
    showConfirmModalMock.mockReset();
    showConfirmModalMock.mockResolvedValue(true);
    openImageFirstViewMock.mockReset();
    showErrorToastMock.mockReset();
    showSuccessToastMock.mockReset();
});

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

describe('canUploadImageToChildDataset', () => {
    test('requires both dataset and fk column', () => {
        expect(canUploadImageToChildDataset({ dataset: 'services_assets', column: 'services_id' })).toBe(true);
        expect(canUploadImageToChildDataset({ dataset: 'services_assets', column: '' })).toBe(false);
        expect(canUploadImageToChildDataset(null)).toBe(false);
    });
});

describe('buildRowArticleImageGallery', () => {
    test('does not keep a fallback upload input when no child relation is resolved', () => {
        const gallery = buildRowArticleImageGallery('services', 1, null, () => {});

        expect(gallery.querySelectorAll('input[type="file"]').length).toBe(0);
        expect(gallery.querySelector('[data-testid="big-card-image-upload-disabled"]')).not.toBeNull();
    });

    test('hides upload input when caller explicitly disables upload permission', () => {
        const gallery = buildRowArticleImageGallery(
            'services',
            1,
            { dataset: 'services_assets', column: 'services_id', rows: [] },
            () => {},
            { canUpload: false },
        );

        expect(gallery.querySelectorAll('input[type="file"]').length).toBe(0);
        expect(gallery.querySelector('[data-testid="big-card-image-upload-disabled"]')).not.toBeNull();
    });

    test('enables multiple file selection for shared asset image uploads', () => {
        const gallery = buildRowArticleImageGallery(
            'services',
            1,
            { dataset: 'services_assets', column: 'services_id', relation_kind: 'shared_asset', rows: [] },
            () => {},
            { canUpload: true },
        );

        const inputs = Array.from(gallery.querySelectorAll('input[type="file"]'));
        expect(inputs.length).toBeGreaterThan(0);
        expect(inputs.every((input) => input.multiple === true)).toBe(true);
    });

    test('renders a single existing image as a thumbnail without a persistent hero preview', () => {
        const gallery = buildRowArticleImageGallery(
            'services',
            1,
            {
                dataset: 'services_assets',
                column: 'services_id',
                rows: [{ id: 11, asset_kind: 'image', filename: 'hero.png' }],
            },
            () => {},
            { canUpload: false },
        );

        expect(gallery.querySelectorAll('img').length).toBe(1);
        expect(gallery.querySelector('.big_card_hero_image')).toBeNull();
        expect(gallery.querySelector('.big_card_thumbnail_row')).not.toBeNull();
    });

    test('uses the shared SVG presentation and parent-row label in image-section thumbnails', () => {
        const gallery = buildRowArticleImageGallery(
            'app_service_catalog',
            1,
            {
                dataset: 'system_assets',
                column: 'record_id',
                rows: [{
                    id: 11,
                    asset_kind: 'image',
                    filename: 'firefox.svg',
                    mime_type: 'image/svg+xml',
                }],
            },
            () => {},
            {
                canUpload: false,
                imageFirstContext: {
                    tableName: 'app_service_catalog',
                    rowItem: { id: 1, name: 'Firefox' },
                    rowLabel: 'Firefox',
                },
            },
        );

        const thumbnail = gallery.querySelector('[data-testid="big-card-image-thumb-0"]');
        expect(thumbnail?.dataset.imagePresentationKind).toBe('svg-logo');
        expect(thumbnail?.querySelector('.record_svg_image_presentation__label')?.textContent)
            .toBe('Firefox');
        expect(thumbnail?.querySelector('img')?.getAttribute('src')).toBe('/storage/firefox.svg');
    });

    test('renders a lone parent-row image thumbnail without row actions', () => {
        const gallery = buildRowArticleImageGallery(
            'tickets',
            2,
            null,
            () => {},
            {
                canUpload: false,
                canDelete: true,
                canSetPrimary: true,
                imageRows: [{
                    asset_kind: 'image',
                    filename: '10_2_1.webp',
                    is_parent_row_image: true,
                }],
            },
        );

        expect(gallery.querySelectorAll('img')).toHaveLength(1);
        expect(gallery.querySelector('img')?.getAttribute('src')).toBe('/storage/10/2/original/10_2_1.webp');
        expect(gallery.querySelector('.big_card_thumbnail_primary, .big_card_thumbnail_delete')).toBeNull();
    });

    test('loads a structured stored name with a query from its storage folder', () => {
        const gallery = buildRowArticleImageGallery(
            'services',
            1,
            {
                dataset: 'services_assets',
                column: 'services_id',
                rows: [{ id: 11, asset_kind: 'image', filename: '10_2_1.webp?v=1' }],
            },
            () => {},
            { canUpload: false },
        );

        expect(gallery.querySelector('[data-testid="big-card-image-thumb-0"] img')?.getAttribute('src'))
            .toBe('/storage/10/2/original/10_2_1.webp?v=1');
    });

    test('shows the thumbnails in the order given instead of re-sorting them', () => {
        const gallery = buildRowArticleImageGallery(
            'services',
            1,
            {
                dataset: 'services_assets',
                column: 'services_id',
                rows: [
                    { id: 2, asset_kind: 'image', filename: 'second.png', sort_order: 9 },
                    { id: 1, asset_kind: 'image', filename: 'first.png', is_primary: true, sort_order: 1 },
                ],
            },
            () => {},
            { canUpload: false },
        );

        expect(Array.from(gallery.querySelectorAll('[data-testid^="big-card-image-thumb-"] img'))
            .map((image) => image.getAttribute('src'))).toEqual(['/storage/second.png', '/storage/first.png']);
    });

    test('keeps the server order but starts on the card picture when a later row shows it', () => {
        const primary = { id: 1, asset_kind: 'image', filename: 'primary.png', is_primary: true, title: 'Primary' };
        const logo = { id: 2, asset_kind: 'image', filename: 'logo.png', title: 'Logo' };
        const gallery = buildRowArticleImageGallery(
            'services',
            1,
            { dataset: 'services_assets', column: 'services_id', relation_kind: 'shared_asset', rows: [primary, logo] },
            () => {},
            { canUpload: false, canEditMetadata: true, cardPicture: 'logo.png' },
        );

        expect(Array.from(gallery.querySelectorAll('[data-testid^="big-card-image-thumb-"] img'))
            .map((image) => image.getAttribute('src'))).toEqual(['/storage/primary.png', '/storage/logo.png']);
        expect(gallery.querySelector('[data-testid="big-card-image-thumb-0"]').classList.contains('active_thumb'))
            .toBe(false);
        expect(gallery.querySelector('[data-testid="big-card-image-thumb-1"]').classList.contains('active_thumb'))
            .toBe(true);
        // The metadata editor edits the picture the gallery starts on.
        expect(gallery.querySelector('[data-testid="big-card-image-title-input"]').value).toBe('Logo');
    });

    test('starts on the first thumbnail when no row shows the card picture', () => {
        const gallery = buildRowArticleImageGallery(
            'services',
            1,
            {
                dataset: 'services_assets',
                column: 'services_id',
                rows: [
                    { id: 1, asset_kind: 'image', filename: 'primary.png' },
                    { id: 2, asset_kind: 'image', filename: 'logo.png' },
                ],
            },
            () => {},
            { canUpload: false, cardPicture: '' },
        );

        expect(gallery.querySelector('[data-testid="big-card-image-thumb-0"]').classList.contains('active_thumb'))
            .toBe(true);
        expect(gallery.querySelector('[data-testid="big-card-image-thumb-1"]').classList.contains('active_thumb'))
            .toBe(false);
    });

    test('shows a card-only picture first without primary, delete, menu or metadata actions', () => {
        const galleryRow = { id: 11, asset_kind: 'image', filename: 'hero.png', title: 'Hero' };
        const imageRows = composeRowArticleImageRows([galleryRow], 'https://cdn.example/card.png');
        const rowItem = { id: 1, title: 'Service' };
        const gallery = buildRowArticleImageGallery(
            'services',
            1,
            {
                dataset: 'services_assets',
                column: 'services_id',
                relation_kind: 'shared_asset',
                rows: [galleryRow],
            },
            () => {},
            {
                canUpload: false,
                canDelete: true,
                canSetPrimary: true,
                canEditMetadata: true,
                imageRows,
                imageFirstContext: { rowItem, tableName: 'services' },
            },
        );

        const cardOnlyItem = gallery.querySelector('[data-testid="big-card-image-item-0"]');
        expect(cardOnlyItem.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example/card.png');
        expect(cardOnlyItem.querySelector('.big_card_thumbnail_primary, .big_card_thumbnail_delete')).toBeNull();
        const menuRequest = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        cardOnlyItem.dispatchEvent(menuRequest);
        expect(menuRequest.defaultPrevented).toBe(false);
        expect(gallery.querySelector('.big_card_thumbnail_context_menu').childElementCount).toBe(0);
        expect(gallery.querySelector('[data-testid="big-card-image-editor-toggle"]').hidden).toBe(true);

        const galleryItem = gallery.querySelector('[data-testid="big-card-image-item-1"]');
        expect(galleryItem.querySelector('[data-testid="big-card-image-primary-1"]')).not.toBeNull();
        expect(galleryItem.querySelector('[data-testid="big-card-image-delete-1"]')).not.toBeNull();

        gallery.querySelector('[data-testid="big-card-image-thumb-1"]').click();
        expect(gallery.querySelector('[data-testid="big-card-image-editor-toggle"]').hidden).toBe(false);
        expect(openImageFirstViewMock).toHaveBeenCalledWith(expect.objectContaining({
            imageRows,
            activeImageRow: galleryRow,
            rowItem,
        }));
    });

    test('opens the standalone image-first view when a thumbnail is clicked', () => {
        const rowItem = { id: 1, title: 'Service' };
        const selectedCard = document.createElement('article');
        const gallery = buildRowArticleImageGallery(
            'services',
            1,
            {
                dataset: 'services_assets',
                column: 'services_id',
                rows: [{ id: 11, asset_kind: 'image', filename: 'hero.png' }],
            },
            () => {},
            {
                canUpload: false,
                imageFirstContext: { rowItem, tableName: 'services', selectedCard },
            },
        );

        gallery.querySelector('[data-testid="big-card-image-thumb-0"]').click();

        expect(openImageFirstViewMock).toHaveBeenCalledWith(expect.objectContaining({
            imageSrc: '/storage/hero.png',
            imageRows: [{ id: 11, asset_kind: 'image', filename: 'hero.png' }],
            activeImageRow: { id: 11, asset_kind: 'image', filename: 'hero.png' },
            rowItem,
            tableName: 'services',
            selectedCard,
        }));
    });

    test('keeps the ordinary gallery unchanged and hands all images to image-first', () => {
        const gallery = buildRowArticleImageGallery(
            'services',
            1,
            {
                dataset: 'services_assets',
                column: 'services_id',
                rows: [
                    { id: 11, asset_kind: 'image', filename: 'hero.png' },
                    { id: 12, asset_kind: 'image', filename: 'map.png' },
                ],
            },
            () => {},
            {
                canUpload: false,
                imageFirstContext: { rowItem: { id: 1 }, tableName: 'services' },
            },
        );

        gallery.querySelector('[data-testid="big-card-image-thumb-0"]').click();
        expect(gallery.querySelector('[data-testid="row-article-image-first-stage"]')).toBeNull();
        expect(openImageFirstViewMock).toHaveBeenCalledWith(expect.objectContaining({
            imageRows: [
                { id: 11, asset_kind: 'image', filename: 'hero.png' },
                { id: 12, asset_kind: 'image', filename: 'map.png' },
            ],
        }));
    });

    test('shows five image thumbnails at a time and pages carousel arrows to the end', () => {
        const gallery = buildRowArticleImageGallery(
            'services',
            1,
            {
                dataset: 'services_assets',
                column: 'services_id',
                rows: Array.from({ length: 7 }, (_, index) => ({
                    id: index + 1,
                    asset_kind: 'image',
                    filename: `image-${index + 1}.png`,
                    sort_order: index + 1,
                })),
            },
            () => {},
            { canUpload: false },
        );

        const visibleThumbTestIds = () => Array
            .from(gallery.querySelectorAll('[data-testid^="big-card-image-thumb-"]'))
            .map((thumb) => thumb.dataset.testid);

        expect(visibleThumbTestIds()).toEqual([
            'big-card-image-thumb-0',
            'big-card-image-thumb-1',
            'big-card-image-thumb-2',
            'big-card-image-thumb-3',
            'big-card-image-thumb-4',
        ]);
        expect(gallery.querySelector('[data-testid="big-card-image-carousel-previous"]').disabled).toBe(true);

        gallery.querySelector('[data-testid="big-card-image-carousel-next"]').click();

        expect(visibleThumbTestIds()).toEqual([
            'big-card-image-thumb-2',
            'big-card-image-thumb-3',
            'big-card-image-thumb-4',
            'big-card-image-thumb-5',
            'big-card-image-thumb-6',
        ]);
        expect(gallery.querySelector('[data-testid="big-card-image-carousel-next"]').disabled).toBe(true);
        expect(gallery.querySelector('[data-testid="big-card-image-carousel-previous"]').disabled).toBe(false);
    });

    test('renders delete actions for image rows when caller grants delete permission', () => {
        const gallery = buildRowArticleImageGallery(
            'services',
            1,
            {
                dataset: 'services_assets',
                column: 'services_id',
                rows: [{ id: 11, asset_kind: 'image', filename: 'hero.png' }],
            },
            () => {},
            { canDelete: true },
        );

        expect(gallery.querySelector('[data-testid="big-card-image-delete-0"]')).not.toBeNull();
    });

    test('renders make-default action for non-primary rows when caller grants update permission', () => {
        const gallery = buildRowArticleImageGallery(
            'services',
            1,
            {
                dataset: 'services_assets',
                column: 'services_id',
                // Server gallery order: the primary picture first.
                rows: [
                    { id: 12, asset_kind: 'image', filename: 'hero.png', is_primary: true, sort_order: 1 },
                    { id: 11, asset_kind: 'image', filename: 'alpha.png', is_primary: false, sort_order: 1 },
                ],
            },
            () => {},
            { canSetPrimary: true },
        );

        const primaryButtons = gallery.querySelectorAll('[data-testid^="big-card-image-primary-"]');
        expect(primaryButtons.length).toBe(2);
        expect(primaryButtons[0].textContent).toBe('★');
        expect(primaryButtons[1].textContent).toBe('☆');
    });

    test('context menu exposes primary + delete actions when both permissions are available', () => {
        const gallery = buildRowArticleImageGallery(
            'services',
            1,
            {
                dataset: 'services_assets',
                column: 'services_id',
                rows: [{ id: 11, asset_kind: 'image', filename: 'hero.png', is_primary: false }],
            },
            () => {},
            { canDelete: true, canSetPrimary: true },
        );

        const item = gallery.querySelector('[data-testid="big-card-image-item-0"]');
        item.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 32,
            clientY: 44,
        }));

        expect(gallery.querySelector('[data-testid="big-card-image-menu-delete"]')).not.toBeNull();
        expect(gallery.querySelector('[data-testid="big-card-image-menu-primary"]')).not.toBeNull();
    });

    test('shared asset galleries expose the metadata editor and save batched updates', async () => {
        const onRefresh = vi.fn().mockResolvedValue(undefined);
        const gallery = buildRowArticleImageGallery(
            'services',
            1,
            {
                dataset: 'services_media',
                column: 'services_id',
                relation_kind: 'shared_asset',
                rows: [{ id: 11, asset_kind: 'image', filename: 'hero.png', title: 'Hero', description: 'Old' }],
            },
            onRefresh,
            { canEditMetadata: true },
        );

        const editor = gallery.querySelector('[data-testid="big-card-image-editor"]');
        const toggle = gallery.querySelector('[data-testid="big-card-image-editor-toggle"]');
        expect(editor.hidden).toBe(true);
        expect(toggle.textContent).toBe('Muokkaa kuvatietoja');

        toggle.click();
        expect(editor.hidden).toBe(false);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');

        const titleInput = gallery.querySelector('[data-testid="big-card-image-title-input"]');
        const descriptionInput = gallery.querySelector('[data-testid="big-card-image-description-input"]');
        titleInput.value = 'New hero';
        descriptionInput.value = 'Updated description';

        gallery.querySelector('[data-testid="big-card-image-save"]')
            .closest('form')
            .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await Promise.resolve();
        await Promise.resolve();

        expect(endpointRouterMock).toHaveBeenCalledWith('updateRow', expect.objectContaining({
            method: 'POST',
            url_params: '?dataset=services_media',
            body_data: {
                id: 11,
                updates: [
                    { column: 'title', value: 'New hero' },
                    { column: 'description', value: 'Updated description' },
                ],
            },
        }));
        expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    test('setting a new primary image updates target row and clears previous primary row', async () => {
        const onRefresh = vi.fn().mockResolvedValue(undefined);
        const gallery = buildRowArticleImageGallery(
            'services',
            1,
            {
                dataset: 'services_assets',
                column: 'services_id',
                // Server gallery order: the primary picture first.
                rows: [
                    { id: 12, asset_kind: 'image', filename: 'hero.png', is_primary: true, sort_order: 1 },
                    { id: 11, asset_kind: 'image', filename: 'alpha.png', is_primary: false, sort_order: 2 },
                ],
            },
            onRefresh,
            { canSetPrimary: true },
        );

        const buttons = gallery.querySelectorAll('[data-testid^="big-card-image-primary-"]');
        buttons[1].click();
        await Promise.resolve();
        await Promise.resolve();

        expect(endpointRouterMock).toHaveBeenNthCalledWith(1, 'updateRow', expect.objectContaining({
            method: 'POST',
            url_params: '?dataset=services_assets',
            body_data: { id: 11, column: 'is_primary', value: true },
        }));
        expect(endpointRouterMock).toHaveBeenNthCalledWith(2, 'updateRow', expect.objectContaining({
            method: 'POST',
            url_params: '?dataset=services_assets',
            body_data: { id: 12, column: 'is_primary', value: false },
        }));
        expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    test('shared asset upload uses relation_kind metadata even when dataset name has no _assets suffix', async () => {
        const gallery = buildRowArticleImageGallery(
            'services',
            1,
            {
                dataset: 'services_media',
                column: 'services_id',
                relation_kind: 'shared_asset',
                rows: [],
            },
            () => Promise.resolve(),
            { canUpload: true },
        );

        const input = gallery.querySelector('input[type="file"]');
        const file = new File(['img'], 'cover.png', { type: 'image/png' });
        Object.defineProperty(input, 'files', {
            configurable: true,
            value: [file],
        });
        input.dispatchEvent(new Event('change'));
        await Promise.resolve();

        const uploadCall = endpointRouterMock.mock.calls.find(([routeName]) => routeName === 'addRowMultipart');
        expect(uploadCall).toBeTruthy();
        const [, request] = uploadCall;
        expect(request.url_params).toBe('?dataset=services_media');
        const payload = JSON.parse(request.body_data.get('jsonPayload'));
        expect(payload).toMatchObject({
            services_id: 1,
            asset_kind: 'image',
            original_name: 'cover.png',
            mime_type: 'image/png',
            title: 'cover.png',
        });
        expect(typeof payload.size_bytes).toBe('number');
        expect(payload.size_bytes).toBeGreaterThan(0);
    });
});
