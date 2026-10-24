// front_page_desktop_search_controller.test.js
// Proves desktop modes, focus, anchoring and delegation to the phone runner.
// Connects real DOM events and the unchanged fitter to controlled geometry.
// Browser G19 supplies actual flex layout, theme and viewport evidence.
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), destroy: vi.fn(), endpoint: vi.fn() }));
vi.mock('./front_page_search_runner.js', () => ({ createFrontPageSearchRunner: mocks.create }));
vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: mocks.endpoint }));
vi.mock('../navigation/main_tabs/main_dataset_tabs.js', () => ({
    getMainDatasetTabs: () => [{ dataset: 'app_travel', text: 'Matkat' }],
    subscribeMainDatasetTabs: () => () => {},
}));
vi.mock('../table_views/compact_dataset_group.js', () => ({
    createSupplementalDatasetGroup: () => {
        const element = document.createElement('section');
        return { element, render: rows => { element.textContent = rows[0]?.title; } };
    },
}));
vi.mock('../lang/translation_handler.js', () => ({ getTranslationForKey: key => ({
    front_page_search_site: 'Hae sivustolta', front_page_search_title: 'Haku',
    front_page_search_close: 'Sulje haku', front_page_search_searching: 'Haetaan…',
}[key] || key) }));
import { getFrontPageSearchMode, mountFrontPageDesktopSearch } from './front_page_desktop_search_controller.js';
import { createNavigationFitController } from '../navigation/main_tabs/navigation_fit_controller.js';
import { LAYOUT_BREAKPOINTS } from '../../ui_config.js';

const { phone, tablet } = LAYOUT_BREAKPOINTS;

let mount, row, home, input, button, push, back;
const panel = () => document.querySelector('.front-page-desktop-search-panel');
function resize(width) {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
    window.dispatchEvent(new Event('resize'));
}
function type(query) { input.value = query; input.dispatchEvent(new Event('input', { bubbles: true })); }
function start(width = 1440) {
    resize(width);
    mount = mountFrontPageDesktopSearch(row, row.querySelector('.filterbar-inline-hero__actions'));
    input = row.querySelector('input');
    button = row.querySelector('.front-page-desktop-search__button');
}
beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<main class="front-page"><div class="front-page-top-row">'
        + '<div class="front-page-top-row__identity">Site</div><nav class="hero-dataset-tabs"></nav>'
        + '<div class="filterbar-inline-hero__actions"><button>Settings</button></div></div><article>Home</article></main>';
    home = document.querySelector('main'); row = home.querySelector('.front-page-top-row');
    vi.spyOn(home, 'getBoundingClientRect').mockReturnValue({ left: 250, right: 1440 });
    mocks.create.mockReset().mockReturnValue({ destroy: mocks.destroy });
    mocks.destroy.mockClear(); mocks.endpoint.mockReset();
    push = vi.spyOn(history, 'pushState'); back = vi.spyOn(history, 'back');
});
afterEach(() => {
    mount?.destroy(); mount = null;
    document.head.replaceChildren(); document.body.replaceChildren();
    vi.restoreAllMocks(); vi.useRealTimers();
});

test.each([[tablet + 1, 'field'], [tablet, 'button'], [phone + 1, 'button'], [phone, 'phone']])(
    '%i uses %s and creates no competing phone host', (width, mode) => {
        expect(getFrontPageSearchMode(width)).toBe(mode);
        start(width);
        const host = row.querySelector('.front-page-desktop-search');
        if (mode === 'phone') { expect(host).toBeNull(); expect(panel()).toBeNull(); return; }
        expect(host.dataset.mode).toBe(mode);
        expect(input.hidden).toBe(false);
        expect(input.parentElement.hidden).toBe(mode !== 'field');
        expect(button.hidden).toBe(mode !== 'button');
        expect(host.previousElementSibling.className).toBe('hero-dataset-tabs');
        expect(host.nextElementSibling.className).toBe('filterbar-inline-hero__actions');
    });

test('the field opens at two characters with exactly one shared runner and a polite labelled dialog', () => {
    start(); input.focus(); expect(panel()).toBeNull();
    type('h'); expect(panel()).toBeNull(); expect(mocks.create).not.toHaveBeenCalled();
    type('he');
    expect(panel().getAttribute('role')).toBe('dialog');
    expect(panel().getAttribute('aria-modal')).toBe('false');
    expect(panel().getAttribute('aria-label')).toBe('Haku');
    expect(panel().querySelector('input')).toBeNull();
    expect(input.getAttribute('aria-label')).toBe('Haku');
    expect(input.getAttribute('aria-controls')).toBe(panel().id);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(panel().querySelector('[role="status"]').getAttribute('aria-live')).toBe('polite');
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith(input,
        panel().querySelector('.front-page-desktop-search-panel__results > div'), panel().querySelector('[role="status"]'));
    type('hel'); expect(mocks.create).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(input);
});

