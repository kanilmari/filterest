// dataset_appearance_capabilities.test.js
// Keeps tab, card and site rights independent beneath the protected feature flag.
import { expect, test } from 'vitest';
import { datasetAppearanceCapabilities } from './dataset_appearance_capabilities.js';
test('ownership grants no access and existing rights stay separate', () => {
    const flags = { view_admin_cover_image_test_palette: true };
    const rights = new Set(['/ui/admin/dataset_header_config', '/api/admin/dataset-appearance']);
    const read = route => rights.has(route);
    expect(datasetAppearanceCapabilities(read, flags)).toEqual({ mayEditTab: true, mayEditSite: false, mayEditCards: false });
    rights.add('/api/admin/site-presentation-settings'); rights.add('/ui/admin/card_visibility');
    expect(datasetAppearanceCapabilities(read, flags)).toEqual({ mayEditTab: true, mayEditSite: true, mayEditCards: true });
    rights.delete('/api/admin/dataset-appearance');
    expect(datasetAppearanceCapabilities(read, flags).mayEditTab).toBe(false);
    expect(datasetAppearanceCapabilities(() => true, {})).toEqual({ mayEditTab: false, mayEditSite: false, mayEditCards: false });
});
