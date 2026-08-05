// product_card_view_printer.js
// Renders dense product-style cards for generic dataset rows.
// Bridges table-view row payloads, resolved product-card fields, and row-article opening behavior.
// Exists to provide a reusable listing-card view without adding backend-specific product code.

import { openRowArticleView } from "../card_view/row_article_opener.js";
import { getLanguageWithBrowserFallback } from "../../state_stores/lang_preference_reader.js";
import { setUnifiedTableState } from "../../state_stores/table_state_store.js";
import { resolveProductCardFields } from "./product_card_view_field_resolver.js";
import {
    bindDatasetLanguageRenderer,
    refreshLocalizedDatasetValues,
} from "../dataset_value_localizer.js";

const TITLE_FALLBACK_LANG_KEY = "untitled";
const EMPTY_STATE_LANG_KEY = "no_rows";
const NO_IMAGE_LANG_KEY = "no_image";
const MAX_TITLE_LENGTH = 120;
const MAX_DETAIL_LENGTH = 96;

/**
 * Creates the product-card dataset view.
 *
 * @param {string} table_name - Dataset/table name.
 * @param {string[]} columns - Visible columns supplied by the dataset renderer.
 * @param {Object<string, *>[]} data - Row payloads to render.
 * @param {Object<string, object>} data_types - Column metadata from system_column_details.
 * @returns {HTMLElement}
 */
export function create_product_card_view(
    table_name,
    columns,
    data,
    data_types = {}
) {
    const preferredLanguage = getLanguageWithBrowserFallback();
    const safeColumns = Array.isArray(columns) ? columns : [];
    const safeData = Array.isArray(data) ? data : [];
    const safeDataTypes = data_types || {};

    const wrapper = document.createElement("div");
    wrapper.classList.add("product-card-view");
    wrapper.dataset.tableName = table_name;
    wrapper.dataset.testid = "product-card-view";

    const context = {
        tableName: table_name,
        columns: safeColumns,
        rows: safeData,
        dataTypes: safeDataTypes,
    };
    bindDatasetLanguageRenderer(
        wrapper,
        (chosenLanguage) => renderProductCardView(wrapper, context, chosenLanguage),
        preferredLanguage
    );
    return wrapper;
}

/**
 * Refreshes mounted product cards after the active language changes.
 * Operates between retained raw row data and already rendered product-card roots.
 * Exists so titles and details switch language without refetching or mutating rows.
 *
 * @param {string} chosenLanguage - Active UI language code.
 */
export function refreshProductCardLanguages(
    chosenLanguage = getLanguageWithBrowserFallback()
) {
    return refreshLocalizedDatasetValues(chosenLanguage, document);
}

function renderProductCardView(wrapper, context, preferredLanguage) {
    wrapper.replaceChildren();
    if (context.rows.length === 0) {
        wrapper.appendChild(createEmptyState());
        return;
    }

    const grid = document.createElement("div");
    grid.classList.add("product-card-view-grid");
    grid.dataset.testid = "product-card-view-grid";

    for (const rowItem of context.rows) {
        grid.appendChild(
            createProductCard({
                rowItem,
                columns: context.columns,
                tableName: context.tableName,
                dataTypes: context.dataTypes,
                preferredLanguage,
            })
        );
    }

    wrapper.appendChild(grid);
}

/**
 * Builds one product-card DOM node from a dataset row.
 *
 * @param {object} options - Row rendering context.
 * @returns {HTMLElement}
 */
function createProductCard({
    rowItem,
    columns,
    tableName,
    dataTypes,
    preferredLanguage,
}) {
    const { title, image, detailEntries } = resolveProductCardFields({
        rowItem,
        columns,
        tableName,
        dataTypes,
        preferredLanguage,
    });

    const card = document.createElement("article");
    card.classList.add("product-card-view-card", "saturate_on_hover");
    card.dataset.testid = "product-card";
    card.dataset.tableName = tableName;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", title.text);
    if (rowItem?.id != null) {
        card.dataset.rowId = String(rowItem.id);
        card.dataset.id = String(rowItem.id);
    }

    card.appendChild(createMediaElement(image, title.text));
    card.appendChild(createBodyElement(title, detailEntries));
    attachRowOpenBehavior(card, rowItem, tableName);

    return card;
}

/**
 * Creates the image/placeholder area for one product card.
 *
 * @param {{src: string, column: string|null}} image
 * @param {string} titleText
 * @returns {HTMLElement}
 */
