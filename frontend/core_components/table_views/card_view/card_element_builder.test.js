// card_element_builder.test.js
// Verifies card media rendering wires service-catalog logo contrast protection into small cards.
// Bridges addImageOrAvatar and its mocked card-media dependencies with jsdom DOM assertions.
// Exists to keep the shared card image hook intentionally narrow while service-catalog logo handling evolves.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
    createImageElementMock,
    createSeededAvatarMock,
    resolveCardMediaFolderMock,
} = vi.hoisted(() => ({
    createImageElementMock: vi.fn(),
    createSeededAvatarMock: vi.fn(),
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
    addHeaderElement,
    addUsernameElement,
    updateCardImageSources,
} from './card_element_builder.js';

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
