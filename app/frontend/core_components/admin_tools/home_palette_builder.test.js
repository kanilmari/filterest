// home_palette_builder.test.js
// Verifies Home controls, permission, saved reset, language and in-flight edits.
// Connects the real shared shell and Home adapter with a controlled save endpoint.
// Prevents preview leakage and verifies legacy Home remains unchanged until an edit/save.
import { afterEach, expect, test, vi } from 'vitest';
import { mountHomePalette } from './home_palette_builder.js';
import { DEFAULT_HOME_PRESENTATION as defaults } from '../../shared/front_page_presentation/validator.js';
let mounted;
afterEach(() => { mounted?.destroy(); mounted = null; document.body.replaceChildren(); vi.restoreAllMocks(); });
function setup(snapshot = { presentation: null, presentation_version: 'none' }, saveRequestFn = vi.fn(async () => ({ version: 'saved-1' }))) {
    const button = document.createElement('button'); document.body.append(button);
    const render = vi.fn();
    mounted = mountHomePalette(button, { snapshot, render, saveRequestFn, permissionCheck: () => true });
    const get = id => mounted.panel.querySelector(`[data-testid="home-palette-${id}"]`);
    return { button, render, saveRequestFn, get };
}
function edit(input, value, event = 'input') { input.value = String(value); input.dispatchEvent(new Event(event)); }

test('requires Home admin permission and exposes shared definition bounds', () => {
    expect(mountHomePalette(document.createElement('button'), { permissionCheck: () => false })).toBeNull();
    const { get, render } = setup();
    expect(render).not.toHaveBeenCalled();
    expect(get('anchor').options).toHaveLength(9);
    expect([...get('paragraph-layout').options].map(o => o.value)).toEqual(['normal', 'artistic']);
    expect([get('margin').min, get('margin').max, get('margin').step, get('margin').value]).toEqual(['0', '320', '1', '40']);
    expect([get('max-width').min, get('max-width').max, get('max-width').step, get('max-width').value]).toEqual(['320', '1600', '10', '1120']);
});

test('legacy edit previews, closing retains it, reset/destroy restore saved layout', () => {
    const { get, render, button, saveRequestFn } = setup();
    edit(get('margin'), 60);
    expect(render).toHaveBeenLastCalledWith({ ...defaults, margin_px: 60 });
    button.click(); get('close').click();
    expect(mounted.panel.hidden).toBe(true);
    expect(render).toHaveBeenCalledTimes(1);
    get('reset').click(); expect(render).toHaveBeenLastCalledWith(null);
    edit(get('anchor'), 'bottom-right', 'change');
    mounted.destroy(); mounted = null;
    expect(render).toHaveBeenLastCalledWith(null);
    expect(saveRequestFn).not.toHaveBeenCalled();
});

test('save uses independent revision, persists reset baseline and preserves edits during a save', async () => {
    let finish;
    const request = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const { get, render } = setup({ presentation: { ...defaults, margin_px: 50 }, presentation_version: 'old-1' }, request);
    edit(get('margin'), 80); get('save').click();
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(request).toHaveBeenCalledWith({ presentation: { ...defaults, margin_px: 80 }, version: 'old-1' });
    edit(get('margin'), 90); finish({ version: 'saved-2' });
    await vi.waitFor(() => expect(get('save').disabled).toBe(false));
    expect(get('margin').value).toBe('90');
    expect(render).toHaveBeenLastCalledWith({ ...defaults, margin_px: 90 });
    get('reset').click(); expect(get('margin').value).toBe('80');
    get('save').click();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(request.mock.calls[1][0].version).toBe('saved-2');
    finish({ version: 'saved-3' });
    await vi.waitFor(() => expect(get('save').disabled).toBe(false));
});

// A reset while the request is pending must not leave Home and its controls on the older layout.
test('reset during a save shows the stored layout for a saved and an untouched legacy Home', async () => {
    for (const snapshot of [{ presentation: { ...defaults, margin_px: 50 }, presentation_version: 'old-1' }, undefined]) {
        let finish;
        const request = vi.fn(() => new Promise(resolve => { finish = resolve; }));
        const { get, render } = setup(snapshot, request);
        edit(get('margin'), 80); get('save').click();
        await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
        edit(get('margin'), 90); get('reset').click();
        expect(get('margin').value).toBe(snapshot ? '50' : '40');
        expect(render).toHaveBeenLastCalledWith(snapshot ? { ...defaults, margin_px: 50 } : null);
        finish({ version: 'saved-2' });
        await vi.waitFor(() => expect(get('save').disabled).toBe(false));
        expect(get('margin').value).toBe('80');
        expect(render).toHaveBeenLastCalledWith({ ...defaults, margin_px: 80 });
        mounted.destroy(); mounted = null; document.body.replaceChildren();
    }
});

test('failed save retains preview, and FI/EN copy changes without rebuilding controls', async () => {
    document.documentElement.lang = 'en';
    const { get, render } = setup(undefined, vi.fn(async () => { throw new Error('conflict'); }));
    const input = get('margin'); edit(input, 75); get('save').click();
    await vi.waitFor(() => expect(get('save').disabled).toBe(false));
    expect(render).toHaveBeenLastCalledWith({ ...defaults, margin_px: 75 });
    document.documentElement.lang = 'fi';
    await vi.waitFor(() => expect(input.getAttribute('aria-label')).toBe('Marginaali'));
    expect(get('margin')).toBe(input); expect(input.value).toBe('75');
    expect(get('anchor').options[0].textContent).toBe('Ylhäällä vasemmalla');
});

test('saving untouched legacy explicitly enables the default layout and teardown during save is safe', async () => {
    const { get, render, saveRequestFn } = setup(); get('save').click();
    await vi.waitFor(() => expect(get('save').disabled).toBe(false));
    expect(saveRequestFn).toHaveBeenCalledWith({ presentation: defaults, version: 'none' });
    expect(render).toHaveBeenLastCalledWith(defaults);
    mounted.destroy(); mounted = null;
    let finish;
    const next = setup(undefined, () => new Promise(resolve => { finish = resolve; }));
    next.get('save').click(); mounted.destroy(); mounted = null;
    finish({ version: 'late' }); await Promise.resolve();
    expect(document.querySelectorAll('[data-testid="home-palette"]')).toHaveLength(0);
});
