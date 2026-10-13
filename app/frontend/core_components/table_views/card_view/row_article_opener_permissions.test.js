// @vitest-environment jsdom
// row_article_opener_permissions.test.js
// Proves article row actions intersect independent UI grants with existing row rights.
// Connects the real shared opener to its isolated navigation and network fixtures.
// Prevents a language-edit grant from requiring or revealing the ordinary edit button.

import { describe, expect, test, vi } from 'vitest';
import { setupRowArticleOpenerTests } from './row_article_opener_test_setup.js';
import { openRowArticleView } from './row_article_opener.js';
import { ROW_ARTICLE_PERMISSION_ROUTES } from './row_article_permission_checker.js';
import { hasDatasetPermission } from '../../route_permission_checker.js';
import { createArticleLanguageEditor } from '../article_view/article_language_editor.js';

const actions = {
    edit: '[data-testid="big-card-edit-button"]',
    edit_language_versions: '[data-testid="article-language-editor-button"]',
    delete: '[data-testid="big-card-delete"]',
};

describe('article row action permissions', () => {
    setupRowArticleOpenerTests();

    async function open(grants, rowRights = true) {
        sessionStorage.setItem('user_permissions', JSON.stringify(grants));
        vi.mocked(hasDatasetPermission).mockResolvedValue(rowRights);
        vi.mocked(createArticleLanguageEditor).mockImplementation(() => {
            const button = document.createElement('button');
            button.dataset.testid = 'article-language-editor-button';
            return { button, panel: document.createElement('div'), setDisabled: vi.fn() };
        });
        document.body.innerHTML = '<div id="events_article_view_container"><div class="card_view_wrapper">'
            + '<div class="card_container"><div class="card" data-id="42"></div></div>'
            + '<div class="row_article_placeholder"></div></div></div>';
        await openRowArticleView({ id: 42, title: 'Article' }, 'events', document.querySelector('.card'));
        expect(document.querySelector('.active_row_article')).not.toBeNull();
    }

    test('administrator grants allow every applicable row action', async () => {
        await open(Object.values(ROW_ARTICLE_PERMISSION_ROUTES));
        for (const selector of Object.values(actions)) expect(document.querySelector(selector)).not.toBeNull();
    });

    test.each(['user', 'guest'])('%s defaults build no configurable actions even with row rights', async () => {
        await open([ROW_ARTICLE_PERMISSION_ROUTES.details]);
        for (const selector of Object.values(actions)) expect(document.querySelector(selector)).toBeNull();
        expect(createArticleLanguageEditor).not.toHaveBeenCalled();
    });

    test.each(Object.keys(actions))('granting %s reveals exactly that button', async (key) => {
        await open([ROW_ARTICLE_PERMISSION_ROUTES.details, ROW_ARTICLE_PERMISSION_ROUTES[key]]);
        for (const [action, selector] of Object.entries(actions)) {
            expect(Boolean(document.querySelector(selector))).toBe(action === key);
        }
        if (key === 'edit_language_versions') {
            const callback = vi.mocked(createArticleLanguageEditor).mock.calls[0][0].onActiveChange;
            expect(() => callback(true)).not.toThrow();
        }
    });

    test('UI grants do not bypass existing update and delete rights', async () => {
        await open(Object.values(ROW_ARTICLE_PERMISSION_ROUTES), false);
        for (const selector of Object.values(actions)) expect(document.querySelector(selector)).toBeNull();
        expect(createArticleLanguageEditor).not.toHaveBeenCalled();
    });
});
