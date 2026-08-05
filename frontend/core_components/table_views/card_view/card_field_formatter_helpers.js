// card_field_formatter_helpers.js
// Provides pure card-view formatting helpers shared by ticket and generic card renderers.
// Bridges raw row values, generated FK aliases, and human-facing display formatting.
// Keeps card formatting testable without DOM coupling or mutable view state.
// Exists so card surfaces can reuse one consistent status and display-value normalization layer.

import { extractLangValue } from '../../../reusable_components/lang_value_reader.js';

const GENERATED_FK_ALIAS_SUFFIX_RE = /\s+\(ln(?: \d+)?\)$/iu;
const DEV_AGENT_TASK_STATUS_CLIENT_ALIASES = Object.freeze({
    awaiting_review: 'awaiting_human_decision',
    closed: 'done',
    done_autonomously: 'done',
    later: 'backlog_later',
    nice_to_have: 'backlog_nice_to_have',
});
const DEV_AGENT_TASK_STATUS_DB_ALIASES = Object.freeze({
    awaiting_review: 'awaiting_human_decision',
    closed: 'done',
    done_autonomously: 'done',
    later: 'backlog_later',
    nice_to_have: 'backlog_nice_to_have',
});
const DEV_AGENT_TASK_STATUS_OPTIONS = Object.freeze([
    'new',
    'backlog',
    'backlog_later',
    'backlog_nice_to_have',
    'in_progress',
    'on_hold',
    'awaiting_human_decision',
    'done',
    'rejected',
    'aborted',
    'archived',
    'to_be_deleted',
]);

/**
 * Resolves a multilingual value from raw text + metadata.
 * Returns { displayText, multiLangObj, editLang } if multilingual,
 * or null if not multilingual.
 *
 * @param {string} rawText - The raw value (possibly JSON string)
 * @param {boolean|undefined} isMultilingualMeta - Metadata flag from column_details
 * @param {string} preferredLang - Preferred language code (e.g. 'en', 'fi')
 * @returns {{ displayText: string, multiLangObj: object, editLang: string } | null}
 */
export function resolveMultilingualValue(rawText, isMultilingualMeta, preferredLang) {
    if (!rawText || !rawText.startsWith('{') || !rawText.endsWith('}')) {
        return null;
    }

    try {
        const parsed = JSON.parse(rawText);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return null;
        }

        const keys = Object.keys(parsed);
        const isMultilingual = isMultilingualMeta
            || (keys.length > 0 && keys.every(k => /^[a-z]{2,3}$/.test(k)));

        if (!isMultilingual) {
            return null;
        }

        const editLang = preferredLang || 'en';
        const displayText = parsed[editLang] || parsed['en'] || parsed[keys[0]] || '';

        return {
            displayText,
            multiLangObj: parsed,
            editLang,
        };
    } catch (_e) {
        return null;
    }
}

/**
 * Reconstructs a multilingual JSON string after editing one language.
 *
 * @param {string} multiLangJson - The stored JSON string of all languages
 * @param {string} editLang - The language that was edited
 * @param {string} newValue - The new value for editLang
 * @returns {string|null} The reconstructed JSON string, or null on failure
 */
export function reconstructMultilingualValue(multiLangJson, editLang, newValue) {
    if (!multiLangJson || !editLang || typeof newValue !== 'string') {
        return null;
    }

    try {
        const langObj = JSON.parse(multiLangJson);
        const hadLanguageKey = Object.prototype.hasOwnProperty.call(langObj, editLang);

        if (!hadLanguageKey && newValue === '') {
            return JSON.stringify(langObj);
        }

        langObj[editLang] = newValue;
        return JSON.stringify(langObj);
    } catch (_e) {
        return null;
    }
}

/**
 * Determines the input type and configuration for a given data type and text length.
 *
 * @param {string} dataType - The column data type (e.g. 'boolean', 'date', 'text')
 * @param {number} textLength - Length of the current text value
 * @returns {{ type: 'checkbox'|'date'|'datetime-local'|'number'|'text'|'textarea' }}
 */
