// row_article_heading_match.js
// Matches only an article content field's first heading against its shown title.
// Shared by article rendering and advisory editors; never changes stored values.
// Keeps entity, locale and first-block rules identical on both surfaces.

import { looksLikeLangValue } from '../../../reusable_components/lang_value_reader.js';

/** Decode entities before stripping inner markup; punctuation remains significant. */
export function normaliseHeadingText(text, language) {
    const decoder = document.createElement('textarea');
    decoder.innerHTML = String(text ?? '');
    const plain = new DOMParser().parseFromString(decoder.value, 'text/html').body.textContent.normalize('NFC');
    let folded;
    try { folded = language ? plain.toLocaleLowerCase(language) : plain.toLowerCase(); }
    catch { folded = plain.toLowerCase(); }
    return folded.replace(/\s+/gu, ' ').trim();
}

const languageCode = (value) => String(value || '').trim().toLowerCase().replaceAll('_', '-');

/** Resolve the actual language selected by extractLangValue, including its fallbacks. */
export function resolveHeadingLanguage(raw, isMultilingual, preferredLanguage) {
    if (isMultilingual === false) return '';
    let values;
    try { values = typeof raw === 'string' ? JSON.parse(raw) : raw; }
    catch { return ''; }
    if (!values || typeof values !== 'object' || Array.isArray(values)
        || isMultilingual !== true && !looksLikeLangValue(raw)) return '';
    const keys = Object.keys(values).filter(key => typeof values[key] === 'string');
    const preferred = languageCode(preferredLanguage);
    for (const language of [preferred, preferred.split('-')[0], 'en']) {
        const key = keys.find(key => languageCode(key) === language);
        if (key) return languageCode(key);
    }
    return languageCode(keys[0]);
}

/**
 * Leading whitespace/comments and empty p/div placeholders may precede the heading.
 * A paragraph, wrapper, inline text or other substantive node stops the search.
 */
export function findMatchingFirstHeading(content, title, language, titleLanguage) {
    if (!languageCode(language) || !languageCode(titleLanguage)
        || languageCode(language) !== languageCode(titleLanguage)) return null;
    const root = typeof content === 'string'
        ? new DOMParser().parseFromString(content, 'text/html').body : content;
    if (!root || !normaliseHeadingText(title, language || titleLanguage)) return null;
    for (const node of root.childNodes) {
        if (node.nodeType === Node.COMMENT_NODE) continue;
        if (node.nodeType === Node.TEXT_NODE) {
            if (!node.textContent.trim()) continue;
            return null;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return null;
        if (/^(P|DIV)$/.test(node.tagName) && !node.textContent.trim()
            && !node.querySelector('img, video, audio, iframe, hr, input, ul, ol, li, pre, blockquote, h1, h2, h3, h4, h5, h6')) continue;
        return /^H[1-6]$/.test(node.tagName)
            && normaliseHeadingText(node.innerHTML, language || titleLanguage)
                === normaliseHeadingText(title, language || titleLanguage) ? node : null;
    }
    return null;
}
