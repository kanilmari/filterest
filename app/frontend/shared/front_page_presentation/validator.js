// validator.js
// Validates the complete saved Home presentation without coercing values.
// Connects palette controls and rendering to the Go-embedded JSON definition.
// Keeps untouched sites in legacy mode instead of silently adopting new defaults.
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
        && definition.paragraph_layouts.includes(value.paragraph_layout)
        && ['margin_px', 'max_width_px'].every(key => {
            const bounds = definition[key];
            return Number.isInteger(value[key]) && value[key] >= bounds.min && value[key] <= bounds.max
                && (value[key] - bounds.min) % bounds.step === 0;
        });
}
