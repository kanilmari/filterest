// child_card_formatter.js
// Renders JSON related-record objects as compact related-item list rows.
// Bridges related-row data, table metadata, and the row article related tabs.
// Exists to keep related-record formatting isolated from the main card element builder.

import { count_this_function } from '../../dev_tools/function_counter.js';
import { extractLangValue } from '../../../reusable_components/lang_value_reader.js';
import { getLanguageWithBrowserFallback } from '../../state_stores/lang_preference_reader.js';
import { formatTimestampDisplayParts } from '../timestamp_display_formatter.js';
import {
    getTemporalValueKind,
    TEMPORAL_KIND_TIMESTAMP,
} from '../temporal_value_formatter.js';

count_this_function('createRelatedRecordCard'); // 🔢

const RELATED_RECORD_HEADER_ROLE = 'header';
const RELATED_RECORD_ID_COLUMN = 'id';
const RELATED_RECORD_CREATED_COLUMN = 'created';
const RELATED_RECORD_UPDATED_COLUMN = 'updated';

/**
 * Luo tiiviin listaelementin yhdestä related-rivistä.
 * Näyttää metadata-headerin sekä audit-päivämäärät sarakemuotoiseen listaan.
 */
export function createRelatedRecordCard(jsonObj, options = {}) {
    const {
        dataTypes = {},
        onOpen = null,
        onDelete = null,
    } = options;
    const preferredLanguage = getLanguageWithBrowserFallback();
    const entries = Object.entries(jsonObj).map(([key, value]) => ({
        key,
        value,
        displayValue: normalizeRelatedValue(
            value,
            preferredLanguage,
            dataTypes[key]?.is_multilingual ?? null,
        ),
    }));

    const wrapper = document.createElement('div');
    wrapper.classList.add(
        'related_pretty_card',
        'child_pretty_card',
        'comment_item',
        'related_record_list_item',
        'child_record_list_item',
    );

    const idEntry = findColumnEntry(entries, RELATED_RECORD_ID_COLUMN);
    const headerEntry = findHeaderEntry(entries, dataTypes);
    const createdEntry = findColumnEntry(entries, RELATED_RECORD_CREATED_COLUMN);
    const updatedEntry = findColumnEntry(entries, RELATED_RECORD_UPDATED_COLUMN);

    if (idEntry?.displayValue && idEntry.displayValue !== '—') {
        wrapper.dataset.recordId = idEntry.displayValue;
    }

    const row = document.createElement('div');
    row.classList.add('related_record_summary_row', 'child_record_summary_row');

    row.appendChild(createSummaryCell({
        column: RELATED_RECORD_ID_COLUMN,
        label: 'ID',
        value: idEntry?.displayValue || '—',
        modifier: 'id',
    }));
    row.appendChild(createSummaryCell({
        column: headerEntry?.key || '',
        label: 'Nimi',
        value: headerEntry?.displayValue || '—',
        modifier: 'title',
        onClick: onOpen ? () => onOpen(jsonObj) : null,
    }));
    const createdDisplay = formatRelatedTimestamp(
        createdEntry?.value,
        createdEntry ? dataTypes[createdEntry.key] : null,
    );
    row.appendChild(createSummaryCell({
        column: RELATED_RECORD_CREATED_COLUMN,
        label: 'Luotu',
        value: createdDisplay.displayText,
        title: createdDisplay.titleText,
        modifier: 'created',
    }));
    const updatedDisplay = formatRelatedTimestamp(
        updatedEntry?.value,
        updatedEntry ? dataTypes[updatedEntry.key] : null,
    );
    row.appendChild(createSummaryCell({
        column: RELATED_RECORD_UPDATED_COLUMN,
        label: 'Muokattu',
        value: updatedDisplay.displayText,
        title: updatedDisplay.titleText,
        modifier: 'updated',
    }));

    if (onDelete) {
        const actions = document.createElement('div');
        actions.classList.add('related_record_actions', 'child_record_actions');
        actions.appendChild(createRelatedRecordActionButton({
            langKey: 'delete',
            fallbackText: 'Poista',
            className: 'related_record_action related_record_action--delete child_record_action child_record_action--delete',
            onClick: () => onDelete(jsonObj),
        }));
        row.appendChild(actions);
    }

    wrapper.appendChild(row);
    return wrapper;
}

export const createPrettyJsonCard = createRelatedRecordCard;

function normalizeRelatedValue(value, preferredLanguage = 'en', isMultilingual = null) {
    if (value === null || value === undefined) return '—';
    return extractLangValue(value, preferredLanguage, isMultilingual);
}

