// row_group_heading_order_control.test.js
// Verifies bilingual accessible copy, site-only edits and revision-protected save.
// Connects the real palette preview with a persistent category card's first sums.
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { paletteMountOptions, paletteSiteResponse, applySitePatch } from './dataset_appearance_palette_test_fixtures.js';
import { mountDatasetCoverTestPalette } from './dataset_cover_test_palette.js';
import { resetSitePresentationStatesForTests } from './site_presentation_state.js';
import { createRowGroupFacetCard } from '../filterbar/filter_list/row_group_facet_card_builder.js';

let control, host;
beforeEach(() => {
    localStorage.clear(); document.body.replaceChildren(); document.documentElement.lang = 'en';
    resetSitePresentationStatesForTests();
});

test('a sparse manual save response resets the palette baseline and permits another save', async () => {
    const hero = document.createElement('section'); document.body.append(hero);
    let site = paletteSiteResponse(); site.site_values['shared.row_group_heading_order'] = 'result_count';
    const save = vi.fn(async patch => {
        site = applySitePatch(site, patch);
        if (site.site_values['shared.row_group_heading_order'] === 'manual') delete site.site_values['shared.row_group_heading_order'];
        return structuredClone(site);
    });
    const options = paletteMountOptions({ settingsRequestFn: vi.fn(async () => structuredClone(site)), saveRequestFn: save });
    control = await mountDatasetCoverTestPalette(hero, 'demo', options);
    control.panel.querySelector('[data-testid="dataset-cover-test-palette-scope-site"]').click();
    const select = control.panel.querySelector('[data-testid="dataset-cover-test-palette-row-group-heading-order"]');
    const saveButton = control.panel.querySelector('[data-testid="dataset-cover-test-palette-save"]');
    const change = value => { select.value = value; select.dispatchEvent(new Event('change')); };
    expect(select.value).toBe('result_count');
    change('manual'); saveButton.click();
    await vi.waitFor(() => expect(saveButton.disabled).toBe(false));
    expect(save).toHaveBeenCalledOnce();
    expect(site.site_values).not.toHaveProperty('shared.row_group_heading_order');
    expect(select.value).toBe('manual');
    change('result_count'); control.resetPreview();
    expect(select.value).toBe('manual');
    change('result_count'); saveButton.click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0]).toEqual({ schema_version: 2, version: 'site-1-next',
        set: { 'shared.row_group_heading_order': 'result_count' } });
    await vi.waitFor(() => expect(saveButton.disabled).toBe(false));
    expect(select.value).toBe('result_count');
});
afterEach(() => { control?.destroy(); host?.disposeRowGroupPanel?.(); resetSitePresentationStatesForTests(); });

test('site preview reorders existing headings from first sums; reset, FI/EN copy and save retain identity', async () => {
    const hero = document.createElement('section'); host = document.createElement('div');
    host.className = 'row-group-facets'; host.id = 'demo_row_group_facets'; hero.append(host); document.body.append(hero);
    host.rowGroupCard = createRowGroupFacetCard({ host, topControls: hero, tableName: 'demo',
        getSelectedSlugs: () => [], getSelectedModes: () => ({}), getFacetTitle: item => item.title.en });
    const groups = [1, 2, 3, 4].map(id => ({ heading: { id, sort_order: id, title: { en: `Heading ${id}` } },
        values: [{ slug: `value_${id}`, row_count: id * 10 }] }));
    host.rowGroupCard.update(groups, {}, { authoritative: true });
    const options = paletteMountOptions();
    control = await mountDatasetCoverTestPalette(hero, 'demo', options);
    const select = control.panel.querySelector('[data-testid="dataset-cover-test-palette-row-group-heading-order"]');
    expect(select.disabled).toBe(true); // Tab scope cannot write a site-only preference.
    control.panel.querySelector('[data-testid="dataset-cover-test-palette-scope-site"]').click();
    expect(select.disabled).toBe(false); expect(select.tabIndex).toBe(0);
    expect(select.getAttribute('aria-label')).toBe('Category heading order');
    expect([...select.options].map(option => option.textContent)).toEqual(["Administrator's order", 'Most results first']);
    const row = select.closest('[data-appearance-path]');
    expect(row.previousElementSibling.dataset.appearancePath).toBe('shared.active_filter_remove_side');
    expect(row.closest('.dataset-cover-test-palette__group').textContent).toContain('Dataset tabs');
    const buttons = [...host.querySelectorAll('.row-group-facet-heading')];
    const order = () => [...host.querySelectorAll('.row-group-facet-heading')].map(button => button.dataset.headingId);
    const change = value => { select.value = value; select.dispatchEvent(new Event('change')); };
    // Counts have changed since the first authoritative response, even before preview.
    host.rowGroupCard.update(groups.map(group => ({ ...group, values: [{ ...group.values[0], row_count: 100 - group.heading.id }] })), {}, { authoritative: true });
    select.focus(); change('result_count');
    await vi.waitFor(() => expect(order()).toEqual(['4', '3', '2', '1']));
    expect(document.activeElement).toBe(select);
    expect([...host.querySelectorAll('.row-group-facet-heading')]).toEqual([...buttons].reverse());
    document.documentElement.lang = 'fi';
    await vi.waitFor(() => expect(select.getAttribute('aria-label')).toBe('Kategoriaotsikoiden järjestys'));
    expect([...select.options].map(option => option.textContent)).toEqual(['Ylläpitäjän järjestys', 'Eniten tuloksia ensin']);
    control.resetPreview();
    await vi.waitFor(() => expect(order()).toEqual(['1', '2', '3', '4']));
    expect(options.saveRequestFn).not.toHaveBeenCalled();
    change('result_count'); control.panel.querySelector('[data-testid="dataset-cover-test-palette-save"]').click();
    await vi.waitFor(() => expect(options.saveRequestFn).toHaveBeenCalledOnce());
    expect(options.saveRequestFn.mock.calls[0][0]).toEqual({ schema_version: 2, version: 'site-1',
        set: { 'shared.row_group_heading_order': 'result_count' } });
    expect(options.datasetSaveRequestFn).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(control.panel.querySelector('[data-testid="dataset-cover-test-palette-save"]').disabled).toBe(false));
    change('manual'); control.resetPreview();
    await vi.waitFor(() => expect(order()).toEqual(['4', '3', '2', '1']));
    expect(options.settingsRequestFn).toHaveBeenCalledOnce();
});
