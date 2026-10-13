// article_toolbar_permission_names.js
// Supplies four-language names for article controls in the existing group-rights editor.
// Connects language keys and reviewed site translations with readable bootstrap copy.
// Keeps the new permissions understandable before a site has authored their translations.

import { getTranslationForKey } from '../lang/translation_handler.js';
import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';

export const ARTICLE_PERMISSION_NAMES = Object.freeze({
    ui_article_section_details: { fi: 'Artikkeli: Tiedot', en: 'Article: Details', ch: '文章：详情', yue: '文章：詳情' },
    ui_article_section_images: { fi: 'Artikkeli: Kuvat', en: 'Article: Images', ch: '文章：图片', yue: '文章：圖片' },
    ui_article_section_attachments: { fi: 'Artikkeli: Liitteet', en: 'Article: Attachments', ch: '文章：附件', yue: '文章：附件' },
    ui_article_section_related_rows: { fi: 'Artikkeli: Liittyvät rivit', en: 'Article: Related rows', ch: '文章：相关行', yue: '文章：相關資料列' },
    ui_article_section_task_progress: { fi: 'Artikkeli: Tehtävän edistyminen', en: 'Article: Task progress', ch: '文章：任务进度', yue: '文章：工作進度' },
    ui_article_action_edit: { fi: 'Artikkeli: Muokkaa', en: 'Article: Edit', ch: '文章：编辑', yue: '文章：編輯' },
    ui_article_action_edit_language_versions: { fi: 'Artikkeli: Muokkaa kieliversioita', en: 'Article: Edit language versions', ch: '文章：编辑语言版本', yue: '文章：編輯語言版本' },
    ui_article_action_delete: { fi: 'Artikkeli: Poista', en: 'Article: Delete', ch: '文章：删除', yue: '文章：刪除' },
});

/** Localizes just the article permission names, preserving every other editor label. */
export function localizeArticlePermissionName(name, element) {
    const key = String(name || '').replaceAll('.', '_');
    const copy = ARTICLE_PERMISSION_NAMES[key];
    if (!copy) return;
    const language = getLanguageWithBrowserFallback();
    element.dataset.articlePermissionName = name;
    element.textContent = getTranslationForKey(key, {
        language, fallback: copy[language] || copy.en, countUsage: false,
    });
}

/** Refreshes connected labels after a language change without replacing permission drafts. */
export function refreshArticlePermissionNames(root) {
    root.querySelectorAll('[data-article-permission-name]').forEach(element => {
        localizeArticlePermissionName(element.dataset.articlePermissionName, element);
    });
}
