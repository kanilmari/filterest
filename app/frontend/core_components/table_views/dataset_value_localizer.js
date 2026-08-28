// dataset_value_localizer.js
// Resolves and refreshes one-language display values for generic dataset views.
// Bridges raw row payloads, column multilingual metadata, and the active UI language into DOM-safe text.
// Exists so every dataset presentation can share one conservative localization boundary without mutating source data.

import {
    extractLangValue,
    looksLikeLangValue,
} from '../../reusable_components/lang_value_reader.js';
import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';

const LANGUAGE_RENDERER = Symbol('datasetLanguageRenderer');
const LANGUAGE_RENDERER_ATTRIBUTE = 'data-dataset-language-renderer';

function serializeDatasetValue(rawValue) {
    if (rawValue == null) {
        return '';
    }
    if (typeof rawValue !== 'object') {
        return String(rawValue).trim();
    }
    try {
        return JSON.stringify(rawValue);
    } catch {
        return String(rawValue);
    }
}

function resolveMultilingualMetadataFlag(columnMetadata) {
    if (!columnMetadata || typeof columnMetadata !== 'object') {
        return null;
    }
    if (!Object.prototype.hasOwnProperty.call(columnMetadata, 'is_multilingual')) {
        return null;
    }
    const metadataValue = columnMetadata.is_multilingual;
    if (metadataValue === true || metadataValue === 1 || metadataValue === 'true' || metadataValue === '1') {
        return true;
    }
    return false;
}

/**
 * Resolves one visible language without changing the source value.
 * Explicit non-multilingual metadata always preserves legitimate JSON fields.
 * Missing metadata uses a conservative language-code heuristic for legacy datasets.
 *
 * @param {*} rawValue - Raw database/API value.
 * @param {object|string|null} columnMetadata - Column descriptor or scalar data type.
 * @param {string} chosenLanguage - Active language code.
 * @returns {string}
 */
export function resolveDatasetDisplayValue(
    rawValue,
    columnMetadata = null,
    chosenLanguage = getLanguageWithBrowserFallback()
) {
    const serializedValue = serializeDatasetValue(rawValue);
    const metadataFlag = resolveMultilingualMetadataFlag(columnMetadata);

    if (metadataFlag === false) {
        return serializedValue;
    }
    if (metadataFlag !== true && !looksLikeLangValue(rawValue)) {
        return serializedValue;
    }
    return extractLangValue(rawValue, chosenLanguage, true);
}

/**
 * Registers a DOM renderer that must be rerun when the active language changes.
 * The callback may update text, accessibility labels, or rebuild a whole view.
 *
 * @param {Element} element - Stable DOM root for the language-dependent output.
 * @param {(language: string) => (void|Promise<void>)} render - Language-aware renderer.
 * @param {string} chosenLanguage - Initial language.
 * @returns {void|Promise<void>}
 */
export function bindDatasetLanguageRenderer(
    element,
    render,
    chosenLanguage = getLanguageWithBrowserFallback()
) {
    if (!(element instanceof Element) || typeof render !== 'function') {
        return undefined;
    }
    element.setAttribute(LANGUAGE_RENDERER_ATTRIBUTE, 'true');
    element[LANGUAGE_RENDERER] = render;
    return render(chosenLanguage);
}

/**
 * Writes a localized text node and keeps its raw value available for language refreshes.
 * Formatting is applied after localization so JSON never reaches the visible DOM accidentally.
 *
 * @param {Element} element - Text-bearing DOM element.
 * @param {*} rawValue - Raw database/API value.
 * @param {object|string|null} columnMetadata - Column descriptor or scalar data type.
 * @param {object} options - Optional prefix, suffix, formatter, and post-render hook.
 * @returns {void|Promise<void>}
 */
export function setLocalizedDatasetText(element, rawValue, columnMetadata = null, options = {}) {
    const {
        prefix = '',
        suffix = '',
        transform = (value) => value,
        afterRender = null,
    } = options;

    return bindDatasetLanguageRenderer(element, (chosenLanguage) => {
        const localizedValue = resolveDatasetDisplayValue(rawValue, columnMetadata, chosenLanguage);
        const renderedValue = String(transform(localizedValue) ?? '');
        element.textContent = `${prefix}${renderedValue}${suffix}`;
        afterRender?.(renderedValue, localizedValue, chosenLanguage);
    });
}

/**
 * Refreshes every registered dataset-value renderer inside the supplied DOM root.
 * Async renderers are awaited so a completed language switch means every active view is current.
 *
 * @param {string} chosenLanguage - Newly active language code.
 * @param {ParentNode} root - Document or view subtree to refresh.
 * @returns {Promise<void>}
 */
export async function refreshLocalizedDatasetValues(chosenLanguage, root = document) {
    const elements = Array.from(root.querySelectorAll(`[${LANGUAGE_RENDERER_ATTRIBUTE}]`));
    await Promise.all(elements.map(async (element) => {
        const renderer = element[LANGUAGE_RENDERER];
        if (typeof renderer === 'function') {
            await renderer(chosenLanguage);
        }
    }));
}
