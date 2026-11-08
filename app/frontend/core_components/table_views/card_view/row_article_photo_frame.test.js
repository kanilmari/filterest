// @vitest-environment jsdom
// row_article_photo_frame.test.js
// Exercise the real article media builder before decode, after load and from cache.
// The ordinary card and the independent gallery/IFAV/logo renderers keep their own frames.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createImageElement } from './card_avatar_builder.js';
import { disposeCardResources } from './card_resource_lifecycle.js';
import { CARD_IMAGE_RENDER_SLOTS as slots } from './card_image_render_options.js';

const prop = '--row-article-photo-ratio';
const filename = 'sample.jpg';
const metadata = (width_px, height_px, file = filename) => ({
    displayed_image_size: { file, width_px, height_px },
});
const frame = (options = {}) => createImageElement('/storage/1000/' + filename, true, {
    renderSlot: slots.ROW_ARTICLE_INLINE, ...options,
});
function loadPhoto(wrapper, width, height) {
    const img = wrapper.querySelector('img');
    Object.defineProperties(img, { naturalWidth: { value: width }, naturalHeight: { value: height } });
    img.dispatchEvent(new Event('load'));
}

describe('ordinary article photo frame', () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

    for (const viewport of [390, 1600]) {
        describe(`at ${viewport}px`, () => {
            it.each([[1280, 853], [450, 1200]])('uses the decoded %s × %s photo without a square placeholder', (w, h) => {
                vi.stubGlobal('innerWidth', viewport);
                const wrapper = frame();
                expect(wrapper.style.aspectRatio).toBe('');
                expect(wrapper.style.height).toBe('');
                expect(wrapper.style.getPropertyValue(prop)).toBe('');
                loadPhoto(wrapper, w, h);
                expect(Number(wrapper.style.getPropertyValue(prop))).toBe(w / h);
            });
            it.each([[1280, 853], [450, 1200]])('reserves the exact stored %s × %s shape before loading', (w, h) => {
                vi.stubGlobal('innerWidth', viewport);
                const wrapper = frame({ imageMetadata: JSON.stringify(metadata(w, h)) });
                expect(wrapper.querySelector('img').complete).toBe(false);
                expect(Number(wrapper.style.getPropertyValue(prop))).toBe(w / h);
            });
        });
    }

    it('uses an already cached legacy image without waiting for another load', () => {
        vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
        vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(300);
        vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(1200);
        expect(frame().style.getPropertyValue(prop)).toBe('0.25');
    });

    it.each([[1e-300, 800], [800, 1e-300], [1e300, 1e300], [1600.5, 900],
        [65536, 65536], [330, 10], [10, 330]])(
        'uses decoded geometry when the stored dimensions are %s × %s', (width, height) => {
            const wrapper = frame({ imageMetadata: metadata(width, height) });
            expect(wrapper.style.getPropertyValue(prop)).toBe('');
            loadPhoto(wrapper, 1200, 800);
            expect(wrapper.style.getPropertyValue(prop)).toBe('1.5');
        },
    );

    it.each([[65535, 65535], [320, 10], [10, 320]])(
        'accepts a stored photo at the size or aspect limit: %s × %s', (width, height) => {
            const wrapper = frame({ imageMetadata: metadata(width, height) });
            expect(Number(wrapper.style.getPropertyValue(prop))).toBe(width / height);
        },
    );

    it('ignores metadata for a different photo and releases the pending load on disposal', () => {
        const wrapper = frame({ imageMetadata: metadata(1600, 400, 'other.jpg') });
        expect(wrapper.style.getPropertyValue(prop)).toBe('');
        disposeCardResources(wrapper);
        loadPhoto(wrapper, 450, 1200);
        expect(wrapper.style.getPropertyValue(prop)).toBe('');
    });

    it('keeps an unsized stacked card square even after its photo loads', () => {
        vi.stubGlobal('innerWidth', 390);
        const wrapper = frame({ renderSlot: slots.CARD_MEDIA });
        loadPhoto(wrapper, 450, 1200);
        expect(wrapper.classList.contains('card_photo_presentation')).toBe(true);
        expect(wrapper.style.aspectRatio).toBe('var(--card-photo-frame-ratio, 1)');
        expect(wrapper.style.getPropertyValue('--card-photo-frame-ratio')).toBe('');
        expect(wrapper.style.getPropertyValue(prop)).toBe('');
    });

    it.each([slots.ROW_ARTICLE_GALLERY_THUMBNAIL, slots.IMAGE_FIRST])('leaves %s externally sized', renderSlot => {
        const wrapper = frame({ renderSlot, imageMetadata: metadata(1200, 800) });
        expect(wrapper.classList.contains('record_image_presentation_host--externally-sized')).toBe(true);
        expect(wrapper.style.getPropertyValue(prop)).toBe('');
    });

    it('preserves the dedicated article logo renderer', () => {
        const wrapper = frame({ imageMimeType: 'image/svg+xml', imageMetadata: metadata(1200, 800) });
        expect(wrapper.classList.contains('record_svg_image_frame')).toBe(true);
        expect(wrapper.classList.contains('row_article_photo_frame')).toBe(false);
    });
});
