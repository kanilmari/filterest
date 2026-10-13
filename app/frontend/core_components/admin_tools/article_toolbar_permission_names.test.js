// @vitest-environment jsdom
// article_toolbar_permission_names.test.js
// Verifies every article permission has a readable name in the four shipped languages.
// Connects bootstrap copy and reviewed translation overrides to permission-editor labels.
// Preserves other permission names and refreshes article names without changing drafts.

import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ language: 'en', translation: vi.fn() }));
vi.mock('../state_stores/lang_preference_reader.js', () => ({ getLanguageWithBrowserFallback: () => mocks.language }));
vi.mock('../lang/translation_handler.js', () => ({ getTranslationForKey: mocks.translation }));
import { ARTICLE_PERMISSION_NAMES, localizeArticlePermissionName, refreshArticlePermissionNames } from './article_toolbar_permission_names.js';
import { ROW_ARTICLE_PERMISSION_ROUTES } from '../table_views/card_view/row_article_permission_checker.js';

beforeEach(() => {
    document.body.replaceChildren();
    mocks.translation.mockImplementation((_key, options) => options.fallback);
});

test.each(['fi', 'en', 'ch', 'yue'])('names all eight permissions in %s', (language) => {
    mocks.language = language;
    expect(Object.keys(ARTICLE_PERMISSION_NAMES)).toHaveLength(8);
    for (const route of Object.values(ROW_ARTICLE_PERMISSION_ROUTES)) {
        const name = route.slice(1).replaceAll('/', '.');
        const key = name.replaceAll('.', '_');
        const element = document.createElement('span');
        localizeArticlePermissionName(name, element);
        expect(element.textContent).toBe(ARTICLE_PERMISSION_NAMES[key][language]);
        expect(element.textContent.trim()).not.toBe('');
    }
});

test('reviewed translations take precedence and live language refresh keeps other labels', () => {
    const article = document.createElement('span');
    const other = document.createElement('span'); other.textContent = 'Existing view label';
    document.body.append(article, other);
    mocks.translation.mockReturnValue('Reviewed wording');
    localizeArticlePermissionName('ui.article.section.details', article);
    localizeArticlePermissionName('ui.view.card', other);
    mocks.language = 'yue';
    refreshArticlePermissionNames(document.body);
    expect(article.textContent).toBe('Reviewed wording');
    expect(mocks.translation).toHaveBeenLastCalledWith('ui_article_section_details', expect.objectContaining({ language: 'yue' }));
    expect(other.textContent).toBe('Existing view label');
});
