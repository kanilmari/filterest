// cell_editor_multilingual_update.js
// Rebases a confirmed language edit on the current row when live changes are held.
// Connects the routed listing read to multilingual reconstruction, leaving retry policy to the editor.
// Prevents a long edit from overwriting another language with its opening snapshot.

import { endpoint_router } from '../../../endpoints/endpoint_router.js';
import { hasHeldInlineChange } from './inline_editor_state.js';
import { reconstructMultilingualValue } from '../../../table_views/card_view/card_field_formatter_helpers.js';

/** Re-read only a held dataset; any failed/missing read leaves the draft available for retry. */
export async function reconstructCurrentMultilingualValue(tableName, id, columnName, multilingualValue, newValue, viewKey) {
    let currentValue = multilingualValue.multiLangObj;
    if (hasHeldInlineChange(tableName)) {
        const params = new URLSearchParams({ dataset: tableName, id: String(id), view_key: viewKey });
        const result = await endpoint_router('getResults', { url_params: `?${params}` });
        const row = result?.data?.find(item => String(item.id) === String(id));
        if (result?.error || result?.success === false || !row || !Object.hasOwn(row, columnName)) {
            throw new Error('Current multilingual cell could not be read');
        }
        currentValue = row[columnName];
        if (typeof currentValue === 'string') {
            if (currentValue.trim() === '') currentValue = null;
            else {
                // Plain text and JSON scalars/lists have no translations to
                // protect. A healthy read must keep the ordinary save payload.
                try { currentValue = JSON.parse(currentValue); }
                catch { return newValue; }
                if (currentValue === null) return newValue;
            }
        }
        // Another confirmed edit may have cleared the whole cell. Start from
        // that empty value, never from the editor's old translations.
        if (currentValue == null && !multilingualValue.multiLangObj) return newValue;
        currentValue ??= {};
        if (typeof currentValue !== 'object' || Array.isArray(currentValue)) {
            return newValue;
        }
    }
    // With no held change, an initially empty cell keeps its ordinary payload.
    if (currentValue == null) return newValue;
    const reconstructed = reconstructMultilingualValue(
        typeof currentValue === 'string' ? currentValue : JSON.stringify(currentValue),
        multilingualValue.editLang, newValue
    );
    if (reconstructed === null) throw new Error('Current multilingual cell could not be reconstructed');
    return reconstructed;
}
