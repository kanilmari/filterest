// product_card_view_field_resolver.js
// Resolves image, title, and detail fields for product-card rows.
// Bridges generic dataset columns, card metadata, multilingual values, and storage image paths.
// Exists to keep product-card inference pure and reusable outside DOM rendering code.

import { resolveImagePaths } from "../card_view/card_element_builder_helpers.js";
import { resolveCardFieldDisplayValue } from "../card_view/card_field_formatter_helpers.js";
import { extractLangValue } from "../../../reusable_components/lang_value_reader.js";

const IMAGE_NAME_TOKENS = Object.freeze([
    "cached_image",
    "image",
    "thumbnail",
    "photo",
    "kuva",
]);
const TITLE_NAME_PRIORITY = Object.freeze([
    "name",
    "title",
    "otsikko",
    "header",
    "label",
    "display",
]);
const DETAIL_NAME_PRIORITY_GROUPS = Object.freeze([
    ["price", "hinta", "cost"],
    ["rating", "score", "arvosana"],
    ["marketplace", "seller", "vendor", "store", "shop"],
    ["category", "kategoria", "type"],
    ["created_at", "updated_at", "created", "updated", "date"],
]);
const PAYLOAD_CARD_METADATA_KEYS = Object.freeze([
    "card_metadata",
    "card_meta",
    "card",
    "metadata",
]);
const MAX_DETAIL_COUNT = 4;
const PRODUCT_CARD_MEDIA_FOLDER = "300";

/**
 * Resolves display fields for one product card.
 *
 * @param {object} options - Product-card inference context.
 * @returns {{title: object, image: object, detailEntries: object[]}}
 */
export function resolveProductCardFields({
    rowItem,
    columns,
    tableName,
    dataTypes,
    preferredLanguage,
}) {
    const image = resolveProductImage(
        rowItem,
        columns,
        tableName,
        dataTypes,
        preferredLanguage
    );
    const title = resolveProductTitle(
        rowItem,
        columns,
        tableName,
        dataTypes,
        preferredLanguage
    );
    const detailEntries = resolveProductDetails({
        rowItem,
        columns,
        tableName,
        dataTypes,
        preferredLanguage,
        imageColumn: image.column,
        titleColumn: title.column,
    });

    return { title, image, detailEntries };
}

function resolveProductImage(
    rowItem,
    columns,
    tableName,
    dataTypes,
    preferredLanguage
) {
    const imageRoleColumn = findFirstColumnByRole(columns, dataTypes, "image");
    const roleImage = resolveImageFromColumn(
        rowItem,
        imageRoleColumn,
        tableName,
        dataTypes,
        preferredLanguage
    );
    if (roleImage.src) {
        return roleImage;
    }

    const namedImageColumn = findFirstColumnByNameTokens(
        columns,
        IMAGE_NAME_TOKENS,
        dataTypes
    );
    const namedImage = resolveImageFromColumn(
        rowItem,
        namedImageColumn,
        tableName,
        dataTypes,
        preferredLanguage
    );
    if (namedImage.src) {
        return namedImage;
    }

    const payloadImageValue = readPayloadCardMetadataValue(
        rowItem,
        IMAGE_NAME_TOKENS
    );
    return {
        column: null,
        src: resolveProductImageSrc(
            payloadImageValue,
            preferredLanguage,
            true
        ),
    };
}

function resolveImageFromColumn(
    rowItem,
    column,
    tableName,
    dataTypes,
    preferredLanguage
) {
    if (!column) {
        return { column: null, src: "" };
    }

    const { displayValue, isMultilingual } = resolveCardFieldDisplayValue(
        rowItem,
        column,
        dataTypes,
        preferredLanguage,
        tableName
    );

    return {
        column,
        src: resolveProductImageSrc(
            displayValue,
            preferredLanguage,
            isMultilingual
        ),
    };
}

function resolveProductImageSrc(rawValue, preferredLanguage, isMultilingual) {
    const imageValue = normalizeProductCardImageValue(
        rawValue,
        preferredLanguage,
        isMultilingual
    );
    if (!imageValue) {
        return "";
    }

    const { displaySrc } = resolveImagePaths(imageValue, PRODUCT_CARD_MEDIA_FOLDER);
    return displaySrc;
}

