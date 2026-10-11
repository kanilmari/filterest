// validator.js
// Validates browser drafts with the same source-owned definition embedded by Go.
// Connects future style authoring to typed scopes, themes and existing-setting owners.
// Rejects arbitrary CSS and unregistered fonts without adding a publication workflow.
import definition from './definition.json' with { type: 'json' };
import { readStyleJSON, styleJSONByteLength } from './json_reader.js';

function freeze(value) {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
}
export const STYLE_PACKAGE_DEFINITION = freeze(definition);

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
const numberIn = (value, min, max, integer = false) => typeof value === 'number'
    && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
const matches = (value, pattern) => typeof value === 'string' && new RegExp(pattern).exec(value)?.[0] === value;
const length = (value, units) => exact(value, ['value', 'unit']) && typeof value.unit === 'string'
    && Object.hasOwn(units, value.unit) && numberIn(value.value, units[value.unit].min, units[value.unit].max);

function validToken(value, rule, knownFonts, references) {
    switch (rule.type) {
        case 'number': case 'integer': return numberIn(value, rule.min, rule.max, rule.type === 'integer');
        case 'length': return length(value, rule.units);
        case 'color': return matches(value, definition.color_pattern);
        case 'shadow_preset': return typeof value === 'string' && Object.hasOwn(definition.shadow_presets, value);
        case 'reveal_preset': return typeof value === 'string' && Object.hasOwn(definition.reveal_presets, value);
        case 'responsive_size': return exact(value, Object.keys(rule.fields))
            && Object.entries(rule.fields).every(([key, unit]) => length(value[key], { [unit]: rule.units[unit] }))
            && value.min.value <= value.max.value;
        case 'font_binding': {
            const font = reference => {
                if (!matches(reference, definition.font_reference_pattern)
                    || !knownFonts.includes(reference)) return false;
                references.add(reference);
                return true;
            };
            return definition.font_roles.includes(rule.role) && exact(value, definition.font_binding_fields)
                && object(value.languages) && font(value.default)
                && Object.entries(value.languages).every(([language, reference]) =>
                    matches(language, definition.language_pattern) && font(reference));
        }
        default: return false;
    }
}

/** Identify the existing owner for a stored setting key or its CSS projection. */
export function reservedStyleTokenOwner(key) {
    return Object.entries(definition.reserved).find(([, owner]) =>
        owner.fields.includes(key) || owner.css.includes(key))?.[0] ?? null;
}

/** Twin of validator.go:Parse for draft objects; use the raw parser for imported JSON. */
export function isValidStylePackage(value, knownFonts = []) {
    if (!exact(value, definition.manifest_fields) || value.schema_version !== definition.schema_version
        || !object(value.scopes) || !Array.isArray(knownFonts)) return false;
    let assignments = 0;
    const references = new Set();
    for (const [scope, themes] of Object.entries(value.scopes)) {
        if (!Object.hasOwn(definition.scopes, scope) || !exact(themes, definition.themes)) return false;
        for (const theme of definition.themes) {
            if (!object(themes[theme])) return false;
            for (const [key, token] of Object.entries(themes[theme])) {
                if (reservedStyleTokenOwner(key) || !Object.hasOwn(definition.tokens, key)) return false;
                const rule = definition.tokens[key];
                if (rule.owner !== 'package' || !rule.scopes.includes(scope)
                    || !validToken(token, rule, knownFonts, references)) return false;
                assignments += definition.assignment_costs.token;
                if (rule.type === 'font_binding') assignments += Object.keys(token.languages).length
                    * definition.assignment_costs.language_font_slot;
            }
        }
    }
    if (assignments > definition.limits.assignments || references.size > definition.limits.font_faces) return false;
    try { return styleJSONByteLength(JSON.stringify(value)) <= definition.limits.manifest_bytes; }
    catch { return false; }
}

/** Validate raw imports without losing duplicate keys. Fonts require a trusted ID list. */
export function parseStylePackageJSON(raw, knownFonts = []) {
    if (typeof raw !== 'string' || styleJSONByteLength(raw) > definition.limits.manifest_bytes)
        throw new Error('Style manifest byte limit exceeded or invalid text');
    const value = readStyleJSON(raw, definition.limits.json_depth);
    if (!isValidStylePackage(value, knownFonts)) throw new Error('Invalid style package');
    return value;
}
