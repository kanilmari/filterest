// card_row_presentation.js
// Renders card detail layouts and the existing compact summary.
// Bridges existing card assembly with shared selection and presentation contracts.
// Exists to keep one card implementation within the source size limit.
import { createImageElement, create_seeded_avatar } from "./card_avatar_builder.js";
import { openRowArticleView } from "./row_article_opener.js";
import { format_column_name, createTicketStatusBadge } from "./card_field_formatter.js";
import { renderKeyValuePairs } from "../../../reusable_components/key_value_container/kv_container_printer.js";
import { kvDefaultOptions } from "../../../reusable_components/key_value_container/kv_config.js";
import { extractLangValue } from "../../../reusable_components/lang_value_reader.js";
import { predictCardImageCssWidth, resolveCardMediaFolderForImageWidth } from "../../../ui_config.js";
import { getLanguageWithBrowserFallback } from "../../state_stores/lang_preference_reader.js";
import { resolveImagePaths } from "./card_element_builder_helpers.js";
import { buildCardImageRenderOptions, CARD_IMAGE_RENDER_SLOTS } from "./card_image_render_options.js";
import { renderSingleLineCardDetails } from "./card_detail_single_line_helpers.js";
import { renderModernCardDetails } from "./card_detail_tile_builder.js";
import { CARD_DETAILS_LAYOUT_VALUES, CARD_STYLE_VARIANT_VALUES, normalizeClientCardDetailsLayout, normalizeClientCardStyleOverride, normalizeClientCardStyleVariant, resolveKvLayoutModeForCardDetails } from "./card_detail_layout_options.js";
import { createDatasetIconElement } from "./dataset_icon_builder.js";
import { decorateStandardCardDetailKey } from "./card_detail_standard_key_decorator.js";
import { formatTimestampDisplayParts } from "../timestamp_display_formatter.js";

export function hasLocalizedCardValue(rawVal, isMultilingual) {
    if (rawVal == null) {
        return false;
    }

    if (isMultilingual === true) {
        return true;
    }

    const str = String(rawVal).trim();
    if (!(str.startsWith("{") && str.endsWith("}"))) {
        return false;
    }

    try {
        const parsed = JSON.parse(str);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return false;
        }

        const keys = Object.keys(parsed);
        return keys.length > 0 && keys.every((key) => /^[a-z]{2,5}$/i.test(key));
    } catch {
        return false;
    }
}

export function getTableMetaFromStorage(tableName) {
    try {
        return JSON.parse(localStorage.getItem(`${tableName}_tableMeta`) || "{}") || {};
    } catch {
        return {};
    }
}

export function getCardDetailsLayout(tableName) {
    return normalizeClientCardDetailsLayout(
        getTableMetaFromStorage(tableName)?.card_details_layout
    );
}

export function getMetadataCardStyleVariant(tableName) {
    return normalizeClientCardStyleOverride(
        getTableMetaFromStorage(tableName)?.card_style_variant
    );
}

export function isTaskTodoStatusField(tableName, columnName) {
    return tableName === "dev_agent_task_todos" && columnName === "status";
}

