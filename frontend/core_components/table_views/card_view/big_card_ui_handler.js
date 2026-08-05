// big_card_ui_handler.js
// Coordinates big-card UI state, scroll handling, and highlighted-card behavior.
// Bridges card content rendering and navigation state with the expanded card experience.
// Exists to keep big-card interaction rules centralized instead of scattering them across card builders.

import { count_this_function } from "../../dev_tools/function_counter.js";
import { extractLangValue } from "../../../reusable_components/lang_value_reader.js";
import {
    renderAllowedHtml,
    containsAllowedHtml,
} from "../../../reusable_components/dom_container_builder.js";
import { appendConfiguredCardDetailIcon } from "./card_detail_single_line_helpers.js";
import { setUnifiedTableState } from "../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js";
import { DATASET_PREFIX } from "../../navigation/nav_engine/query_params.js";
import { buildDatasetPath } from "../../navigation/nav_engine/dataset_aliases.js";
import { isDatasetRowPath } from "../../navigation/nav_engine/history_navigation_handler_helpers.js";
import { getLanguageWithBrowserFallback } from "../../state_stores/lang_preference_reader.js";
import { formatTimestampDisplayParts } from "../timestamp_display_formatter.js";

let highlightedCard = null;
const OPEN_IN_NEW_TAB_LANG_KEY = "open_in_new_tab";
const OPEN_IN_NEW_TAB_FALLBACK = "Avaa uudessa välilehdessä";
const OPEN_IN_NEW_TAB_ICON_PATHS = [
    "M14 3h7v7",
    "M10 14 21 3",
    "M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5",
];

/** Scroll position saved before opening big card, restored on close. */
let _savedScrollY = 0;
export function saveScrollBeforeBigCard() { _savedScrollY = window.scrollY; }
export function restoreScrollAfterBigCard() { window.scrollTo(0, _savedScrollY); }

export function saveScrollBeforeRowArticle() { saveScrollBeforeBigCard(); }
export function restoreScrollAfterRowArticle() { restoreScrollAfterBigCard(); }

export function updateHighlightedCard(newCard) {
    if (highlightedCard && highlightedCard !== newCard) {
        highlightedCard.classList.remove("highlighted");
        highlightedCard.classList.remove("active_card");
    }
    if (newCard) {
        newCard.classList.add("highlighted");
        newCard.classList.add("active_card");
    }
    highlightedCard = newCard;
}

export function resolveLocalizedValue(value, isMultilingual = null) {
    const chosenLang = getLanguageWithBrowserFallback();
    return extractLangValue(value, chosenLang, isMultilingual);
}

export function resolveRowArticleLocalizedValue(value, isMultilingual = null) {
    return resolveLocalizedValue(value, isMultilingual);
}

function appendOpenInNewTabIcon(linkElement) {
    linkElement.classList.add("open-in-new-tab-icon-button");
    linkElement.dataset.titleLangKey = OPEN_IN_NEW_TAB_LANG_KEY;
    linkElement.dataset.ariaLabelLangKey = OPEN_IN_NEW_TAB_LANG_KEY;
    linkElement.title = OPEN_IN_NEW_TAB_FALLBACK;
    linkElement.setAttribute("aria-label", OPEN_IN_NEW_TAB_FALLBACK);

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.classList.add("open-in-new-tab-icon");

    OPEN_IN_NEW_TAB_ICON_PATHS.forEach((pathData) => {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", pathData);
        svg.appendChild(path);
    });

    linkElement.appendChild(svg);
}

/**
 * Luo avain–arvo-elementin kahdelle riville.
 *  • Label-riville asetetaan data-lang-key = "<sarakkeen_nimi>".
 *  • Fallback-tekstinä näytetään edelleen format_column_name:in palauttama arvo.
 */
