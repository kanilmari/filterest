// dataset_appearance_palette_test_fixtures.js
// Models the strict three-place API for focused palette and state regressions.
// Connects versioned server maps to real DOM controls without requests or storage.
// Keeps tests honest about sparse overrides, patch ownership and revision changes.
import { vi } from 'vitest';
import { datasetAppearanceDefaultsForPlace } from '../../shared/dataset_appearance/validator.js';
import { normalizePresentationSettings } from './site_presentation_state.js';

export const clone = value => JSON.parse(JSON.stringify(value));
export function paletteSnapshot(uid = 11, overrides = {}) {
    return { schema_version: 2, dataset_uid: uid, version: '1', shared_version: 'site-1',
        tab_values: datasetAppearanceDefaultsForPlace('tab_only'),
        site_values: datasetAppearanceDefaultsForPlace('site_only'),
        defaults: datasetAppearanceDefaultsForPlace('site_default'), overrides: clone(overrides) };
}
export function paletteSiteResponse(settings = null) {
    const result = normalizePresentationSettings(settings);
    delete result.dataset_cover_theme;
    result.version ||= 'site-1';
    return result;
}
export function applySitePatch(settings, patch) {
    const result = paletteSiteResponse(settings);
    for (const [path, value] of Object.entries(patch.set)) {
        (Object.hasOwn(result.defaults, path) ? result.defaults : result.site_values)[path] = value;
    }
    if (patch.row_article_timestamp_display_mode) result.row_article_timestamp_display_mode = patch.row_article_timestamp_display_mode;
    result.version += '-next';
    return result;
}
export function applyTabPatch(snapshot, patch) {
    const result = clone(snapshot);
    Object.assign(result.tab_values, patch.tab_set);
    Object.assign(result.overrides, patch.set);
    for (const path of patch.unset) delete result.overrides[path];
    result.version = String(Number(result.version) + 1);
    result.shared_version = patch.shared_version;
    return result;
}
export function paletteMountOptions(overrides = {}, initial = paletteSnapshot()) {
    let snapshot = clone(initial);
    let site = paletteSiteResponse();
    return {
        permissionCheck: () => true,
        requestFn: vi.fn(async () => ({ view_admin_cover_image_test_palette: true })),
        settingsRequestFn: vi.fn(async () => clone(site)),
        datasetSettingsRequestFn: vi.fn(async table_name => ({ table_name,
            dataset_appearance: clone(snapshot), columns: [{ column_uid: 1 }] })),
        saveRequestFn: vi.fn(async patch => { site = applySitePatch(site, patch); return clone(site); }),
        datasetSaveRequestFn: vi.fn(async patch => { snapshot = applyTabPatch(snapshot, patch); return clone(snapshot); }),
        ...overrides,
    };
}