function getTaskTodoStatusTone(status) {
    const key = String(status ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_");

    switch (key) {
        case "done":
            return "done";
        case "partially_done":
            return "progress";
        case "needs_review":
            return "awaiting";
        case "not_applicable":
            return "archived";
        case "todo":
        default:
            return "new";
    }
}

export function createTaskTodoStatusChip(status) {
    const normalized = String(status ?? "").trim();
    const chip = document.createElement("span");
    chip.classList.add("ticket_status_badge", "todo_status_chip");
    chip.dataset.statusTone = getTaskTodoStatusTone(normalized);
    chip.textContent = normalized;
    chip.title = normalized;
    return chip;
}

export function renderCardDetailsSection(
    containerElement,
    detailEntries,
    dataTypes,
    cardDetailsLayout,
    cardStyleVariant,
    { deferResponsiveLayoutMs = 0, detailColumns } = {}
) {
    const normalizedStyleVariant = normalizeClientCardStyleVariant(cardStyleVariant);
    if (normalizedStyleVariant === CARD_STYLE_VARIANT_VALUES.MODERN) {
        renderModernCardDetails(containerElement, detailEntries, dataTypes, { columns: detailColumns });
        return;
    }

    const normalizedLayout = normalizeClientCardDetailsLayout(cardDetailsLayout);
    if (normalizedLayout === CARD_DETAILS_LAYOUT_VALUES.SINGLE_LINE) {
        renderSingleLineCardDetails(containerElement, detailEntries, dataTypes, { columns: detailColumns });
        return;
    }

    const kvDataArray = detailEntries.map((entry) => ({
        key: entry.labelKey || entry.column,
        labelKey: entry.labelKey || entry.column,
        // Preserve the empty label that carries the column's hidden-name setting.
        labelText: entry.label,
        value: entry.rawValue,
        titleValue: entry.titleValue,
        isLink: entry.isLink,
        href: entry.href,
        openInNewTabHref: entry.openInNewTabHref,
        columnClass: entry.columnClass,
        column: entry.column,
        sourceColumn: entry.sourceColumn,
        dataColumn: entry.dataColumn,
        labelMeta: dataTypes[String(
            entry.sourceColumn || entry.dataColumn || entry.column || ""
        ).trim()] || {},
    }));

    return renderKeyValuePairs(containerElement, kvDataArray, {
        ...kvDefaultOptions,
        ...(detailColumns !== undefined
            ? { maxColumns: detailColumns, minPairWidth: 240, singleColumnBreakpoint: 0 }
            : {}),
        layoutMode: resolveKvLayoutModeForCardDetails(normalizedLayout),
        animateHeight: true,
        deferResponsiveLayoutMs,
        decorateKeyElement: decorateStandardCardDetailKey,
    });
}


export const CARD_ENTRANCE_ANIMATION_MS = 420;
export const CARD_ENTRANCE_STAGGER_MS = 22;
export function getCardPostEntranceDelay(index = 0) {
    return CARD_ENTRANCE_ANIMATION_MS + index * CARD_ENTRANCE_STAGGER_MS;
}

export function appendSmallCardSummary({
    card, row_item, table_name, setFieldHideAttribute, image_value_small, image_column_small, preferred_image_alt_label, creation_seed, header_first_letter, username_text_small, header_text_small, header_column_small, creation_date_small, creationDateColumn, data_types, timestampDisplayOptions, statusBadgeValue, todoStatusChipValue
}) {
    /* --- SMALL SUMMARY FOR COLLAPSED MODE -------------------- */
    const summaryDiv = document.createElement("div");
    summaryDiv.classList.add("card_small_summary");
    setFieldHideAttribute(summaryDiv);

    const imgDivSmall = document.createElement("div");
    imgDivSmall.classList.add("card_small_image");

    async function ensureSmallSummaryMediaLoaded() {
        if (imgDivSmall.dataset.summaryMediaState === "ready") {
            return;
        }
        if (imgDivSmall.dataset.summaryMediaState === "loading") {
            return;
        }

        imgDivSmall.dataset.summaryMediaState = "loading";

        let mediaElement;
        if (image_value_small) {
            // Defensive: resolve multilingual JSON that may have slipped through
            let imgSrc = extractLangValue(image_value_small, getLanguageWithBrowserFallback()).trim();
            if (!/^https?:\/\//.test(imgSrc) && !imgSrc.startsWith("./")) {
                imgSrc = resolveImagePaths(
                    imgSrc,
                    resolveCardMediaFolderForImageWidth(predictCardImageCssWidth({ large: false }))
                ).displaySrc;
            }
            mediaElement = createImageElement(imgSrc, false, {
                ...buildCardImageRenderOptions(
                    row_item,
                    image_column_small,
                    table_name,
                    preferred_image_alt_label,
                    CARD_IMAGE_RENDER_SLOTS.SMALL_THUMBNAIL
                ),
            });
        } else {
            mediaElement = await create_seeded_avatar(
                creation_seed,
                header_first_letter,
                false
            );
        }

        mediaElement.classList.add("card_small_image_inner");
        imgDivSmall.replaceChildren(mediaElement);
        imgDivSmall.dataset.summaryMediaState = "ready";
    }

    card._ensureSmallSummaryMedia = ensureSmallSummaryMediaLoaded;

    const textWrap = document.createElement("div");
    textWrap.classList.add("card_small_text");
    if (username_text_small) {
        const userEl = document.createElement("div");
        userEl.classList.add("small_card_username");
        userEl.textContent = username_text_small;
        textWrap.appendChild(userEl);
    }
    if (header_text_small) {
        const nameEl = document.createElement("div");
        nameEl.classList.add("small_card_name");
        const datasetIcon = createDatasetIconElement(table_name, "small_card_dataset_icon");
        if (datasetIcon) {
            nameEl.appendChild(datasetIcon);
        }
        const nameText = document.createElement("span");
        nameText.classList.add("small_card_name_text");
        nameText.textContent = header_text_small;
        nameText.dataset.titleLangKey = header_column_small;
        nameText.dataset.titleLangContext = header_text_small;
        nameText.title = `${format_column_name(header_column_small)}: ${header_text_small}`;
        nameEl.appendChild(nameText);
        textWrap.appendChild(nameEl);
    }
    if (creation_date_small) {
        const dateEl = document.createElement("div");
        dateEl.classList.add("small_card_date");
        const timestampDisplay = formatTimestampDisplayParts(
            creation_date_small,
            data_types[creationDateColumn] || {},
            timestampDisplayOptions
        );
        dateEl.textContent = timestampDisplay?.displayText
            ?? String(creation_date_small);
        if (timestampDisplay?.titleText) {
            dateEl.dataset.titleLangKey = creationDateColumn;
            dateEl.dataset.titleLangContext = timestampDisplay.titleText;
            dateEl.title = `${format_column_name(creationDateColumn)}: ${timestampDisplay.titleText}`;
        }
        textWrap.appendChild(dateEl);
    }

    if (statusBadgeValue) {
        const summaryBadge = createTicketStatusBadge(statusBadgeValue);
        summaryBadge.classList.add("ticket_status_badge--small");
        textWrap.appendChild(summaryBadge);
    }

    if (todoStatusChipValue) {
        const summaryTodoChip = createTaskTodoStatusChip(todoStatusChipValue);
        summaryTodoChip.classList.add("ticket_status_badge--small");
        textWrap.appendChild(summaryTodoChip);
    }

    summaryDiv.appendChild(imgDivSmall);
    summaryDiv.appendChild(textWrap);
    summaryDiv.addEventListener("click", (e) => {
        e.preventDefault();
        openRowArticleView(row_item, table_name, card);
    });

    card.appendChild(summaryDiv);

}
