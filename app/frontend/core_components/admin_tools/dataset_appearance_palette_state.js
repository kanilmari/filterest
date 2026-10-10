// dataset_appearance_palette_state.js
// Adapts the authorized tab snapshot to the shared palette draft lifecycle.
// Connects owned cover values, sparse overrides and atomic version-two saves.
// Keeps loaded tokens on conflicts and refuses late responses after dataset teardown.
import { datasetAppearanceState } from '../table_views/dataset_appearance_state.js';
import { readDatasetAppearance } from '../../shared/dataset_appearance/snapshot.js';
import { DATASET_APPEARANCE_PATHS_BY_PLACE } from '../../shared/dataset_appearance/validator.js';

const clone = value => JSON.parse(JSON.stringify(value));

/** One saved baseline serves tab Reset; ownership remains in the dataset state. */
export function createDatasetAppearancePaletteState(datasetName, initial, canCommit) {
    let saved = clone(initial);
    return {
        savedSettings: () => clone(saved),
        setPreview: (owner, draft) => datasetAppearanceState.setPreview(owner, datasetName, draft),
        releasePreview: owner => datasetAppearanceState.releasePreview(owner, datasetName),
        acceptSiteSave(before, after) {
            if (saved.shared_version === before) saved.shared_version = after;
        },
        async saveSettings(draft, requestFn) {
            const tab_set = Object.fromEntries(Object.entries(draft.tab_values)
                .filter(([path, value]) => value !== saved.tab_values[path]));
            const set = {}, unset = [];
            for (const path of DATASET_APPEARANCE_PATHS_BY_PLACE.site_default) {
                if (Object.hasOwn(draft.overrides, path)) {
                    if (!Object.hasOwn(saved.overrides, path) || draft.overrides[path] !== saved.overrides[path]) {
                        set[path] = draft.overrides[path];
                    }
                } else if (Object.hasOwn(saved.overrides, path)) unset.push(path);
            }
            const token = datasetAppearanceState.capture(datasetName);
            const response = await requestFn({ schema_version: 2, dataset_uid: draft.dataset_uid,
                tab_set, set, unset, shared_version: draft.shared_version, version: draft.version });
            if (!readDatasetAppearance(response) || response.dataset_uid !== draft.dataset_uid
                || !response.version || !response.shared_version
                || Object.entries(draft.tab_values).some(([path, value]) => response.tab_values[path] !== value)
                || DATASET_APPEARANCE_PATHS_BY_PLACE.site_default.some(path => (
                    Object.hasOwn(response.overrides, path) !== Object.hasOwn(draft.overrides, path)
                    || response.overrides[path] !== draft.overrides[path]))) {
                throw new Error('Dataset appearance save readback mismatch');
            }
            if (!canCommit() || !datasetAppearanceState.accept(datasetName, response, { token })) {
                throw new Error('Dataset appearance owner expired');
            }
            saved = clone(response);
            return clone(saved);
        },
    };
}
