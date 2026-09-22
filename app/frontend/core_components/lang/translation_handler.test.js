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
                created: 'Created',
                system_users: 'Users',
            }),
            fi: Promise.resolve({
                exclude: 'Sulje pois',
                exclude_filter_option: 'Sulje tämä arvo pois tuloksista',
                chat_for_table: 'Keskustelu – $table_name',
                created: 'Luotu',
                system_users: 'Käyttäjät',
            }),
            yue: Promise.resolve({}),
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
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
        const card = document.createElement('div');
        card.className = 'card';
        document.body.appendChild(card);

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

    test('keeps literal tooltip context after the translated field label', async () => {
        const createdAt = document.createElement('time');
        createdAt.dataset.titleLangKey = 'created';
        createdAt.dataset.titleLangContext = '2026-08-20 00:24:42';
        document.body.appendChild(createdAt);

        const { translatePage } = await import('./translation_handler.js');

        await translatePage('fi');
        expect(createdAt.title).toBe('Luotu: 2026-08-20 00:24:42');

        await translatePage('en');
        expect(createdAt.title).toBe('Created: 2026-08-20 00:24:42');
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

        await translatePage('yue');
        expect(viewButton.textContent).toBe('\u6587\u7ae0');
        expect(heading.textContent).toBe('\u8996\u5716\u8207\u5c55\u793a\u65b9\u5f0f');
    });

    test('keeps deletion confirmation readable through live language changes without runtime keys', async () => {
        const keys = ['delete_confirm_title', 'delete_confirm_single', 'delete_confirm_multiple'];
        const labels = keys.map((key) => {
            const label = document.createElement('p');
            label.dataset.langKey = key;
            document.body.appendChild(label);
            return label;
        });
        window.translationPromises.ch = Promise.resolve({});
        const { translatePage } = await import('./translation_handler.js');

        for (const [language, expected] of [
            ['fi', ['Vahvista poisto', 'Haluatko poistaa tämän kohteen?', 'Haluatko poistaa nämä kohteet?']],
            ['en', ['Confirm deletion', 'Delete this item?', 'Delete these items?']],
            ['fi', ['Vahvista poisto', 'Haluatko poistaa tämän kohteen?', 'Haluatko poistaa nämä kohteet?']],
            ['ch', ['确认删除', '要删除此项目吗？', '要删除这些项目吗？']],
            ['yue', ['確認刪除', '要刪除呢個項目嗎？', '要刪除呢啲項目嗎？']],
        ]) {
            await translatePage(language);
            expect(labels.map((label) => label.textContent)).toEqual(expected);
        }
        expect(endpoint_router).not.toHaveBeenCalled();
    });

    test('prefers reviewed runtime deletion copy over local fallbacks', async () => {
        const keys = ['delete_confirm_title', 'delete_confirm_single', 'delete_confirm_multiple'];
        const labels = keys.map((key) => {
            const label = document.createElement('p');
            label.dataset.langKey = key;
            document.body.appendChild(label);
            return label;
        });
        const copy = {
            fi: ['Poiston vahvistus', 'Poistetaanko valittu kohde?', 'Poistetaanko valitut kohteet?'],
            en: ['Confirm removal', 'Remove the selected item?', 'Remove the selected items?'],
        };
        for (const [language, values] of Object.entries(copy)) {
            window.translationPromises[language] = Promise.resolve(
                Object.fromEntries(keys.map((key, index) => [key, values[index]])),
            );
        }
        const { translatePage } = await import('./translation_handler.js');
        for (const language of ['fi', 'en', 'fi']) {
            await translatePage(language);
            expect(labels.map((label) => label.textContent)).toEqual(copy[language]);
        }
        expect(endpoint_router).not.toHaveBeenCalled();
    });

    test('uses local fallbacks for field-set ownership and inheritance status', async () => {
        const source = document.createElement('p');
        source.dataset.langKey = 'field_set_source_group';
        document.body.appendChild(source);
        const reset = document.createElement('button');
        reset.dataset.langKey = 'use_site_default';
        document.body.appendChild(reset);

        const { translatePage } = await import('./translation_handler.js');

        await translatePage('fi');
        expect(source.textContent).toBe('Ryhmäkohtainen oletus on käytössä');
        expect(reset.textContent).toBe('Käytä sivuston oletusta');

        await translatePage('en');
        expect(source.textContent).toBe('Group default in use');
        expect(reset.textContent).toBe('Use site default');

        await translatePage('yue');
        expect(source.textContent).toBe('正在使用群組預設設定');
        expect(reset.textContent).toBe('使用網站預設設定');
    });

    test('serves the fetch monitor failure notices in every language before runtime keys exist', async () => {
        window.translationPromises.ch = Promise.resolve({});
        const { translatePage, getTranslationForKey } = await import('./translation_handler.js');

        for (const [language, expected] of [
            ['fi', 'Palvelussa tapahtui virhe. Yritä hetken kuluttua uudelleen.'],
            ['en', 'The service ran into an error. Please try again in a moment.'],
            ['ch', '服务出现错误。请稍后再试。'],
            ['yue', '服務出咗錯。請稍後再試。'],
        ]) {
            await translatePage(language);
            expect(getTranslationForKey('server_error_notice')).toBe(expected);
        }
        await translatePage('en');
        expect(getTranslationForKey('network_error_notice'))
            .toBe('The service could not be reached. Check your connection and try again.');
    });

    test('prefers reviewed runtime failure-notice copy over the local fallback', async () => {
        window.translationPromises.fi = Promise.resolve({ server_error_notice: 'Sivuston oma virheteksti.' });
        const { translatePage, getTranslationForKey } = await import('./translation_handler.js');

        await translatePage('fi');

        expect(getTranslationForKey('server_error_notice')).toBe('Sivuston oma virheteksti.');
    });

    test('renders the local fallback after the translation service fails', async () => {
        const source = document.createElement('p');
        source.dataset.langKey = 'field_set_source_group';
        document.body.appendChild(source);
        window.translationPromises.en = Promise.reject(new Error('translation service blocked'));
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const { translatePage } = await import('./translation_handler.js');
        await translatePage('en');

        expect(source.textContent).toBe('Group default in use');
        expect(document.documentElement.lang).toBe('en');
        expect(document.body.classList.contains('loading')).toBe(false);
        warning.mockRestore();
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
        const card = document.createElement('div');
        card.className = 'card';
        document.body.appendChild(card);

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
    test('keeps the article details heading readable across languages when its key is absent', async () => {
        const { buildRowArticleDisclosureSection } = await import('../table_views/card_view/row_article_disclosure_section_builder.js');
        const section = buildRowArticleDisclosureSection({
            titleLangKey: 'row_article_section_details',
            titleText: 'Details',
            contentElement: document.createElement('div'),
        });
        document.body.appendChild(section);
        window.translationPromises.ch = Promise.resolve({});
        const { translatePage } = await import('./translation_handler.js');
        for (const [language, expected] of [
            ['fi', 'Tiedot'], ['en', 'Details'], ['ch', '详细信息'], ['yue', '詳細資料'], ['fi', 'Tiedot'],
        ]) {
            await translatePage(language);
            expect(section.querySelector('.animated-disclosure-title').textContent).toBe(expected);
        }
        expect(endpoint_router).not.toHaveBeenCalled();
    });

    test('does not load card-language refresh when the shell has no cards', async () => {
        const { translatePage } = await import('./translation_handler.js');
        await translatePage('en');
        expect(refreshCardLanguages).not.toHaveBeenCalled();
        expect(refreshLocalizedDatasetValues).toHaveBeenCalledWith('en');
    });

    test('coalesces concurrent translation GETs for the same language', async () => {
        delete window.translationPromises;
        let resolveFetch;
        endpoint_router.mockImplementation(() => new Promise((resolve) => {
            resolveFetch = resolve;
        }));
        const { translatePage } = await import('./translation_handler.js');
        const first = translatePage('en');
        const second = translatePage('en');
        await Promise.resolve();
        expect(endpoint_router).toHaveBeenCalledTimes(1);
        expect(endpoint_router).toHaveBeenCalledWith('translations', { url_params: '?lang=en' });
        resolveFetch({ exclude: 'Exclude' });
        await Promise.all([first, second]);
        expect(endpoint_router).toHaveBeenCalledTimes(1);
    });

    test('prefers reviewed runtime article headings over the missing-key fallback', async () => {
        const label = document.createElement('span');
        label.dataset.langKey = 'row_article_section_details';
        document.body.appendChild(label);
        window.translationPromises.fi = Promise.resolve({ row_article_section_details: 'Lisätiedot' });
        window.translationPromises.en = Promise.resolve({ row_article_section_details: 'More details' });
        const { translatePage } = await import('./translation_handler.js');
        await translatePage('fi');
        expect(label.textContent).toBe('Lisätiedot');
        await translatePage('en');
        expect(label.textContent).toBe('More details');
        expect(endpoint_router).not.toHaveBeenCalled();
    });

});
