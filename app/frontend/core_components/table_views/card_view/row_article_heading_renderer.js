// row_article_heading_renderer.js
// Applies the article-only one-title outline to built, sanitized field DOM.
// Connects the shared content builder and return from inline editing to one rule.
// Retains raw field attributes so editing always opens the complete authored text.

import { findMatchingFirstHeading } from './row_article_heading_match.js';

const renderedFields = new WeakMap();

/** Apply once per freshly rendered field, including after save or cancel. */
export function applyRowArticleHeadingRules(container) {
    if (!container.classList.contains('row_article_content')) return;
    const titles = Array.from(container.querySelectorAll('.big_card_header_value'));
    const titleSignature = JSON.stringify(titles.map(title => [title.textContent, title.dataset.articleHeadingLanguage]));
    for (const field of container.querySelectorAll('.big_description_value')) {
        if (field.dataset.langKey) continue;
        const previous = renderedFields.get(field);
        if (field.dataset.articleHeadingProcessed) {
            if (!previous || previous.titleSignature === titleSignature) continue;
            // A title-only edit must also restore a previously omitted heading in read-only content.
            field.innerHTML = previous.html;
        }
        renderedFields.set(field, { html: field.innerHTML, titleSignature });
        for (const title of titles) {
            const heading = findMatchingFirstHeading(field, title.textContent,
                field.dataset.articleHeadingLanguage, title.dataset.articleHeadingLanguage);
            if (heading) { heading.remove(); break; }
        }
        field.dataset.articleHeadingProcessed = 'true';
    }
    for (const heading of container.querySelectorAll('h1:not(.big_card_header)')) {
        const demoted = document.createElement('h2');
        for (const { name, value } of heading.attributes) demoted.setAttribute(name, value);
        demoted.dataset.demotedFrom = 'h1';
        demoted.append(...heading.childNodes);
        heading.replaceWith(demoted);
    }
}
