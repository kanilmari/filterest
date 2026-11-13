// card_element_builder.test.js
// Verifies card media rendering wires service-catalog logo contrast protection into small cards.
// Bridges addImageOrAvatar and its mocked card-media dependencies with jsdom DOM assertions.
// Exists to keep the shared card image hook intentionally narrow while service-catalog logo handling evolves.
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { setRowPresentationChoice } from '../row_presentation/row_presentation_choice.js';

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

vi.mock('./image_first_view_opener.js', () => ({ openImageFirstView: openImageFirstViewMock }));

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
    PHONE_BREAKPOINT_PX: 700,
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
    addHeaderElement,
    addUsernameElement,
    updateCardImageSources,
} from './card_element_builder.js';

describe('card_element_builder image-first activation', () => {
    afterEach(() => vi.unstubAllGlobals());
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

    test.each([
        [700, 'card', '/ui/view/image_first_page_view', 'page'],
        [701, 'card', '/ui/view/article_view', undefined],
        [390, 'article_view', '/ui/view/article_view', undefined],
    ])('at %i px, %s media opens its permitted view by click and keyboard', async (width, view, grant, layout) => {
        vi.stubGlobal('innerWidth', width);
        sessionStorage.setItem('user_permissions', JSON.stringify([grant]));
        const card = document.createElement('article');
        card.classList.add('card');
        card.dataset.cardPresentationView = view;
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
        await vi.waitFor(() => expect(openImageFirstViewMock).toHaveBeenCalledTimes(1));
        imageActivator.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        await vi.waitFor(() => {
            expect(openImageFirstViewMock).toHaveBeenCalledTimes(2);
        });
        expect(openImageFirstViewMock.mock.lastCall[0].layout).toBe(layout);
        expect(openImageFirstViewMock).toHaveBeenLastCalledWith(expect.objectContaining({
            rowItem,
            tableName: 'examples',
            selectedCard: card,
        }));
    });
    test('retained image refreshes its affordance at the phone boundary and refuses the ungranted view', async () => {
        vi.stubGlobal('innerWidth', 701);
        sessionStorage.setItem('user_permissions', JSON.stringify(['/ui/view/article_view']));
        const card = document.createElement('article');
        card.dataset.cardPresentationView = 'card';
        const imageContainer = document.createElement('div');
        card.append(imageContainer);
        document.body.append(card);
        await addImageOrAvatar('7_7_1.png', true, 'seed', 'E', imageContainer, 'examples', 'Example', {}, { id: 7 }, card);
        const image = card.querySelector('[data-image-first-src]');
        expect(image.getAttribute('role')).toBe('button');
        vi.stubGlobal('innerWidth', 700);
        updateCardImageSources();
        expect(image.hasAttribute('tabindex')).toBe(false);
        image.click();
        expect(openImageFirstViewMock).not.toHaveBeenCalled();
        expect(document.querySelector('[data-lang-key="article_view_permission_missing"]')).not.toBeNull();
        vi.stubGlobal('innerWidth', 701);
        updateCardImageSources();
        expect(image.tabIndex).toBe(0);
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


describe('classic article title and show-more access', () => {
    beforeEach(() => {
        document.body.replaceChildren();
        sessionStorage.clear();
        localStorage.setItem('chosen_language', 'fi');
    });
    test('description text, padding and keyboard open the chosen row; links, editing and text selection stay independent', async () => {
        const { addDescriptionSection } = await import('./card_element_builder.js');
        const { createKeyValueElement } = await import('./card_field_formatter.js');
        const card = document.createElement('div');
        card.className = 'card';
        document.body.append(card);
        const row = { id: 17 };
        setRowPresentationChoice('news', 'image_first_page_view');
        sessionStorage.setItem('user_permissions', JSON.stringify(['/ui/view/image_first_page_view']));
        vi.mocked(createKeyValueElement).mockImplementationOnce(() => {
            const pair = document.createElement('div');
            const value = document.createElement('div');
            value.dataset.column = 'body';
            value.textContent = 'Read this';
            pair.append(value);
            return pair;
        });
        addDescriptionSection([{ rawValue: 'Read this', column: 'body', columnClass: 'news-body' }], row, 'news', card);
        const description = card.querySelector('.card_description_container');
        const text = description.querySelector('[data-column="body"]');
        openImageFirstViewMock.mockClear();
        text.click();
        await vi.waitFor(() => expect(openImageFirstViewMock).toHaveBeenCalledTimes(1));
        description.click();
        await vi.waitFor(() => expect(openImageFirstViewMock).toHaveBeenCalledTimes(2));
        description.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await vi.waitFor(() => expect(openImageFirstViewMock).toHaveBeenCalledTimes(3));
        expect(openImageFirstViewMock).toHaveBeenLastCalledWith(expect.objectContaining({
            layout: 'page', rowItem: row, selectedCard: card, tableName: 'news',
        }));
        openImageFirstViewMock.mockClear();
        for (const tag of ['a', 'input']) {
            const child = document.createElement(tag);
            if (tag === 'a') child.href = '#other';
            text.append(child);
            child.click();
        }
        const selection = window.getSelection();
        selection.selectAllChildren(text);
        text.click();
        selection.removeAllRanges();
        // The dispatcher resolves asynchronous presentation ownership before invoking the opener.
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(openImageFirstViewMock).not.toHaveBeenCalled();
    });
    test('Page-only readers can open a row and its native link directly in Page', async () => {
        setRowPresentationChoice('news', 'image_first_page_view');
        sessionStorage.setItem('user_permissions', JSON.stringify(['/ui/view/image_first_page_view']));
        const { createShowMoreLink } = await import('./card_element_builder.js');
        const link = createShowMoreLink({ id: 7 }, 'news');
        expect(link.tagName).toBe('A');
        expect(new URL(link.href).searchParams.get('view')).toBe('image_first_page_view');
        openImageFirstViewMock.mockClear();
        link.click();
        await vi.waitFor(() => expect(openImageFirstViewMock).toHaveBeenCalledWith(expect.objectContaining({
            layout: 'page', rowItem: { id: 7 }, tableName: 'news', presentationChoice: true,
        })));
    });
    test.each([false, true])('title keeps only permitted opening behavior, allowed=%s', async allowed => {
        const { addHeaderElement, createShowMoreLink } = await import('./card_element_builder.js');
        const { openRowArticleView } = await import('./row_article_opener.js');
        vi.mocked(openRowArticleView).mockClear();
        setRowPresentationChoice('news', 'article_view');
        sessionStorage.setItem('user_permissions', JSON.stringify(allowed ? ['/ui/view/article_view'] : []));
        const card = document.createElement('div'); card.className = 'card'; document.body.append(card);
        const row = { id: 1, title: 'Article' };
        const title = addHeaderElement('Article', 'Title', 'title', false, row, 'news', card);
        const more = createShowMoreLink(row, 'news'); card.append(more);
        expect(title.dataset.articleAccess).toBe(allowed ? 'allowed' : 'denied');
        expect(more.hasAttribute('href')).toBe(allowed);
        title.click();
        if (allowed) await vi.waitFor(() => expect(openRowArticleView).toHaveBeenCalledTimes(1));
        more.click();
        if (allowed) await vi.waitFor(() => expect(openRowArticleView).toHaveBeenCalledTimes(2));
        else {
            expect(openRowArticleView).not.toHaveBeenCalled();
            expect(document.querySelector('[role="alert"]').textContent).toContain('do not have permission');
            title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
            expect(document.querySelectorAll('[role="alert"]')).toHaveLength(3);
            expect(title.hasAttribute('role')).toBe(false);
            expect(title.hasAttribute('tabindex')).toBe(false);
            expect(openRowArticleView).not.toHaveBeenCalled();
        }
    });
});
