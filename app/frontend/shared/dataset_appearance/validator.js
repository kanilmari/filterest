// validator.js
// Validates dataset appearance against the same JSON policy embedded by Go.
// Connects version-one compatibility and version-two ownership with one policy.
// Keeps theme independence separate from storage place and UI steps advisory.
import definition from './definition.json' with { type: 'json' };

export const DATASET_APPEARANCE_DEFINITION = definition;
const isHexColor = value => /^#[0-9a-f]{6}$/i.test(value || '');

/** Resolves a stored path; shared.image_blur borrows the light-theme blur rule. */
export function datasetAppearanceField(path) {
    const [owner, key, extra] = path.split('.');
    if (extra !== undefined) return undefined;
    const fields = owner === 'shared' ? definition.shared_fields
        : definition.theme_owners.includes(owner) ? definition.theme_fields : undefined;
    const field = fields && Object.hasOwn(fields, key) ? fields[key] : undefined;
    if (!field) return undefined;
    if (field.rule_from) return { ...datasetAppearanceField(field.rule_from), ...field, place: field.place };
    return { ...field, default: owner === 'dark' && Object.hasOwn(field, 'dark_default')
        ? field.dark_default : field.default };
}

export const DEFAULT_DATASET_APPEARANCE = Object.freeze(Object.fromEntries(
    [...definition.theme_owners, 'shared'].map(owner => [owner, Object.freeze(Object.fromEntries(
        Object.keys(owner === 'shared' ? definition.shared_fields : definition.theme_fields)
            .map(key => [key, datasetAppearanceField(`${owner}.${key}`).default]),
    ))]),
));

export const DATASET_APPEARANCE_PATHS = Object.freeze(Object.entries(DEFAULT_DATASET_APPEARANCE)
    .flatMap(([owner, fields]) => Object.keys(fields).map(key => `${owner}.${key}`))
    .filter(path => !datasetAppearanceField(path).derived_from).sort());

/** Storage places are independent of the light/dark/shared theme grouping. */
export const DATASET_APPEARANCE_PATHS_BY_PLACE = Object.freeze(Object.fromEntries(
    ['tab_only', 'site_only', 'site_default'].map(place => [place, Object.freeze(
        DATASET_APPEARANCE_PATHS.filter(path => datasetAppearanceField(path).place === place),
    )]),
));

/** Twin of definition.go: Definition.PlaceForPath. Aliases inherit ownership
 *  but remain invalid stored keys; derived blur has no independent place. */
export function datasetAppearancePlace(path) {
    const [owner, key, extra] = path.split('.');
    if (extra !== undefined) return undefined;
    const alias = Object.hasOwn(definition.aliases, key) ? definition.aliases[key] : undefined;
    const field = datasetAppearanceField(alias?.owners.includes(owner) ? `${owner}.${alias.field}` : path);
    return field && !field.derived_from ? field.place : undefined;
}

/** Twin of definition.go: Definition.DefaultsForPlace; returns an independent
 *  flat canonical-path map, excluding aliases and compatibility-only values. */
export function datasetAppearanceDefaultsForPlace(place) {
    const paths = Object.hasOwn(DATASET_APPEARANCE_PATHS_BY_PLACE, place) ? DATASET_APPEARANCE_PATHS_BY_PLACE[place] : [];
    return Object.fromEntries(paths
        .map(path => [path, datasetAppearanceField(path).default]));
}

