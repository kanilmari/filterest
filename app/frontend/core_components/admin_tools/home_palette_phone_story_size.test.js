// home_palette_phone_story_size.test.js
// Proves the bounded phone-size stepper through Home's real palette draft owner.
// Connects fi/en accessible controls, theme geometry, preview and saved revisions.
// Uses throwaway presentations only; never writes installation Home settings.
import { readFileSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import { mountHomePalette } from './home_palette_builder.js';
import { DEFAULT_HOME_PRESENTATION as defaults } from '../../shared/front_page_presentation/validator.js';

const serif = { ...defaults, text_style: { ...defaults.text_style, preset: 'serif_story_v1' } };
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('./presentation_palette.css');
let mounted;
afterEach(() => {
    mounted?.destroy();
    document.body.replaceChildren();
    document.body.className = '';
    document.documentElement.lang = 'en';
    document.head.querySelector('[data-phone-stepper-test]')?.remove();
});
function setup(saved = serif) {
    const button = document.createElement('button'); document.body.append(button);
    const render = vi.fn();
    const request = vi.fn(async ({ presentation }) => ({ version: 'saved-size', presentation }));
    mounted = mountHomePalette(button, { snapshot: { presentation: saved, presentation_version: 'old' },
        render, saveRequestFn: request, permissionCheck: () => true });
    const get = id => mounted.panel.querySelector(`[data-testid="home-palette-${id}"]`);
    return { get, render, request };
}
function select(input, value) { input.value = value; input.dispatchEvent(new Event('change')); }

test('one-pixel steps preview the seven sizes and stop with disabled buttons at both bounds', () => {
    const { get, render, request } = setup();
    const decrease = get('phone-story-size-decrease'), increase = get('phone-story-size-increase');
    const output = get('phone-story-size-value');
    expect(output.value).toBe('15 px');
    expect(output.getAttribute('aria-live')).toBe('polite');
    expect(output.getAttribute('aria-atomic')).toBe('true');
    for (const size of [14, 13, 12]) {
        decrease.click();
        expect(output.value).toBe(`${size} px`);
        expect(render).toHaveBeenLastCalledWith({ ...serif, phone_story_size: size });
    }
    expect(decrease.disabled).toBe(true); expect(increase.disabled).toBe(false);
    decrease.click(); expect(render).toHaveBeenCalledTimes(3);
    for (const size of [13, 14, 15, 16, 17, 18]) {
        increase.click();
        expect(output.value).toBe(`${size} px`);
        expect(render).toHaveBeenLastCalledWith({ ...serif, phone_story_size: size });
    }
    expect(increase.disabled).toBe(true); expect(decrease.disabled).toBe(false);
    increase.click(); expect(render).toHaveBeenCalledTimes(9);
    expect(request).not.toHaveBeenCalled();
    expect(get('phone-story-size').querySelector('[style]')).toBeNull();
});

test('fi/en labels update without replacing the stepper or its preview value', async () => {
    const { get } = setup();
    const control = get('phone-story-size'), increase = get('phone-story-size-increase');
    increase.click();
    for (const [language, label, down, up] of [
        ['fi', 'Tarinan tekstikoko puhelimella', 'Pienennä tarinan tekstikokoa puhelimella', 'Suurenna tarinan tekstikokoa puhelimella'],
        ['en', 'Story text size on phones', 'Decrease story text size on phones', 'Increase story text size on phones'],
    ]) {
        document.documentElement.lang = language;
        await vi.waitFor(() => expect(control.querySelector('legend').textContent).toBe(label));
        expect(control.querySelector('[role="group"]').getAttribute('aria-label')).toBe(label);
        expect(get('phone-story-size-decrease').getAttribute('aria-label')).toBe(down);
        expect(increase.getAttribute('aria-label')).toBe(up);
        expect(get('phone-story-size-increase')).toBe(increase);
        expect(get('phone-story-size-value').value).toBe('16 px');
    }
});

test('style switching retains the size; save, reset and revision use the existing preview flow', async () => {
    const { get, render, request } = setup(defaults);
    expect(get('phone-story-size').hidden).toBe(true);
    select(get('text-style'), 'serif_story_v1');
    expect(get('phone-story-size').hidden).toBe(false);
    get('phone-story-size-increase').click();
    select(get('text-style'), 'default'); expect(get('phone-story-size').hidden).toBe(true);
    select(get('text-style'), 'serif_story_v1');
    expect(get('phone-story-size-value').value).toBe('16 px');
    const saved = { ...serif, phone_story_size: 16 };
    get('save').click(); await vi.waitFor(() => expect(get('save').disabled).toBe(false));
    expect(request).toHaveBeenLastCalledWith({ presentation: saved, version: 'old' });
    get('phone-story-size-increase').click(); get('reset').click();
    expect(get('phone-story-size-value').value).toBe('16 px');
    expect(render).toHaveBeenLastCalledWith(saved);
    get('phone-story-size-decrease').click();
    get('save').click(); await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(request).toHaveBeenLastCalledWith({ presentation: serif, version: 'saved-size' });
});

test.each(['light', 'dark'])('stepper buttons have 44px targets in the explicit %s theme', theme => {
    document.body.className = `${theme}-mode`;
    const style = document.createElement('style'); style.dataset.phoneStepperTest = 'true'; style.textContent = css;
    document.head.append(style);
    const { get } = setup();
    for (const direction of ['decrease', 'increase']) {
        const button = get(`phone-story-size-${direction}`), computed = getComputedStyle(button);
        expect(computed.width).toBe('44px'); expect(computed.height).toBe('44px');
        expect(computed.minHeight).toBe('44px');
        expect(computed.color).toBe('var(--text_color)');
    }
});
