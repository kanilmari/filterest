// front_page_settings_controls.js
// Builds translated, labelled native controls for the Home editor.
// Connects the settings and background sections with the shared language catalog.
// Keeps control names and accessible feedback consistent across the editor.

import { getTranslationForKey } from '../lang/translation_handler.js';

export function frontPageText(key) {
    return getTranslationForKey(key);
}

export function frontPageLabel(element, key) {
    element.dataset.langKey = key;
    element.textContent = frontPageText(key);
    return element;
}

export function frontPageButton(key, testId, primary = false) {
    const button = frontPageLabel(document.createElement('button'), key);
    button.type = 'button';
    button.classList.add('fw-btn', primary ? 'fw-btn--primary' : 'fw-btn--ghost');
    button.dataset.testid = `front-page-${testId}`;
    return button;
}

export function frontPageField(key, input, testId) {
    const label = document.createElement('label');
    label.className = 'front-page-settings-field';
    input.id = `front-page-${testId}`;
    input.dataset.testid = input.id;
    label.htmlFor = input.id;
    const text = frontPageLabel(document.createElement('span'), key);
    label.append(text, input);
    if (input.type === 'checkbox') label.classList.add('front-page-settings-checkbox');
    return label;
}

export function frontPageSection(key) {
    const element = document.createElement('fieldset');
    element.className = 'front-page-settings-section';
    element.append(frontPageLabel(document.createElement('legend'), key));
    return element;
}

export function frontPageStatus(testId) {
    const element = document.createElement('p');
    element.className = 'front-page-settings-status';
    element.dataset.testid = `front-page-${testId}`;
    element.setAttribute('role', 'status');
    element.setAttribute('aria-live', 'polite');
    element.setAttribute('aria-atomic', 'true');
    return element;
}