export function createTwoLineKeyValueElement(
    label,
    value,
    column,
    hasLangKey,
    className,
    showKey = true,
    isMultilingual = null,
    storedRawValue = value,
    labelMeta = {}
) {
    count_this_function("createTwoLineKeyValueElement"); // 🔢

    const container = document.createElement("div");
    container.classList.add("two_line_field");

    /* ---------- LABEL ---------- */
    if (showKey) {
        container.appendChild(createTwoLineLabelElement({
            label,
            labelKey: column,
            column,
            labelMeta,
        }));
    }

    /* ---------- VALUE ---------- */
    const valueDiv = document.createElement("div");
    valueDiv.classList.add(className, "two_line_value");
    valueDiv.setAttribute("data-column", column);
    valueDiv.setAttribute("data-raw-value", storedRawValue);

    if (hasLangKey) {
        valueDiv.dataset.langKey = value;
    } else {
        const resolved = resolveLocalizedValue(value, isMultilingual);
        const timestampDisplay = formatTimestampDisplayParts(resolved, labelMeta);
        const displayText = timestampDisplay?.displayText ?? resolved;
        if (timestampDisplay?.titleText) {
            valueDiv.title = timestampDisplay.titleText;
        }
        if (containsAllowedHtml(displayText)) {
            valueDiv.appendChild(renderAllowedHtml(displayText));
        } else {
            valueDiv.textContent = displayText;
            valueDiv.style.whiteSpace = "pre-wrap";
        }
    }

    container.appendChild(valueDiv);
    return container;
}

export function createRowArticleKeyValueElement(...args) {
    return createTwoLineKeyValueElement(...args);
}

/**
 * Luo label–linkki-yhdistelmän kahdelle riville (details_link-rooli).
 * Label saa data-lang-key = "<sarakkeen_nimi>", arvo vain jos hasLangKey = true.
 */
export function createLinkTwoLine(
    label,
    linkValue,
    column,
    hasLangKey,
    showKey = true,
    isMultilingual = null,
    storedRawValue = linkValue,
    labelMeta = {}
) {
    count_this_function("createLinkTwoLine"); // 🔢

    const container = document.createElement("div");
    container.classList.add("two_line_field");

    /* ---------- LABEL ---------- */
    if (showKey) {
        container.appendChild(createTwoLineLabelElement({
            label,
            labelKey: column,
            column,
            labelMeta,
        }));
    }

    /* ---------- VALUE ---------- */
    const valueDiv = document.createElement("div");
    valueDiv.classList.add("big_card_detail_value", "two_line_value");
    valueDiv.setAttribute("data-column", column);
    valueDiv.setAttribute("data-raw-value", storedRawValue);

    if (hasLangKey) {
        valueDiv.dataset.langKey = linkValue;
    } else {
        const linkEl = document.createElement("a");
        const resolved = resolveLocalizedValue(linkValue, isMultilingual);
        const trimmed = resolved.trim();
        linkEl.href = trimmed;
        linkEl.target = "_blank";
        linkEl.textContent = trimmed;
        valueDiv.appendChild(linkEl);
    }

    container.appendChild(valueDiv);
    return container;
}

export function createRowArticleLinkTwoLine(...args) {
    return createLinkTwoLine(...args);
}

export function createNavigableTwoLineElement({
    label,
    labelKey,
    value,
    column = "",
    dataColumn = column,
    className = "big_card_detail_value",
    showKey = true,
    href = "",
    openInNewTabHref = "",
    openPrimaryInNewTab = false,
    storedRawValue = value,
    labelMeta = {},
}) {
    count_this_function("createNavigableTwoLineElement"); // 🔢

    const container = document.createElement("div");
    container.classList.add("two_line_field");

    if (showKey) {
        container.appendChild(createTwoLineLabelElement({
            label,
            labelKey: labelKey || column,
            column,
            labelMeta,
        }));
    }

    const valueDiv = document.createElement("div");
    valueDiv.classList.add(className, "two_line_value");

    if (dataColumn) {
        valueDiv.setAttribute("data-column", dataColumn);
        valueDiv.setAttribute("data-raw-value", storedRawValue);
    }

    const resolvedValue = String(value ?? "");
    const resolvedHref = String(href || "").trim();
    const resolvedNewTabHref = String(openInNewTabHref || resolvedHref).trim();

    if (resolvedHref) {
        const linkGroup = document.createElement("span");
        linkGroup.classList.add("two_line_link_group");

        const linkEl = document.createElement("a");
        linkEl.href = resolvedHref;
        linkEl.textContent = resolvedValue;
        if (openPrimaryInNewTab) {
            linkEl.target = "_blank";
            linkEl.rel = "noopener noreferrer";
        }
        linkGroup.appendChild(linkEl);

        if (resolvedNewTabHref) {
            const openLink = document.createElement("a");
            openLink.href = resolvedNewTabHref;
            openLink.target = "_blank";
            openLink.rel = "noopener noreferrer";
            openLink.classList.add("two_line_new_tab_button");
            appendOpenInNewTabIcon(openLink);
            linkGroup.appendChild(openLink);
        }

        valueDiv.appendChild(linkGroup);
    } else {
        valueDiv.textContent = resolvedValue;
        valueDiv.style.whiteSpace = "pre-wrap";
    }

    container.appendChild(valueDiv);
    return container;
}

