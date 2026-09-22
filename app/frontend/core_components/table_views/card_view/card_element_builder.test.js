// card_element_builder.test.js
// Verifies card media rendering wires service-catalog logo contrast protection into small cards.
// Bridges addImageOrAvatar and its mocked card-media dependencies with jsdom DOM assertions.
// Exists to keep the shared card image hook intentionally narrow while service-catalog logo handling evolves.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
    createImageElementMock,
    createSeededAvatarMock,
    openImageFirstViewMock,
    resolveCardMediaFolderMock,
} = vi.hoisted(() => ({
    createImageElementMock: vi.fn(),
    createSeededAvatarMock: vi.fn(),
    openImageFirstViewMock: vi.fn(),
    resolveCardMediaFolderMock: vi.fn((width) => (width <= 360 ? '300' : '1000')),
}));

vi.mock('./card_avatar_builder.js', () => ({
    createImageElement: createImageElementMock,
    create_seeded_avatar: createSeededAvatarMock,
}));

vi.mock('./row_article_opener.js', () => ({
    openRowArticleView: vi.fn(),
}));

vi.mock('./image_first_view_activation.js', () => ({
    bindImageFirstViewActivation: vi.fn((element, options) => {
        element.tabIndex = 0;
        element.setAttribute('role', 'button');
        element.dataset.imageFirstSrc = options.imageSrc;
        const open = () => openImageFirstViewMock(options);
        element.addEventListener('click', open);
        element.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') open();
        });
        return element;
    }),
}));

vi.mock('../../../reusable_components/modal/modal_builder.js', () => ({
    createModal: vi.fn(() => ({
        modal_overlay: document.createElement('div'),
        modal: document.createElement('div'),
    })),
    showModal: vi.fn(),
}));

vi.mock('./card_field_formatter.js', () => ({
    createKeyValueElement: vi.fn(() => document.createElement('div')),
}));

vi.mock('../../dev_tools/function_counter.js', () => ({
    count_this_function: vi.fn(),
}));

vi.mock('../../../ui_config.js', () => ({
    show_more_button_on_cards: false,
    resolveCardMediaFolderForImageWidth: resolveCardMediaFolderMock,
    predictCardImageCssWidth: vi.fn(() => 300),
}));

vi.mock('../../../reusable_components/lang_value_reader.js', () => ({
    extractLangValue: vi.fn((value) => String(value ?? '')),
}));

vi.mock('../../../icons/icon_loader.js', () => ({
    setElementSvgContent: vi.fn(),
}));

vi.mock('../../state_stores/lang_preference_reader.js', () => ({
    getLanguageWithBrowserFallback: vi.fn(() => 'en'),
}));

import {
    addImageOrAvatar,
    addDetailsSection,
    addHeaderElement,
    addUsernameElement,
    updateCardImageSources,
} from './card_element_builder.js';

describe('card_element_builder image-first activation', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        createImageElementMock.mockReset();
        createImageElementMock.mockImplementation((src) => {
            const wrapper = document.createElement('div');
            wrapper.classList.add('wrapper');
            const image = document.createElement('img');
            image.src = src;
            wrapper.appendChild(image);
            return wrapper;
        });
        openImageFirstViewMock.mockReset();
        openImageFirstViewMock.mockResolvedValue(null);
    });

    test('opens the separate image-first view by click and keyboard', async () => {
        const card = document.createElement('article');
        card.classList.add('card');
        const imageContainer = document.createElement('div');
        const rowItem = { id: 7, title: 'Example', image: '7_7_1.png' };

        await addImageOrAvatar(
            '7_7_1.png',
            true,
            'seed',
            'E',
            imageContainer,
            'examples',
            'Example',
            {},
            rowItem,
            card,
        );

        // The real card builder wires image-first before attaching this image
        // container to the card, so navigation must use the explicit card.
        expect(imageContainer.closest('.card')).toBeNull();

        const imageActivator = imageContainer.querySelector('[role="button"]');
        const image = imageActivator.querySelector('img');
        expect(imageActivator?.dataset.imageFirstSrc).toContain('/storage/7/7/original/7_7_1.png');

        // Pointer activation on the visible image bubbles to its accessible wrapper.
        image.click();
        imageActivator.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        await vi.waitFor(() => {
            expect(openImageFirstViewMock).toHaveBeenCalledTimes(2);
        });
        expect(openImageFirstViewMock).toHaveBeenLastCalledWith(expect.objectContaining({
            rowItem,
            tableName: 'examples',
            selectedCard: card,
        }));
    });
});

describe('card_element_builder link details', () => {
    test('links safe HTTP(S) values and renders unsafe schemes as text', () => {
        const container = document.createElement('div');

        addDetailsSection([
            {
                suffix_number: 1,
                column: 'website',
                columnClass: 'website-column',
                rawValue: 'https://example.test',
                isLink: true,
            },
            {
                suffix_number: 2,
                column: 'script',
                columnClass: 'script-column',
                rawValue: 'javascript:alert(1)',
                isLink: true,
            },
        ], {}, 'orders', container);

        const safeLink = container.querySelector('tr.website-column td a');
        expect(safeLink?.getAttribute('href')).toBe('https://example.test');
        expect(safeLink?.getAttribute('rel')).toBe('noopener noreferrer');
        expect(container.querySelector('tr.script-column td a')).toBeNull();
        expect(container.querySelector('tr.script-column td')?.textContent).toBe('javascript:alert(1)');
    });

    test('links an HTTP(S) address in an ordinary details field', () => {
        const container = document.createElement('div');

        addDetailsSection([{
            suffix_number: 1,
            column: 'notes',
            columnClass: 'notes-column',
            rawValue: 'Read https://example.test/guide for details.',
            isLink: false,
        }], {}, 'orders', container);

        const link = container.querySelector('tr.notes-column td a');
        expect(link?.getAttribute('href')).toBe('https://example.test/guide');
        expect(container.querySelector('tr.notes-column td')?.textContent)
            .toBe('Read https://example.test/guide for details.');
    });
});

