// active_filter_tag_printer_helpers.js
// Pure helper functions extracted from active_filter_tag_printer.js for testability.
// Zero DOM access — all functions are pure input→output.

/**
 * Group flat filter entries into logical filter groups.
 * Range filters (keys ending with _from/_to) are merged under their base name.
 * Other filters become single-value groups.
 *
 * @param {object} filters - Flat filter map { key: value }
 * @returns {object} Grouped filters: { baseName: { type: 'range'|'single', keys: string[], value?: *, values?: { from?, to? } } }
 */
export function groupFilters(filters) {
    const grouped = {};

    Object.entries(filters).forEach(([key, val]) => {
        if (key === 'search' || val === '' || val == null) return;
        const isExclude = key.endsWith('_exclude');
        const normalizedKey = isExclude ? key.replace(/_exclude$/, '') : key;
        const rangeMatch = normalizedKey.match(/_from$|_to$/);
        if (rangeMatch) {
            const base = normalizedKey.replace(/_(from|to)$/, '');
            if (!grouped[base]) grouped[base] = { type: 'range', keys: [], values: {} };
            grouped[base].keys.push(key);
            if (normalizedKey.endsWith('_from')) grouped[base].values.from = val;
            if (normalizedKey.endsWith('_to')) grouped[base].values.to = val;
        } else {
            const groupKey = isExclude ? `${normalizedKey}__exclude` : normalizedKey;
            grouped[groupKey] = {
                baseKey: normalizedKey,
                type: 'single',
                value: val,
                keys: [key],
                ...(isExclude ? { exclude: true } : {}),
            };
        }
    });

    return grouped;
}

/**
 * Strip the table name prefix from a filter base name to produce a display label.
 *
 * @param {string} base - Filter base name (e.g. "users_age")
 * @param {string} tableName - Table/dataset name (e.g. "users")
 * @returns {string} Display label (e.g. "age")
 */
export function buildFilterLabel(base, tableName) {
    return base.startsWith(`${tableName}_`) ? base.slice(tableName.length + 1) : base;
}

/**
 * Build the display value string for a filter group.
 *
 * @param {{ type: 'range'|'single', value?: *, values?: { from?: *, to?: * } }} data
 * @returns {string}
 */
export function buildDisplayValue(data) {
    if (data.type === 'range') {
        return `${data.values.from || ''}-${data.values.to || ''}`;
    }
    return String(data.value);
}

/**
 * Build a deduplication key for a filter tag.
 *
 * @param {string} labelBase - Display label
 * @param {string} displayValue - Formatted value
 * @returns {string}
 */
export function buildDedupeKey(labelBase, displayValue) {
    return `${labelBase}::${displayValue}`;
}

/**
 * Check whether a filter value is a translatable keyword
 * (true/false/empty/all) that should receive a langKey attribute.
 *
 * @param {*} value - Filter value
 * @returns {boolean}
 */
export function isTranslatableValue(value) {
    const lowerVal = String(value).toLowerCase();
    return ["true", "false", "empty", "all"].includes(lowerVal);
}

/**
 * Format the range label suffix for display.
 *
 * @param {{ from?: *, to?: * }} values - Range boundaries
 * @returns {string} Formatted range string (e.g. ": 10 - 20", " ≥ 10", " ≤ 20")
 */
export function formatRangeLabel(values) {
    const from = values.from;
    const to = values.to;
    if (from && to) return `: ${from} - ${to}`;
    if (from) return ` ≥ ${from}`;
    if (to) return ` ≤ ${to}`;
    return '';
}