export function createRowArticleNavigableElement(options) {
    return createNavigableTwoLineElement(options);
}

function createTwoLineLabelElement({
    label,
    labelKey,
    column,
    labelMeta = {},
}) {
    const labelDiv = document.createElement("div");
    labelDiv.classList.add("two_line_label");

    const iconContainer = document.createElement("span");
    iconContainer.className = "two_line_label_icon";
    const renderedIcon = appendConfiguredCardDetailIcon(
        iconContainer,
        labelMeta,
        column
    );
    if (renderedIcon) {
        iconContainer.setAttribute("aria-hidden", "true");
        labelDiv.classList.add("two_line_label--with-icon");
        labelDiv.appendChild(iconContainer);
    }

    const labelText = document.createElement("span");
    labelText.className = "two_line_label_text";
    labelText.dataset.langKey = String(labelKey || column).toLowerCase();
    labelText.textContent = label;
    labelDiv.appendChild(labelText);

    return labelDiv;
}

function dispatchCardArticleToggle(tableName, isOpen) {
    if (!tableName) {
        return;
    }

    const detail = { tableName, isOpen };
    document.dispatchEvent(
        new CustomEvent("big-card-toggle", { detail })
    );
    document.dispatchEvent(
        new CustomEvent("row-article-toggle", { detail })
    );
}

export function closeBigCard(
    wrapper,
    card_container,
    big_card_div,
    selectedCard,
    table_name,
    skipHistoryBack = false
) {
    big_card_div.remove();
    wrapper.classList.remove("big-card-open");

    // Restore URL from /{dataset}/{id} back to /{dataset}
    // Use history.back() so the card URL entry is popped (no duplicate entries).
    // A flag tells the popstate handler to skip re-navigation since closeBigCard
    // already cleaned up the DOM.
    // If the current state was NOT pushed by open_big_card_view (e.g. direct URL),
    // fall back to replaceState to avoid navigating away entirely.
    if (!skipHistoryBack && table_name) {
        const datasetPath = buildDatasetPath(table_name, DATASET_PREFIX);
        const currentPath = window.location.pathname;
        if (isDatasetRowPath(currentPath, DATASET_PREFIX, table_name)) {
            if (history.state?.bigCard === true) {
                window.__bigCardClosing = true;
                history.back();
            } else {
                history.replaceState(
                    { bigCard: false, dataset: table_name },
                    "",
                    datasetPath
                );
            }
        }
    }
    // Restore scroll position that was saved when the card was opened
    restoreScrollAfterBigCard();
    dispatchCardArticleToggle(table_name, false);
    Array.from(card_container.children).forEach((c) => {
        c.classList.remove("small-card");
    });
    if (selectedCard) {
        selectedCard.classList.remove("highlighted");
        selectedCard.classList.remove("active_card");
    }
    if (highlightedCard === selectedCard) highlightedCard = null;
    if (table_name) {
        setUnifiedTableState(table_name, {
            cardView: { collapsed: false, expandedId: null },
        });
    }
}

export function closeRowArticle(...args) {
    return closeBigCard(...args);
}
