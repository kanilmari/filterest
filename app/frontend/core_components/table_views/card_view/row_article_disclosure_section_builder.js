// row_article_disclosure_section_builder.js
// Builds article-view disclosure sections on top of the shared animated disclosure primitive.
// Bridges row article content blocks and reusable accordion behavior.
// Exists so article tools can stack consistently below row details without custom toggle code.

import { createAnimatedDisclosureSection } from "../../../reusable_components/animated_disclosure/animated_disclosure_builder.js";

/**
 * Builds a persistent-header disclosure section for the row article surface.
 *
 * @param {{
 *   titleLangKey?: string,
 *   titleText: string,
 *   iconPath?: string,
 *   contentElement: HTMLElement,
 *   startOpen?: boolean,
 *   sectionClassNames?: string|string[],
 * }} options
 * @returns {HTMLElement}
 */
export function buildRowArticleDisclosureSection({
    titleLangKey = "",
    titleText,
    iconPath = "",
    contentElement,
    startOpen = true,
    sectionClassNames = [],
}) {
    return createAnimatedDisclosureSection({
        titleLangKey,
        titleText,
        iconPath,
        contentElement,
        startOpen,
        sectionClassNames: [
            "row_article_disclosure_section",
            sectionClassNames,
        ],
        headerClassNames: "row_article_disclosure_header",
        contentClassNames: "row_article_disclosure_content",
    });
}
