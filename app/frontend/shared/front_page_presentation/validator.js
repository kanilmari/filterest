// validator.js
// Validates the complete saved Home presentation without coercing values.
// Connects palette controls and rendering to the Go-embedded JSON definition.
// Converts version-one through six rows and supplies the centred site default.
import definition from './definition.json' with { type: 'json' };
export const HOME_PRESENTATION_DEFINITION = definition;
export const DEFAULT_HOME_PRESENTATION = Object.freeze({ ...definition.default,
    text_style: Object.freeze({ ...definition.default.text_style,
        reveal: Object.freeze({ ...definition.default.text_style.reveal }) }) });
const clone = value => ({ ...value, text_style: { ...value.text_style, reveal: { ...value.text_style.reveal } } });
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const inBounds = (value, bounds) => typeof value === 'number' && value >= bounds.min && value <= bounds.max
    && Math.round(value * 10) / 10 === value && (value * 10 - bounds.min * 10) % (bounds.step * 10) === 0;

/** Source-owned choices only; no font, colour, selector or CSS strings cross this boundary. */
export function isValidHomeTextStyle(value) {
    const rules = definition.text_style;
    return Boolean(exact(value, ['preset', 'reveal']) && rules.presets.includes(value.preset)
        && exact(value.reveal, ['mode', 'start_ms', 'interval_ms']) && rules.reveal_modes.includes(value.reveal.mode)
        && inBounds(value.reveal.start_ms, rules.start_ms) && inBounds(value.reveal.interval_ms, rules.interval_ms));
}

/** Twin of frontend/shared/front_page_presentation/definition.go: Parse. */
export function isValidHomePresentation(value) {
    if (!value || Array.isArray(value) || typeof value !== 'object') return false;
    const keys = Object.keys(definition.default);
    if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) return false;
    return value.schema_version === definition.schema_version
        && definition.anchors.includes(value.anchor)
        && definition.alignments.includes(value.alignment)
        && definition.phone_alignments.includes(value.phone_alignment)
        && isValidHomeTextStyle(value.text_style)
        && keys.filter(key => definition[key]?.step).every(key => inBounds(value[key], definition[key]));
}

/** Read compatibility only: writes always pass the strict current validator. */
export function readHomePresentation(value) {
    if (value == null) return clone(DEFAULT_HOME_PRESENTATION);
    if (isValidHomePresentation(value)) return clone(value);
    const v6Keys = Object.keys(definition.default).filter(key => key !== 'box_row_gap_px');
    if (value?.schema_version === 6) {
        if (!exact(value, v6Keys)) throw new Error('Invalid Home presentation');
        return readHomePresentation({ ...value, schema_version: definition.schema_version,
            box_row_gap_px: DEFAULT_HOME_PRESENTATION.box_row_gap_px });
    }
    const v5Keys = v6Keys.filter(key => key !== 'box_heading_gap_px');
    if (value?.schema_version === 5) {
        if (!exact(value, v5Keys)) throw new Error('Invalid Home presentation');
        return readHomePresentation({ ...value, schema_version: 6,
            box_heading_gap_px: DEFAULT_HOME_PRESENTATION.box_heading_gap_px });
    }
    if (value?.schema_version === 2 || value?.schema_version === 3) {
        const keys = v5Keys.filter(key => key !== 'phone_alignment' && key !== 'phone_story_size'
            && (value.schema_version !== 2 || key !== 'text_style'));
        const alignments = { left: 'start', center: 'center', right: 'end', justify: 'justify' };
        if (!exact(value, keys) || typeof value.alignment !== 'string'
            || !Object.hasOwn(alignments, value.alignment)) throw new Error('Invalid Home presentation');
        return readHomePresentation({ ...value, schema_version: 5,
            alignment: alignments[value.alignment], phone_alignment: 'inherit',
            phone_story_size: DEFAULT_HOME_PRESENTATION.phone_story_size,
            text_style: value.schema_version === 2 ? DEFAULT_HOME_PRESENTATION.text_style : value.text_style });
    }
    if (value?.schema_version === 4) {
        if (!exact(value, v5Keys.filter(key => key !== 'phone_story_size'))) {
            throw new Error('Invalid Home presentation');
        }
        return readHomePresentation({ ...value, schema_version: 5,
            phone_story_size: DEFAULT_HOME_PRESENTATION.phone_story_size });
    }
    const keys = ['schema_version', 'anchor', 'margin_px', 'paragraph_layout', 'max_width_px'];
    if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length
        || keys.some(key => !Object.hasOwn(value, key))
        || value.schema_version !== definition.legacy.schema_version
        || typeof value.paragraph_layout !== 'string'
        || !Object.hasOwn(definition.legacy.alignments, value.paragraph_layout)) throw new Error('Invalid Home presentation');
    const converted = { ...clone(DEFAULT_HOME_PRESENTATION), anchor: value.anchor,
        horizontal_margin_px: value.margin_px, vertical_margin_px: value.margin_px,
        alignment: definition.legacy.alignments[value.paragraph_layout], max_width_px: value.max_width_px };
    if (!isValidHomePresentation(converted)) throw new Error('Invalid Home presentation');
    return converted;
}