/** Formats audit values from metadata, using payload-shape detection only when metadata is absent. */
function formatRelatedTimestamp(value, columnMeta = null) {
    const fallbackValue = normalizeRelatedValue(value);
    const metadataProvided = columnMeta !== null
        && columnMeta !== undefined
        && (typeof columnMeta !== 'string' || columnMeta.trim() !== '');
    const temporalKind = getTemporalValueKind(columnMeta || '');
    if (metadataProvided && temporalKind === null) {
        return {
            displayText: fallbackValue,
            titleText: fallbackValue,
        };
    }

    // database/sql may serialize a TIMESTAMP WITHOUT TIME ZONE as RFC3339.
    // The suffix is transport syntax in that case, not permission to shift the wall clock.
    const displayValue = temporalKind === TEMPORAL_KIND_TIMESTAMP && !(value instanceof Date)
        ? String(value ?? '').trim().replace(/(?:Z|[+-]\d{2}:?\d{2})$/u, '')
        : value;
    const displayParts = formatTimestampDisplayParts(
        displayValue,
        metadataProvided ? columnMeta : '',
        { force: true },
    );
    return displayParts || {
        displayText: fallbackValue,
        titleText: fallbackValue,
    };
}

function createSummaryCell({
    column,
    label,
    value,
    title = value,
    modifier,
    onClick = null,
}) {
    const cell = document.createElement('div');
    cell.classList.add(
        'related_record_summary_cell',
        'child_record_summary_cell',
        `related_record_summary_cell--${modifier}`,
        `child_record_summary_cell--${modifier}`,
    );
    if (column) {
        cell.dataset.column = column;
    }

    const labelElement = document.createElement('span');
    labelElement.classList.add('related_record_summary_label', 'child_record_summary_label');
    labelElement.textContent = label;

    const valueElement = document.createElement(onClick ? 'button' : 'span');
    valueElement.classList.add('related_record_summary_value', 'child_record_summary_value');
    valueElement.textContent = value;
    valueElement.title = title;

    if (onClick) {
        valueElement.type = 'button';
        valueElement.classList.add(
            'related_record_title',
            'child_record_title',
            'related_record_title_button',
            'child_record_title_button',
        );
        valueElement.addEventListener('click', onClick);
    }

    cell.appendChild(labelElement);
    cell.appendChild(valueElement);
    return cell;
}

function findHeaderEntry(entries, dataTypes = {}) {
    const headerColumns = new Set(
        Object.entries(dataTypes)
            .filter(([, columnType]) => hasHeaderCardRole(columnType))
            .map(([columnName]) => normalizeRelatedColumnKey(columnName))
    );
    if (headerColumns.size === 0) {
        return null;
    }

    return entries.find(entry =>
        headerColumns.has(normalizeRelatedColumnKey(entry.key))
        && entry.displayValue !== '—'
        && entry.displayValue.trim() !== ''
    ) || null;
}

function hasHeaderCardRole(columnType) {
    const cardElement = typeof columnType === 'object' && columnType !== null
        ? columnType.card_element
        : '';
    return String(cardElement || '')
        .split('+')
        .map(role => role.trim().toLowerCase())
        .includes(RELATED_RECORD_HEADER_ROLE);
}

function findColumnEntry(entries, columnName) {
    const normalizedColumnName = normalizeRelatedColumnKey(columnName);
    return entries.find(entry => normalizeRelatedColumnKey(entry.key) === normalizedColumnName) || null;
}

function normalizeRelatedColumnKey(key) {
    return key
        .toLowerCase()
        .replace(/\s+\(ln(?: \d+)?\)$/u, '');
}

export function getRelatedRecordDisplayName(jsonObj, options = {}) {
    const dataTypes = options.dataTypes || {};
    const preferredLanguage = getLanguageWithBrowserFallback();
    const entries = Object.entries(jsonObj).map(([key, value]) => ({
        key,
        displayValue: normalizeRelatedValue(
            value,
            preferredLanguage,
            dataTypes[key]?.is_multilingual ?? null,
        ),
    }));
    const titleEntry = findHeaderEntry(entries, dataTypes);
    return titleEntry?.displayValue || '';
}

export const getChildRecordDisplayName = getRelatedRecordDisplayName;

function createRelatedRecordActionButton({
    langKey,
    fallbackText,
    className,
    onClick,
}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.dataset.langKey = langKey;
    button.textContent = fallbackText;
    button.addEventListener('click', (event) => {
        event.stopPropagation();
        onClick();
    });
    return button;
}
