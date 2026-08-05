// experimental_free_layout_card_view.js
// Renders the removable admin-only free-layout card prototype inside the existing card view shell.
// Bridges card role metadata, localStorage layout templates, and pointer-based drag/resize interactions.
// Exists to test a low-coupling card designer before committing to backend persistence or broader UI adoption.

import { create_seeded_avatar, createImageElement } from "../card_view/card_avatar_builder.js";
import { resolveImagePaths } from "../card_view/card_element_builder_helpers.js";
import {
    createTicketStatusBadge,
} from "../card_view/card_field_formatter.js";
import { openRowArticleView } from "../card_view/row_article_opener.js";
import { update_card_selection } from "../table_view/row_selection_handler.js";
import { makeColumnClass } from "../../filterbar/filter_list/column_visibility_handler.js";
import { getLanguageWithBrowserFallback } from "../../state_stores/lang_preference_reader.js";
import {
    always_show_empty_fields_on_cards,
    resolveCardMediaFolder,
} from "../../../ui_config.js";
import {
    buildExperimentalCardModel,
    getExperimentalLayoutRowCount,
    mergeExperimentalLayoutTemplate,
    normalizeExperimentalLayoutItem,
} from "./experimental_free_layout_card_helpers.js";
import {
    clearExperimentalLayoutTemplate,
    EXPERIMENTAL_FREE_LAYOUT_CARD_STYLE_VARIANT,
    isExperimentalDesignModeEnabled,
    loadExperimentalLayoutTemplate,
    saveExperimentalLayoutTemplate,
    setExperimentalDesignModeEnabled,
} from "./experimental_free_layout_card_store.js";

const workingTemplatesByTable = new Map();

function cloneJsonCompatible(value) {
    return JSON.parse(JSON.stringify(value));
}

function ensureWorkingLayoutTemplate(tableName, blocks) {
    const mergedTemplate = mergeExperimentalLayoutTemplate(
        workingTemplatesByTable.get(tableName) ||
            loadExperimentalLayoutTemplate(tableName),
        blocks
    );

    workingTemplatesByTable.set(tableName, mergedTemplate);
    return mergedTemplate;
}

function persistWorkingLayoutTemplate(tableName) {
    const template = workingTemplatesByTable.get(tableName);
    if (!template) {
        return;
    }

    saveExperimentalLayoutTemplate(tableName, cloneJsonCompatible(template));
}

function updateWorkingLayoutItem(tableName, blockId, nextItem, persist = false) {
    const template = workingTemplatesByTable.get(tableName);
    if (!template) {
        return;
    }

    template.items[blockId] = normalizeExperimentalLayoutItem(
        nextItem,
        template.columns
    );

    if (persist) {
        persistWorkingLayoutTemplate(tableName);
    }
}

function applyLayoutItemToElement(blockElement, layoutItem) {
    blockElement.style.gridColumn = `${layoutItem.x} / span ${layoutItem.w}`;
    blockElement.style.gridRow = `${layoutItem.y} / span ${layoutItem.h}`;
}

function updateCanvasRowCounts(tableName) {
    const template = workingTemplatesByTable.get(tableName);
    const rowCount = getExperimentalLayoutRowCount(template);

    document
        .querySelectorAll(
            `.experimental-free-layout-card[data-table-name="${tableName}"] .experimental-free-layout-card__canvas`
        )
        .forEach((canvas) => {
            canvas.style.setProperty(
                "--experimental-free-layout-row-count",
                String(rowCount)
            );
        });
}

function updateMatchingBlockLayouts(tableName, blockId, layoutItem) {
    document
        .querySelectorAll(
            `.experimental-free-layout-card[data-table-name="${tableName}"] [data-layout-block-id]`
        )
        .forEach((blockElement) => {
            if (blockElement.dataset.layoutBlockId === blockId) {
                applyLayoutItemToElement(blockElement, layoutItem);
            }
        });

    updateCanvasRowCounts(tableName);
}

