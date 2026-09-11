// @vitest-environment jsdom
// Verifies presentation choices and the boundary around ordinary card photos.
// Connects the real image builder with shared site settings.
// Prevents a card default from cropping article media, thumbnails or SVG logos.
import { afterEach, describe, expect, it } from 'vitest';
import { createImageElement } from './card_avatar_builder.js';
import {
    applyCardImagePresentationSetting,
    normalizeCardImagePresentation,
} from './card_image_presentation.js';

afterEach(() => {
    document.documentElement.removeAttribute('data-card-image-presentation');
});

describe('card photo presentation', () => {
    it.each(['cover', 'contain', 'contain_blur'])('accepts the %s mode', (mode) => {
        applyCardImagePresentationSetting(mode);
        expect(document.documentElement.dataset.cardImagePresentation).toBe(mode);
    });
    it.each([undefined, null, '', 'unsafe-mode'])('uses the complete image for an unknown mode %s', (mode) => {
        expect(normalizeCardImagePresentation(mode)).toBe('contain');
    });
    it('decorates only one accessible photo and follows image load/error changes', () => {
        const wrapper = createImageElement('/storage/photo.jpg', true, { renderSlot: 'card_media' });
        const image = wrapper.querySelector('img');
        expect(wrapper.classList.contains('card_photo_presentation')).toBe(true);
        expect(wrapper.querySelectorAll('img')).toHaveLength(1);
        expect(image.getAttribute('aria-hidden')).toBeNull();
        expect(image.alt).toBeTruthy();
        expect(wrapper.style.getPropertyValue('--card-photo-source')).toContain('/storage/photo.jpg');
        image.src = '/storage/large/photo.jpg';
        image.dispatchEvent(new Event('load'));
        expect(wrapper.style.getPropertyValue('--card-photo-source')).toContain('/storage/large/photo.jpg');
        image.dispatchEvent(new Event('error'));
        expect(wrapper.style.getPropertyValue('--card-photo-source')).toBe('');
    });
    it.each(['small_thumbnail', 'row_article_inline', 'row_article_gallery_thumbnail', 'image_first', 'standalone'])(
        'does not change the %s slot', (renderSlot) => {
            const wrapper = createImageElement('/storage/photo.jpg', true, { renderSlot });
            expect(wrapper.classList.contains('card_photo_presentation')).toBe(false);
            expect(wrapper.querySelector('img').style.objectFit).toBe('contain');
            expect(wrapper.style.getPropertyValue('--card-photo-source')).toBe('');
        },
    );
    it('keeps SVG logos on their composed presentation', () => {
        const wrapper = createImageElement('/storage/mark.svg', true, { renderSlot: 'card_media', rowLabel: 'Mark' });
        expect(wrapper.classList.contains('card_photo_presentation')).toBe(false);
        expect(wrapper.querySelector('.record_svg_image_presentation')).not.toBeNull();
        expect(wrapper.querySelectorAll('img')).toHaveLength(1);
    });
});
