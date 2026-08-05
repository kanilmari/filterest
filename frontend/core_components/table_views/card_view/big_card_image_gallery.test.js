/* @vitest-environment jsdom */

import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
    endpointRouterMock,
    openImageModalMock,
    showConfirmModalMock,
    showErrorToastMock,
    showSuccessToastMock,
} = vi.hoisted(() => ({
    endpointRouterMock: vi.fn(),
    openImageModalMock: vi.fn(),
    showConfirmModalMock: vi.fn(),
    showErrorToastMock: vi.fn(),
    showSuccessToastMock: vi.fn(),
}));

vi.mock('../../endpoints/endpoint_router.js', () => ({
    endpoint_router: endpointRouterMock,
}));

vi.mock('./card_image_modal.js', () => ({
    openImageModal: openImageModalMock,
}));

vi.mock('../../../reusable_components/modal/confirm_modal_builder.js', () => ({
    showConfirmModal: showConfirmModalMock,
}));

vi.mock('../../../reusable_components/notifications/toast_notification_printer.js', () => ({
    showErrorToast: showErrorToastMock,
    showSuccessToast: showSuccessToastMock,
}));

import {
    buildImageGallery,
    canUploadImageToChildDataset,
    resolveImageRows,
} from './big_card_image_gallery.js';
import {
    buildRowArticleImageGallery,
    canUploadImageToRowArticleChildDataset,
    resolveRowArticleImageRows,
} from './row_article_image_gallery.js';

beforeEach(() => {
    endpointRouterMock.mockReset();
    endpointRouterMock.mockResolvedValue({ ok: true });
    showConfirmModalMock.mockReset();
    showConfirmModalMock.mockResolvedValue(true);
    openImageModalMock.mockReset();
    showErrorToastMock.mockReset();
    showSuccessToastMock.mockReset();
});

describe('row article image gallery aliases', () => {
    test('keeps row_article exports mapped to the legacy gallery implementation', () => {
        expect(buildRowArticleImageGallery).toBe(buildImageGallery);
        expect(resolveRowArticleImageRows).toBe(resolveImageRows);
        expect(canUploadImageToRowArticleChildDataset).toBe(canUploadImageToChildDataset);
    });
});

describe('resolveImageRows', () => {
    test('keeps explicit image asset rows from shared asset tables', () => {
        const rows = [
            { id: 1, asset_kind: 'image', filename: 'hero.png' },
            { id: 2, asset_kind: 'pdf', filename: 'offer.pdf' },
        ];

        expect(resolveImageRows(rows).map(row => row.id)).toEqual([1]);
    });

    test('keeps legacy filename rows without asset_kind for backward compatibility', () => {
        const rows = [
            { id: 1, filename: 'legacy.png' },
            { id: 2, asset_kind: 'archive', filename: 'backup.zip' },
        ];

        expect(resolveImageRows(rows).map(row => row.id)).toEqual([1]);
    });

    test('sorts primary image rows before non-primary rows', () => {
        const rows = [
            { id: 11, asset_kind: 'image', filename: 'older.png', is_primary: false, sort_order: 1 },
            { id: 12, asset_kind: 'image', filename: 'hero.png', is_primary: true, sort_order: 99 },
        ];

        expect(resolveImageRows(rows).map(row => row.id)).toEqual([12, 11]);
    });

    test('deduplicates a parent-row image already represented by a canonical child row', () => {
        const canonical = { id: 12, asset_kind: 'image', filename: 'hero.png', is_primary: false };
        const parentFallback = { asset_kind: 'image', filename: 'hero.png', is_primary: true };

        expect(resolveImageRows([canonical], [parentFallback])).toEqual([canonical]);
    });
});

describe('canUploadImageToChildDataset', () => {
    test('requires both dataset and fk column', () => {
        expect(canUploadImageToChildDataset({ dataset: 'services_assets', column: 'services_id' })).toBe(true);
        expect(canUploadImageToChildDataset({ dataset: 'services_assets', column: '' })).toBe(false);
        expect(canUploadImageToChildDataset(null)).toBe(false);
    });
});

describe('buildImageGallery', () => {
    test('does not keep a fallback upload input when no child relation is resolved', () => {
        const gallery = buildImageGallery('services', 1, null, () => {});

        expect(gallery.querySelectorAll('input[type="file"]').length).toBe(0);
        expect(gallery.querySelector('[data-testid="big-card-image-upload-disabled"]')).not.toBeNull();
    });

    test('hides upload input when caller explicitly disables upload permission', () => {
        const gallery = buildImageGallery(
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
        const gallery = buildImageGallery(
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
        const gallery = buildImageGallery(
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

    test.each([true, false])(
        'renders a lone parent-row image thumbnail whether primary is %s',
        (isPrimary) => {
            const gallery = buildImageGallery(
                'tickets',
                2,
                null,
                () => {},
                {
                    canUpload: false,
                    parentImageRows: [{
                        asset_kind: 'image',
                        filename: '10_2_1.webp',
                        is_primary: isPrimary,
                        is_parent_row_image: true,
                    }],
                },
            );

            expect(gallery.querySelectorAll('img')).toHaveLength(1);
            expect(gallery.querySelector('img')?.getAttribute('src')).toBe('/storage/10/2/original/10_2_1.webp');
        },
    );

    test('opens the shared on-demand image modal when a thumbnail is clicked', () => {
        const gallery = buildImageGallery(
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

        gallery.querySelector('[data-testid="big-card-image-thumb-0"]').click();

        expect(openImageModalMock).toHaveBeenCalledWith('/storage/hero.png');
    });

    test('shows five image thumbnails at a time and pages carousel arrows to the end', () => {
        const gallery = buildImageGallery(
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
        const gallery = buildImageGallery(
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
        const gallery = buildImageGallery(
            'services',
            1,
            {
                dataset: 'services_assets',
                column: 'services_id',
                rows: [
                    { id: 11, asset_kind: 'image', filename: 'alpha.png', is_primary: false, sort_order: 1 },
                    { id: 12, asset_kind: 'image', filename: 'hero.png', is_primary: true, sort_order: 1 },
                ],
            },
            () => {},
            { canSetPrimary: true },
        );

        const primaryButtons = gallery.querySelectorAll('[data-testid^="big-card-image-primary-"]');
        expect(primaryButtons.length).toBe(2);
        expect(primaryButtons[1].textContent).toBe('☆');
    });

    test('context menu exposes primary + delete actions when both permissions are available', () => {
        const gallery = buildImageGallery(
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
        const gallery = buildImageGallery(
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
        const gallery = buildImageGallery(
            'services',
            1,
            {
                dataset: 'services_assets',
                column: 'services_id',
                rows: [
                    { id: 11, asset_kind: 'image', filename: 'alpha.png', is_primary: false, sort_order: 2 },
                    { id: 12, asset_kind: 'image', filename: 'hero.png', is_primary: true, sort_order: 1 },
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
        const gallery = buildImageGallery(
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
