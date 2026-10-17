// @vitest-environment jsdom
// table_cell_max_lines.test.js
// Proves public startup/cache binding and immediate administrator saves.
// Connects the real site state, settings form and inherited CSS variable.
// Guards fallback, failed saves and stale GET races without a browser server.
import { beforeEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSitePresentationState, normalizePresentationSettings, PUBLIC_PRESENTATION_CACHE_KEY,
    resetSitePresentationStatesForTests } from './site_presentation_state.js';
import { generate_table_view_settings_view } from './table_view_settings_view.js';
import { getAdminToolsStructure } from '../navigation/database_tree/nav_builder_helpers.js';

vi.mock('../endpoints/stable_endpoint_router.js', () => ({
    fetchSitePresentationSettings: vi.fn(), saveAdminSitePresentationSettings: vi.fn(),
}));
vi.mock('../lang/translation_handler.js', () => ({ getTranslationForKey: key => ({
    table_cell_max_lines_label: 'Taulukon solun rivimäärä',
    table_cell_max_lines_help: 'Pidemmät solut vierivät solun sisällä.',
}[key] || key) }));
import { fetchSitePresentationSettings, saveAdminSitePresentationSettings } from '../endpoints/stable_endpoint_router.js';

const snapshot = lines => {
    const value = normalizePresentationSettings({ table_cell_max_lines: lines, version: 'loaded' });
    delete value.dataset_cover_theme;
    return value;
};
const current = () => document.documentElement.style.getPropertyValue('--table-cell-max-lines');
beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear(); document.body.replaceChildren();
    document.documentElement.removeAttribute('style'); resetSitePresentationStatesForTests();
});

test('startup reads the site value, then saves and paints mounted tables without reloading', async () => {
    const state = createSitePresentationState({ requestFn: async () => snapshot(3) });
    expect(current()).toBe('3');
    await state.loadSettings();
    const table = document.body.appendChild(document.createElement('table'));
    table.className = 'table_from_db';
    const save = vi.fn(async patch => ({ ...snapshot(patch.table_cell_max_lines), version: 'saved' }));
    const draft = state.savedSettings(); draft.table_cell_max_lines = 7;
    await state.saveSettings(draft, save);
    expect(save).toHaveBeenCalledWith({ schema_version: 2, version: 'loaded', set: {}, table_cell_max_lines: 7 });
    expect(current()).toBe('7'); expect(table.isConnected).toBe(true);
    expect(JSON.parse(localStorage.getItem(PUBLIC_PRESENTATION_CACHE_KEY)).settings.table_cell_max_lines).toBe(7);
});

test('valid cache is applied immediately and a later public read supersedes it', async () => {
    localStorage.setItem(PUBLIC_PRESENTATION_CACHE_KEY, JSON.stringify({ schema_version: 2, settings: snapshot(8) }));
    const state = createSitePresentationState({ requestFn: async () => snapshot(4) });
    expect(current()).toBe('8'); await state.loadSettings(); expect(current()).toBe('4');
});

test.each([undefined, null, 0, 31, 1.5, '5', true])('invalid public value %s falls back to three', async value => {
    const state = createSitePresentationState({ storage: null, requestFn: async () => ({ ...snapshot(3), table_cell_max_lines: value }) });
    await state.loadSettings(); expect(current()).toBe('3');
});

test('failed save leaves the current setting and cache unchanged', async () => {
    const state = createSitePresentationState({ requestFn: async () => snapshot(5) });
    await state.loadSettings(); const before = localStorage.getItem(PUBLIC_PRESENTATION_CACHE_KEY);
    const draft = state.savedSettings(); draft.table_cell_max_lines = 9;
    await expect(state.saveSettings(draft, async () => { throw new Error('refused'); })).rejects.toThrow('refused');
    expect(current()).toBe('5'); expect(localStorage.getItem(PUBLIC_PRESENTATION_CACHE_KEY)).toBe(before);
});

test('a public GET started before a successful save cannot restore the old limit', async () => {
    let resolve; const waiting = new Promise(done => { resolve = done; });
    const state = createSitePresentationState({ requestFn: () => waiting });
    const loading = state.loadSettings(); await Promise.resolve();
    const draft = state.savedSettings(); draft.table_cell_max_lines = 6;
    await state.saveSettings(draft, async () => snapshot(6));
    resolve(snapshot(3)); await loading; expect(current()).toBe('6');
});

test('site settings offers translated copy, numeric bounds and a successful live save', async () => {
    fetchSitePresentationSettings.mockResolvedValue(snapshot(3));
    saveAdminSitePresentationSettings.mockImplementation(async patch => snapshot(patch.table_cell_max_lines));
    const container = document.body.appendChild(document.createElement('section'));
    await generate_table_view_settings_view(container);
    const input = container.querySelector('input');
    expect(container.querySelector('label').textContent).toBe('Taulukon solun rivimäärä');
    expect(container.querySelector('#table-cell-max-lines-help').textContent).toBe('Pidemmät solut vierivät solun sisällä.');
    expect([input.min, input.max, input.step, input.value]).toEqual(['1', '30', '1', '3']);
    input.value = '10'; container.querySelector('form').requestSubmit();
    await vi.waitFor(() => expect(current()).toBe('10'));
    expect(getAdminToolsStructure().find(node => node.id === 'site_settings').children)
        .toContainEqual({ id: 'table_view_settings', name: 'table_view_settings' });
});

test('CSS fallback inherits the root setting and SPA loads it during startup', () => {
    const css = readFileSync('frontend/core_components/table_views/table_view/tables.css', 'utf8');
    expect(css).toMatch(/:root\s*\{\s*--table-cell-max-lines: 3;/);
    expect(css.match(/--table-cell-max-lines:/g)).toHaveLength(1);
    expect(readFileSync('frontend/main.js', 'utf8')).toContain('await getSitePresentationState().loadSettings()');
});
