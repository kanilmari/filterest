// card_label_visibility_setting.js
// Edits the nullable field-label override without duplicating the server's role policy.
// Connects raw card-visibility metadata to the existing editable checkbox table.
// Keeps explicit Show/Hide distinct from the inherited default across languages.
import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';

const COPY = {
    fi: { label: 'Kentän otsikko', inherit: 'Roolin oletus', show: 'Näytä', hide: 'Piilota' },
    en: { label: 'Field label', inherit: 'Role default', show: 'Show', hide: 'Hide' },
    ch: { label: '字段标签', inherit: '角色默认值', show: '显示', hide: '隐藏' },
    yue: { label: '欄位標籤', inherit: '角色預設值', show: '顯示', hide: '隱藏' },
};

export function prepareCardLabelVisibilityRows(rows) {
    return rows.map(row => {
        if (Object.hasOwn(row, 'show_key_on_card_override') || typeof row.show_key_on_card !== 'boolean') return row;
        // A legacy server only exposes an explicit boolean; never guess a role default.
        return { ...row, show_key_on_card_override: row.show_key_on_card };
    });
}

export function buildCardLabelVisibilityColumn() {
    const copy = COPY[getLanguageWithBrowserFallback()] || COPY.en;
    const choices = [
        { value: 'inherit', label: copy.inherit },
        { value: 'true', label: copy.show },
        { value: 'false', label: copy.hide },
    ];
    return {
        key: 'show_key_on_card_override', label: copy.label, type: 'select',
        width: '12rem', minWidth: '12rem', maxWidth: '12rem',
        formatReadOnly: value => value == null ? copy.inherit : value === true ? copy.show : copy.hide,
        renderEditableCell({ value, column, updateValue, isDisabled }) {
            const select = document.createElement('select');
            select.className = 'vct-input-select';
            select.dataset.testid = 'card-label-visibility-select';
            select.setAttribute('aria-label', column.label);
            for (const choice of choices) {
                const option = document.createElement('option');
                option.value = choice.value; option.textContent = choice.label; select.append(option);
            }
            select.value = value == null ? 'inherit' : String(value);
            select.disabled = isDisabled;
            select.addEventListener('change', () => updateValue(select.value === 'inherit' ? null : select.value === 'true'));
            return select;
        },
    };
}
