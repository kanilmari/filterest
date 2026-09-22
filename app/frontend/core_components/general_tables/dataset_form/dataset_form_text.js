// dataset_form_text.js
// The one text helper of the dataset form, in both of its modes, its setting
// controls, its column table and the dataset removal dialog.
// Bridges the site's language keys with the form's own bootstrap copy, and
// retranslates an open form in place when the interface language changes.
// Exists so every part of the form names things the same way and never shows a
// raw key, instead of each part carrying its own lookup and English fallback.
import { getTranslationForKey } from "../../lang/translation_handler.js";
import { getCardRoleTranslationFallbacks } from "../../table_views/card_view/card_role_catalog.js";
import { getDatasetColumnTypeTranslationFallbacks } from "./dataset_column_type_catalog.js";
import { DATASET_FORM_TRANSLATION_FALLBACKS } from "./dataset_form_translation_fallbacks.js";

const FALLBACKS = {
    ...getCardRoleTranslationFallbacks(),
    ...getDatasetColumnTypeTranslationFallbacks(),
    ...DATASET_FORM_TRANSLATION_FALLBACKS,
};

/** The copy language of the page, as the fallback copy names it. */
function currentLocale() {
    let raw = document.documentElement.lang;
    if (!raw) {
        try { raw = localStorage.getItem("chosen_language"); } catch { raw = ""; }
    }
    const lang = String(raw || "en").toLowerCase();
    if (lang.startsWith("fi")) return "fi";
    if (lang.startsWith("yue") || lang.startsWith("zh-hk")) return "yue";
    if (lang.startsWith("ch") || lang.startsWith("zh")) return "ch";
    return "en";
}

/**
 * One text of the form in the current interface language.
 * The site's reviewed translation comes first; the form's own copy stands in
 * for a key the installation does not have yet, English for a language the copy
 * lacks, so the form never shows a raw key. A {name} placeholder is filled
 * from `values`.
 *
 * @param {string} key
 * @param {Object<string, string|number>} [values]
 * @returns {string}
 */
export function datasetFormText(key, values = null) {
    const copy = FALLBACKS[key];
    const fallback = copy?.[currentLocale()] || copy?.en || key;
    const translated = getTranslationForKey(key, { fallback, countUsage: false });
    const text = !translated || translated === key ? fallback : translated;
    if (!values) return text;
    return text.replace(/\{(\w+)\}/g, (match, name) => (name in values ? String(values[name]) : match));
}

/**
 * Give an element one text of the form and keep it translated.
 * A text without placeholders also carries data-lang-key, so the page's own
 * translator keeps it current too; a text with values is retranslated only by
 * the form's own observer, which knows the values.
 */
export function setDatasetFormText(element, key, values = null) {
    element.dataset.datasetFormKey = key;
    if (values) {
        element.dataset.datasetFormValues = JSON.stringify(values);
        delete element.dataset.langKey;
    } else {
        delete element.dataset.datasetFormValues;
        element.dataset.langKey = key;
    }
    element.textContent = datasetFormText(key, values);
    return element;
}

/** A label whose caption is one text of the form; the caller appends its control. */
export function datasetFormLabel(key, className = "") {
    const label = document.createElement("label");
    if (className) label.className = className;
    label.appendChild(setDatasetFormText(document.createElement("span"), key));
    return label;
}

/**
 * A status line beside one control. It says why the control cannot be used or
 * what went wrong with it, in the form's words or in the server's own sentence.
 */
export function createDatasetFormStatus(className = "") {
    const element = document.createElement("span");
    element.className = `dataset-form-status${className ? ` ${className}` : ""}`;
    element.setAttribute("role", "status");
    element.hidden = true;
    return {
        element,
        /** Show one text of the form. */
        show(key, values = null) {
            setDatasetFormText(element, key, values);
            element.hidden = false;
        },
        /** Show a sentence the server wrote, which is already in the reader's language. */
        showMessage(message) {
            delete element.dataset.datasetFormKey;
            delete element.dataset.datasetFormValues;
            delete element.dataset.langKey;
            element.textContent = String(message || "");
            element.hidden = false;
        },
        clear() {
            element.hidden = true;
        },
    };
}

/**
 * Retranslate every text of one open form when the interface language
 * changes, without replacing any control, draft value or focus.
 *
 * @param {HTMLElement} root
 * @returns {() => void} stops observing
 */
export function observeDatasetFormLanguage(root) {
    const refresh = () => {
        root.querySelectorAll("[data-dataset-form-key]").forEach((element) => {
            const values = element.dataset.datasetFormValues ? JSON.parse(element.dataset.datasetFormValues) : null;
            element.textContent = datasetFormText(element.dataset.datasetFormKey, values);
        });
    };
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    refresh();
    return () => observer.disconnect();
}