test.each([1440, 1000])('close, Escape and outside click at %i restore the initiating control without history', width => {
    start(width);
    const trigger = width > tablet ? input : button;
    function open() { if (width > tablet) { input.focus(); type('Helsinki'); } else button.click(); }
    for (const gesture of ['close', 'escape', 'outside']) {
        open(); expect(panel()).not.toBeNull();
        if (width <= tablet) { expect(panel().querySelector('input')).toBe(input); expect(document.activeElement).toBe(input); }
        if (gesture === 'close') panel().querySelector('button').click();
        if (gesture === 'escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        if (gesture === 'outside') home.querySelector('article').click();
        expect(panel()).toBeNull(); expect(document.activeElement).toBe(trigger);
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
    }
    expect(mocks.destroy).toHaveBeenCalledTimes(3);
    expect(push).not.toHaveBeenCalled(); expect(back).not.toHaveBeenCalled();
});

test('panel clamps to docked Home gutters and stays beneath the measured field on resize/scroll', () => {
    start();
    const rect = vi.spyOn(input.parentElement, 'getBoundingClientRect').mockReturnValue({ right: 1400, bottom: 60 });
    type('he');
    expect(panel().style.width).toBe('640px'); expect(panel().style.left).toBe('760px');
    expect(panel().style.top).toBe('68px'); expect(parseFloat(panel().style.maxHeight)).toBeLessThanOrEqual(innerHeight - 84);
    vi.mocked(home.getBoundingClientRect).mockReturnValue({ left: 900, right: 1400 });
    rect.mockReturnValue({ right: 1200, bottom: 100 });
    home.dispatchEvent(new Event('scroll'));
    expect(panel().style.width).toBe('468px'); expect(panel().style.left).toBe('916px');
    expect(panel().style.top).toBe('108px');
});

test('an outside pointer click returns focus even when its destination takes focus before click', () => {
    start(); input.focus(); type('he');
    const outside = row.querySelector('.filterbar-inline-hero__actions button');
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    outside.focus(); outside.click();
    expect(panel()).toBeNull(); expect(document.activeElement).toBe(input);
});

test('portalled links keep activation, ArrowDown and Tab reach results/end actions without a focus trap', () => {
    start(); type('he');
    const groups = mocks.create.mock.calls[0][1];
    groups.innerHTML = '<a href="/app_travel?search=he">Row</a><a href="/app_travel?search=he">All</a>';
    const close = panel().querySelector('button');
    const links = [...groups.children];
    for (const node of [close, ...links, input, row.querySelector('.filterbar-inline-hero__actions button')]) {
        vi.spyOn(node, 'getClientRects').mockReturnValue([{}]);
    }
    input.focus(); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(close);
    close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(links[0]);
    links[1].focus(); links[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(panel()).toBeNull(); expect(document.activeElement.textContent).toBe('Settings');
    type('he');
    const link = document.createElement('a'); link.href = '/app_travel?search=he';
    mocks.create.mock.calls.at(-1)[1].append(link);
    const activate = vi.fn(event => { event.preventDefault(); expect(panel()).toBeNull(); });
    link.addEventListener('click', activate); link.click(); expect(activate).toHaveBeenCalledOnce();
});

test('focus leaving and ordinary Back close; crossing modes disposes the runner and focuses the new trigger', async () => {
    start(); input.focus(); type('he');
    row.querySelector('.filterbar-inline-hero__actions button').focus(); expect(panel()).toBeNull();
    type('he'); window.dispatchEvent(new PopStateEvent('popstate')); expect(panel()).toBeNull();
    type('he'); resize(tablet); await vi.advanceTimersByTimeAsync(20);
    expect(panel()).toBeNull(); expect(document.activeElement).toBe(button);
    button.click();
    resize(tablet + 1); await vi.advanceTimersByTimeAsync(20);
    expect(panel()).toBeNull(); expect(document.activeElement).toBe(input);
    type('he'); resize(phone + 1); await vi.advanceTimersByTimeAsync(20);
    expect(panel()).toBeNull(); expect(document.activeElement).toBe(button);
    button.click();
    const phoneButton = document.createElement('button'); phoneButton.className = 'front-page-search-button'; home.append(phoneButton);
    resize(phone); await vi.advanceTimersByTimeAsync(20);
    expect(panel()).toBeNull(); expect(row.querySelector('.front-page-desktop-search')).toBeNull();
    expect(document.activeElement).toBe(phoneButton);
    resize(tablet + 1); await vi.advanceTimersByTimeAsync(20); expect(document.activeElement).toBe(input);
    type('he'); mount.destroy();
    expect(panel()).toBeNull(); expect(push).not.toHaveBeenCalled(); expect(back).not.toHaveBeenCalled();
});

test('the unchanged fitter measures the tabs after the CSS flex reservation, hiding whole destinations', async () => {
    const style = document.createElement('style');
    style.textContent = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'front_page_desktop_search.css'), 'utf8');
    document.head.append(style); start();
    const host = row.querySelector('.front-page-desktop-search'); const tabs = row.querySelector('nav');
    tabs.innerHTML = '<button>Matkat</button><button>Tiedotteet</button><button>Artikkelit</button>';
    // jsdom has no flex geometry: model only the remaining row width, then run the real fitter.
    vi.spyOn(tabs, 'clientWidth', 'get').mockImplementation(() => 500 - parseFloat(getComputedStyle(host).flexBasis));
    const buttons = [...tabs.children];
    buttons.forEach(node => vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({ width: 130 }));
    const fitter = createNavigationFitController(tabs);
    try {
        expect(getComputedStyle(host).flexBasis).toBe('280px');
        fitter.sync(); await vi.advanceTimersByTimeAsync(25);
        expect(buttons.map(node => node.hidden)).toEqual([false, true, true]);
        resize(tablet); await vi.advanceTimersByTimeAsync(25);
        expect(getComputedStyle(host).flexBasis).toBe('44px');
        expect(buttons.map(node => node.hidden)).toEqual([false, false, false]);
    } finally { fitter.destroy(); }
});

