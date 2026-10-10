import { paletteMountOptions } from './dataset_appearance_palette_test_fixtures.js';
// dataset_appearance_palette_bounds.test.js
// Verifies every palette slider consumes the authoritative appearance bounds.
// Connects mounted light/dark controls with the Go-embedded JSON definition.
// Preserves translated controls and blur/visibility compatibility without live requests.
import { afterEach, expect, test } from 'vitest';
import { datasetAppearanceField, DEFAULT_DATASET_APPEARANCE } from '../../shared/dataset_appearance/validator.js';
import { mountDatasetCoverTestPalette } from './dataset_cover_test_palette.js';
import { resetSitePresentationStatesForTests } from './site_presentation_state.js';

afterEach(() => {
    document.body.replaceChildren();
    document.documentElement.removeAttribute('lang');
    document.documentElement.removeAttribute('style');
    document.documentElement.removeAttribute('class');
    localStorage.clear();
    resetSitePresentationStatesForTests();
});

test.each(['en', 'fi'])('all mounted sliders use the definition in both themes (%s)', async language => {
    document.documentElement.lang = language;
    const hero = document.body.appendChild(document.createElement('section'));
    const control = await mountDatasetCoverTestPalette(hero, 'fixture', {
        ...paletteMountOptions(), permissionCheck: () => true,
        requestFn: async () => ({ view_admin_cover_image_test_palette: true }),
        settingsRequestFn: async () => ({ dataset_cover_theme: JSON.parse(JSON.stringify(DEFAULT_DATASET_APPEARANCE)),
            row_article_timestamp_display_mode: 'date_time' }),
        saveRequestFn: async value => value,
    });
    try {
        const sliders = [...control.panel.querySelectorAll('input[type="range"]')];
        expect(sliders).toHaveLength(23);
        for (const owner of ['light', 'dark']) {
            document.documentElement.className = `theme-${owner}`;
            control.panel.querySelector(`[data-testid="dataset-cover-test-palette-tab-${owner}"]`).click();
            for (const slider of sliders) {
                const suffix = slider.dataset.testid.replace('dataset-cover-test-palette-', '');
                const key = ({ 'oval-x': 'oval_width', 'oval-y': 'oval_height', 'hero-height': 'hero_extra_height' })[suffix]
                    || suffix.replaceAll('-', '_');
                const path = Object.hasOwn(DEFAULT_DATASET_APPEARANCE.shared, key) && key !== 'image_blur'
                    ? `shared.${key}` : `${owner}.${key}`;
                const field = datasetAppearanceField(path);
                expect(field, path).toBeDefined();
                expect([slider.min, slider.max, slider.step]).toEqual([field.min, field.max, field.step].map(String));
                expect(slider.getAttribute('aria-label')).toBeTruthy();
            }
        }
    } finally {
        control.destroy();
    }
});
