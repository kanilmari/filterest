// manage_table_i18n.js
// Updates text-only nodes in open management dialogs without replacing inputs.
import { getTranslationForKey } from '../../lang/translation_handler.js';
import { MANAGE_TABLE_TRANSLATION_FALLBACKS } from './manage_table_translation_fallbacks.js';
import { getDatasetColumnTypeTranslationFallbacks } from '../dataset_form/dataset_column_type_catalog.js';
import { TABLE_CREATION_TRANSLATION_FALLBACKS } from '../gt_3_table_crud/gt_3_1_table_create/table_creation_translation_fallbacks.js';

// The column types are named once, in the catalogue both dataset forms share,
// and the column table's field names once, in the copy both forms read.
const DIALOG_FALLBACKS = {
    ...MANAGE_TABLE_TRANSLATION_FALLBACKS,
    ...TABLE_CREATION_TRANSLATION_FALLBACKS,
    ...getDatasetColumnTypeTranslationFallbacks(),
};

export function managementText(key) {
    const raw = document.documentElement.lang || localStorage.getItem('chosen_language') || 'en';
    const lang = raw.toLowerCase();
    const locale = lang.startsWith('fi') ? 'fi'
        : lang.startsWith('yue') || lang.startsWith('zh-hk') ? 'yue'
        : lang.startsWith('ch') || lang.startsWith('zh') ? 'ch' : 'en';
    // English stands in for a language this bootstrap copy does not carry, so a
    // dialog never shows a raw key.
    const fallback = DIALOG_FALLBACKS[key]?.[locale] || DIALOG_FALLBACKS[key]?.en || key;
    const translated = getTranslationForKey(key, { fallback, countUsage: false });
    return !translated || translated === key ? fallback : translated;
}

export function setManagementText(element, key) {
    element.dataset.langKey = key;
    element.dataset.manageTableKey = key;
    element.textContent = managementText(key);
    return element;
}

export function managementLabel(key) {
    const label = document.createElement('label');
    label.appendChild(setManagementText(document.createElement('span'), key));
    return label;
}

export function observeManagementLanguage(root) {
    const refresh = () => {
        root.querySelectorAll('[data-manage-table-key]').forEach(element => {
            element.textContent = managementText(element.dataset.manageTableKey);
        });
        root.querySelectorAll('[data-manage-table-aria-key]').forEach(element => {
            element.setAttribute('aria-label', managementText(element.dataset.manageTableAriaKey));
        });
    };
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    refresh();
    return () => observer.disconnect();
}
