// table_creation_labels.js
// Creates translatable text-only labels without replacing nested form controls.
// data-lang-key lets the shared page translator refresh open forms in place.
import { getTranslationForKey } from '../../../lang/translation_handler.js';

export function setCreationText(element, key) {
    element.dataset.langKey = key;
    element.textContent = getTranslationForKey(key);
    return element;
}
export function createCreationLabel(key) {
    const label = document.createElement('label');
    label.appendChild(setCreationText(document.createElement('span'), key));
    return label;
}
