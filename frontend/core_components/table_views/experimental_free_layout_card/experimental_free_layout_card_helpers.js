// experimental_free_layout_card_helpers.js
// Builds the data model and default layout template for the experimental free-layout card style.
// Bridges existing card-role metadata and row values into a removable grid-template representation.
// Exists so the prototype stays mostly pure/testable while card_view_printer only delegates at the edges.

import {
    format_column_name,
    parseRoleString,
} from "../card_view/card_field_formatter.js";
import {
    isTicketStatusField,
    resolveCardFieldDisplayValue,
} from "../card_view/card_field_formatter_helpers.js";

const GRID_COLUMNS = 24;
const MIN_LAYOUT_ROWS = 16;

function readRoleOrder(roles, prefix) {
    const matchedRole = roles.find((role) => role === prefix || role.startsWith(prefix));
    if (!matchedRole) {
        return Number.MAX_SAFE_INTEGER;
    }

    const suffix = matchedRole.replace(prefix, "");
    return Number.parseInt(suffix, 10) || 1;
}

function hasRenderableValue(rawValue, displayValue, columnMeta = {}) {
    if (columnMeta.hide_false_null_on_sml_crd === true) {
        if (
            rawValue === null ||
            rawValue === undefined ||
            rawValue === false ||
            String(displayValue || "").trim() === "" ||
            String(displayValue || "").trim().toLowerCase() === "false"
        ) {
            return false;
        }
    }

    return String(displayValue || "").trim() !== "";
}

function clamp(value, minValue, maxValue) {
    return Math.min(Math.max(value, minValue), maxValue);
}

/**
 * Normalizes one layout item so dragging/resizing cannot move it outside the template grid.
 *
 * @param {{ x?: number, y?: number, w?: number, h?: number }} item
 * @param {number} totalColumns
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
export function normalizeExperimentalLayoutItem(item = {}, totalColumns = GRID_COLUMNS) {
    const width = clamp(Number.parseInt(item.w, 10) || 4, 2, totalColumns);
    const height = clamp(Number.parseInt(item.h, 10) || 2, 2, 18);
    const x = clamp(Number.parseInt(item.x, 10) || 1, 1, totalColumns - width + 1);
    const y = clamp(Number.parseInt(item.y, 10) || 1, 1, 999);

    return { x, y, w: width, h: height };
}

function buildFieldBlock({
    id,
    type,
    column,
    label,
    rawValue,
    displayValue,
    hasLangKey,
    hasValue,
    order = Number.MAX_SAFE_INTEGER,
    isLink = false,
}) {
    return {
        id,
        type,
        column,
        label,
        rawValue,
        displayValue,
        hasLangKey,
        hasValue,
        order,
        isLink,
    };
}

/**
 * Builds the normalized block model for one row in the experimental free-layout renderer.
 *
 * @param {object} params
 * @param {Object<string, *>} params.rowItem
 * @param {string[]} params.columns
 * @param {string} params.tableName
 * @param {Object<string, object>} params.dataTypes
 * @param {string} params.preferredLang
 * @param {boolean} params.tableHasImageRole
 * @returns {{ blocks: object[], summary: object }}
 */