function buildKeywords(block) {
    const chipValues = String(block.displayValue || "")
        .split(/[;,]+/)
        .map((value) => value.trim())
        .filter(Boolean);

    const chipContainer = document.createElement("div");
    chipContainer.classList.add("experimental-free-layout-card__chips");

    chipValues.forEach((chipValue) => {
        const chip = document.createElement("span");
        chip.classList.add("experimental-free-layout-card__chip");
        chip.textContent = chipValue;
        chipContainer.appendChild(chip);
    });

    if (chipValues.length === 0) {
        chipContainer.textContent = "No keywords";
        chipContainer.classList.add("experimental-free-layout-card__value--empty");
    }

    return chipContainer;
}

async function buildMediaBlockContent(block, summary, rowItem, tableName) {
    const mediaWrapper = document.createElement("div");
    mediaWrapper.classList.add("experimental-free-layout-card__media");

    const avatarSeed = `${String(rowItem?.id ?? "x")}_${summary.creationDate || ""}`;
    const showLargeMedia = block.usesTableImageRole === true;
    const mediaValue = String(block.displayValue || "").trim();

    if (mediaValue) {
        const mediaFolder = resolveCardMediaFolder();
        const { displaySrc } = resolveImagePaths(mediaValue, mediaFolder);
        const imageElement = createImageElement(displaySrc, showLargeMedia, {
            tableName,
            rowLabel: summary.headerText || summary.usernameText || "",
        });
        imageElement.style.width = "100%";
        imageElement.style.height = "100%";
        imageElement.style.maxWidth = "none";
        imageElement.style.maxHeight = "none";

        const foregroundImage = imageElement.querySelector("img");
        if (foregroundImage instanceof HTMLImageElement) {
            foregroundImage.style.width = "100%";
            foregroundImage.style.height = "100%";
            foregroundImage.style.maxWidth = "none";
            foregroundImage.style.maxHeight = "none";
            foregroundImage.style.objectFit = "contain";
        }

        mediaWrapper.appendChild(imageElement);
        return mediaWrapper;
    }

    const avatar = await create_seeded_avatar(
        avatarSeed,
        summary.headerFirstLetter,
        showLargeMedia
    );
    mediaWrapper.appendChild(avatar);
    return mediaWrapper;
}

function isPointerNearResizeCorner(blockElement, pointerEvent) {
    const blockRect = blockElement.getBoundingClientRect();
    const resizeZoneSize = 28;

    return (
        pointerEvent.clientX >= blockRect.right - resizeZoneSize &&
        pointerEvent.clientY >= blockRect.bottom - resizeZoneSize
    );
}

function buildFieldValueElement(block) {
    if (block.type === "keywords") {
        return buildKeywords(block);
    }

    if (block.type === "status") {
        return createTicketStatusBadge(block.displayValue);
    }

    if (block.hasLangKey) {
        const localizedValue = document.createElement("div");
        localizedValue.classList.add("experimental-free-layout-card__value");
        localizedValue.dataset.langKey =
            String(block.displayValue || block.rawValue || "").trim();
        localizedValue.textContent = String(block.displayValue || "").trim();
        return localizedValue;
    }

    if (block.isLink && String(block.displayValue || "").trim()) {
        const link = document.createElement("a");
        link.href = String(block.displayValue || "").trim();
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.classList.add("experimental-free-layout-card__value");
        link.textContent = String(block.displayValue || "").trim();
        return link;
    }

    const valueElement = document.createElement("div");
    valueElement.classList.add("experimental-free-layout-card__value");
    valueElement.textContent = String(block.displayValue || "").trim();
    if (!String(block.displayValue || "").trim()) {
        valueElement.textContent = "Empty";
        valueElement.classList.add("experimental-free-layout-card__value--empty");
    }

    return valueElement;
}

function shouldRenderBlock(block, designModeEnabled) {
    if (block.type === "action" || block.type === "media") {
        return true;
    }
    if (designModeEnabled) {
        return true;
    }
    if (always_show_empty_fields_on_cards) {
        return true;
    }

    return block.hasValue === true;
}

function maybeAppendLabel(blockElement, block) {
    if (!block.label || !block.column) {
        return;
    }

    const labelElement = document.createElement("div");
    labelElement.classList.add("experimental-free-layout-card__label");
    labelElement.dataset.langKey = block.column;
    labelElement.textContent = block.label;
    blockElement.appendChild(labelElement);
}

