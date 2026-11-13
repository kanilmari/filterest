// row_article_page_reading.js
// Keeps the Page article's reading fields in the language selected for their content.
// Uses the regular article builder on a language change so missing, new and duplicate headings follow its rules.
// The selected picture stays mounted while the article's text is refreshed.

import { bindDatasetLanguageRenderer } from '../dataset_value_localizer.js';
import { getLanguageWithBrowserFallback } from '../../state_stores/lang_preference_reader.js';
import { hyphenateReadingField } from '../../../reusable_components/reading_hyphenation/reading_hyphenation.js';
import { disposeCardResources } from './card_resource_lifecycle.js';

function hyphenateFields(content) {
    for (const field of content.querySelectorAll('.big_card_header_value, .big_description_value')) {
        void hyphenateReadingField(field, field.dataset.readingLanguage ?? field.dataset.articleHeadingLanguage);
    }
}

/** Register on the disposable page shell, retaining no records after close. */
export function bindPageArticleReading(shell, initialContent, rebuild, initialLanguage) {
    let content = initialContent;
    let renderedLanguage = initialLanguage;
    let revision = 0;
    hyphenateFields(content);
    return bindDatasetLanguageRenderer(shell, async language => {
        const current = ++revision;
        if (language === renderedLanguage || !shell.isConnected) return;
        const next = await rebuild(language);
        if (!next || current !== revision || !content.isConnected || !shell.contains(content)) {
            if (next) disposeCardResources(next);
            return;
        }
        const expanded = content.querySelector(':scope > .row_article_details_section')?.dataset.disclosureState;
        const details = next.querySelector(':scope > .row_article_details_section');
        if (expanded === 'expanded') details?.expand?.({ animate: false });
        if (expanded === 'collapsed') details?.collapse?.({ animate: false });
        const picture = content.querySelector(':scope > .row_article_page_image');
        if (picture) next.prepend(picture);
        hyphenateFields(next);
        content.replaceWith(next);
        disposeCardResources(content);
        content = next;
        renderedLanguage = language;
    }, getLanguageWithBrowserFallback());
}
