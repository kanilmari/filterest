// @vitest-environment jsdom
// Checks the field selector's complete disclosure and the effective fields it applies.
// Uses the normal public layout controller and field-set editor with controlled API replies.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const api = vi.hoisted(() => ({ layout: vi.fn(), fields: vi.fn() }));
vi.mock('../../endpoints/endpoint_router.js', () => ({ endpoint_router: api.layout }));
vi.mock('../../endpoints/stable_endpoint_router.js', async importOriginal =>
    ({ ...await importOriginal(), getViewFieldSets: api.fields }));
vi.mock('../../lang/translation_handler.js', () => ({ getTranslationForKey: () => '' }));

let preferences;
let buildSelector;
let rows;
let listeners;

beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal('BroadcastChannel', undefined);
    listeners = vi.spyOn(window, 'addEventListener');
    document.body.replaceChildren();
    localStorage.clear();
    api.layout.mockReset();
    api.fields.mockReset();
    preferences = await import('../filterbar_preferences_controller.js');
    ({ buildColumnViewPresetSelector: buildSelector } = await import('./column_view_preset_builder.js'));
    rows = [];
});
afterEach(() => {
    rows.forEach(row => row.destroy());
    for (const [type, listener, options] of listeners.mock.calls) window.removeEventListener(type, listener, options);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function mount(dataset, view = 'table') {
    const row = buildSelector(dataset, ['name', 'note'], view);
    rows.push(row);
    document.body.append(row);
    return row;
}

function fieldSet(role, visible) {
    return { can_edit_site_default: role === 'admin', can_edit_personal: role !== 'guest',
        effective_scope: role === 'guest' ? 'site' : 'personal',
        available_columns: ['name', 'note'], visible_columns: [visible], field_sets: [] };
}

test.each([
    ['guest', true, true], ['user', true, true], ['admin', true, false],
    ['guest', undefined, false], ['user', false, false], ['admin', false, false],
])('%s with admin-only policy %s keeps effective fields when opening two datasets', async (role, policy, hidden) => {
    if (role !== 'guest') localStorage.setItem('button_state', 'logout');
    const layout = { section_order: ['field_sets'], field_selector_admin_only: policy };
    api.layout.mockImplementation(async name => name === 'getFilterbarSectionLayout' ? layout : {});
    api.fields.mockResolvedValueOnce(fieldSet(role, 'name')).mockResolvedValueOnce(fieldSet(role, 'note'));

    const first = mount('travel');
    expect(first.hidden).toBe(true);
    await vi.waitFor(() => expect(localStorage.getItem('travel_table_hide_columns')).toBe('{"note":true}'));
    expect(first.hidden).toBe(true); // Field data can finish before the shared policy.
    await preferences.loadFilterbarPreferences();
    expect(first.hidden).toBe(hidden);
    expect(first.querySelector('[data-testid="field-set-site-default-mode"]').hidden).toBe(role !== 'admin');

    const next = mount('hotels', 'card');
    if (policy === true) expect(next.hidden).toBe(true); // No role from the previous selector.
    await vi.waitFor(() => expect(localStorage.getItem('hotels_card_hide_columns')).toBe('{"name":true}'));
    expect(next.hidden).toBe(hidden);
    expect(api.fields.mock.calls).toEqual([['travel', 'table'], ['hotels', 'card']]);
});

test.each([[true, true], [false, false]])('field-set failure with policy %s leaves the expected local picker', async (policy, hidden) => {
    api.layout.mockResolvedValue({ field_selector_admin_only: policy });
    api.fields.mockRejectedValue(new Error('field sets unavailable'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const row = mount('travel');
    await preferences.loadFilterbarPreferences();
    await vi.waitFor(() => expect(warning).toHaveBeenCalledWith(expect.stringContaining('load failed'), expect.any(Error)));
    expect(row.hidden).toBe(hidden);
    expect(row.querySelector('[data-testid="field-set-site-default-mode"]').hidden).toBe(true);
});

test('a failed first layout read keeps the selector hidden while the server fields still apply', async () => {
    api.fields.mockResolvedValue(fieldSet('user', 'note'));
    api.layout.mockRejectedValueOnce(new Error('layout unavailable'));
    const row = mount('travel');
    await expect(preferences.loadFilterbarPreferences()).rejects.toThrow('layout unavailable');
    await vi.waitFor(() => expect(localStorage.getItem('travel_table_hide_columns')).toBe('{"name":true}'));
    expect(row.hidden).toBe(true);
    api.layout.mockResolvedValue({}); // Legacy layout without the setting.
    await preferences.loadFilterbarPreferences();
    expect(row.hidden).toBe(false);
});

test('an old administrator response cannot reveal the selector after a session change', async () => {
    api.layout.mockResolvedValue({ field_selector_admin_only: true });
    let finishAdmin;
    api.fields.mockImplementationOnce(() => new Promise(resolve => { finishAdmin = resolve; }));
    const row = mount('travel');
    await preferences.loadFilterbarPreferences();
    const { invalidateSessionGeneration } = await import('../../auth/session_generation_store.js');
    invalidateSessionGeneration({ revalidate: false });
    api.fields.mockResolvedValueOnce(fieldSet('user', 'note'));
    await preferences.loadFilterbarPreferences();
    await vi.waitFor(() => expect(localStorage.getItem('travel_table_hide_columns')).toBe('{"name":true}'));
    finishAdmin(fieldSet('admin', 'name'));
    await Promise.resolve();
    expect(row.hidden).toBe(true);
    expect(row.querySelector('[data-testid="field-set-site-default-mode"]').hidden).toBe(true);
    expect(localStorage.getItem('travel_table_hide_columns')).toBe('{"name":true}');
});