export function buildExperimentalCardModel({
    rowItem,
    columns,
    tableName,
    dataTypes,
    preferredLang,
    tableHasImageRole,
}) {
    const descriptionBlocks = [];
    const keywordBlocks = [];
    const fieldBlocks = [];

    let primaryMediaColumn = null;
    let primaryMediaValue = "";
    let primaryHeaderBlock = null;
    let primaryUsernameBlock = null;
    let statusValue = "";

    for (const column of columns) {
        const columnMeta = dataTypes[column] || {};
        if (columnMeta.show_value_on_card !== true) {
            continue;
        }
        if (columnMeta.hide_on_small_card === true) {
            continue;
        }

        const {
            rawValue,
            displayValue,
        } = resolveCardFieldDisplayValue(
            rowItem,
            column,
            dataTypes,
            preferredLang,
            tableName
        );

        if (isTicketStatusField(tableName, column)) {
            if (String(displayValue || "").trim()) {
                statusValue = displayValue;
            }
            continue;
        }

        const { baseRoles, hasLangKey } = parseRoleString(
            columnMeta.card_element || ""
        );
        const visibleRoles = baseRoles.filter((role) => !/^hidden\d*$/.test(role));
        const label =
            columnMeta.show_key_on_card === true ? format_column_name(column) : "";
        const hasValue = hasRenderableValue(rawValue, displayValue, columnMeta);

        if (baseRoles.length > 0 && visibleRoles.length === 0) {
            continue;
        }

        if (visibleRoles.includes("image")) {
            if (
                primaryMediaColumn === null &&
                String(displayValue || "").trim()
            ) {
                primaryMediaColumn = column;
                primaryMediaValue = String(displayValue || "").trim();
            }
            continue;
        }

        if (visibleRoles.includes("header") && !primaryHeaderBlock) {
            primaryHeaderBlock = buildFieldBlock({
                id: `header:${column}`,
                type: "header",
                column,
                label,
                rawValue,
                displayValue,
                hasLangKey,
                hasValue,
                order: readRoleOrder(visibleRoles, "header"),
            });
            continue;
        }

        if (visibleRoles.includes("username") && !primaryUsernameBlock) {
            primaryUsernameBlock = buildFieldBlock({
                id: `username:${column}`,
                type: "username",
                column,
                label,
                rawValue,
                displayValue,
                hasLangKey,
                hasValue,
                order: readRoleOrder(visibleRoles, "username"),
            });
            continue;
        }

        const descriptionOrder = readRoleOrder(visibleRoles, "description");
        if (descriptionOrder !== Number.MAX_SAFE_INTEGER) {
            descriptionBlocks.push(
                buildFieldBlock({
                    id: `description:${column}`,
                    type: "description",
                    column,
                    label,
                    rawValue,
                    displayValue,
                    hasLangKey,
                    hasValue,
                    order: descriptionOrder,
                })
            );
            continue;
        }

        const keywordOrder = readRoleOrder(visibleRoles, "keywords");
        if (keywordOrder !== Number.MAX_SAFE_INTEGER) {
            keywordBlocks.push(
                buildFieldBlock({
                    id: `keywords:${column}`,
                    type: "keywords",
                    column,
                    label,
                    rawValue,
                    displayValue,
                    hasLangKey,
                    hasValue,
                    order: keywordOrder,
                })
            );
            continue;
        }

        const linkOrder = readRoleOrder(visibleRoles, "details_link");
        if (linkOrder !== Number.MAX_SAFE_INTEGER) {
            fieldBlocks.push(
                buildFieldBlock({
                    id: `details_link:${column}`,
                    type: "field",
                    column,
                    label,
                    rawValue,
                    displayValue,
                    hasLangKey,
                    hasValue,
                    order: linkOrder,
                    isLink: true,
                })
            );
            continue;
        }

        const detailsOrder = readRoleOrder(visibleRoles, "details");
        if (detailsOrder !== Number.MAX_SAFE_INTEGER) {
            fieldBlocks.push(
                buildFieldBlock({
                    id: `details:${column}`,
                    type: "field",
                    column,
                    label,
                    rawValue,
                    displayValue,
                    hasLangKey,
                    hasValue,
                    order: detailsOrder,
                    isLink: false,
                })
            );
            continue;
        }

        fieldBlocks.push(
            buildFieldBlock({
                id: `field:${column}`,
                type: "field",
                column,
                label,
                rawValue,
                displayValue,
                hasLangKey,
                hasValue,
                order: Number.MAX_SAFE_INTEGER,
                isLink: false,
            })
        );
    }

    descriptionBlocks.sort((left, right) => left.order - right.order);
    keywordBlocks.sort((left, right) => left.order - right.order);
    fieldBlocks.sort((left, right) => left.order - right.order);

    const headerText = String(primaryHeaderBlock?.displayValue || "").trim();
    const usernameText = String(primaryUsernameBlock?.displayValue || "").trim();
    const headerFirstLetter = (headerText || usernameText || String(rowItem?.id || "?"))
        .trim()
        .slice(0, 1);

    const mediaBlock = {
        id: "media:primary",
        type: "media",
        column: primaryMediaColumn,
        label: "",
        rawValue: primaryMediaValue,
        displayValue: primaryMediaValue,
        hasLangKey: false,
        hasValue: String(primaryMediaValue || "").trim() !== "",
        usesTableImageRole: tableHasImageRole,
    };

    const blocks = [mediaBlock];
    if (primaryHeaderBlock) {
        blocks.push(primaryHeaderBlock);
    }
    if (primaryUsernameBlock) {
        blocks.push(primaryUsernameBlock);
    }
    if (statusValue) {
        blocks.push({
            id: "status:primary",
            type: "status",
            column: "status",
            label: "Status",
            rawValue: statusValue,
            displayValue: statusValue,
            hasLangKey: false,
            hasValue: true,
        });
    }

    blocks.push(...descriptionBlocks, ...keywordBlocks, ...fieldBlocks);
    blocks.push({
        id: "action:show_more",
        type: "action",
        column: null,
        label: "",
        rawValue: "",
        displayValue: "",
        hasLangKey: false,
        hasValue: true,
    });

    return {
        blocks,
        summary: {
            headerText,
            usernameText,
            headerFirstLetter,
            creationDate:
                rowItem.created ||
                rowItem.created_at ||
                rowItem.luontiaika ||
                "",
            statusValue,
        },
    };
}

/**
 * Creates the default dataset-level layout template for the experimental grid renderer.
 *
 * @param {object[]} blocks
 * @returns {{ version: number, columns: number, items: Record<string, object> }}
 */
