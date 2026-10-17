// @vitest-environment jsdom
// card_avatar_builder.test.js
// Verifies generic card media and metadata-driven logo presentation.
// Bridges createImageElement and jsdom assertions for card media wrappers.
// Keeps asset metadata authoritative while preserving ordinary image defaults.

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

    test('uses the shared framed mark-and-label presentation for ordinary SVG media', () => {
        const wrapper = createImageElement('/storage/77/88/300/vendor.svg?rev=2', true, {
            tableName: 'app_vendors',
            rowLabel: 'Vendor name',
            renderSlot: CARD_IMAGE_RENDER_SLOTS.CARD_MEDIA,
        });

        expect(wrapper.dataset.imagePresentationKind).toBe('svg-logo');
        expect(wrapper.classList.contains('record_svg_image_frame')).toBe(true);
        expect(wrapper.querySelector('.record_svg_image_presentation__mark')?.getAttribute('src'))
            .toContain('/storage/77/88/300/vendor.svg?rev=2');
        expect(wrapper.querySelector('.record_svg_image_presentation__label')?.textContent)
            .toBe('Vendor name');
    });

    test('keeps raster media on the existing plain image path', () => {
        const wrapper = createImageElement('/storage/77/88/300/photo.webp', true, {
            tableName: 'app_vendors',
            rowLabel: 'Vendor name',
        });

        expect(wrapper.dataset.imagePresentationKind).toBe('raster');
        expect(wrapper.querySelector('.record_svg_image_presentation')).toBeNull();
        expect(wrapper.querySelector('img')?.getAttribute('src'))
            .toBe('/storage/77/88/300/photo.webp');
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
        expect(cssLogo?.classList.contains('record_image_logo_presentation')).toBe(true);
        expect(cssLogo?.classList.contains('service-catalog-css-logo--mark-title')).toBe(true);
        expect(cssLogo?.classList.contains(`service-catalog-css-logo--${expectedVariant}`)).toBe(true);
        expect(logoMark?.getAttribute('aria-hidden')).toBe('true');
        expect(logoMark?.classList.contains('record_image_logo_presentation__mark')).toBe(true);
        expect(logoMark?.getAttribute('src')).toBe(imagePath);
        expect(logoTitle?.textContent).toBe(rowLabel);
        expect(logoTitle?.classList.contains('record_image_logo_presentation__label')).toBe(true);
        expect(logoTitle?.style.getPropertyValue('--service-logo-title-length')).toBe(String(rowLabel.length));
    });

    test.each(['app_service_catalog', 'service_catalog', 'ordinary_dataset'])(
        'uses shared SVG and raster presentation for untyped media in %s', (tableName) => {
            const imagePath = '/storage/104/6169/300/104_6169_7169.svg';
            const wrapper = createImageElement(imagePath, true, {
                tableName, rowLabel: 'Kanto Lab', renderSlot: CARD_IMAGE_RENDER_SLOTS.CARD_MEDIA,
            });
            expect(wrapper.classList.contains('service_catalog_logo_frame')).toBe(false);
            expect(wrapper.classList.contains('record_svg_image_frame')).toBe(true);
            expect(wrapper.querySelector('.service-catalog-css-logo')).toBeNull();
            expect(wrapper.querySelector('img')?.getAttribute('src')).toBe(imagePath);

            const photo = createImageElement('/storage/photo.jpg', true, {
                tableName, rowLabel: 'Photo', renderSlot: CARD_IMAGE_RENDER_SLOTS.CARD_MEDIA,
            });
            expect(photo.classList.contains('service_catalog_logo_frame')).toBe(false);
            expect(photo.dataset.imagePresentationKind).toBe('raster');
            expect(photo.querySelector('img')?.getAttribute('src')).toBe('/storage/photo.jpg');
        }
    );

    test.each([
        ['/storage/service_catalog_logos/firefox.svg', 'firefox', 'Firefox', 'FI'],
        ['service_catalog_logos/openstreetmap.svg', 'openstreetmap', 'OpenStreetMap', 'OP'],
        ['/storage/service_catalog_logos/wikipedia.svg', 'wikipedia', 'Wikipedia', 'WI', 'service_catalog'],
        ['/storage/service_catalog_logos/matrix.svg', 'matrix', 'Matrix', 'MA'],
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

    test('renders typed service-catalog logo image with its name in small thumbnail slots', () => {
        const wrapper = createImageElement('/storage/104/6005/300/104_6005_7005.svg', true, {
            tableName: 'app_service_catalog',
            rowLabel: 'Firefox',
            renderSlot: CARD_IMAGE_RENDER_SLOTS.SMALL_THUMBNAIL,
            imageTypeId: 1,
            imageMetadata: JSON.stringify({ logo_variant: 'firefox' }),
        });
        const cssLogo = wrapper.querySelector('.service-catalog-css-logo');
        const logoMark = cssLogo?.querySelector('.service-catalog-css-logo__mark');

        expect(wrapper.dataset.serviceCatalogLogoPresentation).toBe('mark-title');
        expect(wrapper.dataset.serviceCatalogLogoShowLabel).toBe('true');
        expect(wrapper.querySelectorAll('img')).toHaveLength(1);
        expect(cssLogo?.classList.contains('service-catalog-css-logo--mark-title')).toBe(true);
        expect(logoMark?.tagName).toBe('IMG');
        expect(logoMark?.getAttribute('src')).toBe('/storage/104/6005/300/104_6005_7005.svg');
        expect(cssLogo?.querySelector('.service-catalog-css-logo__title')?.textContent).toBe('Firefox');
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

    test('renders Matrix as a plain image when its row requests image rendering', () => {
        const imagePath = '/storage/104/6010/300/104_6010_7010.svg';
        const wrapper = createImageElement('/storage/104/6010/300/104_6010_7010.svg', true, {
            tableName: 'app_service_catalog',
            rowLabel: 'Matrix',
            renderSlot: CARD_IMAGE_RENDER_SLOTS.CARD_MEDIA,
            imageTypeId: 1,
            imageMetadata: JSON.stringify({
                logo_variant: 'matrix', logo_render_mode: 'image',
                logo_mark_mode: 'css_wordmark', logo_show_label: false,
            }),
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

    test('renders Matrix as a labelled CSS logo when its row requests css_logo', () => {
        const imagePath = '/storage/104/6010/300/104_6010_7010.svg';
        const wrapper = createImageElement('/storage/104/6010/300/104_6010_7010.svg', true, {
            tableName: 'app_service_catalog',
            rowLabel: 'Matrix',
            renderSlot: CARD_IMAGE_RENDER_SLOTS.CARD_MEDIA,
            imageTypeId: 1,
            imageMetadata: JSON.stringify({
                logo_variant: 'matrix', logo_render_mode: 'css_logo', logo_show_label: true,
            }),
        });
        const image = wrapper.querySelector('img');

        expect(wrapper.dataset.serviceCatalogLogoRenderMode).toBe('css');
        expect(wrapper.dataset.serviceCatalogLogoVariant).toBe('matrix');
        expect(wrapper.dataset.serviceCatalogLogoPresentation).toBe('mark-title');
        expect(wrapper.querySelector('.service-catalog-css-logo__title')?.textContent).toBe('Matrix');
        expect(image?.getAttribute('src')).toBe(imagePath);
    });

    test('renders Matrix as an unlabelled text mark when its row requests css_wordmark', () => {
        const imagePath = '/storage/104/6010/300/104_6010_7010.svg';
        const wrapper = createImageElement(imagePath, true, {
            tableName: 'app_service_catalog',
            rowLabel: 'Matrix',
            renderSlot: CARD_IMAGE_RENDER_SLOTS.CARD_MEDIA,
            imageTypeId: 1,
            imageMetadata: JSON.stringify({
                logo_variant: 'matrix',
                logo_render_mode: 'css_logo',
                logo_mark_mode: 'css_wordmark',
                logo_show_label: false,
            }),
        });
        expect(wrapper.dataset.serviceCatalogLogoRenderMode).toBe('css');
        expect(wrapper.dataset.serviceCatalogLogoPresentation).toBe('mark-only');
        expect(wrapper.querySelector('.service-catalog-css-logo__mark')?.textContent).toBe('MA');
        expect(wrapper.querySelector('img')).toBeNull();
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
    test.each(['app_service_catalog', 'service_catalog', 'ordinary_dataset'])(
        'selects typed and legacy logos from asset identity in %s', (tableName) => {
            for (const renderSlot of Object.values(CARD_IMAGE_RENDER_SLOTS)) {
                const wrapper = createImageElement('/storage/logo.svg', true, {
                    tableName, rowLabel: 'Firefox', renderSlot,
                    imageTypeId: 1, imageMetadata: { logo_variant: 'firefox', logo_show_label: false },
                });
                expect(wrapper.dataset.serviceCatalogLogoVariant).toBe('firefox');
                expect(wrapper.dataset.serviceCatalogLogoShowLabel).toBe('false');
                expect(wrapper.querySelector('img')?.getAttribute('src')).toBe('/storage/logo.svg');
            }
            const legacy = createImageElement('/storage/service_catalog_logos/firefox.svg', true, { tableName, rowLabel: 'Firefox' });
            expect(legacy.dataset.serviceCatalogLogoVariant).toBe('firefox');
            expect(legacy.querySelector('img')).toBeNull();
            expect(legacy.querySelector('.service-catalog-css-logo__mark')?.textContent).toBe('FI');
        }
    );

    test.each(['normal_image', 'image', 'asset_image'])(
        'preserves explicit %s presentation over the legacy filename fallback', (mode) => {
            const src = '/storage/service_catalog_logos/firefox.svg';
            const wrapper = createImageElement(src, true, {
                tableName: 'ordinary_dataset', rowLabel: 'Firefox', imageTypeId: 1,
                imageMetadata: { logo_variant: 'firefox', logo_render_mode: mode },
            });
            expect(wrapper.querySelector('.service-catalog-css-logo')).toBeNull();
            expect(wrapper.querySelector('img')?.getAttribute('src')).toBe(src);
        }
    );

    test('preserves typed image rendering over a different legacy name', () => {
        const src = '/storage/service_catalog_logos/firefox.svg';
        const wrapper = createImageElement(src, true, {
            tableName: 'ordinary_dataset', rowLabel: 'Matrix', imageTypeId: 1,
            imageMetadata: { logo_variant: 'matrix', logo_render_mode: 'image' },
        });
        expect(wrapper.querySelector('.service-catalog-css-logo')).toBeNull();
        expect(wrapper.querySelector('img')?.getAttribute('src')).toBe(src);
    });

    test.each([
        ['firefox', 'Fx', 'FI'],
        ['thunderbird', 'Tb', 'TH'],
        ['wikipedia', 'W', 'WI'],
        ['openstreetmap', 'OSM', 'OP'],
        ['matrix', 'Mx', 'MA'],
        ['new-service', '新', 'NE'],
    ])('takes %s text marks from metadata and otherwise uses generic initials', (
        variant, markText, fallback
    ) => {
        for (const [metadataText, expected] of [[`  ${markText}  `, markText], [undefined, fallback]]) {
            const wrapper = createImageElement('/storage/logo.svg', true, {
                imageTypeId: 1,
                rowLabel: 'Palvelu 服务',
                imageMetadata: {
                    logo_variant: variant, logo_mark_mode: 'text', logo_mark_text: metadataText,
                    logo_show_label: false,
                },
            });
            expect(wrapper.querySelector('.service-catalog-css-logo__mark')?.textContent).toBe(expected);
            expect(wrapper.querySelector('img')).toBeNull();
            expect(wrapper.querySelector('.service-catalog-css-logo__title')).toBeNull();
            expect(wrapper.querySelector('.service-catalog-css-logo')?.getAttribute('aria-label'))
                .toBe('Palvelu 服务');
        }
    });

    test.each([
        ['   ', 'FI'], [null, 'FI'], [42, 'FI'], [{ text: 'bad' }, 'FI'],
        ['  ABCDEFGHI  ', 'ABCDEFGH'], ['😀😀😀😀😀😀😀😀😀', '😀😀😀😀😀😀😀😀'],
        ['<b>X</b>', '<b>X</b>'],
    ])('keeps mark text short and literal for %j', (logo_mark_text, expected) => {
        const wrapper = createImageElement('/storage/logo.svg', true, {
            imageTypeId: 1,
            imageMetadata: { logo_variant: 'firefox', logo_mark_mode: 'text', logo_mark_text },
        });
        const mark = wrapper.querySelector('.service-catalog-css-logo__mark');
        expect(mark?.textContent).toBe(expected);
        expect(mark?.childElementCount).toBe(0);
    });

    test('keeps image-mark and visible-label defaults even when mark text is supplied', () => {
        const wrapper = createImageElement('/storage/logo.svg', true, {
            imageTypeId: 1, rowLabel: 'Uusi palvelu',
            imageMetadata: { logo_variant: 'new-service', logo_mark_text: 'NS' },
        });
        expect(wrapper.dataset.serviceCatalogLogoRenderMode).toBe('css');
        expect(wrapper.querySelector('.service-catalog-css-logo__mark')?.tagName).toBe('IMG');
        expect(wrapper.querySelector('.service-catalog-css-logo__title')?.textContent).toBe('Uusi palvelu');
    });

    test.each([
        [2, { logo_variant: 'firefox' }],
        [undefined, { logo_variant: 'firefox' }],
        [1, { logo_variant: '../bad' }],
        [1, []],
        [1, '{invalid'],
        [1, { logo_variant: 'firefox', logo_render_mode: 'unknown' }],
    ])('keeps invalid or unsupported typed metadata on the image path', (imageTypeId, imageMetadata) => {
        const wrapper = createImageElement('/storage/photo.png', true, {
            tableName: 'ordinary_dataset', rowLabel: 'Photo', imageTypeId, imageMetadata,
        });
        expect(wrapper.querySelector('.service-catalog-css-logo')).toBeNull();
        expect(wrapper.querySelector('img')?.getAttribute('src')).toBe('/storage/photo.png');
    });

});
