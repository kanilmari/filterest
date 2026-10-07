// lang_key_editor_builder.js
// Builds the shared hero language-key editor with optional legacy and multi-line language fields.
// Connects dataset and Home settings to the same labelled translation controls.
// Keeps reviewed copy and usage explanations editable without duplicating a form.

import { getTranslationForKey } from '../lang/translation_handler.js';

function headerText(key) {
    return getTranslationForKey(key, { countUsage: false });
}

/** Gives an element one text of this screen; the page translator keeps it current. */
function setHeaderText(element, key) {
    element.dataset.langKey = key;
    element.textContent = headerText(key);
    return element;
}

// With `multiline`, each language gets a full-width textarea (still named fiInput etc.) for copy that wraps or keeps
// its own line breaks, such as Home's slogan.
export function createLangKeyEditor(titleKey, { includeChinese = true, multiline = false } = {}) {
    const wrapper = document.createElement('section');
    wrapper.classList.add('dataset-header-config-text-card', 'fw-panel', 'fw-flex', 'fw-flex-col', 'fw-gap-3');
    wrapper.appendChild(setHeaderText(document.createElement('h4'), titleKey));

    const keyInput = createTextInput();
    keyInput.readOnly = true;
    keyInput.classList.add('dataset-header-config-readonly-key');
    wrapper.appendChild(createLabeledField(setHeaderText(document.createElement('span'), 'lang_key'), keyInput));

    const translationsGrid = document.createElement('div');
    translationsGrid.classList.add('dataset-header-config-translation-grid');
    translationsGrid.classList.toggle('dataset-header-config-translation-grid--multiline', multiline);
    const createTranslationControl = multiline ? createTextArea : createTextInput;
    const fiInput = createTranslationControl();
    const enInput = createTranslationControl();
    const chInput = createTranslationControl();
    translationsGrid.append(
        createLabeledField(createLanguageCaption('fi'), fiInput),
        createLabeledField(createLanguageCaption('en'), enInput),
        ...(includeChinese ? [createLabeledField(createLanguageCaption('ch'), chInput)] : []),
    );
    wrapper.appendChild(translationsGrid);

    const usageExplanationInput = createTextArea();
    usageExplanationInput.placeholder = headerText('dataset_header_config_usage_placeholder');
    wrapper.appendChild(createLabeledField(
        setHeaderText(document.createElement('span'), 'usage_explanation'),
        usageExplanationInput
    ));

    return { wrapper, keyInput, fiInput, enInput, chInput, usageExplanationInput };
}

function createTextInput() {
    const input = document.createElement('input');
    input.type = 'text';
    input.classList.add('fw-form-control');
    return input;
}

function createTextArea() {
    const textarea = document.createElement('textarea');
    textarea.classList.add('fw-form-control');
    textarea.rows = 3;
    return textarea;
}

/** A caption above its control, inside one label so the caption focuses the control. */
function createLabeledField(caption, control) {
    const wrapper = document.createElement('label');
    wrapper.classList.add('fw-flex', 'fw-flex-col', 'fw-gap-2');
    caption.classList.add('fw-label');
    wrapper.append(caption, control);
    return wrapper;
}

/** A language's name with its code, such as "Finnish (FI)"; only the name is translated. */
function createLanguageCaption(code) {
    const caption = document.createElement('span');
    caption.classList.add('dataset-header-config-language-caption');
    caption.append(setHeaderText(document.createElement('span'), code), ` (${code.toUpperCase()})`);
    return caption;
}

/**
 * @param {ReturnType<typeof createLangKeyEditor>} editor
 * @param {DatasetHeaderTextConfig | null | undefined} config
 */
export function applyLangKeyConfig(editor, config) {
    editor.keyInput.value = config?.lang_key || '';
    editor.fiInput.value = config?.fi || '';
    editor.enInput.value = config?.en || '';
    editor.chInput.value = config?.ch || '';
    editor.usageExplanationInput.value = config?.usage_explanation || '';
}

export function appendLangKeyPayload(payload, prefix, editor) {
    payload.append(`${prefix}_fi`, editor.fiInput.value.trim());
    payload.append(`${prefix}_en`, editor.enInput.value.trim());
    payload.append(`${prefix}_ch`, editor.chInput.value.trim());
    payload.append(`${prefix}_usage_explanation`, editor.usageExplanationInput.value.trim());
}