function resolveProductTitle(
    rowItem,
    columns,
    tableName,
    dataTypes,
    preferredLanguage
) {
    const roleColumn = findFirstColumnByRole(columns, dataTypes, "header");
    const roleTitle = resolveTitleFromColumn(
        rowItem,
        roleColumn,
        tableName,
        dataTypes,
        preferredLanguage
    );
    if (roleTitle.text) {
        return roleTitle;
    }

    const namedTitleColumn = findFirstColumnByNamePriority(
        columns,
        TITLE_NAME_PRIORITY,
        dataTypes
    );
    const namedTitle = resolveTitleFromColumn(
        rowItem,
        namedTitleColumn,
        tableName,
        dataTypes,
        preferredLanguage
    );
    if (namedTitle.text) {
        return namedTitle;
    }

    const textColumn = columns.find((column) => {
        return (
            !isHiddenColumn(column, dataTypes) &&
            !isIdColumn(column) &&
            !isImageColumnCandidate(column, dataTypes) &&
            isTextLikeColumn(column, rowItem, dataTypes)
        );
    });
    const textTitle = resolveTitleFromColumn(
        rowItem,
        textColumn,
        tableName,
        dataTypes,
        preferredLanguage
    );
    if (textTitle.text) {
        return textTitle;
    }

    return { text: "Untitled", column: null, isFallback: true };
}

function resolveTitleFromColumn(
    rowItem,
    column,
    tableName,
    dataTypes,
    preferredLanguage
) {
    if (!column) {
        return { text: "", column: null, isFallback: false };
    }

    const { displayValue } = resolveCardFieldDisplayValue(
        rowItem,
        column,
        dataTypes,
        preferredLanguage,
        tableName
    );
    const titleText = String(displayValue || "").trim();

    return {
        text: titleText,
        column,
        isFallback: false,
    };
}

function resolveProductDetails({
    rowItem,
    columns,
    tableName,
    dataTypes,
    preferredLanguage,
    imageColumn,
    titleColumn,
}) {
    const excludedColumns = new Set([imageColumn, titleColumn].filter(Boolean));
    const selectedColumns = [];

    for (const tokenGroup of DETAIL_NAME_PRIORITY_GROUPS) {
        const column = findFirstColumnByNameTokens(columns, tokenGroup, dataTypes);
        addDetailColumn(selectedColumns, column, excludedColumns);
    }

    addRoleDetailColumns(selectedColumns, columns, dataTypes, excludedColumns);

    for (const column of columns) {
        if (selectedColumns.length >= MAX_DETAIL_COUNT) {
            break;
        }
        if (
            isCurrencyOnlyColumn(column) ||
            isHiddenColumn(column, dataTypes) ||
            isIdColumn(column) ||
            isImageColumnCandidate(column, dataTypes)
        ) {
            continue;
        }
        addDetailColumn(selectedColumns, column, excludedColumns);
    }

    return selectedColumns
        .map((column) => createDetailEntry(
            rowItem,
            column,
            tableName,
            columns,
            dataTypes,
            preferredLanguage
        ))
        .filter(Boolean)
        .slice(0, MAX_DETAIL_COUNT);
}

function addRoleDetailColumns(
    selectedColumns,
    columns,
    dataTypes,
    excludedColumns
) {
    const roleColumns = columns
        .filter((column) => {
            const roles = getCardRoles(column, dataTypes);
            return roles.some((role) => {
                return roleMatches(role, "details") ||
                    roleMatches(role, "details_link") ||
                    role === "username";
            });
        })
        .sort((columnA, columnB) => {
            return getSmallestRoleOrder(columnA, dataTypes) -
                getSmallestRoleOrder(columnB, dataTypes);
        });

    for (const column of roleColumns) {
        addDetailColumn(selectedColumns, column, excludedColumns);
    }
}

function addDetailColumn(selectedColumns, column, excludedColumns) {
    if (!column || excludedColumns.has(column) || selectedColumns.includes(column)) {
        return;
    }
    selectedColumns.push(column);
}

