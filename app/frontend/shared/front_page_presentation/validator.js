// validator.js
// Validates the complete saved Home presentation without coercing values.
// Connects palette controls and rendering to the Go-embedded JSON definition.
// Converts development version-one rows and supplies the centred site default.
import definition from './definition.json' with { type: 'json' };
export const HOME_PRESENTATION_DEFINITION = definition;
export const DEFAULT_HOME_PRESENTATION = Object.freeze({ ...definition.default });

/** Twin of frontend/shared/front_page_presentation/definition.go: Parse. */
export function isValidHomePresentation(value) {
    if (!value || Array.isArray(value) || typeof value !== 'object') return false;
    const keys = Object.keys(definition.default);
    if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) return false;
    return value.schema_version === definition.schema_version
        && definition.anchors.includes(value.anchor)
        && definition.alignments.includes(value.alignment)
        && Object.keys(definition.default).filter(key => definition[key]?.step).every(key => {
            const bounds = definition[key];
            return Number.isInteger(value[key]) && value[key] >= bounds.min && value[key] <= bounds.max
                && (value[key] - bounds.min) % bounds.step === 0;
        });
}

/** Read compatibility only: writes always pass the strict version-two validator. */
export function readHomePresentation(value) {
    if (value == null) return { ...DEFAULT_HOME_PRESENTATION };
    if (isValidHomePresentation(value)) return { ...value };
    const keys = ['schema_version', 'anchor', 'margin_px', 'paragraph_layout', 'max_width_px'];
    if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length
        || keys.some(key => !Object.hasOwn(value, key))
        || value.schema_version !== definition.legacy.schema_version
        || typeof value.paragraph_layout !== 'string'
        || !Object.hasOwn(definition.legacy.alignments, value.paragraph_layout)) throw new Error('Invalid Home presentation');
    const converted = { ...DEFAULT_HOME_PRESENTATION, anchor: value.anchor,
        horizontal_margin_px: value.margin_px, vertical_margin_px: value.margin_px,
        alignment: definition.legacy.alignments[value.paragraph_layout], max_width_px: value.max_width_px };
    if (!isValidHomePresentation(converted)) throw new Error('Invalid Home presentation');
    return converted;
}