function createMediaElement(image, titleText) {
    const media = document.createElement("div");
    media.classList.add("product-card-view-media");

    if (image.src) {
        const img = document.createElement("img");
        img.classList.add("product-card-view-image");
        img.src = image.src;
        img.alt = titleText;
        img.loading = "lazy";
        img.decoding = "async";
        media.appendChild(img);
        return media;
    }

    const placeholder = document.createElement("div");
    placeholder.classList.add("product-card-view-image-placeholder");
    const initial = titleText.trim()[0] || "";
    if (initial) {
        placeholder.textContent = initial.toUpperCase();
    } else {
        placeholder.dataset.langKey = NO_IMAGE_LANG_KEY;
        placeholder.textContent = "No image";
    }
    media.appendChild(placeholder);
    return media;
}

/**
 * Creates title and detail content for one product card.
 *
 * @param {{text: string, column: string|null, isFallback: boolean}} title
 * @param {Array<{column: string, label: string, value: string}>} detailEntries
 * @returns {HTMLElement}
 */
function createBodyElement(title, detailEntries) {
    const body = document.createElement("div");
    body.classList.add("product-card-view-body");

    const heading = document.createElement("h3");
    heading.classList.add("product-card-view-title");
    heading.dataset.testid = "product-card-title";
    heading.textContent = truncateText(title.text, MAX_TITLE_LENGTH);
    heading.title = title.text;
    if (title.isFallback) {
        heading.dataset.langKey = TITLE_FALLBACK_LANG_KEY;
    }
    body.appendChild(heading);

    if (detailEntries.length > 0) {
        const details = document.createElement("dl");
        details.classList.add("product-card-view-details");
        details.dataset.testid = "product-card-details";

        for (const entry of detailEntries) {
            details.appendChild(createDetailElement(entry));
        }

        body.appendChild(details);
    }

    return body;
}

/**
 * Creates one label/value detail row.
 *
 * @param {{column: string, label: string, value: string}} entry
 * @returns {HTMLElement}
 */
function createDetailElement(entry) {
    const row = document.createElement("div");
    row.classList.add("product-card-view-detail");
    row.dataset.column = entry.column;

    const label = document.createElement("dt");
    label.classList.add("product-card-view-detail-label");
    label.dataset.langKey = entry.column;
    label.textContent = entry.label;

    const value = document.createElement("dd");
    value.classList.add("product-card-view-detail-value");
    value.textContent = truncateText(entry.value, MAX_DETAIL_LENGTH);
    value.title = entry.value;

    row.appendChild(label);
    row.appendChild(value);
    return row;
}

/**
 * Adds click and keyboard row-opening behavior matching small-card affordances.
 *
 * @param {HTMLElement} card
 * @param {Object<string, *>} rowItem
 * @param {string} tableName
 */
function attachRowOpenBehavior(card, rowItem, tableName) {
    card.addEventListener("click", (event) => {
        if (isInteractiveChildClick(event)) {
            return;
        }
        void openProductRowArticle(rowItem, tableName, card);
    });

    card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
            return;
        }
        event.preventDefault();
        void openProductRowArticle(rowItem, tableName, card);
    });
}

async function openProductRowArticle(rowItem, tableName, card) {
    const rowId = rowItem?.id;
    if (rowId == null) {
        openRowArticleView(rowItem, tableName, card);
        return;
    }

    localStorage.setItem(`${tableName}_view`, "card");
    setUnifiedTableState(tableName, {
        cardView: {
            collapsed: true,
            expandedId: rowId,
        },
    });

    const { refreshTableUnified } = await import(
        "../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js"
    );
    await refreshTableUnified(tableName, { skipUrlParams: true });
}

function isInteractiveChildClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) {
        return false;
    }

    return Boolean(
        target.closest(
            "a, button, input, textarea, select, [data-product-card-ignore-open]"
        )
    );
}

function createEmptyState() {
    const emptyState = document.createElement("div");
    emptyState.classList.add("product-card-view-empty");
    emptyState.dataset.langKey = EMPTY_STATE_LANG_KEY;
    emptyState.dataset.testid = "product-card-empty";
    emptyState.textContent = "No rows";
    return emptyState;
}

function truncateText(value, maxLength) {
    const text = String(value ?? "");
    if (text.length <= maxLength) {
        return text;
    }

    return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}