function createDetailEntry(
    rowItem,
    column,
    tableName,
    columns,
    dataTypes,
    preferredLanguage
) {
    if (
        !column ||
        isHiddenColumn(column, dataTypes) ||
        isPlainIdentifierColumn(column) ||
        isImageColumnCandidate(column, dataTypes)
    ) {
        return null;
    }

    const { displayValue } = resolveCardFieldDisplayValue(
        rowItem,
        column,
        dataTypes,
        preferredLanguage,
        tableName
    );
    const value = formatDetailValue(
        column,
        String(displayValue ?? "").trim(),
        rowItem,
        columns,
        tableName,
        dataTypes,
        preferredLanguage
    );
    if (!hasRenderableText(value, dataTypes[column])) {
        return null;
    }

    return {
        column,
        label: formatColumnLabel(column),
        value,
    };
}

function formatDetailValue(
    column,
    displayValue,
    rowItem,
    columns,
    tableName,
    dataTypes,
    preferredLanguage
) {
    if (!displayValue) {
        return "";
    }

    if (isPriceColumn(column)) {
        const currencyText = resolveCurrencyText(
            rowItem,
            columns,
            tableName,
            dataTypes,
            preferredLanguage
        );
        if (currencyText && !displayValue.includes(currencyText)) {
            return `${displayValue} ${currencyText}`;
        }
    }

    if (isRatingColumn(column) && isPlainNumber(displayValue)) {
        return `${displayValue} / 5`;
    }

    return displayValue;
}

function resolveCurrencyText(
    rowItem,
    columns,
    tableName,
    dataTypes,
    preferredLanguage
) {
    const currencyColumn = columns.find((column) => {
        const normalized = normalizeColumnName(column);
        return normalized === "currency" ||
            normalized === "currency_symbol" ||
            normalized === "price_currency";
    });
    if (!currencyColumn) {
        return "";
    }

    const { displayValue } = resolveCardFieldDisplayValue(
        rowItem,
        currencyColumn,
        dataTypes,
        preferredLanguage,
        tableName
    );
    return String(displayValue || "").trim();
}

function findFirstColumnByRole(columns, dataTypes, roleName) {
    return columns.find((column) => {
        return !isHiddenColumn(column, dataTypes) &&
            getCardRoles(column, dataTypes).some((role) => roleMatches(role, roleName));
    }) || null;
}

function findFirstColumnByNamePriority(columns, priorityNames, dataTypes) {
    for (const name of priorityNames) {
        const exactColumn = columns.find((column) => {
            return !isHiddenColumn(column, dataTypes) &&
                normalizeColumnName(column) === name;
        });
        if (exactColumn) {
            return exactColumn;
        }
    }

    return findFirstColumnByNameTokens(columns, priorityNames, dataTypes);
}

function findFirstColumnByNameTokens(columns, tokens, dataTypes) {
    return columns.find((column) => {
        return !isHiddenColumn(column, dataTypes) &&
            !isCurrencyOnlyColumn(column) &&
            tokens.some((token) => columnMatchesToken(column, token));
    }) || null;
}

function columnMatchesToken(column, token) {
    const normalizedColumn = normalizeColumnName(column);
    const normalizedToken = normalizeColumnName(token);

    if (normalizedColumn === normalizedToken) {
        return true;
    }

    return normalizedColumn.includes(normalizedToken);
}

function getCardRoles(column, dataTypes) {
    const roleString = dataTypes?.[column]?.card_element || "";
    if (!roleString) {
        return [];
    }

    return roleString
        .split(",")
        .map((rawRole) => rawRole.trim().split("+")[0].trim())
        .filter(Boolean);
}

function roleMatches(role, roleName) {
    return role === roleName || role.startsWith(roleName);
}

function getSmallestRoleOrder(column, dataTypes) {
    const orders = getCardRoles(column, dataTypes)
        .map((role) => {
            const order = Number.parseInt(role.replace(/^[a-z_]+/i, ""), 10);
            return Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER;
        });

    return Math.min(...orders, Number.MAX_SAFE_INTEGER);
}

function isHiddenColumn(column, dataTypes) {
    const columnMeta = dataTypes?.[column] || {};
    const roles = getCardRoles(column, dataTypes);

    return columnMeta.show_value_on_card === false ||
        columnMeta.hide_on_small_card === true ||
        roles.some((role) => /^hidden\d*$/i.test(role));
}