export function resolveInputType(dataType, textLength) {
    if (dataType === 'boolean') {
        return { type: 'checkbox' };
    }

    if (dataType === 'date') {
        return { type: 'date' };
    }

    if (dataType.includes('timestamp')) {
        return { type: 'datetime-local' };
    }

    if (dataType === 'int' || dataType === 'integer' || dataType === 'numeric') {
        return { type: 'number' };
    }

    // Text: use textarea for long content
    if (textLength > 80) {
        return { type: 'textarea' };
    }

    return { type: 'text' };
}

/**
 * Builds a lookup map from column_details array for a given table.
 *
 * @param {Array<{table_name: string, column_name: string, editable_in_ui: any, data_type: string, is_multilingual: any}>} columnDetails
 * @param {string} tableName
 * @returns {Object<string, {editable_in_ui: boolean, data_type: string, is_multilingual: boolean}>}
 */
export function buildColumnInfoMap(columnDetails, tableName) {
    const columnInfoMap = {};

    if (!Array.isArray(columnDetails)) {
        return columnInfoMap;
    }

    for (const colObj of columnDetails) {
        if (colObj.table_name === tableName && colObj.column_name) {
            columnInfoMap[colObj.column_name] = {
                editable_in_ui: !!colObj.editable_in_ui,
                data_type: colObj.data_type || 'text',
                is_multilingual: !!colObj.is_multilingual,
            };
        }
    }

    return columnInfoMap;
}

/**
 * Build the backend-generated FK display alias base for a foreign-key column.
 *
 * @param {string} columnName
 * @returns {string}
 */
export function buildGeneratedForeignDisplayAliasBase(columnName) {
    if (!columnName) {
        return '';
    }

    if (columnName.endsWith('_id')) {
        return `${columnName.slice(0, -3)}_name`;
    }

    if (columnName.endsWith('_uid')) {
        return `${columnName.slice(0, -4)}_name`;
    }

    return `${columnName}_name`;
}

/**
 * Normalize a generated FK alias key so `queue_name`, `queue_name (ln)`,
 * and `queue_name (ln 2)` can be compared safely.
 *
 * @param {string} columnName
 * @returns {string}
 */
export function normalizeGeneratedForeignDisplayAliasKey(columnName) {
    return String(columnName || '')
        .trim()
        .replace(GENERATED_FK_ALIAS_SUFFIX_RE, '')
        .toLowerCase();
}

/**
 * Find the generated FK display column emitted by the backend for a visible FK field.
 *
 * @param {Object<string, *>} rowItem
 * @param {string} columnName
 * @param {Object<string, {foreign_table?: string}>} dataTypes
 * @returns {string|null}
 */
export function getGeneratedForeignDisplayColumn(rowItem, columnName, dataTypes = {}) {
    if (!rowItem || typeof rowItem !== 'object') {
        return null;
    }

    if (!dataTypes[columnName]?.foreign_table) {
        return null;
    }

    const expectedAlias = buildGeneratedForeignDisplayAliasBase(columnName).toLowerCase();

    return Object.keys(rowItem).find((candidate) => {
        if (Object.prototype.hasOwnProperty.call(dataTypes, candidate)) {
            return false;
        }

        return normalizeGeneratedForeignDisplayAliasKey(candidate) === expectedAlias;
    }) || null;
}

/**
 * Check whether a column name is a generated FK alias that should be hidden
 * in favor of the underlying FK column on big-card surfaces.
 *
 * @param {string} columnName
 * @param {Object<string, {foreign_table?: string}>} dataTypes
 * @returns {boolean}
 */
export function isGeneratedForeignDisplayColumn(columnName, dataTypes = {}) {
    if (!columnName || Object.prototype.hasOwnProperty.call(dataTypes, columnName)) {
        return false;
    }

    const normalizedCandidate = normalizeGeneratedForeignDisplayAliasKey(columnName);

    return Object.keys(dataTypes).some((sourceColumn) => {
        if (!dataTypes[sourceColumn]?.foreign_table) {
            return false;
        }

        return buildGeneratedForeignDisplayAliasBase(sourceColumn).toLowerCase() === normalizedCandidate;
    });
}

