// chart_configuration.test.js
// Verifies chart site defaults and writes use the established field-set boundary.
// Connects mocked permission responses with the options consumed by the renderer.
// Prevents personal/group defaults or failed saves from masquerading as site defaults.
import { beforeEach, expect, test, vi } from 'vitest';
vi.mock('../../endpoints/stable_endpoint_router.js', () => ({ getViewFieldSets: vi.fn(), saveSiteViewFieldSet: vi.fn() }));
vi.mock('./price_chart_view_printer.js', () => ({ create_price_chart_view: vi.fn((_d, _c, _r, _t, options) => options) }));
import { getViewFieldSets, saveSiteViewFieldSet } from '../../endpoints/stable_endpoint_router.js';
import { createConfiguredChartView } from './chart_configuration.js';
const types = { clock: 'date', id: 'integer', value: 'numeric' };
const create = () => createConfiguredChartView('series', Object.keys(types), [], types);
beforeEach(() => { vi.resetAllMocks(); });

test('reads ordered shared site axes, with personal/group assignments present', async () => {
    getViewFieldSets.mockResolvedValue({ dataset: 'series', view_key: 'price_chart',
        can_edit_site_default: true, site_default_field_set_id: 9, active_field_set_id: 8,
        visible_columns: ['clock', 'value'], field_sets: [
            { id: 8, scope: 'personal', visible_columns: ['clock', 'value'] },
            { id: 9, scope: 'shared', visible_columns: ['clock', 'id'] },
        ] });
    const options = await create();
    expect(getViewFieldSets).toHaveBeenCalledWith('series', 'price_chart');
    expect(options.savedColumns).toEqual(['clock', 'id']);
    expect(options.canSaveDefault).toBe(true);
    saveSiteViewFieldSet.mockResolvedValue({ status: 'ok' });
    await options.onSaveDefault({ timeColumn: 'clock', priceColumn: 'value' });
    expect(saveSiteViewFieldSet).toHaveBeenCalledWith({ dataset: 'series', view_key: 'price_chart',
        name: 'price_chart_axes', visible_columns: ['clock', 'value'], target_scope: 'site' });
    saveSiteViewFieldSet.mockResolvedValue({ status: 'refused' });
    await expect(options.onSaveDefault({ timeColumn: 'clock', priceColumn: 'id' })).rejects.toThrow();
});

test('guest read has saved axes but cannot show the administrator save control', async () => {
    getViewFieldSets.mockResolvedValue({ dataset: 'series', view_key: 'price_chart', can_edit_site_default: false,
        site_default_field_set_id: 9, field_sets: [{ id: 9, scope: 'shared', visible_columns: ['clock', 'value'] }] });
    expect(await create()).toMatchObject({ savedColumns: ['clock', 'value'], canSaveDefault: false });
});

test.each([null, { dataset: 'other', view_key: 'price_chart' }])('reports unavailable or wrong settings and falls back safely', async response => {
    getViewFieldSets.mockResolvedValue(response);
    expect(await create()).toMatchObject({ savedColumns: [], defaultLoadFailed: true, canSaveDefault: false });
});
