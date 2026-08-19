// row_article_presentation.js
// Places image-first article details and builds bounded result-row navigation.
// Bridges site configuration, image-first DOM ordering, and the already-filtered card result set.
// Exists to keep the standalone image-first view independent from the ordinary article opener.

import { getTranslationForKey } from "../../lang/translation_handler.js";
import {
    normalizeRowArticleDetailsPosition,
    ROW_ARTICLE_DETAILS_POSITIONS,
} from "./row_article_presentation_options.js";

export {
    normalizeRowArticleDetailsPosition,
    ROW_ARTICLE_DETAILS_POSITIONS,
} from "./row_article_presentation_options.js";

/**
 * Places the details disclosure immediately before or after the description.
 * Invalid metadata is normalized to the stable after-description layout.
 */
export function placeRowArticleDetails(contentElement, requestedPosition) {
    if (!(contentElement instanceof HTMLElement)) {
        return;
    }

    const details = contentElement.querySelector(":scope > .row_article_details_section");
    if (!details) {
        return;
    }

    const position = normalizeRowArticleDetailsPosition(requestedPosition);
    const description = contentElement.querySelector(":scope > .big_card_description_container");
    if (description) {
        if (position === ROW_ARTICLE_DETAILS_POSITIONS.BETWEEN_TITLE_AND_DESCRIPTION) {
            description.before(details);
        } else {
            description.after(details);
        }
        return;
    }

    const titleAnchor = contentElement.querySelector(
        ":scope > .ticket_status_badge--big, :scope > .big_card_header:last-of-type",
    );
    if (titleAnchor) {
        titleAnchor.after(details);
    } else {
        contentElement.prepend(details);
    }
}

function createRowNavigationButton({ direction, disabled, onActivate }) {
    const isPrevious = direction === "previous";
    const langKey = isPrevious ? "previous_row" : "next_row";
    const fallback = isPrevious ? "Previous record" : "Next record";
    const button = document.createElement("button");
    button.type = "button";
    button.classList.add(
        "row_article_row_navigation_button",
        "fw-btn",
        "fw-btn--ghost",
    );
    button.dataset.testid = `row-article-${direction}-row`;
    button.dataset.titleLangKey = langKey;
    button.dataset.ariaLabelLangKey = langKey;
    button.textContent = isPrevious ? "«" : "»";
    button.title = getTranslationForKey(langKey) || fallback;
    button.setAttribute("aria-label", button.title);
    button.disabled = disabled;
    button.addEventListener("click", onActivate);
    return button;
}

/**
 * Builds experimental row navigation from cards already returned by the active
 * query. It performs no unrestricted fetch, so filters, sorting, and row-level
 * permissions remain exactly those of the visible result set.
 */
export function buildRowArticleRowNavigation({
    cardContainer,
    currentRowId,
    onNavigate,
} = {}) {
    if (!(cardContainer instanceof HTMLElement) || typeof onNavigate !== "function") {
        return null;
    }

    const resultCards = Array.from(cardContainer.querySelectorAll(":scope > .card[data-id]"));
    const currentIndex = resultCards.findIndex(
        (card) => String(card.dataset.id) === String(currentRowId),
    );
    if (currentIndex < 0) {
        return null;
    }

    const navigation = document.createElement("nav");
    navigation.classList.add("row_article_row_navigation");
    navigation.dataset.testid = "row-article-row-navigation";
    const navigationLabel = getTranslationForKey("article_records") || "Article records";
    navigation.dataset.ariaLabelLangKey = "article_records";
    navigation.setAttribute("aria-label", navigationLabel);

    const navigateToIndex = (targetIndex) => {
        const targetCard = resultCards[targetIndex];
        if (!targetCard?._row) {
            return;
        }
        onNavigate(targetCard._row, targetCard);
    };

    navigation.append(
        createRowNavigationButton({
            direction: "previous",
            disabled: currentIndex === 0,
            onActivate: () => navigateToIndex(currentIndex - 1),
        }),
        createRowNavigationButton({
            direction: "next",
            disabled: currentIndex === resultCards.length - 1,
            onActivate: () => navigateToIndex(currentIndex + 1),
        }),
    );
    return navigation;
}
