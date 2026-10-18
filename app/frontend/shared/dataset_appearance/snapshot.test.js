// snapshot.test.js
// Proves explicit version-two ownership and in-flight version-one read compatibility.
import { describe, expect, test } from 'vitest';
import { DEFAULT_DATASET_APPEARANCE, datasetAppearanceDefaultsForPlace } from './validator.js';
import { readDatasetAppearance, readSiteAppearance } from './snapshot.js';

const response = () => ({ schema_version: 2,
    tab_values: datasetAppearanceDefaultsForPlace('tab_only'),
    site_values: datasetAppearanceDefaultsForPlace('site_only'),
    defaults: datasetAppearanceDefaultsForPlace('site_default'), overrides: {},
});

describe('three-place snapshot', () => {
    test('resolves all three maps and preserves zero, false and equality', () => {
        const data = response();
        data.tab_values['light.image_blur'] = 0;
        data.tab_values['light.oval_enabled'] = false;
        data.overrides = { 'shared.card_show_all_fields': false, 'shared.filterbar_content_top_space': 0,
            'shared.card_detail_columns': data.defaults['shared.card_detail_columns'] };
        data.effective = DEFAULT_DATASET_APPEARANCE; // Explicit maps own the v2 read.
        const effective = readDatasetAppearance(data);
        expect(effective.light.image_blur).toBe(0); expect(effective.light.oval_enabled).toBe(false);
        expect(effective.shared.image_blur).toBe(0); expect(effective.shared.card_show_all_fields).toBe(false);
        expect(effective.shared.filterbar_content_top_space).toBe(0); expect(effective.shared.card_detail_columns).toBe(2);
        expect(Object.keys(data.tab_values)).toHaveLength(28); expect(Object.keys(data.site_values)).toHaveLength(8);
        expect(Object.keys(data.defaults)).toHaveLength(9); expect(Object.keys(data.overrides)).toHaveLength(3);
    });
    test('public site settings project definition covers without exposing a stored cover', () => {
        const data = response(); delete data.tab_values; delete data.overrides;
        data.defaults['shared.card_image_width'] = 413;
        expect(readSiteAppearance(data).shared.card_image_width).toBe(413);
        expect(readSiteAppearance(data).light).toEqual(DEFAULT_DATASET_APPEARANCE.light);
    });
    test.each(['tab_values', 'site_values', 'defaults', 'overrides'])('refuses missing or wrong %s instead of fallback', key => {
        const data = response(); delete data[key]; expect(readDatasetAppearance(data)).toBeNull();
        data[key] = null; expect(readDatasetAppearance(data)).toBeNull();
    });
    test('refuses incomplete groups, cross-place overrides and invalid masks in either theme', () => {
        for (const theme of ['light', 'dark']) {
            const data = response(); data.tab_values[`${theme}.mid_stop`] = 99;
            expect(readDatasetAppearance(data)).toBeNull();
        }
        for (const path of ['shared.brand_color', 'light.image_blur', 'shared.hero_extra_height']) {
            const data = response(); data.overrides[path] = 0; expect(readDatasetAppearance(data)).toBeNull();
        }
        const data = response(); delete data.tab_values['light.image_blur']; expect(readDatasetAppearance(data)).toBeNull();
    });
    test('accepts a response already in flight from version one', () => {
        expect(readDatasetAppearance({ schema_version: 1, effective: DEFAULT_DATASET_APPEARANCE })).toEqual(DEFAULT_DATASET_APPEARANCE);
        expect(readSiteAppearance({ dataset_cover_theme: DEFAULT_DATASET_APPEARANCE })).toEqual(DEFAULT_DATASET_APPEARANCE);
        expect(readDatasetAppearance({ schema_version: 3, effective: DEFAULT_DATASET_APPEARANCE })).toBeNull();
    });
});

test('absent heading order in old snapshots defaults to manual without changing other choices', () => {
    const data = response(); delete data.site_values['shared.row_group_heading_order'];
    data.site_values['shared.active_filter_remove_side'] = 'end';
    for (const read of [readSiteAppearance, readDatasetAppearance]) {
        expect(read(data).shared.row_group_heading_order).toBe('manual');
        expect(read(data).shared.active_filter_remove_side).toBe('end');
    }
    expect(Object.hasOwn(data.site_values, 'shared.row_group_heading_order')).toBe(false);
    const legacy = structuredClone(DEFAULT_DATASET_APPEARANCE); delete legacy.shared.row_group_heading_order;
    expect(readSiteAppearance({ dataset_cover_theme: legacy }).shared.row_group_heading_order).toBe('manual');
    expect(readDatasetAppearance({ schema_version: 1, effective: legacy }).shared.row_group_heading_order).toBe('manual');
    for (const value of ['count', null, 12]) {
        data.site_values['shared.row_group_heading_order'] = value;
        expect(readDatasetAppearance(data)).toBeNull();
    }
});
