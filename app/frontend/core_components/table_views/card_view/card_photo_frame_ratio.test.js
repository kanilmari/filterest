// @vitest-environment jsdom
// card_photo_frame_ratio.test.js
// Checks stored photo geometry, immutable frames and renderer boundaries.
// Connects matching image metadata to the raster presentation's removable projection.
// Keeps loading, errors and resolution swaps from changing a built frame's shape.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createImageElement, updateCardImageFrame } from './card_avatar_builder.js';
import { updateCardImageSources } from './card_element_builder.js';
import { cardImageFrameFollowsStoredShape, prepareCardImagePresentation, resolveCardPhotoFrameRatio,
    resolveStoredCardPhotoFrameRatio } from './card_image_presentation.js';
import { clearAppearanceProjections } from '../../../reusable_components/appearance_projection_writer.js';
import { disposeCardResources } from './card_resource_lifecycle.js';

// This resize proof uses the real media builder without importing unrelated article renderers.
vi.mock('./row_article_opener.js', () => ({ openRowArticleView: vi.fn() }));
vi.mock('./image_first_view_activation.js', () => ({ bindImageFirstViewActivation: vi.fn() }));
vi.mock('./card_field_formatter.js', () => ({ createKeyValueElement: vi.fn() }));

const property = '--card-photo-frame-ratio';
function metadata(file, width_px = 1200, height_px = 675) {
    return { displayed_image_size: { file, width_px, height_px } };
}
function photo(file, { width = 0, height = 0, complete = false } = {}) {
    const wrapper = document.createElement('div');
    wrapper.dataset.cardImageRenderSlot = 'card_media';
    wrapper.dataset.imagePresentationKind = 'raster';
    wrapper.dataset.datasetAppearanceScope = '';
    const image = new Image();
    image.src = file;
    Object.defineProperties(image, {
        naturalWidth: { configurable: true, value: width },
        naturalHeight: { configurable: true, value: height },
        complete: { value: complete },
    });
    wrapper.append(image);
    return { wrapper, image };
}
function prepare(file, { imageMetadata, ...imageOptions } = {}) {
    const result = photo(file, imageOptions);
    prepareCardImagePresentation(result.wrapper, result.image, { imageMetadata });
    return result;
}

