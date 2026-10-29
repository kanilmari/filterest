// record_title_resolver.js
// Resolves a record's visible name for every card and article presentation.
// Connects already-authorized row values, column roles and dataset metadata.
// Never reads records or writes inferred roles; absent candidates fail closed.

import { resolveCardFieldDisplayValue } from './card_view/card_field_formatter_helpers.js';
import { extractLangValue, looksLikeLangValue } from '../../reusable_components/lang_value_reader.js';
import { getTranslationForKey } from '../lang/translation_handler.js';
import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';
import { resolveHeadingLanguage } from './card_view/row_article_heading_match.js';

const EXACT_NAMES = ['display_name', 'name', 'title', 'key'];
const SECRET_NAME = /(?:password|passwd|pwd|token|secret|credential|private.?key|api.?key|embedding|vector|binary)/i;
const BODY_NAME = /(?:payload|metadata|description|kuvaus|content|body|translation)/i;
const UNSAFE_TYPE = /(?:bytea|binary|vector|geometry|geography|array)/i;
const FALLBACK_COPY = {
    record_title_with_id: { en: 'Record {id}', fi: 'Tietue {id}', ch: '记录 {id}', yue: '記錄 {id}', 'zh-cn': '记录 {id}', 'zh-tw': '記錄 {id}', 'zh-hk': '記錄 {id}' },
    record_title_without_id: { en: 'Record', fi: 'Tietue', ch: '记录', yue: '記錄', 'zh-cn': '记录', 'zh-tw': '記錄', 'zh-hk': '記錄' },
};

/** Reads the same response metadata cache used by dataset presentation. */
export function readRecordTitleTableMeta(tableName) {
    try {
        return JSON.parse(localStorage.getItem(`${tableName}_tableMeta`) || '{}') || {};
    } catch {
        return {};
    }
}

/** Uses only the owner mark proven by the server; guests never own a record. */
export function isRecordViewersOwn(rowItem, dataTypes, currentUserID) {
    const column = Object.keys(dataTypes).find(key => dataTypes[key]?.is_row_owner === true);
    const viewer = Number(currentUserID);
    return Boolean(column && Number.isInteger(viewer) && viewer > 1 &&
        rowItem[column] != null && String(rowItem[column]).trim() === String(viewer));
}

function rolesOf(meta) {
    return String(meta.card_element || '').split(',').map(role => role.trim().split('+')[0]);
}

function visible(meta, surface, rowIsViewersOwn) {
    if (!meta || meta.hide_everywhere === true || meta.is_hidden === true ||
        meta.authorized === false || meta.selectable === false || meta.restricted === true ||
        meta.client_delivery_mode && meta.client_delivery_mode !== 'include' ||
        meta.show_value_on_card === false || rolesOf(meta).some(role => /^hidden\d*$/.test(role))) return false;
    if (surface === 'article') return !(meta.hide_on_bg_crd_if_not_own === true && !rowIsViewersOwn);
    return meta.hide_on_small_card !== true;
}

function orderedColumns(columns, dataTypes) {
    // The display order may be role-sorted by a renderer. Metadata's stable
    // physical order decides inference; ties retain the response column order.
    return [...new Set(columns)].sort((a, b) => {
        const left = Number(dataTypes[a]?.co_number);
        const right = Number(dataTypes[b]?.co_number);
        return (Number.isFinite(left) && left > 0 ? left : Infinity) -
            (Number.isFinite(right) && right > 0 ? right : Infinity);
    });
}

// The joined value alone proves neither delivery nor its type. Only the actual
// target's schema metadata can admit it; source-field visibility stays separate.
function eligibleAliasTarget(meta, configured) {
    const target = meta.foreign_display_metadata;
    const name = meta.foreign_display_column;
    const type = String(target?.data_type || '').toLowerCase();
    return target && typeof name === 'string' && name.trim() && !SECRET_NAME.test(name) &&
        (configured || !BODY_NAME.test(name)) && target.hide_everywhere === false &&
        target.client_delivery_mode === 'include' && type && !UNSAFE_TYPE.test(type) &&
        (/text|char|citext/.test(type) || target.is_multilingual === true);
}

/**
 * Resolve all usable configured headings, otherwise one safe inferred title.
 * `columns` is the current authorized presentation set, never all row keys.
 * Relation text comes only from an alias already returned by the authorized query.
 * Callers render `headers` as several headings and use `text`/`initial` for summaries.
 * Each title carries its displayed translation's language, or '' when unknown.
 */