test.each([tablet + 1, tablet])('phone base rules and the shared panel reset leave desktop cascade intact at %i', width => {
    const directory = dirname(fileURLToPath(import.meta.url));
    const paths = ['../filterbar/text_search/text_search.css', 'front_page_search_sheet.css', 'front_page_desktop_search.css'];
    const imports = readFileSync(resolve(directory, '../../styles/imports.css'), 'utf8');
    const sheets = paths.map(path => {
        const style = document.createElement('style');
        style.textContent = readFileSync(resolve(directory, path), 'utf8');
        document.head.append(style);
        return style;
    });
    expect(imports.indexOf('text_search.css')).toBeLessThan(imports.indexOf('front_page_search_sheet.css'));
    expect(imports.indexOf('front_page_search_sheet.css')).toBeLessThan(imports.indexOf('front_page_desktop_search.css'));
    start(width);
    if (width > tablet) type('he'); else button.click();
    const groups = mocks.create.mock.calls[0][1];
    groups.innerHTML = '<div class="front-page-search-sheet__slot" aria-busy="true">'
        + '<section class="supplemental-dataset-group"><a class="supplemental-dataset-show-all" href="/app_travel">Näytä kaikki</a></section></div>';
    const host = row.querySelector('.front-page-desktop-search');
    const nodes = [host, ...host.querySelectorAll('*'), panel(), ...panel().querySelectorAll('*')];
    // Phone component selectors must match only the shared runner's placeholder slot.
    const rules = [...sheets[1].sheet.cssRules].filter(rule => rule.selectorText);
    for (const node of nodes) {
        const matched = rules.filter(rule => node.matches(rule.selectorText));
        if (node.classList.contains('front-page-search-sheet__slot')) expect(matched).toHaveLength(2);
        else expect(matched).toHaveLength(0);
        expect(node.matches('.dataset-search-panel')).toBe(false);
    }
    expect(getComputedStyle(panel())).toMatchObject({ position: 'fixed', display: 'flex' });
    expect(getComputedStyle(panel().querySelector('.front-page-desktop-search-panel__close'))).toMatchObject({ display: 'grid', width: '44px' });
    expect(getComputedStyle(panel().querySelector('.front-page-desktop-search-panel__results'))).toMatchObject({ padding: '0px 12px 12px', overflowY: 'auto' });
    const properties = ['display', 'position', 'width', 'height', 'min-height', 'padding', 'overflow-y', 'background', 'border'];
    const computed = () => nodes.map(node => properties.map(property => getComputedStyle(node).getPropertyValue(property)));
    const withPhone = computed();
    sheets[1].remove();
    expect(computed()).toEqual(withPhone);
    // Desktop's more specific, later declarations win for the only shared classes.
    const desktopRules = [...sheets[2].sheet.cssRules].filter(rule => rule.selectorText);
    const slot = groups.firstElementChild;
    for (const property of ['min-height', 'border-bottom']) {
        const winner = desktopRules.filter(rule => slot.matches(rule.selectorText) && rule.style.getPropertyValue(property)).at(-1);
        expect(winner.selectorText).toContain('.front-page-desktop-search-panel .front-page-search-sheet__slot');
    }
});

test('the real 565 runner owns the first input debounce, GET parameters, result rendering and cancellation', async () => {
    const { createFrontPageSearchRunner } = await vi.importActual('./front_page_search_runner.js');
    mocks.create.mockImplementation(createFrontPageSearchRunner);
    mocks.endpoint.mockResolvedValue({ data: [{ title: 'Helsinki' }], columns: [], types: {} });
    start(); input.focus(); type('he');
    expect(panel().querySelector('[role="status"]').textContent).toBe('Haetaan…');
    await vi.advanceTimersByTimeAsync(299); expect(mocks.endpoint).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(mocks.endpoint).toHaveBeenCalledOnce();
    const [endpoint, options] = mocks.endpoint.mock.calls[0];
    expect(endpoint).toBe('getResults');
    expect(Object.fromEntries(new URLSearchParams(options.url_params))).toMatchObject({
        dataset: 'app_travel', search: 'he', limit: '3', view_key: 'card', include_card_support: '1',
    });
    expect(panel().textContent).toContain('Helsinki');
    type('hel'); panel().querySelector('button').click();
    await vi.advanceTimersByTimeAsync(300); expect(mocks.endpoint).toHaveBeenCalledOnce();
    expect(options.signal.aborted).toBe(true);
});
