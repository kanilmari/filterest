// @vitest-environment jsdom
// active_filter_remove_side_control.test.js
// Verifies the chip-side palette control through shared preview, save and reset.
// Connects translated palette copy, existing chip identity and durable public state.
// Protects unsaved drafts and saved choices across theme/language changes and reloads.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mountDatasetCoverTestPalette } from './dataset_cover_test_palette.js';
import { DEFAULT_DATASET_COVER_THEME, resetSitePresentationStatesForTests } from './site_presentation_state.js';
import { buildActiveFilterChip } from '../filterbar/filter_list/active_filter_chip_builder.js';

let control;
beforeEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
    document.documentElement.lang = 'en';
    resetSitePresentationStatesForTests();
});
afterEach(() => { control?.destroy(); control = null; });

test('previews both sides, resets without rebuilding and saves/reloads with FI/EN labels', async () => {
    const snapshot = { dataset_cover_theme: structuredClone(DEFAULT_DATASET_COVER_THEME),
        row_article_timestamp_display_mode: 'date_time' };
    const request = vi.fn(async () => snapshot);
    const save = vi.fn(async value => value);
    const hero = document.createElement('section');
    const row = document.createElement('div');
    row.className = 'active_filters';
    document.body.append(hero, row);
    const label = document.createElement('span');
    const remove = vi.fn();
    const { item, button } = buildActiveFilterChip({ label, onRemove: remove });
    row.append(item);
    const options = { settingsRequestFn: request, saveRequestFn: save,
        requestFn: async () => ({ view_admin_cover_image_test_palette: true }),
        permissionCheck: permission => permission === '/ui/admin/dataset_header_config' };
    control = await mountDatasetCoverTestPalette(hero, 'demo', options);
    const select = control.panel.querySelector('[data-testid="dataset-cover-test-palette-active-filter-remove-side"]');
    expect(select.closest('.dataset-cover-test-palette__group').textContent).toContain('Dataset header');
    expect([...select.options].map(option => option.textContent)).toEqual(['Before the label', 'After the label']);
    const change = side => { select.value = side; select.dispatchEvent(new Event('change')); };
    button.focus();
    change('end');
    expect(item.firstElementChild).toBe(label);
    expect(document.activeElement).toBe(button);
    control.panel.querySelector('[data-testid="dataset-cover-test-palette-tab-dark"]').click();
    expect(select.value).toBe('end');
    document.documentElement.lang = 'fi';
    await vi.waitFor(() => expect(select.getAttribute('aria-label')).toBe('Poistopainike'));
    expect([...select.options].map(option => option.textContent)).toEqual(['Ennen tekstiä', 'Tekstin jälkeen']);
    control.resetPreview();
    expect(select.value).toBe('start');
    expect(item.firstElementChild).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(request).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    change('end');
    control.panel.querySelector('[data-testid="dataset-cover-test-palette-save"]').click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(control.panel.querySelector('[data-testid="dataset-cover-test-palette-save"]').disabled).toBe(false));
    expect(save.mock.calls[0][0].dataset_cover_theme.shared.active_filter_remove_side).toBe('end');
    change('start');
    control.resetPreview();
    expect(select.value).toBe('end');
    expect(item.firstElementChild).toBe(label);
    control.destroy();
    resetSitePresentationStatesForTests();
    control = await mountDatasetCoverTestPalette(hero, 'demo', { ...options, settingsRequestFn: async () => { throw Error('offline'); } });
    expect(control.panel.querySelector('[data-testid="dataset-cover-test-palette-active-filter-remove-side"]').value).toBe('end');
    expect(row.firstElementChild).toBe(item);
    expect(item.querySelector('button')).toBe(button);
});
