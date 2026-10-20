// home_palette_text_style.test.js
// Proves nested text settings survive every existing Home palette save path.
// Connects accessible fi/en style/reveal controls to the unchanged draft/save owner.
// Guards preview/reset counts and limits new controls to text_style alone.
import { afterEach, expect, test, vi } from 'vitest';
import { mountHomePalette } from './home_palette_builder.js';
import * as paletteShell from './presentation_palette_shell.js';
import { createHomePaletteState } from './home_palette_state.js';
import { DEFAULT_HOME_PRESENTATION as defaults } from '../../shared/front_page_presentation/validator.js';
let mounted;
afterEach(() => { mounted?.destroy(); document.body.replaceChildren(); document.documentElement.lang = 'en'; vi.restoreAllMocks(); });
function setup(saved = { ...defaults, text_style: { preset: 'serif_story_v1', reveal: { mode: 'lines', start_ms: 1234, interval_ms: 567 } } },
    request = vi.fn(async () => ({ version: 'next' }))) {
    const button = document.createElement('button'); document.body.append(button);
    const render = vi.fn();
    mounted = mountHomePalette(button, { snapshot: { presentation: saved, presentation_version: 'old' }, render,
        saveRequestFn: request, permissionCheck: () => true });
    const get = id => mounted.panel.querySelector(`[data-testid="home-palette-${id}"]`);
    return { get, request, render, saved };
}
function edit(input, value, event = 'input') { input.value = String(value); input.dispatchEvent(new Event(event)); }

test('untouched text style round-trips when saving directly or editing another setting', async () => {
    const { get, request, saved } = setup();
    get('save').click(); await vi.waitFor(() => expect(get('save').disabled).toBe(false));
    expect(request).toHaveBeenLastCalledWith({ presentation: saved, version: 'old' });
    edit(get('horizontal-margin'), 81);
    get('save').click(); await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(request).toHaveBeenLastCalledWith({ presentation: { ...saved, horizontal_margin_px: 81 }, version: 'next' });
});

test.each([
    ['text-style', 'serif_story_v1', 'change', { ...defaults.text_style, preset: 'serif_story_v1' }],
    ['line-reveal', 'lines', 'change', { ...defaults.text_style, reveal: { ...defaults.text_style.reveal, mode: 'lines' } }],
    ['reveal-start', 1234, 'input', { ...defaults.text_style, reveal: { ...defaults.text_style.reveal, start_ms: 1234 } }],
    ['reveal-interval', 567, 'input', { ...defaults.text_style, reveal: { ...defaults.text_style.reveal, interval_ms: 567 } }],
])('%s tolerates a missing draft', (id, value, event, textStyle) => {
    const createOwner = paletteShell.createPaletteDraftOwner;
    vi.spyOn(paletteShell, 'createPaletteDraftOwner').mockImplementationOnce(options => {
        const owner = createOwner(options);
        return { ...owner, get draft() { return undefined; } };
    });
    const { get, render } = setup();
    edit(get(id), value, event);
    expect(render).toHaveBeenCalledExactlyOnceWith({ ...defaults, text_style: textStyle });
});

test('an untouched v2 origin saves a complete v3 request and remains editable with the new revision', async () => {
    const origin = { ...defaults, schema_version: 2, horizontal_margin_px: 73 };
    delete origin.text_style;
    const normalized = { ...defaults, horizontal_margin_px: 73 };
    const request = vi.fn(async () => ({ version: 'stored-v2-revision', presentation: normalized }));
    const { get, render } = setup(origin, request);
    get('save').click(); await vi.waitFor(() => expect(get('save').disabled).toBe(false));
    expect(request).toHaveBeenLastCalledWith({ presentation: normalized, version: 'old' });
    expect(render).toHaveBeenLastCalledWith(normalized);
    edit(get('text-style'), 'serif_story_v1', 'change');
    expect(render).toHaveBeenLastCalledWith({ ...normalized, text_style: { ...defaults.text_style, preset: 'serif_story_v1' } });
    get('save').click(); await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(request.mock.calls[1][0].version).toBe('stored-v2-revision');
    await vi.waitFor(() => expect(get('save').disabled).toBe(false));
    get('reset').click(); expect(render).toHaveBeenLastCalledWith(normalized);
});

