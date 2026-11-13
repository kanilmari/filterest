// snapshot.js
// Decodes version-two owned maps into the nested rendering projection.
// Connects authorized results and public site settings with the shared validators.
// Keeps version-one reads only for responses already in flight during cutover.
import { DEFAULT_DATASET_APPEARANCE, DATASET_APPEARANCE_PATHS_BY_PLACE,
    isValidDatasetAppearanceTabValuesV2, isValidDatasetAppearanceSiteValuesV2,
    isValidDatasetAppearanceDefaultsV2, isValidDatasetAppearanceOverridesV2,
    isReadableDatasetAppearance, deriveDatasetAppearanceCompatibilityValues } from './validator.js';

const clone = value => JSON.parse(JSON.stringify(value));
// Reads preserve a server-authorized development layout. Server writes enforce
// the installation's development boundary before any value reaches this decoder.
const readOptions = { development: true };

// Additive fields may be absent in older v2 responses or
// public caches. Strict writers still require the complete canonical map.
function readableSiteValues(values) {
    return values && typeof values === 'object' && !Array.isArray(values)
        ? { 'shared.row_group_heading_order': DEFAULT_DATASET_APPEARANCE.shared.row_group_heading_order, ...values }
        : values;
}

// Additive site defaults may be absent in older responses. Present
// malformed values still reach the strict validator; write maps stay complete.
const additiveDefaults = Object.fromEntries(DATASET_APPEARANCE_PATHS_BY_PLACE.site_default
    .filter(path => path === 'shared.row_article_default_presentation' || path.endsWith('_initial_open'))
    .map(path => [path, DEFAULT_DATASET_APPEARANCE.shared[path.split('.')[1]]]));
function readableDefaults(values) {
    return values && typeof values === 'object' && !Array.isArray(values)
        ? { ...additiveDefaults, ...values } : values;
}

function readLegacyAppearance(config) {
    if (!isReadableDatasetAppearance(config)) return null;
    const result = clone(config);
    result.shared.row_group_heading_order ??= DEFAULT_DATASET_APPEARANCE.shared.row_group_heading_order;
    for (const [path, value] of Object.entries(additiveDefaults)) {
        const key = path.split('.')[1];
        if (!Object.hasOwn(result.shared, key)) result.shared[key] = value;
    }
    return result;
}

export function projectAppearanceMaps(...maps) {
    const config = clone(DEFAULT_DATASET_APPEARANCE);
    for (const map of maps) for (const [path, value] of Object.entries(map || {})) {
        const [group, key] = path.split('.'); config[group][key] = value;
    }
    deriveDatasetAppearanceCompatibilityValues(config);
    return config;
}

export function appearanceValuesForPlace(config, place) {
    return Object.fromEntries(DATASET_APPEARANCE_PATHS_BY_PLACE[place].map(path => {
        const [group, key] = path.split('.'); return [path, config[group][key]];
    }));
}

export function readSiteAppearance(payload) {
    if (payload?.schema_version === 2) {
        const siteValues = readableSiteValues(payload.site_values);
        const defaults = readableDefaults(payload.defaults);
        if (!isValidDatasetAppearanceSiteValuesV2(siteValues, readOptions)
            || !isValidDatasetAppearanceDefaultsV2(defaults, readOptions)) return null;
        return projectAppearanceMaps(siteValues, defaults);
    }
    return readLegacyAppearance(payload?.dataset_cover_theme);
}

export function readDatasetAppearance(snapshot) {
    if (snapshot?.schema_version === 1) {
        return readLegacyAppearance(snapshot.effective);
    }
    const siteValues = readableSiteValues(snapshot?.site_values);
    const defaults = readableDefaults(snapshot?.defaults);
    if (snapshot?.schema_version !== 2
        || !isValidDatasetAppearanceTabValuesV2(snapshot.tab_values, readOptions)
        || !isValidDatasetAppearanceSiteValuesV2(siteValues, readOptions)
        || !isValidDatasetAppearanceDefaultsV2(defaults, readOptions)
        || !isValidDatasetAppearanceOverridesV2(snapshot.overrides, readOptions)) return null;
    return projectAppearanceMaps(siteValues, defaults, snapshot.tab_values, snapshot.overrides);
}