export function resolveRecordTitle({
    rowItem = {}, columns = [], dataTypes = {}, tableName = '',
    tableMeta = rowItem.__articleTableMeta ?? readRecordTitleTableMeta(tableName),
    preferredLanguage = getLanguageWithBrowserFallback(), surface = 'card', currentUserID = null,
    rowIsViewersOwn = isRecordViewersOwn(rowItem, dataTypes, currentUserID),
} = {}) {
    const ordered = orderedColumns(columns, dataTypes);
    const candidate = (column, configured = false) => {
        const meta = dataTypes[column];
        if (!columns.includes(column) || !visible(meta, surface, rowIsViewersOwn) ||
            SECRET_NAME.test(column) || !configured && BODY_NAME.test(column) || UNSAFE_TYPE.test(meta.data_type || '') ||
            !configured && rolesOf(meta).some(role => /^(?:image|keywords|description)\d*$/.test(role))) return null;
        const value = resolveCardFieldDisplayValue(rowItem, column, dataTypes, preferredLanguage, tableName);
        const raw = value.aliasColumn ? rowItem[value.aliasColumn] : rowItem[column];
        if (value.aliasColumn) {
            if (!eligibleAliasTarget(meta, configured)) return null;
            // Override only this formatter result, never field metadata or the
            // shared formatter: ordinary FK display elsewhere is unchanged.
            value.isMultilingual = meta.foreign_display_metadata.is_multilingual === true;
            value.displayValue = extractLangValue(raw, preferredLanguage, value.isMultilingual);
        }
        // A numeric FK is never a label by itself. The formatter only accepts
        // server-generated aliases, whose SELECT rights the row query checked.
        if (meta.foreign_table && !value.aliasColumn) return null;
        const multilingual = value.isMultilingual !== false && looksLikeLangValue(raw);
        const dataType = String((value.aliasColumn ? meta.foreign_display_metadata.data_type : meta.data_type) || '').toLowerCase();
        if (/json/.test(dataType) && !(multilingual && value.isMultilingual === true) ||
            typeof raw === 'object' && !multilingual || Array.isArray(raw)) return null;
        if ((!configured || value.aliasColumn) && !multilingual && !/text|char|citext/.test(dataType) && !(dataType === '' && typeof raw === 'string')) return null;
        let text = value.displayValue.trim();
        // Use the admitted display source (including a related label), never its stored FK ID.
        let language = resolveHeadingLanguage(raw, value.isMultilingual, preferredLanguage);
        if (/(?:\+lang_key|\+lang-key)(?:,|$)/.test(meta.card_element || '') && text) {
            text = getTranslationForKey(text, { language: preferredLanguage, fallback: text }).trim();
            language = ''; // Dictionary lookup does not expose its resolved translation language.
        }
        if (!text || !configured && (/[\r\n]/.test(text) || text.length > 160 || text.startsWith('{') || text.startsWith('['))) return null;
        if (meta[surface === 'article' ? 'hide_false_null_on_big_crd' : 'hide_false_null_on_sml_crd'] === true &&
            /^(?:false|null)$/i.test(text)) return null;
        return { text, language, column, isFallback: false, configured };
    };
    // Configured heading order follows the caller's existing layout, not inference order.
    const headers = columns.filter(column => rolesOf(dataTypes[column] || {}).includes('header'))
        .map(column => candidate(column, true)).filter(Boolean);
    let title = headers[0];
    if (!title) {
        const names = EXACT_NAMES.flatMap(name => ordered.filter(column => column.toLowerCase() === name));
        const natural = tableMeta?.fk_display_column;
        const candidates = [...new Set([...names, ...(natural ? [natural] : []), ...ordered])];
        for (const column of candidates) {
            title = candidate(column);
            if (title) break;
        }
    }
    if (!title) {
        const idMeta = dataTypes.id;
        const id = columns.includes('id') && visible(idMeta, surface, rowIsViewersOwn) &&
            !/json|bytea|binary|vector/i.test(idMeta?.data_type || '') &&
            ['string', 'number'].includes(typeof rowItem.id) && /^[^\r\n]{1,160}$/.test(String(rowItem.id))
            ? String(rowItem.id).trim() : '';
        const key = id ? 'record_title_with_id' : 'record_title_without_id';
        const language = String(preferredLanguage || 'en').toLowerCase().replaceAll('_', '-');
        const copy = FALLBACK_COPY[key];
        const text = getTranslationForKey(key, { language: preferredLanguage,
            fallback: copy[language] || copy[language.split('-')[0]] || copy.en }).replaceAll('{id}', id);
        title = { text, language: '', column: null, isFallback: true, configured: false };
    }
    return { ...title, headers, initial: [...title.text][0]?.toUpperCase() || '' };
}
