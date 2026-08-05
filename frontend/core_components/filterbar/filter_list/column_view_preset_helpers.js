// column_view_preset_helpers.js
// Pure helper functions extracted from column_view_preset_builder.js for testability.
// Zero DOM access — all functions are pure input→output.

/**
 * Find a preset by its ID (string comparison).
 *
 * @param {Array<{id: number|string, preset_name: string}>} presets
 * @param {string|number} id
 * @returns {object|null}
 */
export function findPresetById(presets, id) {
    if (!id) return null;
    return presets.find((p) => String(p.id) === String(id)) || null;
}

/**
 * Find a preset by name (case-insensitive).
 *
 * @param {Array<{id: number|string, preset_name: string}>} presets
 * @param {string} name
 * @returns {object|null}
 */
export function findPresetByName(presets, name) {
    if (!name) return null;
    return presets.find(
        (p) => p.preset_name.toLowerCase() === name.toLowerCase()
    ) || null;
}

/**
 * Compute the UI visibility state for preset controls.
 *
 * @param {object|null} selectedPreset - The currently selected preset, or null
 * @returns {{ showSaveNew: boolean, showUpdate: boolean, showClear: boolean, showMore: boolean, updateDisabled: boolean, deleteDisabled: boolean, updateTitle: string|null }}
 */
export function computeUIState(selectedPreset) {
    const loaded = !!selectedPreset;
    return {
        showSaveNew: true,
        showUpdate: true,
        showClear: true,
        showMore: true,
        updateDisabled: !loaded,
        deleteDisabled: !loaded,
        updateTitle: loaded ? selectedPreset.preset_name : null,
    };
}

/**
 * Normalize an API response into a presets array.
 * Handles non-array responses gracefully.
 *
 * @param {*} data - Raw API response
 * @returns {Array}
 */
export function normalizePresetList(data) {
    return Array.isArray(data) ? data : [];
}
