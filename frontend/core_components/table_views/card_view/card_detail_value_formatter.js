// card_detail_value_formatter.js
// Formats card-detail display values before any card-detail layout renders them.
// Bridges system_column_details.card_detail_capitalization and card detail DOM builders.
// Exists so standard, single-line, and modern card details share the same text policy.

import { formatTimestampDisplayParts } from "../timestamp_display_formatter.js";

function getCardDetailMetadata(detailEntry, dataTypes = {}) {
    const metadataColumnName = String(
        detailEntry?.sourceColumn
        || detailEntry?.dataColumn
        || detailEntry?.column
        || ""
    ).trim();

    return dataTypes[metadataColumnName] || {};
}

function cardElementIncludesPlainDetailRole(cardElement) {
    return String(cardElement || "")
        .split(",")
        .map((role) => role.trim().split("+")[0].trim().toLowerCase())
        .some((role) => /^details\d*$/.test(role));
}

function metadataEnablesCardDetailCapitalization(metadata = {}) {
    const setting = metadata?.card_detail_capitalization;
    if (setting === false || String(setting).trim().toLowerCase() === "false") {
        return false;
    }

    return cardElementIncludesPlainDetailRole(metadata?.card_element);
}

function shouldSkipCapitalizationForValue(value) {
    const text = String(value ?? "");
    const trimmed = text.trim();
    if (!trimmed) {
        return true;
    }

    return /^-?\d/.test(trimmed)
        || trimmed.startsWith("{")
        || trimmed.startsWith("[")
        || trimmed.includes("://")
        || trimmed.includes("@");
}

export function capitalizeCardDetailDisplayText(value) {
    const text = String(value ?? "");
    if (shouldSkipCapitalizationForValue(text)) {
        return text;
    }

    const leadingWhitespace = text.match(/^\s*/)?.[0] || "";
    const firstIndex = leadingWhitespace.length;
    const firstCharacter = text.charAt(firstIndex);
    const upperFirstCharacter = firstCharacter.toLocaleUpperCase();

    if (!firstCharacter || firstCharacter === upperFirstCharacter) {
        return text;
    }

    return `${text.slice(0, firstIndex)}${upperFirstCharacter}${text.slice(firstIndex + 1)}`;
}

export function formatCardDetailEntryForCardDisplay(detailEntry, dataTypes = {}) {
    if (!detailEntry || detailEntry.isLink === true) {
        return detailEntry;
    }

    const metadata = getCardDetailMetadata(detailEntry, dataTypes);
    const timestampDisplay = formatTimestampDisplayParts(detailEntry.rawValue, metadata);
    if (timestampDisplay) {
        return {
            ...detailEntry,
            rawValue: timestampDisplay.displayText,
            titleValue: timestampDisplay.titleText,
        };
    }

    if (!metadataEnablesCardDetailCapitalization(metadata)) {
        return detailEntry;
    }

    const formattedValue = capitalizeCardDetailDisplayText(detailEntry.rawValue);
    if (formattedValue === detailEntry.rawValue) {
        return detailEntry;
    }

    return {
        ...detailEntry,
        rawValue: formattedValue,
    };
}

export function formatCardDetailEntriesForCardDisplay(detailEntries, dataTypes = {}) {
    return (Array.isArray(detailEntries) ? detailEntries : [])
        .map((entry) => formatCardDetailEntryForCardDisplay(entry, dataTypes));
}
