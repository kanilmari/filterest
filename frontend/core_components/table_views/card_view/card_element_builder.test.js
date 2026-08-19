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
    resolveCardMediaFolderMock: vi.fn((width = window.innerWidth) =>
        width <= 1060 ? '1000' : '300'
    ),
}));

vi.mock('./card_avatar_builder.js', () => ({
    createImageElement: createImageElementMock,
    create_seeded_avatar: createSeededAvatarMock,
}));

vi.mock('./row_article_opener.js', () => ({
    openRowArticleView: vi.fn(),
    open_big_card_view: vi.fn(),
}));

vi.mock('./image_first_view_activation.js', () => ({
    activateImageFirstView: openImageFirstViewMock,
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
    resolveCardMediaFolder: resolveCardMediaFolderMock,
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
        card.appendChild(imageContainer);
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
        );

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
        expect(header.querySelector('.card_header_dataset_icon path')?.getAttribute('d')).toBeTruthy();
        expect(container.firstElementChild).toBe(header);
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

    test('uses the rendered card width when choosing the large media folder', () => {
        const card = document.createElement('div');
        card.classList.add('card');
        card.getBoundingClientRect = vi.fn(() => ({ width: 620 }));

        const imageSlot = document.createElement('div');
        imageSlot.classList.add('card_image');
        const img = document.createElement('img');
        img.src = '/storage/104/161/300/logo.png';
        imageSlot.appendChild(img);
        card.appendChild(imageSlot);
        document.body.appendChild(card);

        updateCardImageSources();

        expect(resolveCardMediaFolderMock).toHaveBeenCalledWith(620);
        expect(img.src).toContain('/storage/104/161/1000/logo.png');
    });

    test('switches back to the compact media folder when the card is wide', () => {
        const card = document.createElement('div');
        card.classList.add('card');
        card.getBoundingClientRect = vi.fn(() => ({ width: 1300 }));

        const imageSlot = document.createElement('div');
        imageSlot.classList.add('card_image');
        const img = document.createElement('img');
        img.src = '/storage/104/161/1000/logo.png';
        imageSlot.appendChild(img);
        card.appendChild(imageSlot);
        document.body.appendChild(card);

        updateCardImageSources();

        expect(resolveCardMediaFolderMock).toHaveBeenCalledWith(1300);
        expect(img.src).toContain('/storage/104/161/300/logo.png');
    });

    test('falls back to the card list width while the card is still measuring', () => {
        const cardContainer = document.createElement('div');
        cardContainer.classList.add('card_container');
        cardContainer.getBoundingClientRect = vi.fn(() => ({ width: 640 }));

        const card = document.createElement('div');
        card.classList.add('card');
        card.getBoundingClientRect = vi.fn(() => ({ width: 0 }));

        const imageSlot = document.createElement('div');
        imageSlot.classList.add('card_image');
        const img = document.createElement('img');
        img.src = '/storage/104/161/300/logo.png';
        imageSlot.appendChild(img);
        card.appendChild(imageSlot);
        cardContainer.appendChild(card);
        document.body.appendChild(cardContainer);

        updateCardImageSources();

        expect(resolveCardMediaFolderMock).toHaveBeenCalledWith(640);
        expect(img.src).toContain('/storage/104/161/1000/logo.png');
    });
});