describe('card photo frame ratio', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });
    it.each([1440, 1600])('restores the build-time frame in both resize directions, starting at %s', initialWidth => {
        const options = { renderSlot: 'card_media', imageMetadata: metadata('portrait.png', 500, 1500) };
        vi.stubGlobal('innerWidth', initialWidth);
        const wrapper = createImageElement('/storage/portrait.png', true, options);
        expect(wrapper.style.getPropertyValue(property)).toBe('0.8');
        for (const width of [initialWidth === 1440 ? 1600 : 390, initialWidth]) {
            vi.stubGlobal('innerWidth', width);
            updateCardImageFrame(wrapper);
            const fresh = createImageElement('/storage/portrait.png', true, options);
            const stacked = width <= 1550;
            for (const key of ['width', 'height', 'maxWidth', 'aspectRatio']) {
                expect(wrapper.style[key], key).toBe(fresh.style[key]);
            }
            expect(wrapper.style.width).toBe(stacked ? '100%' : '300px');
            expect(wrapper.style.height).toBe(stacked ? '' : '300px');
            expect(wrapper.style.maxWidth).toBe(stacked ? '1000px' : '');
            expect(wrapper.style.aspectRatio).toBe(stacked ? 'var(--card-photo-frame-ratio, 1)' : '');
            expect(wrapper.style.getPropertyValue(property)).toBe('0.8');
            disposeCardResources(fresh);
        }
        disposeCardResources(wrapper);
    });
    it('keeps main\'s presentation on a typed raster logo without projecting its stored ratio', () => {
        const setProperty = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty');
        const wrapper = createImageElement('/storage/logo.jpg', true, {
            renderSlot: 'card_media', imageTypeId: 1,
            imageMetadata: { logo_variant: 'mark', logo_render_mode: 'image', ...metadata('logo.jpg') },
        });
        const image = wrapper.querySelector('img');
        expect(wrapper.classList.contains('service_catalog_logo_frame')).toBe(true);
        expect(wrapper.classList.contains('card_photo_presentation')).toBe(true);
        expect(image.style.getPropertyValue('object-fit')).toBe('var(--card-photo-object-fit, contain)');
        expect(setProperty).toHaveBeenCalledWith('object-fit', 'var(--card-photo-object-fit, contain)', 'important');
        expect(wrapper.style.backgroundColor).toBe('var(--bg_color)');
        expect(wrapper.style.getPropertyValue(property)).toBe('');
        disposeCardResources(wrapper);
    });
    it.each([
        ['raster photo', {}, true],
        ['typed raster logo', { imageTypeId: 1,
            imageMetadata: { logo_variant: 'mark', logo_render_mode: 'image' } }, false],
    ])('only follows the stored shape for an eligible frame: %s', (_, options, expected) => {
        const wrapper = createImageElement('/storage/image.jpg', true, { renderSlot: 'card_media', ...options });
        expect(wrapper.classList.contains('card_photo_presentation')).toBe(true);
        expect(cardImageFrameFollowsStoredShape(wrapper)).toBe(expected);
        disposeCardResources(wrapper);
    });
    it('leaves a typed raster logo\'s inline frame untouched during resize', () => {
        vi.stubGlobal('innerWidth', 1600);
        const wrapper = createImageElement('/storage/logo.jpg', true, {
            renderSlot: 'card_media', imageTypeId: 1,
            imageMetadata: { logo_variant: 'mark', logo_render_mode: 'image', ...metadata('logo.jpg') },
        });
        const slot = document.createElement('div');
        slot.classList.add('card_image');
        slot.append(wrapper);
        document.body.append(slot);
        const setters = ['width', 'height', 'maxWidth', 'aspectRatio']
            .map(name => vi.spyOn(wrapper.style, name, 'set'));
        const initialStyle = wrapper.style.cssText;
        try {
            for (const width of [390, 768, 1440, 1600]) {
                vi.stubGlobal('innerWidth', width);
                updateCardImageSources();
                expect(wrapper.style.cssText).toBe(initialStyle);
                expect(wrapper.style.getPropertyValue(property)).toBe('');
            }
            setters.forEach(setter => expect(setter).not.toHaveBeenCalled());
        } finally {
            slot.remove();
            disposeCardResources(wrapper);
        }
    });
    it.each([[1200, 675, 16 / 9], [675, 1000, 0.8], [800, 1000, 0.8],
        [900, 1000, 0.9], [800, 800, 1], [1500, 500, 3], [500, 1500, 0.8]])(
        'resolves %s × %s to %s', (width, height, ratio) => {
            expect(resolveCardPhotoFrameRatio(width, height)).toBe(ratio);
        },
    );
    it.each([0, -1, NaN, Infinity, -Infinity, undefined, null, '800'])(
        'rejects invalid stored dimensions %s on either axis', invalid => {
            for (const size of [{ width_px: invalid, height_px: 800 }, { width_px: 800, height_px: invalid }]) {
                const imageMetadata = { displayed_image_size: { file: 'invalid.png', ...size } };
                const { wrapper, image } = prepare('/storage/invalid.png', { imageMetadata });
                expect(resolveStoredCardPhotoFrameRatio(image, imageMetadata)).toBeNull();
                expect(wrapper.style.getPropertyValue(property)).toBe('');
                disposeCardResources(wrapper);
            }
            expect(resolveCardPhotoFrameRatio(invalid, 800)).toBeNull();
            expect(resolveCardPhotoFrameRatio(800, invalid)).toBeNull();
        },
    );
    for (const format of ['object', 'JSON']) {
        it.each([[1200, 675, 16 / 9], [500, 1500, 0.8], [800, 800, 1]])(
            `builds %s × %s at ratio %s from matching ${format} metadata before loading or mounting`, (width, height, ratio) => {
                const stored = metadata('first-paint.png', width, height);
                vi.stubGlobal('innerWidth', 768);
                const wrapper = createImageElement('/storage/1000/first-paint.png?variant=2#photo', true,
                    { renderSlot: 'card_media', imageMetadata: format === 'JSON' ? JSON.stringify(stored) : stored });
                const image = wrapper.querySelector('img');
                expect(wrapper.isConnected).toBe(false);
                expect(image.complete).toBe(false);
                expect(image.naturalWidth).toBe(0);
                expect(wrapper.style.aspectRatio).toBe('var(--card-photo-frame-ratio, 1)');
                expect(Number(wrapper.style.getPropertyValue(property))).toBe(ratio);
                disposeCardResources(wrapper);
            },
        );
    }
    it.each([undefined, null, {}, [], true, 42, '', '{malformed', 'null', '[]', '42',
        { displayed_image_size: null }, { displayed_image_size: [] },
        { displayed_image_size: { width_px: 1200, height_px: 675 } },
        metadata('stale.png'), JSON.stringify(metadata('stale.png')),
        metadata('invalid.png', 1, 800), metadata('invalid.png', 1e300, 1e300),
        metadata('/storage/invalid.png'), metadata('invalid.png', Number.MAX_VALUE, Number.MIN_VALUE)])(
        'leaves malformed, missing or stale metadata unset: %j', imageMetadata => {
            const { wrapper, image } = prepare('/storage/invalid.png', { imageMetadata, width: 1200, height: 675, complete: true });
            expect(resolveStoredCardPhotoFrameRatio(image, imageMetadata)).toBeNull();
            expect(wrapper.style.getPropertyValue(property)).toBe('');
            disposeCardResources(wrapper);
        },
    );
    it.each([undefined, metadata('events.png'), metadata('stale.png')])(
        'never writes or removes the built ratio on load or error: %j', imageMetadata => {
            const { wrapper, image } = prepare('/storage/300/events.png', { imageMetadata });
            const initialRatio = wrapper.style.getPropertyValue(property);
            const setProperty = vi.spyOn(wrapper.style, 'setProperty');
            const removeProperty = vi.spyOn(wrapper.style, 'removeProperty');
            Object.defineProperties(image, { naturalWidth: { value: 500 }, naturalHeight: { value: 1500 } });
            image.src = '/storage/1000/events.png';
            for (const event of ['load', 'error', 'load']) {
                image.dispatchEvent(new Event(event));
                expect(wrapper.style.getPropertyValue(property)).toBe(initialRatio);
            }
            expect(setProperty.mock.calls.filter(([name]) => name === property)).toEqual([]);
            expect(removeProperty.mock.calls.filter(([name]) => name === property)).toEqual([]);
            disposeCardResources(wrapper);
        },
    );
    it('does not learn a ratio from a complete image or another wrapper of the same file', () => {
        const known = prepare('/storage/300/no-cache.png', { imageMetadata: metadata('no-cache.png'),
            width: 1200, height: 675, complete: true });
        const missing = prepare('/storage/1000/no-cache.png', { width: 1200, height: 675, complete: true });
        expect(missing.wrapper.style.getPropertyValue(property)).toBe('');
        disposeCardResources(known.wrapper);
        disposeCardResources(missing.wrapper);
    });
    it('does not restore a revoked projection from late image events', () => {
        const { wrapper, image } = prepare('/storage/revoked.png', { imageMetadata: metadata('revoked.png') });
        clearAppearanceProjections(wrapper);
        for (const event of ['load', 'error']) {
            image.dispatchEvent(new Event(event));
            expect(wrapper.style.getPropertyValue(property)).toBe('');
        }
        disposeCardResources(wrapper);
    });
    it('restores the original stored geometry with an explicit appearance repaint after cleanup', () => {
        const imageMetadata = metadata('repaint.png');
        const { wrapper, image } = prepare('/storage/repaint.png', { imageMetadata });
        clearAppearanceProjections(wrapper);
        expect(wrapper.style.getPropertyValue(property)).toBe('');
        imageMetadata.displayed_image_size.width_px = 500;
        image.dispatchEvent(new Event('error'));
        wrapper._refreshImagePresentation();
        expect(Number(wrapper.style.getPropertyValue(property))).toBe(16 / 9);
        disposeCardResources(wrapper);
    });
    it.each([
        ['SVG', '/storage/mark.svg', { renderSlot: 'card_media' }],
        ['contrast frame', '/storage/contrast.svg', { renderSlot: 'card_media' }],
        ['logo', '/storage/service_catalog_logos/mark.svg', { renderSlot: 'card_media' }],
        ['typed raster logo', '/storage/logo.png', { renderSlot: 'card_media', imageTypeId: 1,
            imageMetadata: { logo_variant: 'mark', logo_render_mode: 'image' } }],
        ['avatar slot', '/storage/photo.jpg', { renderSlot: 'standalone' }],
        ['external slot', '/storage/photo.jpg', { renderSlot: 'image_first' }],
    ])('does not project a stored ratio onto %s', (_, source, options) => {
        const file = source.split('/').pop();
        const wrapper = createImageElement(source, true, { ...options,
            imageMetadata: { ...options.imageMetadata, ...metadata(file) } });
        wrapper.querySelectorAll('img').forEach(image => {
            Object.defineProperties(image, { naturalWidth: { value: 1200 }, naturalHeight: { value: 675 } });
            image.dispatchEvent(new Event('load'));
        });
        expect(wrapper.style.getPropertyValue(property)).toBe('');
        disposeCardResources(wrapper);
    });
});