async function createBlockElement({
    block,
    summary,
    rowItem,
    tableName,
    designModeEnabled,
    cardElement,
}) {
    const blockElement = document.createElement("div");
    blockElement.classList.add(
        "experimental-free-layout-card__block",
        `experimental-free-layout-card__block--${block.type}`
    );
    blockElement.dataset.layoutBlockId = block.id;

    if (block.column) {
        blockElement.classList.add(makeColumnClass(tableName, block.column));
    }

    if (!block.hasValue && block.type !== "action") {
        blockElement.classList.add("experimental-free-layout-card__block--empty");
    }

    if (block.type === "action") {
        const actionButton = document.createElement("button");
        actionButton.type = "button";
        actionButton.classList.add("experimental-free-layout-card__action-button");
        actionButton.dataset.langKey = "show_more";
        actionButton.textContent = "Show more";
        actionButton.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (designModeEnabled) {
                return;
            }
            openRowArticleView(rowItem, tableName, cardElement);
        });
        blockElement.appendChild(actionButton);
    } else if (block.type === "media") {
        const mediaContent = await buildMediaBlockContent(
            block,
            summary,
            rowItem,
            tableName
        );
        blockElement.appendChild(mediaContent);
    } else {
        maybeAppendLabel(blockElement, block);
        const valueElement = buildFieldValueElement(block);
        blockElement.appendChild(valueElement);
    }

    if (designModeEnabled) {
        const resizeHandle = document.createElement("div");
        resizeHandle.classList.add("experimental-free-layout-card__resize-handle");
        blockElement.appendChild(resizeHandle);
    }

    return blockElement;
}

function attachLayoutPointerInteraction({
    blockElement,
    blockId,
    tableName,
    canvasElement,
}) {
    const resizeHandle = blockElement.querySelector(
        ".experimental-free-layout-card__resize-handle"
    );

    const startInteraction = (mode, pointerDownEvent) => {
        pointerDownEvent.preventDefault();
        pointerDownEvent.stopPropagation();

        const template = workingTemplatesByTable.get(tableName);
        if (!template) {
            return;
        }

        const currentItem = template.items[blockId];
        if (!currentItem) {
            return;
        }

        const canvasRect = canvasElement.getBoundingClientRect();
        const columnWidth = canvasRect.width / template.columns;
        const rowHeightValue = Number.parseFloat(
            getComputedStyle(canvasElement).getPropertyValue(
                "--experimental-free-layout-row-size"
            )
        );
        const rowHeight = Number.isFinite(rowHeightValue) ? rowHeightValue : 18;

        const startX = pointerDownEvent.clientX;
        const startY = pointerDownEvent.clientY;
        const originalItem = { ...currentItem };

        blockElement.classList.add("experimental-free-layout-card__block--dragging");
        blockElement.setPointerCapture(pointerDownEvent.pointerId);

        const handlePointerMove = (pointerMoveEvent) => {
            const deltaColumns = Math.round(
                (pointerMoveEvent.clientX - startX) / columnWidth
            );
            const deltaRows = Math.round(
                (pointerMoveEvent.clientY - startY) / rowHeight
            );

            const nextItem =
                mode === "resize"
                    ? normalizeExperimentalLayoutItem(
                          {
                              ...originalItem,
                              w: originalItem.w + deltaColumns,
                              h: originalItem.h + deltaRows,
                          },
                          template.columns
                      )
                    : normalizeExperimentalLayoutItem(
                          {
                              ...originalItem,
                              x: originalItem.x + deltaColumns,
                              y: originalItem.y + deltaRows,
                          },
                          template.columns
                      );

            updateWorkingLayoutItem(tableName, blockId, nextItem, false);
            updateMatchingBlockLayouts(tableName, blockId, nextItem);
        };

        const handlePointerUp = () => {
            blockElement.classList.remove(
                "experimental-free-layout-card__block--dragging"
            );
            persistWorkingLayoutTemplate(tableName);
            blockElement.removeEventListener("pointermove", handlePointerMove);
            blockElement.removeEventListener("pointerup", handlePointerUp);
            blockElement.removeEventListener("pointercancel", handlePointerUp);
        };

        blockElement.addEventListener("pointermove", handlePointerMove);
        blockElement.addEventListener("pointerup", handlePointerUp);
        blockElement.addEventListener("pointercancel", handlePointerUp);
    };

    if (resizeHandle instanceof HTMLElement) {
        resizeHandle.addEventListener("pointerdown", (event) => {
            startInteraction("resize", event);
        });
    }

    blockElement.addEventListener("pointerdown", (event) => {
        if (!isExperimentalDesignModeEnabled(tableName)) {
            return;
        }

        if (resizeHandle && resizeHandle.contains(event.target)) {
            return;
        }

        if (isPointerNearResizeCorner(blockElement, event)) {
            startInteraction("resize", event);
            return;
        }

        startInteraction("drag", event);
    });
}