describe('card_element_builder addHeaderElement', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
    });

    test('prepends the dataset icon before the card header value', () => {
        localStorage.setItem(
            'app_service_catalog_tableMeta',
            JSON.stringify({ icon_key: 'building' })
        );
        const container = document.createElement('div');

        const header = addHeaderElement(
            'Firefox',
            '',
            'title',
            false,
            { id: 392, title: 'Firefox' },
            'app_service_catalog',
            container,
            'Firefox'
        );

        expect(header.classList.contains('card_header--with-dataset-icon')).toBe(true);
        expect(header.firstElementChild?.classList.contains('card_header_dataset_icon')).toBe(true);
        expect(header.querySelector('.card_header_dataset_icon')?.dataset.symbolKey).toBe('building');
        expect(container.firstElementChild).toBe(header);
    });

    test('does not add an automatic table icon when icon_key is missing', () => {
        const container = document.createElement('div');

        const header = addHeaderElement(
            'Firefox',
            '',
            'title',
            false,
            { id: 392, title: 'Firefox' },
            'app_service_catalog',
            container,
            'Firefox'
        );

        expect(header.classList.contains('card_header--with-dataset-icon')).toBe(false);
        expect(header.querySelector('.card_header_dataset_icon')).toBeNull();
    });
});

describe('card_element_builder addUsernameElement', () => {
    test('wraps username text so short names do not reserve fixed-width space', () => {
        const element = addUsernameElement('kantolab', 'User', 'cached_username', false);

        expect(element.classList.contains('card_username')).toBe(true);
        expect(element.querySelector('.card_username_icon')).toBeTruthy();
        expect(element.querySelector('.card_username_text')?.textContent).toBe('kantolab');
        expect(element.childNodes).toHaveLength(2);
    });

    test('keeps translated username text separate from the icon', () => {
        const element = addUsernameElement('service_owner', 'User', 'cached_username', true);
        const text = element.querySelector('.card_username_text');

        expect(element.dataset.langKey).toBeUndefined();
        expect(text?.dataset.langKey).toBe('service_owner');
    });
});

describe('card_element_builder updateCardImageSources', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        resolveCardMediaFolderMock.mockClear();
    });

    function mountCardImage(src, imageWidth, { complete = false, naturalWidth = 0 } = {}) {
        const card = document.createElement('div');
        card.classList.add('card');
        const imageSlot = document.createElement('div');
        imageSlot.classList.add('card_image');
        const img = document.createElement('img');
        img.src = src;
        img.getBoundingClientRect = vi.fn(() => ({ width: imageWidth }));
        Object.defineProperty(img, 'complete', { configurable: true, get: () => complete });
        Object.defineProperty(img, 'naturalWidth', { configurable: true, get: () => naturalWidth });
        imageSlot.appendChild(img);
        card.appendChild(imageSlot);
        document.body.appendChild(card);
        return img;
    }

    test('uses the rendered image width, not the card width, when choosing the folder', () => {
        const img = mountCardImage('/storage/104/161/300/logo.png', 620);

        updateCardImageSources();

        expect(resolveCardMediaFolderMock).toHaveBeenCalledWith(620);
        expect(img.src).toContain('/storage/104/161/1000/logo.png');
    });

    test('moves a small image that is still loading to the compact folder', () => {
        const img = mountCardImage('/storage/104/161/1000/logo.png', 320);

        updateCardImageSources();

        expect(resolveCardMediaFolderMock).toHaveBeenCalledWith(320);
        expect(img.src).toContain('/storage/104/161/300/logo.png');
    });

    test('keeps an already loaded larger image instead of fetching a smaller one', () => {
        const img = mountCardImage('/storage/104/161/1000/logo.png', 320, { complete: true, naturalWidth: 1000 });

        updateCardImageSources();

        expect(img.src).toContain('/storage/104/161/1000/logo.png');
    });

    test('waits until the image has been laid out', () => {
        const img = mountCardImage('/storage/104/161/300/logo.png', 0);

        updateCardImageSources();

        expect(resolveCardMediaFolderMock).not.toHaveBeenCalled();
        expect(img.src).toContain('/storage/104/161/300/logo.png');
    });

    test('does not reassign src when the image is already on the chosen folder', () => {
        const img = mountCardImage('/storage/104/161/300/logo.png', 300);
        const descriptor = Object.getOwnPropertyDescriptor(window.HTMLImageElement.prototype, 'src');
        const setSrc = vi.fn(function setSrc(value) {
            descriptor.set.call(this, value);
        });
        Object.defineProperty(img, 'src', {
            configurable: true,
            get() {
                return descriptor.get.call(this);
            },
            set: setSrc,
        });

        updateCardImageSources();

        expect(img.src).toContain('/storage/104/161/300/logo.png');
        expect(setSrc).not.toHaveBeenCalled();
    });

    test('rewrites leftover original paths onto the display folder', () => {
        const img = mountCardImage('/storage/9/1/original/9_1_1.png', 620, { complete: true, naturalWidth: 2000 });

        updateCardImageSources();

        expect(img.src).toContain('/storage/9/1/1000/9_1_1.png');
    });
});