function isIdColumn(column) {
    return /(^id$|_id$|^uid$|_uid$|^oid$|_oid$)/i.test(String(column || ""));
}

function isPlainIdentifierColumn(column) {
    return /^(id|uid|oid)$/i.test(String(column || ""));
}

function isImageColumnCandidate(column, dataTypes) {
    return getCardRoles(column, dataTypes).includes("image") ||
        IMAGE_NAME_TOKENS.some((token) => columnMatchesToken(column, token));
}

function isTextLikeColumn(column, rowItem, dataTypes) {
    const dataType = String(dataTypes?.[column]?.data_type || "").toLowerCase();
    if (!dataType) {
        return typeof rowItem?.[column] === "string";
    }

    return dataType.includes("text") ||
        dataType.includes("char") ||
        dataType.includes("json");
}

function isPriceColumn(column) {
    return ["price", "hinta", "cost"].some((token) =>
        columnMatchesToken(column, token)
    );
}

function isRatingColumn(column) {
    return ["rating", "score", "arvosana"].some((token) =>
        columnMatchesToken(column, token)
    );
}

function isCurrencyOnlyColumn(column) {
    const normalized = normalizeColumnName(column);
    return normalized === "currency" ||
        normalized === "currency_symbol" ||
        normalized === "price_currency";
}

function isPlainNumber(value) {
    return /^-?\d+(?:[.,]\d+)?$/.test(String(value || "").trim());
}

function hasRenderableText(value, columnMeta = {}) {
    const text = String(value ?? "").trim();
    if (!text) {
        return false;
    }

    if (columnMeta.hide_false_null_on_sml_crd === true) {
        return text.toLowerCase() !== "false" && text.toLowerCase() !== "null";
    }

    return true;
}

function normalizeProductCardImageValue(
    rawValue,
    preferredLanguage,
    isMultilingual = null
) {
    if (rawValue == null) {
        return "";
    }

    if (Array.isArray(rawValue)) {
        for (const item of rawValue) {
            const resolved = normalizeProductCardImageValue(
                item,
                preferredLanguage,
                isMultilingual
            );
            if (resolved) {
                return resolved;
            }
        }
        return "";
    }

    if (typeof rawValue === "object") {
        for (const value of Object.values(rawValue)) {
            const resolved = normalizeProductCardImageValue(
                value,
                preferredLanguage,
                isMultilingual
            );
            if (resolved) {
                return resolved;
            }
        }
        return "";
    }

    const extractedValue = extractLangValue(
        rawValue,
        preferredLanguage,
        isMultilingual
    ).trim();
    if (!extractedValue) {
        return "";
    }

    if (extractedValue.startsWith("{") && extractedValue.endsWith("}")) {
        try {
            return normalizeProductCardImageValue(
                JSON.parse(extractedValue),
                preferredLanguage,
                isMultilingual
            );
        } catch {
            return "";
        }
    }

    return extractedValue;
}

function readPayloadCardMetadataValue(rowItem, valueKeys) {
    if (!rowItem || typeof rowItem !== "object") {
        return "";
    }

    for (const metadataKey of PAYLOAD_CARD_METADATA_KEYS) {
        const metadata = parseObjectLike(rowItem[metadataKey]);
        if (!metadata) {
            continue;
        }

        for (const valueKey of valueKeys) {
            if (metadata[valueKey] != null) {
                return metadata[valueKey];
            }
        }
    }

    return "";
}

function parseObjectLike(rawValue) {
    if (!rawValue) {
        return null;
    }

    if (typeof rawValue === "object" && !Array.isArray(rawValue)) {
        return rawValue;
    }

    if (typeof rawValue !== "string") {
        return null;
    }

    try {
        const parsed = JSON.parse(rawValue);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed;
        }
    } catch {
        return null;
    }

    return null;
}

function formatColumnLabel(column) {
    const label = String(column || "")
        .replace(/_+/g, " ")
        .trim();
    if (!label) {
        return "";
    }

    return label.charAt(0).toUpperCase() + label.slice(1);
}

function normalizeColumnName(column) {
    return String(column || "").trim().toLowerCase();
}