function buildSmallSummary(summary) {
    const summaryWrapper = document.createElement("div");
    summaryWrapper.classList.add("card_small_summary");

    const textWrap = document.createElement("div");
    textWrap.classList.add("card_small_text");

    if (summary.usernameText) {
        const usernameElement = document.createElement("div");
        usernameElement.classList.add("small_card_username");
        usernameElement.textContent = summary.usernameText;
        textWrap.appendChild(usernameElement);
    }

    if (summary.headerText) {
        const headerElement = document.createElement("div");
        headerElement.classList.add("small_card_name");
        headerElement.textContent = summary.headerText;
        textWrap.appendChild(headerElement);
    }

    if (summary.creationDate) {
        const dateElement = document.createElement("div");
        dateElement.classList.add("small_card_date");
        dateElement.textContent = summary.creationDate;
        textWrap.appendChild(dateElement);
    }

    if (summary.statusValue) {
        const statusBadge = createTicketStatusBadge(summary.statusValue);
        statusBadge.classList.add("ticket_status_badge--small");
        textWrap.appendChild(statusBadge);
    }

    summaryWrapper.appendChild(textWrap);
    return summaryWrapper;
}

/**
 * Creates one experimental free-layout card while preserving existing card shell classes and data hooks.
 *
 * @param {object} params
 * @param {Object<string, *>} params.rowItem
 * @param {string[]} params.columns
 * @param {string} params.tableName
 * @param {Object<string, object>} params.dataTypes
 * @param {{ hasDeleteRight: boolean, tableHasImageRole: boolean }} params.renderContext
 * @param {Function} [params.onSelectionChange]
 * @returns {Promise<HTMLElement>}
 */
export async function createExperimentalFreeLayoutCard({
    rowItem,
    columns,
    tableName,
    dataTypes,
    renderContext,
    onSelectionChange,
}) {
    const preferredLang = getLanguageWithBrowserFallback();
    const designModeEnabled = isExperimentalDesignModeEnabled(tableName);
    const model = buildExperimentalCardModel({
        rowItem,
        columns,
        tableName,
        dataTypes,
        preferredLang,
        tableHasImageRole: renderContext.tableHasImageRole,
    });

    const layoutTemplate = ensureWorkingLayoutTemplate(tableName, model.blocks);
    const card = document.createElement("div");
    card.classList.add("card", "saturate_on_hover", "experimental-free-layout-card");
    card.dataset.cardStyleVariant = EXPERIMENTAL_FREE_LAYOUT_CARD_STYLE_VARIANT;
    card.dataset.tableName = tableName;
    if (rowItem.id != null) {
        card.dataset.id = rowItem.id;
    }

    if (renderContext.hasDeleteRight) {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.classList.add("card_checkbox");
        checkbox.addEventListener("change", () => {
            update_card_selection(card);
            onSelectionChange?.();
        });
        card.appendChild(checkbox);
    }

    const cardContent = document.createElement("div");
    cardContent.classList.add(
        "card_content",
        "experimental-free-layout-card__content"
    );

    const canvasElement = document.createElement("div");
    canvasElement.classList.add("experimental-free-layout-card__canvas");
    canvasElement.style.setProperty(
        "--experimental-free-layout-row-count",
        String(getExperimentalLayoutRowCount(layoutTemplate))
    );
    if (designModeEnabled) {
        card.classList.add("experimental-free-layout-card--designing");
    }

    for (const block of model.blocks) {
        if (!shouldRenderBlock(block, designModeEnabled)) {
            continue;
        }

        const blockElement = await createBlockElement({
            block,
            summary: model.summary,
            rowItem,
            tableName,
            designModeEnabled,
            cardElement: card,
        });
        const layoutItem = layoutTemplate.items[block.id];
        applyLayoutItemToElement(blockElement, layoutItem);
        canvasElement.appendChild(blockElement);

        if (designModeEnabled) {
            attachLayoutPointerInteraction({
                blockElement,
                blockId: block.id,
                tableName,
                canvasElement,
            });
        }
    }

    cardContent.appendChild(canvasElement);
    card.appendChild(cardContent);

    const summaryElement = buildSmallSummary(model.summary);
    summaryElement.addEventListener("click", (event) => {
        event.preventDefault();
        if (isExperimentalDesignModeEnabled(tableName)) {
            return;
        }
        openRowArticleView(rowItem, tableName, card);
    });
    card.appendChild(summaryElement);

    card.addEventListener("click", (event) => {
        if (isExperimentalDesignModeEnabled(tableName)) {
            return;
        }

        if (event.target.closest("button, a, input")) {
            return;
        }

        openRowArticleView(rowItem, tableName, card);
    });

    card._row = rowItem;
    card._columns = columns;
    card._table_name = tableName;
    card._data_types = dataTypes;
    card._render_context = renderContext;
    card._hasLocalizedRowData = true;

    return card;
}

