// @vitest-environment jsdom
// translation_handler.test.js
// Verifies translatePage updates live-translated auxiliary attributes such as tooltips.
// Bridges the shared translation handler and DOM attribute updates without requiring a full page reload.
// Exists to prevent regressions where text updates on language switch but title tooltips stay stale.

import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';
import { endpoint_router } from '../endpoints/endpoint_router.js';
import { refreshCardLanguages } from '../table_views/card_view/card_view_printer.js';
import { refreshLocalizedDatasetValues } from '../table_views/dataset_value_localizer.js';

vi.mock('../endpoints/endpoint_router.js', () => ({
    endpoint_router: vi.fn(),
}));

vi.mock('../table_views/card_view/card_view_printer.js', () => ({
    refreshCardLanguages: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../table_views/dataset_value_localizer.js', () => ({
    refreshLocalizedDatasetValues: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../reusable_components/notifications/toast_notification_printer.js', () => ({
    showToast: vi.fn(),
}));

vi.mock('./dev_lang_key_editor.js', () => ({
    initDevLangKeyEditor: vi.fn(),
}));

describe('translatePage', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        document.body.className = 'loading';
        document.head.innerHTML = '';
        endpoint_router.mockReset();
        refreshCardLanguages.mockClear();
        refreshLocalizedDatasetValues.mockClear();

        window.translationPromises = {
            en: Promise.resolve({
                exclude: 'Exclude',
                exclude_filter_option: 'Exclude this value from results',
                chat_for_table: 'Chat - $table_name',
                system_users: 'Users',
            }),
            fi: Promise.resolve({
                exclude: 'Sulje pois',
                exclude_filter_option: 'Sulje tämä arvo pois tuloksista',
                chat_for_table: 'Keskustelu – $table_name',
                system_users: 'Käyttäjät',
            }),
        };
    });

    afterEach(() => {
        document.body.innerHTML = '';
        document.body.className = '';
        delete window.translationPromises;
    });

    test('does not call the protected AI translation writer for production-page fallbacks', async () => {
        const { translatePage } = await import('./translation_handler.js');
        await translatePage('en');
        endpoint_router.mockClear();

        const missingLabel = document.createElement('span');
        missingLabel.dataset.langKey = 'missing_login_copy';
        document.body.appendChild(missingLabel);

        await new Promise((resolve) => setTimeout(resolve, 350));

        expect(endpoint_router).not.toHaveBeenCalledWith(
            'generateTranslations',
            expect.anything(),
        );
    });

    test('updates title tooltips when the language changes without a page reload', async () => {
        const actionButton = document.createElement('button');
        actionButton.dataset.langKey = 'exclude';
        actionButton.dataset.titleLangKey = 'exclude_filter_option';
        actionButton.textContent = 'Exclude';
        actionButton.title = 'Exclude this value from results';
        document.body.appendChild(actionButton);

        const { translatePage } = await import('./translation_handler.js');

        await translatePage('fi');
        expect(actionButton.textContent).toBe('Sulje pois');
        expect(actionButton.title).toBe('Sulje tämä arvo pois tuloksista');

        await translatePage('en');
        expect(actionButton.textContent).toBe('Exclude');
        expect(actionButton.title).toBe('Exclude this value from results');

        expect(refreshCardLanguages).toHaveBeenCalledTimes(2);
        expect(refreshLocalizedDatasetValues).toHaveBeenNthCalledWith(1, 'fi');
        expect(refreshLocalizedDatasetValues).toHaveBeenNthCalledWith(2, 'en');
        expect(endpoint_router).not.toHaveBeenCalled();
    });

    test('uses local fallbacks for view-selector keys before database translations exist', async () => {
        const viewButton = document.createElement('button');
        viewButton.dataset.langKey = 'view_article';
        viewButton.textContent = 'Artikkeli';
        document.body.appendChild(viewButton);

        const heading = document.createElement('div');
        heading.dataset.langKey = 'views_and_presentations';
        heading.textContent = 'Näkymät ja esitystavat';
        document.body.appendChild(heading);

        const { translatePage } = await import('./translation_handler.js');

        await translatePage('fi');
        expect(viewButton.textContent).toBe('Artikkeli');
        expect(heading.textContent).toBe('Näkymät ja esitystavat');

        await translatePage('en');
        expect(viewButton.textContent).toBe('Article');
        expect(heading.textContent).toBe('Views and presentations');
    });

    test('uses explicit lang variable attributes for placeholder translations', async () => {
        const chatTitle = document.createElement('span');
        chatTitle.dataset.langKey = 'chat_for_table';
        chatTitle.dataset.langVariable = 'Käyttäjät';
        chatTitle.textContent = 'Keskustelu - Käyttäjät';
        document.body.appendChild(chatTitle);

        const { translatePage } = await import('./translation_handler.js');

        await translatePage('fi');
        expect(chatTitle.textContent).toBe('Keskustelu – Käyttäjät');

        chatTitle.dataset.langVariable = 'Users';
        await translatePage('en');
        expect(chatTitle.textContent).toBe('Chat - Users');
    });

    test('translates a language-key variable again when the selected language changes', async () => {
        const chatTitle = document.createElement('span');
        chatTitle.dataset.langKey = 'chat_for_table';
        chatTitle.dataset.langVariable = 'Users';
        chatTitle.dataset.langVariableKey = 'system_users';
        document.body.appendChild(chatTitle);

        const { translatePage } = await import('./translation_handler.js');

        await translatePage('fi');
        expect(chatTitle.textContent).toBe('Keskustelu – Käyttäjät');

        await translatePage('en');
        expect(chatTitle.textContent).toBe('Chat - Users');
    });

    test('keeps the latest selected language when an older request resolves last', async () => {
        const label = document.createElement('span');
        label.dataset.langKey = 'exclude';
        document.body.appendChild(label);

        let resolveFinnish;
        window.translationPromises.fi = new Promise((resolve) => {
            resolveFinnish = resolve;
        });

        const { translatePage } = await import('./translation_handler.js');
        const olderFinnishRequest = translatePage('fi');
        const latestEnglishRequest = translatePage('en');

        await latestEnglishRequest;
        resolveFinnish({ exclude: 'Sulje pois' });
        await olderFinnishRequest;

        expect(document.documentElement.lang).toBe('en');
        expect(label.textContent).toBe('Exclude');
        expect(refreshCardLanguages).toHaveBeenLastCalledWith('en');
        expect(refreshLocalizedDatasetValues).toHaveBeenLastCalledWith('en');
    });
});
