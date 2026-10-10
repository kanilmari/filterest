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
        if (!isValidDatasetAppearanceSiteValuesV2(payload.site_values, readOptions)
            || !isValidDatasetAppearanceDefaultsV2(payload.defaults, readOptions)) return null;
        return projectAppearanceMaps(payload.site_values, payload.defaults);
    }
    return isReadableDatasetAppearance(payload?.dataset_cover_theme) ? clone(payload.dataset_cover_theme) : null;
}

export function readDatasetAppearance(snapshot) {
    if (snapshot?.schema_version === 1) {
        return isReadableDatasetAppearance(snapshot.effective) ? clone(snapshot.effective) : null;
    }
    if (snapshot?.schema_version !== 2
        || !isValidDatasetAppearanceTabValuesV2(snapshot.tab_values, readOptions)
        || !isValidDatasetAppearanceSiteValuesV2(snapshot.site_values, readOptions)
        || !isValidDatasetAppearanceDefaultsV2(snapshot.defaults, readOptions)
        || !isValidDatasetAppearanceOverridesV2(snapshot.overrides, readOptions)) return null;
    return projectAppearanceMaps(snapshot.site_values, snapshot.defaults, snapshot.tab_values, snapshot.overrides);
}