/**
 * Resolve the stored raw value plus the human-facing display value for a card field.
 * Prefers backend-generated FK display aliases when available and normalizes
 * dev_agent_tasks status to the contributor-facing alias.
 *
 * @param {Object<string, *>} rowItem
 * @param {string} columnName
 * @param {Object<string, {foreign_table?: string, is_multilingual?: boolean}>} dataTypes
 * @param {string} preferredLang
 * @param {string} tableName
 * @returns {{ rawValue: *, displayValue: string, aliasColumn: string|null, isMultilingual: boolean|null }}
 */
export function resolveCardFieldDisplayValue(
    rowItem,
    columnName,
    dataTypes = {},
    preferredLang = 'en',
    tableName = ''
) {
    const rawValue = rowItem?.[columnName];
    const aliasColumn = getGeneratedForeignDisplayColumn(rowItem, columnName, dataTypes);
    const aliasValue = aliasColumn ? rowItem?.[aliasColumn] : null;
    const useAliasValue = aliasValue !== null && aliasValue !== undefined && String(aliasValue).trim() !== '';
    const valueForDisplay = useAliasValue ? aliasValue : rawValue;
    const isMultilingual = useAliasValue
        ? (dataTypes[aliasColumn]?.is_multilingual ?? null)
        : (dataTypes[columnName]?.is_multilingual ?? null);

    let displayValue = extractLangValue(valueForDisplay, preferredLang, isMultilingual);
    if (isTicketStatusField(tableName, columnName)) {
        displayValue = normalizeTicketStatusForClient(displayValue);
    }

    return {
        rawValue,
        displayValue,
        aliasColumn: useAliasValue ? aliasColumn : null,
        isMultilingual,
    };
}

/**
 * Normalize a dev_agent_tasks status into the contributor-facing alias set.
 *
 * @param {string} status
 * @returns {string}
 */
export function normalizeTicketStatusForClient(status) {
    const trimmed = String(status ?? '').trim();
    if (!trimmed) {
        return '';
    }

    return DEV_AGENT_TASK_STATUS_CLIENT_ALIASES[trimmed] || trimmed;
}

/**
 * Normalize a dev_agent_tasks status into the canonical DB value set.
 *
 * @param {string} status
 * @returns {string}
 */
export function normalizeTicketStatusForDb(status) {
    const trimmed = String(status ?? '').trim();
    if (!trimmed) {
        return '';
    }

    return DEV_AGENT_TASK_STATUS_DB_ALIASES[trimmed] || trimmed;
}

/**
 * Whether the current field should use the ticket-status alias model.
 *
 * @param {string} tableName
 * @param {string} columnName
 * @returns {boolean}
 */
export function isTicketStatusField(tableName, columnName) {
    return tableName === 'dev_agent_tasks' && columnName === 'status';
}

/**
 * Build the constrained status-option set used by dev_agent_tasks card editing.
 * Uses the canonical workflow status set, but preserves an unexpected current value
 * so stale rows remain editable during transitions.
 *
 * @param {string} currentStatus
 * @returns {Array<{value: string, label: string}>}
 */
export function getTicketStatusOptions(currentStatus = '') {
    const normalizedCurrent = normalizeTicketStatusForClient(currentStatus);
    const optionValues = [...DEV_AGENT_TASK_STATUS_OPTIONS];

    if (normalizedCurrent && !optionValues.includes(normalizedCurrent)) {
        optionValues.push(normalizedCurrent);
    }

    return optionValues.map((value) => ({ value, label: value }));
}

/**
 * Map ticket statuses into presentation tones for badges/chips.
 *
 * @param {string} status
 * @returns {string}
 */
export function getTicketStatusTone(status) {
    switch (normalizeTicketStatusForClient(status)) {
        case 'backlog':
            return 'backlog';
        case 'backlog_later':
            return 'later';
        case 'backlog_nice_to_have':
            return 'nice';
        case 'in_progress':
            return 'progress';
        case 'on_hold':
            return 'hold';
        case 'awaiting_human_decision':
            return 'awaiting';
        case 'done':
            return 'done';
        case 'rejected':
            return 'rejected';
        case 'aborted':
            return 'aborted';
        case 'archived':
            return 'archived';
        case 'to_be_deleted':
            return 'delete';
        case 'new':
        default:
            return 'new';
    }
}
