// dataset_default_view_row.test.js
// Exercises acknowledged defaults, offered options and local-only drafts in the filterbar.
// Connects the real vanilla dropdown to controlled server responses and language refreshes.
// Protects permission gating, serialized saves, stale replies and detached-row cleanup.
import { beforeEach, afterEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn(), permission: vi.fn(), language: 'en' }));
vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: mocks.request }));
vi.mock('../route_permission_checker.js', () => ({ hasRoutePermission: mocks.permission }));
vi.mock('../lang/translation_handler.js', () => ({ getTranslationForKey: (key, options = {}) => {
    const copy = { en: { dataset_default_view_for: 'Default view for', dataset_default_view_saved: 'Default', app_events: 'Events' },
        fi: { dataset_default_view_for: 'Oletusnäkymä aineistolle', dataset_default_view_saved: 'Oletusnäkymä', app_events: 'Kalenteri' },
        'zh-CN': { dataset_default_view_for: '数据集默认视图', dataset_default_view_saved: '默认', app_events: '日历' } };
    return copy[mocks.language]?.[key] || options.fallback || key;
} }));
vi.mock('../state_stores/lang_preference_reader.js', () => ({ getLanguageWithBrowserFallback: () => mocks.language }));
vi.mock('../state_stores/table_specs_reader.js', () => ({ getAllSpecs: () => ({}), setAllSpecs: vi.fn() }));

import { createDatasetDefaultViewRow } from './dataset_default_view_row.js';
import { refreshLocalizedDatasetValues } from '../table_views/dataset_value_localizer.js';

const response = (saved = null, offered = ['card', 'table', 'calendar']) => ({ dataset: 'app_events',
    default_view_name: saved, default_view_id: saved ? 7 : null, offered_views: offered });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };
let row;
beforeEach(() => { sessionStorage.clear(); mocks.language = 'en'; mocks.permission.mockReset().mockReturnValue(true); mocks.request.mockReset().mockResolvedValue(response()); });
afterEach(() => { row?.__destroy(); row = null; document.body.replaceChildren(); localStorage.clear(); });
async function mount(view = 'calendar') { row = await createDatasetDefaultViewRow('app_events', view); document.body.append(row); await settle(); return row; }
function checkbox() { return row.querySelector('[type=checkbox]'); }
function choose(view) { row.querySelector('.vdw-dropdown').__dropdown.setValue(view, true); }
function toggle(checked) { checkbox().checked = checked; checkbox().dispatchEvent(new Event('change')); }

