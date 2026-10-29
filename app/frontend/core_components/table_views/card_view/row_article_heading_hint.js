// row_article_heading_hint.js
// Shows a polite, advisory duplicate-title hint below article content editors.
// Connects both existing article editors with the rendering match contract.
// Reads drafts without modifying controls, validation, saving or stored content.

import { getTranslationForKey } from '../../lang/translation_handler.js';
import { LOCAL_TRANSLATION_FALLBACKS } from '../../lang/local_translation_fallback_catalog.js';
import { getLanguageWithBrowserFallback } from '../../state_stores/lang_preference_reader.js';
import { findMatchingFirstHeading, resolveHeadingLanguage } from './row_article_heading_match.js';
import { resolveRecordTitle } from '../record_title_resolver.js';

const HINT_KEY = 'row_article_repeated_title_hint';
const inlineListeners = new WeakMap();

/** Use the same authorized title and actual locale as article rendering. */
export function articleHeadingTitlesForLanguage(row, columns, dataTypes, tableName, language, currentUserID = null) {
    const title = resolveRecordTitle({ rowItem: row, columns, dataTypes, tableName,
        preferredLanguage: language, surface: 'article', currentUserID });
    return (title.headers.length ? title.headers : [title]).map(heading => ({ text: heading.text,
        language: heading.language }));
}

/** A persistent live region receives text only while the exact match holds. */
export function createArticleHeadingHint(input, readTitles, readLanguage) {
    const hint = document.createElement('span');
    hint.className = 'row-article-heading-hint';
    hint.setAttribute('aria-live', 'polite');
    const update = () => {
        const language = readLanguage();
        const matches = readTitles().some(title => findMatchingFirstHeading(
            input.value, title.text, language, title.language));
        const uiLanguage = getLanguageWithBrowserFallback();
        const fallback = LOCAL_TRANSLATION_FALLBACKS[HINT_KEY][uiLanguage.startsWith('fi') ? 'fi' : 'en'];
        const text = matches ? getTranslationForKey(HINT_KEY, { fallback }) : '';
        if (hint.textContent !== text) hint.textContent = text;
    };
    input.after(hint);
    update();
    return update;
}

/** Install once per inline edit session, after its complete set of controls exists. */
export function attachRowArticleHeadingHints(container, dataTypes) {
    if (!container.classList.contains('row_article_content')) return;
    const previous = inlineListeners.get(container);
    if (previous) {
        container.removeEventListener('input', previous);
        container.removeEventListener('change', previous);
    }
    const updates = [];
    const titles = () => Array.from(container.querySelectorAll('.big_card_header_value'), field => {
        const control = field.querySelector('input, textarea');
        return { text: control?.value ?? field.textContent, language: control && field.dataset.multilangEditLang
            ? field.dataset.multilangEditLang : field.dataset.articleHeadingLanguage
                ?? resolveHeadingLanguage(field.dataset.rawValue, dataTypes[field.dataset.column]?.is_multilingual,
                    getLanguageWithBrowserFallback()) };
    });
    for (const field of container.querySelectorAll('.big_description_value')) {
        const input = field.querySelector('input, textarea');
        if (!input || field.dataset.langKey) continue;
        updates.push(createArticleHeadingHint(input, titles, () => field.dataset.multilangEditLang
            || (field.dataset.articleHeadingLanguage ?? resolveHeadingLanguage(field.dataset.rawValue,
                dataTypes[field.dataset.column]?.is_multilingual, getLanguageWithBrowserFallback()))));
    }
    // The existing language selector updates field values in its own bubbling listener first.
    const update = () => updates.forEach(update => update());
    container.addEventListener('input', update);
    container.addEventListener('change', update);
    inlineListeners.set(container, update);
    queueMicrotask(update);
}