/** Twin of definition.go: Definition.ValidateLeaf. Steps constrain only the UI. */
export function isValidDatasetAppearanceLeaf(path, value, { development = false } = {}) {
    const field = datasetAppearanceField(path);
    if (!field) return false;
    switch (field.type) {
    case 'boolean': return typeof value === 'boolean';
    case 'number':
    case 'integer': return Number.isFinite(value) && value >= field.min && value <= field.max
        && (field.type !== 'integer' || Number.isInteger(value));
    case 'string': return typeof value === 'string' && (field.values.includes(value)
        || (development && (field.development_values || []).includes(value)));
    case 'hex_color': return typeof value === 'string' && isHexColor(value);
    default: return false;
    }
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Keep compatibility-only values derived during palette saves, without new stored leaves. */
export function deriveDatasetAppearanceCompatibilityValues(config) {
    for (const [key, field] of Object.entries(definition.shared_fields)) {
        if (!field.derived_from) continue;
        const [owner, sourceKey] = field.derived_from.split('.');
        config.shared[key] = config[owner][sourceKey];
    }
}

/** Stored-read compatibility twin of dataset_cover_theme_config.go: inheritLegacyImageBlur.
 *  Returns a copy; explicit zero and null are present and never replaced by fallback. */
export function inheritLegacyDatasetAppearanceBlur(config) {
    const result = JSON.parse(JSON.stringify(config));
    for (const [key, field] of Object.entries(definition.shared_fields)) {
        for (const path of field.legacy_read_targets || []) {
            const [owner, target] = path.split('.');
            if (!Object.hasOwn(result[owner], target)) result[owner][target] = result.shared[key];
        }
    }
    return result;
}

/** Twin of definition.go: Validate; checks complete groups and mask ordering. */
export function isValidDatasetAppearance(config, options) {
    if (!isObject(config) || Object.keys(config).length !== Object.keys(DEFAULT_DATASET_APPEARANCE).length) return false;
    for (const [owner, fields] of Object.entries(DEFAULT_DATASET_APPEARANCE)) {
        if (!Object.hasOwn(config, owner) || !isObject(config[owner])
            || Object.keys(config[owner]).length !== Object.keys(fields).length) return false;
        for (const key of Object.keys(fields)) {
            if (!Object.hasOwn(config[owner], key) || !isValidDatasetAppearanceLeaf(`${owner}.${key}`, config[owner][key], options)) return false;
        }
    }
    return definition.theme_owners.every(owner => definition.mask_order.every(order =>
        order.every((key, index) => index === 0 || config[owner][order[index - 1]] <= config[owner][key])));
}

// Flat version-two maps require canonical stored keys. Presence is never
// normalized against defaults, so explicit zero/false/equality survive validation.
function isValidPlaceValuesV2(values, place, complete, options) {
    if (!isObject(values)) return false;
    const paths = DATASET_APPEARANCE_PATHS_BY_PLACE[place];
    return (!complete || Object.keys(values).length === paths.length)
        && Object.entries(values).every(([path, value]) => paths.includes(path)
            && isValidDatasetAppearanceLeaf(path, value, options));
}

/** Twin of definition.go: ValidateTabValuesV2. Requires all 28 values and
 *  ascending masks within this tab alone; version-one consumers stay unchanged. */
export function isValidDatasetAppearanceTabValuesV2(values, options) {
    return isValidPlaceValuesV2(values, 'tab_only', true, options)
        && definition.theme_owners.every(owner => definition.mask_order.every(order =>
            order.every((key, index) => index === 0 || values[`${owner}.${order[index - 1]}`] <= values[`${owner}.${key}`])));
}

/** Twin of definition.go: ValidateSiteValuesV2; exactly seven site-only values. */
export function isValidDatasetAppearanceSiteValuesV2(values, options) {
    return isValidPlaceValuesV2(values, 'site_only', true, options);
}

/** Twin of definition.go: ValidateDefaultsV2; all nine overridable defaults. */
export function isValidDatasetAppearanceDefaultsV2(values, options) {
    return isValidPlaceValuesV2(values, 'site_default', true, options);
}

/** Twin of definition.go: ValidateOverridesV2; sparse entries for only those
 *  nine defaults, without dropping present values or modifying the map. */
export function isValidDatasetAppearanceOverridesV2(values, options) {
    return isValidPlaceValuesV2(values, 'site_default', false, options);
}

/** Existing public-cache/read guard: finite numbers, optional older fields and
 *  permissive layout/blur reads stay compatible. Writes use the strict twin above. */
export function isReadableDatasetAppearance(config) {
    if (!config?.shared) return false;
    for (const owner of definition.theme_owners) {
        for (const key of Object.keys(definition.theme_fields)) {
            const field = datasetAppearanceField(`${owner}.${key}`);
            if (field.type === 'boolean' ? typeof config[owner]?.[key] !== 'boolean'
                : !Number.isFinite(config[owner]?.[key])) return false;
        }
    }
    for (const key of Object.keys(definition.shared_fields)) {
        if (definition.compatibility.browser_unchecked.includes(key)) continue;
        const value = config.shared[key];
        if (definition.compatibility.browser_optional.includes(key)) {
            if (value !== undefined && !isValidDatasetAppearanceLeaf(`shared.${key}`, value)) return false;
        } else {
            const field = datasetAppearanceField(`shared.${key}`);
            if (field.type === 'number' || field.type === 'integer') {
                if (!Number.isFinite(value)) return false;
            } else if (field.type === 'hex_color') {
                // Preserve the original read guard's regex coercion; strict leaves require strings.
                if (!isHexColor(value)) return false;
            } else if (!isValidDatasetAppearanceLeaf(`shared.${key}`, value)) return false;
        }
    }
    return true;
}
