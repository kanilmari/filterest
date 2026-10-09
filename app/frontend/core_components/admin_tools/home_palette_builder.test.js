// home_palette_builder.test.js
// Verifies Home controls, permission, saved reset, language and in-flight edits.
// Connects the real shared shell and Home adapter with a controlled save endpoint.
// Prevents preview leakage while missing settings already use the centred default.
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
    expect(get('anchor').querySelectorAll('button')).toHaveLength(9);
    expect(get('alignment').querySelectorAll('button')).toHaveLength(4);
    expect(get('anchor-center-center').getAttribute('aria-pressed')).toBe('true');
    expect(get('alignment-left').getAttribute('aria-pressed')).toBe('true');
    expect([get('horizontal-margin').min, get('horizontal-margin').max, get('horizontal-margin').step, get('horizontal-margin').value]).toEqual(['0', '320', '1', '40']);
    expect([get('max-width').min, get('max-width').max, get('max-width').step, get('max-width').value]).toEqual(['320', '1600', '10', '1120']);
});

test('default edit previews, closing retains it, reset/destroy restore saved layout', () => {
    const { get, render, button, saveRequestFn } = setup();
    edit(get('horizontal-margin'), 60);
    expect(render).toHaveBeenLastCalledWith({ ...defaults, horizontal_margin_px: 60 });
    button.click(); get('close').click();
    expect(mounted.panel.hidden).toBe(true);
    expect(render).toHaveBeenCalledTimes(1);
    get('reset').click(); expect(render).toHaveBeenLastCalledWith(defaults);
    get('anchor-bottom-right').click();
    mounted.destroy(); mounted = null;
    expect(render).toHaveBeenLastCalledWith(defaults);
    expect(saveRequestFn).not.toHaveBeenCalled();
});

test('save uses independent revision, persists reset baseline and preserves edits during a save', async () => {
    let finish;
    const request = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const { get, render } = setup({ presentation: { ...defaults, horizontal_margin_px: 50 }, presentation_version: 'old-1' }, request);
    edit(get('horizontal-margin'), 80); get('save').click();
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(request).toHaveBeenCalledWith({ presentation: { ...defaults, horizontal_margin_px: 80 }, version: 'old-1' });
    edit(get('horizontal-margin'), 90); finish({ version: 'saved-2' });
    await vi.waitFor(() => expect(get('save').disabled).toBe(false));
    expect(get('horizontal-margin').value).toBe('90');
    expect(render).toHaveBeenLastCalledWith({ ...defaults, horizontal_margin_px: 90 });
    get('reset').click(); expect(get('horizontal-margin').value).toBe('80');
    get('save').click();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(request.mock.calls[1][0].version).toBe('saved-2');
    finish({ version: 'saved-3' });
    await vi.waitFor(() => expect(get('save').disabled).toBe(false));
});

// A reset while the request is pending must not leave Home and its controls on the older layout.
test('reset during a save shows the stored layout for a saved and an untouched default Home', async () => {
    for (const snapshot of [{ presentation: { ...defaults, horizontal_margin_px: 50 }, presentation_version: 'old-1' }, undefined]) {
        let finish;
        const request = vi.fn(() => new Promise(resolve => { finish = resolve; }));
        const { get, render } = setup(snapshot, request);
        edit(get('horizontal-margin'), 80); get('save').click();
        await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
        edit(get('horizontal-margin'), 90); get('reset').click();
        expect(get('horizontal-margin').value).toBe(snapshot ? '50' : '40');
        expect(render).toHaveBeenLastCalledWith(snapshot ? { ...defaults, horizontal_margin_px: 50 } : defaults);
        finish({ version: 'saved-2' });
        await vi.waitFor(() => expect(get('save').disabled).toBe(false));
        expect(get('horizontal-margin').value).toBe('80');
        expect(render).toHaveBeenLastCalledWith({ ...defaults, horizontal_margin_px: 80 });
        mounted.destroy(); mounted = null; document.body.replaceChildren();
    }
});

test('failed save retains preview, and FI/EN copy changes without rebuilding controls', async () => {
    document.documentElement.lang = 'en';
    const { get, render } = setup(undefined, vi.fn(async () => { throw new Error('conflict'); }));
    const input = get('horizontal-margin'); edit(input, 75); get('save').click();
    await vi.waitFor(() => expect(get('save').disabled).toBe(false));
    expect(render).toHaveBeenLastCalledWith({ ...defaults, horizontal_margin_px: 75 });
    document.documentElement.lang = 'fi';
    await vi.waitFor(() => expect(input.getAttribute('aria-label')).toBe('Vaakamarginaali'));
    expect(get('horizontal-margin')).toBe(input); expect(input.value).toBe('75');
    expect(get('anchor-top-left').getAttribute('aria-label')).toBe('Ylhäällä vasemmalla');
    expect(get('alignment-justify').getAttribute('aria-label')).toBe('Tasaa molemmat reunat');
});

test('saving untouched default explicitly enables the default layout and teardown during save is safe', async () => {
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


test('position grid arrows select and focus without wrapping across rows', () => {
    const { get, render } = setup();
    const press = (id, key) => get(id).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    press('anchor-center-center', 'ArrowUp');
    expect(document.activeElement).toBe(get('anchor-top-center'));
    expect(render).toHaveBeenLastCalledWith({ ...defaults, anchor: 'top-center' });
    press('anchor-top-center', 'ArrowRight');
    press('anchor-top-right', 'ArrowRight');
    expect(get('anchor-top-right').getAttribute('aria-pressed')).toBe('true');
    expect(get('anchor').querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    press('anchor-top-right', 'ArrowDown');
    expect(get('anchor-center-right').getAttribute('aria-pressed')).toBe('true');
    get('alignment-justify').click();
    expect(render).toHaveBeenLastCalledWith({ ...defaults, anchor: 'center-right', alignment: 'justify' });
    press('alignment-justify', 'ArrowLeft');
    expect(get('alignment-right').getAttribute('aria-pressed')).toBe('true');
});

test('both margins and independent wash/opacity pairs preview, save and reset together', async () => {
    const { get, render, saveRequestFn } = setup();
    for (const id of ['horizontal-margin', 'vertical-margin']) {
        expect([get(id).min, get(id).max, get(id).step]).toEqual(['0', '320', '1']);
    }
    for (const theme of ['light', 'dark']) for (const property of ['wash', 'opacity']) {
        expect([get(`${theme}-${property}`).min, get(`${theme}-${property}`).max, get(`${theme}-${property}`).step])
            .toEqual(['0', '100', '1']);
    }
    edit(get('vertical-margin'), 123); edit(get('light-wash'), 35); edit(get('dark-opacity'), 55);
    const value = { ...defaults, vertical_margin_px: 123, light_wash: 35, dark_opacity: 55 };
    expect(render).toHaveBeenLastCalledWith(value);
    get('save').click(); await vi.waitFor(() => expect(get('save').disabled).toBe(false));
    expect(saveRequestFn).toHaveBeenCalledWith({ presentation: value, version: 'none' });
    edit(get('dark-wash'), 99); get('reset').click();
    expect(render).toHaveBeenLastCalledWith(value);
    expect(get('dark-wash').value).toBe('0');
});