/**
 * Builds the small prototype toolbar shown above the experimental cards.
 *
 * @param {string} tableName
 * @returns {HTMLElement}
 */
export function createExperimentalFreeLayoutToolbar(tableName) {
    const designModeEnabled = isExperimentalDesignModeEnabled(tableName);

    const toolbar = document.createElement("div");
    toolbar.classList.add("experimental-free-layout-card__toolbar");

    const statusText = document.createElement("div");
    statusText.classList.add("experimental-free-layout-card__toolbar-copy");
    statusText.textContent = designModeEnabled
        ? "Designer mode is on. Drag blocks and resize from the corner handle."
        : "Template is stored in localStorage for this dataset.";
    toolbar.appendChild(statusText);

    const toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.classList.add("fw-btn");
    toggleButton.textContent = designModeEnabled
        ? "Exit designer"
        : "Designer mode";
    toggleButton.addEventListener("click", async () => {
        setExperimentalDesignModeEnabled(tableName, !designModeEnabled);
        const { refreshTableUnified } = await import(
            "../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js"
        );
        await refreshTableUnified(tableName, { skipUrlParams: true });
    });
    toolbar.appendChild(toggleButton);

    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.classList.add("fw-btn");
    resetButton.textContent = "Reset layout";
    resetButton.addEventListener("click", async () => {
        clearExperimentalLayoutTemplate(tableName);
        workingTemplatesByTable.delete(tableName);
        const { refreshTableUnified } = await import(
            "../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js"
        );
        await refreshTableUnified(tableName, { skipUrlParams: true });
    });
    toolbar.appendChild(resetButton);

    return toolbar;
}

/**
 * Rebuilds one existing experimental card after language or data refresh events.
 *
 * @param {HTMLElement} card
 * @param {Function} onSelectionChange
 * @returns {Promise<HTMLElement>}
 */
export async function rebuildExperimentalFreeLayoutCard(
    card,
    onSelectionChange
) {
    if (!(card instanceof HTMLElement)) {
        throw new Error("Expected an HTMLElement card instance");
    }

    const rowItem = card._row;
    const columns = card._columns;
    const tableName = card._table_name;
    const dataTypes = card._data_types;
    const renderContext = card._render_context || {
        hasDeleteRight: false,
        tableHasImageRole: false,
    };
    const rebuiltCard = await createExperimentalFreeLayoutCard({
        rowItem,
        columns,
        tableName,
        dataTypes,
        renderContext,
        onSelectionChange,
    });

    if (card.classList.contains("small-card")) {
        rebuiltCard.classList.add("small-card");
    }

    return rebuiltCard;
}

/**
 * Keeps the working layout cache aligned with an explicit reset coming from the broader card flow.
 *
 * @param {string} tableName
 */
export function clearExperimentalFreeLayoutWorkingCache(tableName) {
    workingTemplatesByTable.delete(tableName);
}
