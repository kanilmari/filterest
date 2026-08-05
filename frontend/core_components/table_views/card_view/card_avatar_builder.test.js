// @vitest-environment jsdom
// card_avatar_builder.test.js
// Verifies card image DOM styling stays consistent across media formats.
// Bridges createImageElement and jsdom style assertions for card media wrappers.
// Exists to prevent square image corners from leaking through rounded cards.

import { describe, expect, test } from 'vitest';

import { createImageElement } from './card_avatar_builder.js';
import { CARD_IMAGE_RENDER_SLOTS } from './card_image_render_options.js';

describe('createImageElement', () => {
    test('rounds and clips PNG images without adding non-PNG effects', () => {
        const wrapper = createImageElement('/storage/example.png', true, {
            tableName: 'app_service_catalog',
            rowLabel: 'Example',
        });
        const image = wrapper.querySelector('img');

        expect(wrapper.style.overflow).toBe('hidden');
        expect(wrapper.style.borderRadius).toBe('7px');
        expect(wrapper.style.boxShadow).toBe('');
        expect(image?.style.borderRadius).toBe('6px');
    });

    test.each([
        ['/storage/104/6005/300/104_6005_7005.svg', 'firefox', 'Firefox'],
        ['/storage/104/6007/300/104_6007_7007.svg', 'thunderbird', 'Thunderbird'],
        ['/storage/104/6008/300/104_6008_7008.svg', 'wikipedia', 'Wikipedia'],
        ['/storage/104/6009/300/104_6009_7009.svg', 'openstreetmap', 'OpenStreetMap'],
    ])('renders typed service-catalog icon asset %s with the CSS renderer', (
        imagePath,
        expectedVariant,
        rowLabel
    ) => {
        const wrapper = createImageElement(imagePath, true, {
            tableName: 'app_service_catalog',
            rowLabel,
            imageTypeId: 1,
            imageMetadata: JSON.stringify({ logo_variant: expectedVariant }),
        });
        const image = wrapper.querySelector('img');
        const cssLogo = wrapper.querySelector('.service-catalog-css-logo');
        const logoMark = cssLogo?.querySelector('.service-catalog-css-logo__mark');
        const logoTitle = cssLogo?.querySelector('.service-catalog-css-logo__title');

        expect(wrapper.dataset.serviceCatalogLogoRenderMode).toBe('css');
        expect(wrapper.dataset.serviceCatalogLogoVariant).toBe(expectedVariant);
        expect(wrapper.dataset.serviceCatalogLogoPresentation).toBe('mark-title');
        expect(wrapper.dataset.serviceCatalogLogoShowLabel).toBe('true');
        expect(wrapper.querySelectorAll('img')).toHaveLength(1);
        expect(image?.classList.contains('service-catalog-css-logo__mark')).toBe(true);
        expect(image?.hidden).toBe(false);
        expect(cssLogo?.getAttribute('aria-label')).toBe(rowLabel);
        expect(cssLogo?.classList.contains('service-catalog-css-logo--mark-title')).toBe(true);
        expect(cssLogo?.classList.contains(`service-catalog-css-logo--${expectedVariant}`)).toBe(true);
        expect(logoMark?.getAttribute('aria-hidden')).toBe('true');
        expect(logoMark?.getAttribute('src')).toBe(imagePath);
        expect(logoTitle?.textContent).toBe(rowLabel);
        expect(logoTitle?.style.getPropertyValue('--service-logo-title-length')).toBe(String(rowLabel.length));
    });

    test('frames normal service-catalog images without invoking the CSS icon renderer', () => {
        const imagePath = '/storage/104/6169/300/104_6169_7169.svg';
        const wrapper = createImageElement(imagePath, true, {
            tableName: 'app_service_catalog',
            rowLabel: 'Kanto Lab',
            renderSlot: CARD_IMAGE_RENDER_SLOTS.CARD_MEDIA,
        });
        const image = wrapper.querySelector('img');

        expect(wrapper.classList.contains('service_catalog_logo_frame')).toBe(true);
        expect(wrapper.classList.contains('service_catalog_logo_frame--contrast-safe')).toBe(true);
        expect(wrapper.dataset.serviceCatalogLogoRenderMode).toBe('image');
        expect(wrapper.dataset.serviceCatalogLogoKind).toBe('standalone');
        expect(wrapper.querySelector('.service-catalog-css-logo')).toBeNull();
        expect(image?.getAttribute('src')).toBe(imagePath);
    });

    test('classifies service-catalog JPG media as a full image logo frame', () => {
        const imagePath = '/storage/104/6169/300/104_6169_7169.jpg';
        const wrapper = createImageElement(imagePath, true, {
            tableName: 'app_service_catalog',
            rowLabel: 'Kanto Lab',
            renderSlot: CARD_IMAGE_RENDER_SLOTS.CARD_MEDIA,
        });

        expect(wrapper.dataset.serviceCatalogLogoRenderMode).toBe('image');
        expect(wrapper.dataset.serviceCatalogLogoKind).toBe('image');
        expect(wrapper.querySelector('img')?.getAttribute('src')).toBe(imagePath);
    });

    test.each([
        ['/storage/service_catalog_logos/firefox.svg', 'firefox', 'Firefox', 'Fx'],
        ['service_catalog_logos/openstreetmap.svg', 'openstreetmap', 'OpenStreetMap', 'OSM'],
        ['/storage/service_catalog_logos/wikipedia.svg', 'wikipedia', 'Wikipedia', 'W', 'service_catalog'],
    ])('renders legacy service-catalog logo path %s without fetching the old file', (
        imagePath,
        expectedVariant,
        rowLabel,
        expectedMarkText,
        tableName = 'app_service_catalog'
    ) => {
        const wrapper = createImageElement(imagePath, true, {
            tableName,
            rowLabel,
        });
        const cssLogo = wrapper.querySelector('.service-catalog-css-logo');
        const logoMark = cssLogo?.querySelector('.service-catalog-css-logo__mark');

        expect(wrapper.dataset.serviceCatalogLogoRenderMode).toBe('css');
        expect(wrapper.dataset.serviceCatalogLogoKind).toBe('css');
        expect(wrapper.dataset.serviceCatalogLogoVariant).toBe(expectedVariant);
        expect(cssLogo?.getAttribute('aria-label')).toBe(rowLabel);
        expect(logoMark?.tagName).toBe('SPAN');
        expect(logoMark?.textContent).toBe(expectedMarkText);
        expect(wrapper.querySelector(`img[src="${imagePath}"]`)).toBeNull();
        expect(wrapper.querySelector('img')).toBeNull();
    });

    test('renders legacy Matrix logo paths as normal images', () => {
        const imagePath = '/storage/service_catalog_logos/matrix.svg';
        const wrapper = createImageElement(imagePath, true, {
            tableName: 'app_service_catalog',
            rowLabel: 'Matrix',
        });
        const image = wrapper.querySelector('img');

        expect(wrapper.dataset.serviceCatalogLogoRenderMode).toBe('image');
        expect(wrapper.dataset.serviceCatalogLogoKind).toBe('standalone');
        expect(wrapper.querySelector('.service-catalog-css-logo')).toBeNull();
        expect(image?.getAttribute('src')).toBe(imagePath);
    });

    test('renders typed service-catalog logo image with a label in card media slots by default', () => {
        const wrapper = createImageElement('/storage/104/6005/300/104_6005_7005.svg', true, {
            tableName: 'app_service_catalog',
            rowLabel: 'Firefox',
            renderSlot: CARD_IMAGE_RENDER_SLOTS.CARD_MEDIA,
            imageTypeId: 1,
            imageMetadata: JSON.stringify({ logo_variant: 'firefox' }),
        });
        const cssLogo = wrapper.querySelector('.service-catalog-css-logo');
        const logoMark = cssLogo?.querySelector('.service-catalog-css-logo__mark');
        const logoTitle = cssLogo?.querySelector('.service-catalog-css-logo__title');

        expect(wrapper.dataset.serviceCatalogLogoPresentation).toBe('mark-title');
        expect(wrapper.dataset.serviceCatalogLogoShowLabel).toBe('true');
        expect(wrapper.dataset.serviceCatalogLogoSlot).toBe(CARD_IMAGE_RENDER_SLOTS.CARD_MEDIA);
        expect(wrapper.querySelectorAll('img')).toHaveLength(1);
        expect(cssLogo?.classList.contains('service-catalog-css-logo--mark-title')).toBe(true);
        expect(logoMark?.tagName).toBe('IMG');
        expect(logoMark?.getAttribute('src')).toBe('/storage/104/6005/300/104_6005_7005.svg');
        expect(logoTitle?.textContent).toBe('Firefox');
        expect(logoTitle?.style.getPropertyValue('--service-logo-title-length')).toBe('7');
    });

    test('renders typed service-catalog logo image as mark-only in small thumbnail slots', () => {
        const wrapper = createImageElement('/storage/104/6005/300/104_6005_7005.svg', true, {
            tableName: 'app_service_catalog',
            rowLabel: 'Firefox',
            renderSlot: CARD_IMAGE_RENDER_SLOTS.SMALL_THUMBNAIL,
            imageTypeId: 1,
            imageMetadata: JSON.stringify({ logo_variant: 'firefox' }),
        });
        const cssLogo = wrapper.querySelector('.service-catalog-css-logo');
        const logoMark = cssLogo?.querySelector('.service-catalog-css-logo__mark');

        expect(wrapper.dataset.serviceCatalogLogoPresentation).toBe('mark-only');
        expect(wrapper.dataset.serviceCatalogLogoShowLabel).toBe('false');
        expect(wrapper.querySelectorAll('img')).toHaveLength(1);
        expect(cssLogo?.classList.contains('service-catalog-css-logo--mark-only')).toBe(true);
        expect(logoMark?.tagName).toBe('IMG');
        expect(logoMark?.getAttribute('src')).toBe('/storage/104/6005/300/104_6005_7005.svg');
        expect(cssLogo?.querySelector('.service-catalog-css-logo__title')).toBeNull();
    });

    test('renders typed service-catalog logo image with a label in row article media slots', () => {
        const wrapper = createImageElement('/storage/104/6008/300/104_6008_7008.svg', true, {
            tableName: 'app_service_catalog',
            rowLabel: 'Wikipedia',
            renderSlot: CARD_IMAGE_RENDER_SLOTS.ROW_ARTICLE_INLINE,
            imageTypeId: 1,
            imageMetadata: JSON.stringify({ logo_variant: 'wikipedia' }),
        });
        const cssLogo = wrapper.querySelector('.service-catalog-css-logo');
        const logoMark = cssLogo?.querySelector('.service-catalog-css-logo__mark');
        const logoTitle = cssLogo?.querySelector('.service-catalog-css-logo__title');

        expect(wrapper.dataset.serviceCatalogLogoPresentation).toBe('mark-title');
        expect(wrapper.dataset.serviceCatalogLogoShowLabel).toBe('true');
        expect(wrapper.dataset.serviceCatalogLogoSlot).toBe(CARD_IMAGE_RENDER_SLOTS.ROW_ARTICLE_INLINE);
        expect(cssLogo?.classList.contains('service-catalog-css-logo--mark-title')).toBe(true);
        expect(logoMark?.tagName).toBe('IMG');
        expect(logoTitle?.textContent).toBe('Wikipedia');
        expect(logoTitle?.style.getPropertyValue('--service-logo-title-length')).toBe('9');
    });

    test('renders Matrix as a normal image instead of a CSS-assisted wordmark', () => {
        const imagePath = '/storage/104/6010/300/104_6010_7010.svg';
        const wrapper = createImageElement('/storage/104/6010/300/104_6010_7010.svg', true, {
            tableName: 'app_service_catalog',
            rowLabel: 'Matrix',
            renderSlot: CARD_IMAGE_RENDER_SLOTS.CARD_MEDIA,
            imageTypeId: 1,
            imageMetadata: JSON.stringify({ logo_variant: 'matrix' }),
        });
        const image = wrapper.querySelector('img');

        expect(wrapper.dataset.serviceCatalogLogoRenderMode).toBe('image');
        expect(wrapper.dataset.serviceCatalogLogoKind).toBe('standalone');
        expect(wrapper.dataset.serviceCatalogLogoVariant).toBeUndefined();
        expect(wrapper.querySelector('.service-catalog-css-logo')).toBeNull();
        expect(image?.getAttribute('src')).toBe(imagePath);
        expect(image?.classList.contains('service-catalog-css-logo__mark')).toBe(false);
    });

    test('honors metadata that hides a normally labeled CSS logo', () => {
        const wrapper = createImageElement('/storage/104/6005/300/104_6005_7005.svg', true, {
            tableName: 'app_service_catalog',
            rowLabel: 'Firefox',
            renderSlot: CARD_IMAGE_RENDER_SLOTS.CARD_MEDIA,
            imageTypeId: 1,
            imageMetadata: JSON.stringify({ logo_variant: 'firefox', logo_show_label: false }),
        });

        expect(wrapper.dataset.serviceCatalogLogoPresentation).toBe('mark-only');
        expect(wrapper.dataset.serviceCatalogLogoShowLabel).toBe('false');
        expect(wrapper.querySelector('.service-catalog-css-logo__title')).toBeNull();
    });

    test('keeps Matrix image-only even when metadata asks for a label', () => {
        const imagePath = '/storage/104/6010/300/104_6010_7010.svg';
        const wrapper = createImageElement('/storage/104/6010/300/104_6010_7010.svg', true, {
            tableName: 'app_service_catalog',
            rowLabel: 'Matrix',
            renderSlot: CARD_IMAGE_RENDER_SLOTS.CARD_MEDIA,
            imageTypeId: 1,
            imageMetadata: JSON.stringify({ logo_variant: 'matrix', logo_show_label: true }),
        });
        const image = wrapper.querySelector('img');

        expect(wrapper.dataset.serviceCatalogLogoRenderMode).toBe('image');
        expect(wrapper.dataset.serviceCatalogLogoKind).toBe('standalone');
        expect(wrapper.querySelector('.service-catalog-css-logo')).toBeNull();
        expect(image?.getAttribute('src')).toBe(imagePath);
    });

    test('keeps Matrix image-only even when metadata asks for an image mark', () => {
        const imagePath = '/storage/104/6010/300/104_6010_7010.svg';
        const wrapper = createImageElement(imagePath, true, {
            tableName: 'app_service_catalog',
            rowLabel: 'Matrix',
            renderSlot: CARD_IMAGE_RENDER_SLOTS.CARD_MEDIA,
            imageTypeId: 1,
            imageMetadata: JSON.stringify({
                logo_variant: 'matrix',
                logo_mark_mode: 'image',
            }),
        });
        const image = wrapper.querySelector('img');

        expect(wrapper.dataset.serviceCatalogLogoRenderMode).toBe('image');
        expect(wrapper.dataset.serviceCatalogLogoKind).toBe('standalone');
        expect(image?.getAttribute('src')).toBe(imagePath);
        expect(wrapper.querySelector('.service-catalog-css-logo__title')).toBeNull();
    });

    test('honors metadata that opts a typed asset back into normal image rendering', () => {
        const imagePath = '/storage/104/6005/300/104_6005_7005.svg';
        const wrapper = createImageElement(imagePath, true, {
            tableName: 'app_service_catalog',
            rowLabel: 'Firefox',
            renderSlot: CARD_IMAGE_RENDER_SLOTS.CARD_MEDIA,
            imageTypeId: 1,
            imageMetadata: JSON.stringify({
                logo_variant: 'firefox',
                logo_render_mode: 'normal_image',
            }),
        });
        const image = wrapper.querySelector('img');

        expect(wrapper.querySelector('.service-catalog-css-logo')).toBeNull();
        expect(wrapper.dataset.serviceCatalogLogoRenderMode).toBe('image');
        expect(image?.getAttribute('src')).toBe(imagePath);
        expect(image?.classList.contains('service-catalog-css-logo__mark')).toBe(false);
    });
});