test('a save adopts server-normalized inactive timings and reset keeps that stored baseline', async () => {
    const request = vi.fn(async () => ({ version: 'stored-v2', presentation: defaults }));
    const { get, render } = setup(defaults, request);
    edit(get('reveal-start'), 1234); edit(get('reveal-interval'), 567);
    get('save').click(); await vi.waitFor(() => expect(get('save').disabled).toBe(false));
    expect(request.mock.calls[0][0].presentation.text_style.reveal).toEqual({ mode: 'none', start_ms: 1234, interval_ms: 567 });
    expect(render).toHaveBeenLastCalledWith(defaults);
    expect(get('reveal-start').value).toBe('3000'); expect(get('reveal-interval').value).toBe('800');
    edit(get('reveal-start'), 99); get('reset').click(); expect(render).toHaveBeenLastCalledWith(defaults);
});

test('a malformed saved presentation cannot replace the baseline or advance the palette revision', async () => {
    const state = createHomePaletteState({ presentation: defaults, presentation_version: 'old' });
    await expect(state.saveSettings(defaults, async () => ({ version: 'bad', presentation: {} }))).rejects.toThrow('Invalid Home saved presentation');
    expect(state.savedSettings()).toEqual(defaults);
    const request = vi.fn(async () => ({ version: 'good' }));
    await state.saveSettings(defaults, request);
    expect(request).toHaveBeenCalledWith({ presentation: defaults, version: 'old' });
});

test('controls update only text_style, preview once per edit and reset/save use their existing lifecycle', async () => {
    const { get, request, render, saved } = setup();
    edit(get('text-style'), 'default', 'change');
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenLastCalledWith({ ...saved, text_style: { ...saved.text_style, preset: 'default' } });
    edit(get('line-reveal'), 'none', 'change');
    edit(get('reveal-start'), 5000); edit(get('reveal-interval'), 2000);
    expect(render).toHaveBeenCalledTimes(4);
    const changed = { ...saved, text_style: { preset: 'default', reveal: { mode: 'none', start_ms: 5000, interval_ms: 2000 } } };
    expect(render).toHaveBeenLastCalledWith(changed);
    get('reset').click(); expect(render).toHaveBeenCalledTimes(5); expect(render).toHaveBeenLastCalledWith(saved);
    expect(get('text-style').value).toBe('serif_story_v1'); expect(get('reveal-start').value).toBe('1234');
    get('save').click(); await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(6));
});

test('fi/en labels and bounds remain accessible and existing control order precedes the added controls', async () => {
    document.documentElement.lang = 'en';
    const { get } = setup();
    expect(get('text-style').getAttribute('aria-label')).toBe('Text style');
    expect(get('line-reveal').getAttribute('aria-label')).toBe('Line reveal');
    expect([get('reveal-start').min, get('reveal-start').max]).toEqual(['0', '5000']);
    expect([get('reveal-interval').min, get('reveal-interval').max]).toEqual(['200', '2000']);
    expect([...mounted.panel.querySelectorAll('input, select')].map(input => input.dataset.testid).slice(-4))
        .toEqual(['home-palette-text-style', 'home-palette-line-reveal', 'home-palette-reveal-start', 'home-palette-reveal-interval']);
    document.documentElement.lang = 'fi';
    await vi.waitFor(() => expect(get('text-style').getAttribute('aria-label')).toBe('Tekstityyli'));
    expect(get('line-reveal').getAttribute('aria-label')).toBe('Rivien ilmestyminen');
});

test.each([
    ['en', 'The title and slogan form one heading row – keep them short, e.g. "Travel news and deals" + "at a glance".',
        'A slogan of up to 40 characters joins the title in italics; a longer one is shown below the title as a smaller lead paragraph.',
        'Use **…** for whole emphasis lines and blank lines for sections.', 'A longer lead sentence belongs in the description.'],
    ['fi', 'Otsikko ja iskulause muodostavat yhden otsikkorivin – pidä ne lyhyinä, esim. ”Matkatiedot ja -edut” + ”yhdellä silmäyksellä”.',
        'Enintään 40 merkin iskulause liittyy otsikkoon kursiivina; pidempi näytetään otsikon alla pienempänä johdantokappaleena.',
        'Merkitse kokonaiset korostusrivit **…** ja erota osiot tyhjällä rivillä.', 'Pidempi johdantolause kuuluu kuvaukseen.'],
])('%s notice explains slogan placement and retains story-authoring guidance', (language, headingHint, leadHint, storyHint, oldHint) => {
    document.documentElement.lang = language;
    setup();
    const notice = mounted.panel.querySelector('.dataset-cover-test-palette__notice');
    expect(notice.textContent).toContain(headingHint);
    expect(notice.textContent).toContain(leadHint);
    expect(notice.textContent).toContain(storyHint);
    expect(notice.textContent).not.toContain(oldHint);
});