export function createDefaultExperimentalLayoutTemplate(blocks) {
    const template = {
        version: 1,
        columns: GRID_COLUMNS,
        items: {},
    };

    const hasMediaBlock = blocks.some((block) => block.type === "media");
    const mainColumnStart = hasMediaBlock ? 10 : 1;
    const mainColumnSpan = hasMediaBlock ? 15 : GRID_COLUMNS;

    const mediaBlock = blocks.find((block) => block.type === "media");
    if (mediaBlock) {
        template.items[mediaBlock.id] = normalizeExperimentalLayoutItem({
            x: 1,
            y: 1,
            w: hasMediaBlock ? 8 : 6,
            h: hasMediaBlock ? 14 : 8,
        });
    }

    const headerBlock = blocks.find((block) => block.type === "header");
    const usernameBlock = blocks.find((block) => block.type === "username");
    const statusBlock = blocks.find((block) => block.type === "status");
    const descriptionBlocks = blocks.filter((block) => block.type === "description");
    const keywordBlocks = blocks.filter((block) => block.type === "keywords");
    const fieldBlocks = blocks.filter((block) => block.type === "field");

    if (headerBlock) {
        template.items[headerBlock.id] = normalizeExperimentalLayoutItem({
            x: mainColumnStart,
            y: 1,
            w: usernameBlock ? Math.max(8, mainColumnSpan - 4) : mainColumnSpan,
            h: 3,
        });
    }

    if (usernameBlock) {
        template.items[usernameBlock.id] = normalizeExperimentalLayoutItem({
            x: mainColumnStart + mainColumnSpan - 3,
            y: 1,
            w: 4,
            h: 2,
        });
    }

    let currentRow = 4;
    descriptionBlocks.forEach((block, index) => {
        const blockHeight = index === 0 ? 4 : 3;
        template.items[block.id] = normalizeExperimentalLayoutItem({
            x: mainColumnStart,
            y: currentRow,
            w: mainColumnSpan,
            h: blockHeight,
        });
        currentRow += blockHeight;
    });

    keywordBlocks.forEach((block) => {
        template.items[block.id] = normalizeExperimentalLayoutItem({
            x: mainColumnStart,
            y: currentRow,
            w: mainColumnSpan,
            h: 3,
        });
        currentRow += 3;
    });

    if (statusBlock) {
        template.items[statusBlock.id] = normalizeExperimentalLayoutItem({
            x: mainColumnStart,
            y: currentRow,
            w: 6,
            h: 2,
        });
    }

    const fieldColumnStarts = hasMediaBlock ? [mainColumnStart, mainColumnStart + 8] : [1, 13];
    const fieldColumnWidth = hasMediaBlock ? 7 : 11;
    const detailStartRow = Math.max(currentRow + 2, hasMediaBlock ? 11 : 9);

    fieldBlocks.forEach((block, index) => {
        const columnIndex = index % 2;
        const rowIndex = Math.floor(index / 2);
        template.items[block.id] = normalizeExperimentalLayoutItem({
            x: fieldColumnStarts[columnIndex],
            y: detailStartRow + rowIndex * 3,
            w: fieldColumnWidth,
            h: 3,
        });
    });

    const showMoreBlock = blocks.find((block) => block.id === "action:show_more");
    if (showMoreBlock) {
        const fieldRows = Math.ceil(fieldBlocks.length / 2);
        template.items[showMoreBlock.id] = normalizeExperimentalLayoutItem({
            x: mainColumnStart + Math.max(0, mainColumnSpan - 5),
            y: detailStartRow + fieldRows * 3,
            w: 6,
            h: 3,
        });
    }

    return template;
}

/**
 * Merges a stored template with the current block list so new blocks get sensible defaults.
 *
 * @param {{ version?: number, columns?: number, items?: Record<string, object> } | null} storedTemplate
 * @param {object[]} blocks
 * @returns {{ version: number, columns: number, items: Record<string, object> }}
 */
export function mergeExperimentalLayoutTemplate(storedTemplate, blocks) {
    const defaultTemplate = createDefaultExperimentalLayoutTemplate(blocks);
    const mergedItems = {};
    const storedItems = storedTemplate?.items || {};

    blocks.forEach((block) => {
        const sourceItem = storedItems[block.id] || defaultTemplate.items[block.id];
        mergedItems[block.id] = normalizeExperimentalLayoutItem(
            sourceItem,
            storedTemplate?.columns || GRID_COLUMNS
        );
    });

    return {
        version: 1,
        columns: GRID_COLUMNS,
        items: mergedItems,
    };
}

/**
 * Computes the required grid row count for one merged layout template.
 *
 * @param {{ items?: Record<string, { y: number, h: number }> }} template
 * @returns {number}
 */
export function getExperimentalLayoutRowCount(template) {
    const items = Object.values(template?.items || {});
    if (items.length === 0) {
        return MIN_LAYOUT_ROWS;
    }

    const maxRow = items.reduce((currentMax, item) => {
        return Math.max(currentMax, item.y + item.h - 1);
    }, MIN_LAYOUT_ROWS);

    return Math.max(MIN_LAYOUT_ROWS, maxRow);
}
