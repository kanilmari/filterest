// cell_editor_options.js
// Resolves safe inline-edit option lists for known metadata enum columns.
// Exists so table cells can use dropdowns for constrained values instead of raw text entry.

import {
    CARD_DETAILS_LAYOUT_OPTIONS,
    CARD_STYLE_VARIANT_OPTIONS,
    normalizeClientCardDetailsLayout,
    normalizeClientCardStyleVariant,
} from '../../../table_views/card_view/card_detail_layout_options.js';
import {
    getTicketStatusOptions,
    isTicketStatusField,
    normalizeTicketStatusForDb,
} from '../../../table_views/card_view/card_field_formatter_helpers.js';

const SYSTEM_DB_TABLES = 'system_db_tables';
const CARD_DETAILS_LAYOUT_COLUMN = 'card_details_layout';
const CARD_STYLE_VARIANT_COLUMN = 'card_style_variant';

function normalizeIdentifier(value) {
    return String(value || '').trim();
}

function isCardDetailsLayoutColumn(tableName, columnName) {
    return (
        normalizeIdentifier(tableName) === SYSTEM_DB_TABLES
        && normalizeIdentifier(columnName) === CARD_DETAILS_LAYOUT_COLUMN
    );
}

function isCardStyleVariantColumn(tableName, columnName) {
    return (
        normalizeIdentifier(tableName) === SYSTEM_DB_TABLES
        && normalizeIdentifier(columnName) === CARD_STYLE_VARIANT_COLUMN
    );
}

function resolveOptionLabel(option, translate) {
    const valueLabel = translate?.(option.value);
    if (typeof valueLabel === 'string' && valueLabel.trim()) {
        return valueLabel;
    }

    return option.label || option.value;
}

export function getInlineEditOptions({ tableName, columnName, translate } = {}) {
    if (isTicketStatusField(tableName, columnName)) {
        return getTicketStatusOptions().map((option) => ({
            value: option.value,
            label: resolveOptionLabel(option, translate),
        }));
    }

    if (isCardDetailsLayoutColumn(tableName, columnName)) {
        return CARD_DETAILS_LAYOUT_OPTIONS.map((option) => ({
            value: option.value,
            label: resolveOptionLabel(option, translate),
        }));
    }

    if (isCardStyleVariantColumn(tableName, columnName)) {
        return CARD_STYLE_VARIANT_OPTIONS.map((option) => ({
            value: option.value,
            label: resolveOptionLabel(option, translate),
        }));
    }

    return [];
}

export function normalizeInlineEditOptionValue({
    tableName,
    columnName,
    value,
} = {}) {
    if (isTicketStatusField(tableName, columnName)) {
        return normalizeTicketStatusForDb(value);
    }

    if (isCardDetailsLayoutColumn(tableName, columnName)) {
        return normalizeClientCardDetailsLayout(value);
    }

    if (isCardStyleVariantColumn(tableName, columnName)) {
        return normalizeClientCardStyleVariant(value);
    }

    return value;
}

export function getInlineEditCacheInvalidationKeys({
    tableName,
    columnName,
    rowData,
} = {}) {
    if (
        !isCardDetailsLayoutColumn(tableName, columnName)
        && !isCardStyleVariantColumn(tableName, columnName)
    ) {
        return [];
    }

    const targetTableName = normalizeIdentifier(rowData?.table_name);
    return targetTableName ? [`${targetTableName}_tableMeta`] : [];
}
