// duration_input.js
// Builds one number and unit editor for a setting-specific stored JSON shape.
// Connects a shared duration definition to caller-owned translations and save events.
// Exists so duration settings need no separate raw JSON form or unit vocabulary.
import definitions from '../../shared/setting_durations/definitions.json' with { type: 'json' };

/** Creates a portable editor; callers validate before saving and own translations. */
export function createDurationInput({ definition, value, translate, inputId, label }) {
    let stored = value;
    if (typeof stored === 'string') {
        try { stored = JSON.parse(stored); } catch { stored = {}; }
    }
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) stored = {};

    const element = document.createElement('div');
    element.className = 'duration-input';
    element.setAttribute('role', 'group');
    element.setAttribute('aria-label', label);
    const amountInput = document.createElement('input');
    amountInput.id = inputId;
    amountInput.type = 'number';
    amountInput.step = '1';
    amountInput.required = true;
    amountInput.setAttribute('aria-label', label);
    amountInput.value = stored[definition.amount_field] ?? '';
    const unitSelect = document.createElement('select');
    unitSelect.required = true;
    const normalizedUnit = String(stored[definition.unit_field] ?? '').trim().toLowerCase().replace(/s$/, '') + 's';
    for (const unit of definitions.units.filter(unit => definition.bounds[unit])) {
        const option = document.createElement('option');
        option.value = unit;
        option.dataset.langKey = `duration_unit_${unit}`;
        unitSelect.appendChild(option);
    }
    unitSelect.value = normalizedUnit;
    element.append(amountInput, unitSelect);

    let enabledInput;
    let enabledText;
    if (definition.enabled_field) {
        const enabledLabel = document.createElement('label');
        enabledInput = document.createElement('input');
        enabledInput.type = 'checkbox';
        enabledInput.checked = typeof stored[definition.enabled_field] === 'boolean'
            ? stored[definition.enabled_field] : definition.default?.[definition.enabled_field] === true;
        enabledText = document.createElement('span');
        enabledText.dataset.langKey = 'enabled';
        enabledLabel.append(enabledInput, enabledText);
        element.prepend(enabledLabel);
    }

    function updateBounds() {
        const bounds = definition.bounds[unitSelect.value];
        amountInput.min = String(bounds?.min ?? 1);
        amountInput.max = String(bounds?.max ?? Number.MAX_SAFE_INTEGER);
        // Keep incomplete old values repairable rather than replacing them silently.
        amountInput.disabled = enabledInput ? !enabledInput.checked : false;
        unitSelect.disabled = amountInput.disabled;
    }

    function updateTranslations() {
        for (const option of unitSelect.options) option.textContent = translate(option.dataset.langKey);
        unitSelect.dataset.ariaLabelLangKey = `duration_unit_${unitSelect.value}`;
        unitSelect.setAttribute('aria-label', `${label}: ${translate(`duration_unit_${unitSelect.value}`)}`);
        if (enabledText) enabledText.textContent = translate('enabled');
    }

    /** Emits original field names and unrelated JSON fields, with an integer amount. */
    function getValue() {
        const value = { ...stored, [definition.amount_field]: amountInput.value === '' ? null : Number(amountInput.value), [definition.unit_field]: unitSelect.value };
        if (enabledInput) value[definition.enabled_field] = enabledInput.checked;
        return value;
    }

    /** Rejects incomplete, fractional and out-of-range values before a request. */
    function validate() {
        if (enabledInput && !enabledInput.checked) return true;
        const bounds = definition.bounds[unitSelect.value];
        const amount = Number(amountInput.value);
        return Boolean(bounds && amountInput.value !== '' && Number.isSafeInteger(amount) && amount >= bounds.min && amount <= bounds.max);
    }

    element.addEventListener('change', () => { updateBounds(); updateTranslations(); });
    updateBounds();
    updateTranslations();
    return { element, getValue, validate, updateTranslations };
}