test('hides the row without the administrator route and makes no request', async () => {
    mocks.permission.mockReturnValue(false);
    expect(await createDatasetDefaultViewRow('app_events', 'card')).toBeNull();
    expect(mocks.request).not.toHaveBeenCalled();
});
test('requires the administrator-checked server answer before rendering', async () => {
    mocks.request.mockRejectedValue(new Error('403 administrator required'));
    expect(await createDatasetDefaultViewRow('app_events', 'card')).toBeNull();
});
test('uses the offered button and More views with the same permission filter', async () => {
    mocks.request.mockResolvedValue(response(null, ['card', 'table', 'calendar', 'tree', 'settings', 'price_chart']));
    mocks.permission.mockImplementation(route => route !== '/ui/view/table');
    await mount();
    const dropdown = row.querySelector('.vdw-dropdown').__dropdown; dropdown.open();
    expect(document.querySelector('[data-testid=dataset-default-view-option-card]')).not.toBeNull();
    expect(document.querySelector('[data-testid=dataset-default-view-option-calendar]')).not.toBeNull();
    expect(document.querySelector('[data-testid=dataset-default-view-option-table]')).toBeNull();
    expect(document.querySelector('[data-testid=dataset-default-view-option-tree]')).toBeNull();
    expect(document.querySelector('[data-testid=dataset-default-view-option-price-chart]')).toBeNull();
});
test('changing the dropdown changes the tick but sends no save', async () => {
    mocks.request.mockResolvedValue(response('calendar')); await mount();
    expect(checkbox().checked).toBe(true);
    choose('card'); expect(checkbox().checked).toBe(false);
    choose('calendar'); expect(checkbox().checked).toBe(true);
    expect(mocks.request).toHaveBeenCalledTimes(1);
});
test('keeps the inherited site default available just like the view buttons', async () => {
    mocks.permission.mockImplementation(route => route !== '/ui/view/card');
    await mount(); row.querySelector('.vdw-dropdown').__dropdown.open();
    expect(document.querySelector('[data-testid=dataset-default-view-option-card]')).not.toBeNull();
    choose('card'); expect(checkbox().checked).toBe(false);
});
test('tick saves the selected view and displays only the acknowledged server default', async () => {
    await mount(); const pending = deferred(); mocks.request.mockReturnValueOnce(pending.promise);
    toggle(true); await settle();
    expect(checkbox().checked).toBe(false); expect(checkbox().disabled).toBe(true);
    expect(mocks.request).toHaveBeenLastCalledWith('datasetDefaultView', { method: 'POST', body_data: { dataset: 'app_events', view_key: 'calendar' } });
    pending.resolve(response('card')); await settle();
    expect(checkbox().checked).toBe(false); expect(checkbox().disabled).toBe(false);
});
test('untick explicitly clears and remembers null rather than an omitted property', async () => {
    mocks.request.mockResolvedValueOnce(response('calendar')); await mount();
    mocks.request.mockResolvedValueOnce(response()); toggle(false); await settle();
    expect(mocks.request).toHaveBeenLastCalledWith('datasetDefaultView', { method: 'POST', body_data: { dataset: 'app_events', view_key: null } });
    expect(checkbox().checked).toBe(false);
    expect(JSON.parse(localStorage.getItem('app_events_tableMeta'))).toHaveProperty('default_view_name', null);
});
test('serializes rapid tick/untick and only the latest request may update the row', async () => {
    await mount(); const first = deferred(), second = deferred();
    mocks.request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    toggle(true); await settle(); toggle(false); await settle();
    expect(mocks.request).toHaveBeenCalledTimes(2);
    first.resolve(response('calendar')); await settle();
    expect(checkbox().checked).toBe(false); expect(checkbox().disabled).toBe(true);
    expect(mocks.request).toHaveBeenCalledTimes(3);
    second.resolve(response()); await settle();
    expect(checkbox().checked).toBe(false); expect(checkbox().disabled).toBe(false);
});
test('a failed save retains acknowledged state and reports a translated failure', async () => {
    mocks.request.mockResolvedValueOnce(response('calendar')); await mount();
    mocks.request.mockRejectedValueOnce(new Error('save failed')).mockResolvedValueOnce(response('calendar'));
    toggle(false); await settle();
    expect(checkbox().checked).toBe(true); expect(row.querySelector('[role=status]').textContent).toBe('dataset_default_view_error');
});
test('a lost save response refreshes the committed state from the server', async () => {
    await mount();
    mocks.request.mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce(response('calendar'));
    toggle(true); await settle();
    expect(checkbox().checked).toBe(true);
    expect(mocks.request).toHaveBeenLastCalledWith('datasetDefaultView', { url_params: '?dataset=app_events' });
});
test.each(['fi', 'zh-CN'])('updates the prefix, dataset display name and dropdown in %s', async language => {
    await mount(); mocks.language = language; await refreshLocalizedDatasetValues(language);
    expect(row.textContent).toContain(language === 'fi' ? 'Oletusnäkymä aineistolleKalenteri:' : '数据集默认视图日历:');
    expect(row.querySelector('.vdw-dropdown-input').value).toBe(language === 'fi' ? 'Kalenteri' : '日历');
});
test('view switches select the active view and refresh the saved state', async () => {
    mocks.request.mockResolvedValueOnce(response('calendar')); await mount();
    mocks.request.mockResolvedValueOnce(response('card')); row.__syncView('card'); await settle();
    expect(row.querySelector('.vdw-dropdown').__dropdown.getValue()).toBe('card'); expect(checkbox().checked).toBe(true);
});
test('routine selector sync keeps an unsaved dropdown draft and sends no extra reads', async () => {
    await mount('card'); choose('calendar'); row.__syncView('card'); await settle();
    expect(row.querySelector('.vdw-dropdown').__dropdown.getValue()).toBe('calendar');
    expect(mocks.request).toHaveBeenCalledTimes(1);
});
test('a view switch during initial loading uses the committed view when the row arrives', async () => {
    const initial = deferred(); mocks.request.mockReturnValueOnce(initial.promise);
    const building = createDatasetDefaultViewRow('app_events', 'card');
    sessionStorage.setItem('app_events_view', 'calendar'); initial.resolve(response('calendar'));
    row = await building;
    expect(row.querySelector('.vdw-dropdown').__dropdown.getValue()).toBe('calendar');
    expect(checkbox().checked).toBe(true);
});
test('removing a mounted row destroys the portalled dropdown and ignores pending responses', async () => {
    await mount(); const pending = deferred(); mocks.request.mockReturnValueOnce(pending.promise);
    const dropdown = row.querySelector('.vdw-dropdown').__dropdown; dropdown.open();
    toggle(true); await settle(); row.remove(); await settle();
    expect(document.querySelector('[data-testid=dataset-default-view-list]')).toBeNull();
    pending.resolve(response('calendar')); await settle();
    expect(localStorage.getItem('app_events_tableMeta')).toBeNull();
    const count = mocks.request.mock.calls.length;
    row.__syncView('card'); await settle();
    expect(mocks.request).toHaveBeenCalledTimes(count);
});
