// lang_panel_navbar_lifecycle.test.js
// Reproduces language selection with the navbar's real outside-click handler.
// Connects portalled pointer events, translated labels and selector replacement.
// Protects reopening and cleanup without a running backend or browser layout engine.
// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
vi.mock('./translation_handler.js', () => ({ translatePage: vi.fn() }));
vi.mock('../../reusable_components/scroll_passthrough.js', () => ({ setupScrollPassthrough: vi.fn() }));
import { translatePage } from './translation_handler.js';
import { initializeLanguageSelector } from './lang_panel_printer.js';
import { initNavbar } from '../navigation/menu_button/navbar_visibility_handler.js';

const lifetimes = [];
const navbarListeners = [];
let resizeObservers;
let ownerObservers;

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(667);
    localStorage.clear();
    localStorage.setItem('chosen_language', 'en');
    localStorage.setItem('navVisibleNarrow', 'true');
    localStorage.setItem('navVisibleWide', 'true');
    document.documentElement.lang = 'en';
    document.body.innerHTML = `<div class="body_content"><button id="showMenuButton"></button>
        <nav id="navbar"><button id="hideMenuButton"></button></nav><main id="tabs_container"></main></div>`;
    resizeObservers = [];
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback) { this.callback = callback; resizeObservers.push(this); }
        observe = vi.fn();
        disconnect = vi.fn();
    });
    ownerObservers = [];
    const NativeMutationObserver = window.MutationObserver;
    vi.stubGlobal('MutationObserver', class extends NativeMutationObserver {
        constructor(callback) {
            super(callback);
            this.disconnect = vi.fn(() => super.disconnect());
            ownerObservers.push(this);
        }
    });
    // Translation is asynchronous and replaces label children, as the real translator does.
    // Navbar visibility, selector interaction and controller lifetimes stay real.
    translatePage.mockImplementation(async language => {
        await Promise.resolve();
        document.documentElement.lang = language;
        const label = language === 'fi' ? 'Valitse valikoiden kieli' : 'Select menu language';
        document.querySelectorAll('[data-aria-label-lang-key="select_menu_language"]')
            .forEach(button => button.setAttribute('aria-label', label));
        document.querySelectorAll('[data-lang-key="select_menu_language"]')
            .forEach(heading => { heading.textContent = label; });
    });
});

afterEach(() => {
    lifetimes.splice(0).forEach(lifetime => lifetime.abort());
    navbarListeners.splice(0).forEach(([target, args]) => target.removeEventListener(...args));
    document.body.replaceChildren();
    document.documentElement.lang = 'en';
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

function mountSelector() {
    const selector = document.createElement('div');
    selector.className = 'language-selection menu-language-selection';
    document.getElementById('navbar').appendChild(selector);
    const lifetime = new AbortController();
    lifetimes.push(lifetime);
    initializeLanguageSelector(selector, { signal: lifetime.signal, translateOnInitialize: false, languages: [
        { id: 'en', value: 'en', label: 'English', shortLabel: 'EN' },
        { id: 'fi', value: 'fi', label: 'Suomi', shortLabel: 'FI' },
    ] });
    const button = selector.querySelector('button');
    const panel = selector.querySelector('.floating-language-panel');
    const anchor = { top: 548, bottom: 592, right: 280 };
    vi.spyOn(selector, 'getBoundingClientRect').mockReturnValue(anchor);
    const measurements = vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ width: 242, height: 206 });
    Object.defineProperty(panel, 'scrollHeight', { configurable: true, value: 206 });
    return { selector, button, panel, anchor, measurements };
}

function mountNavbar(width) {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(width);
    // initNavbar predates AbortSignal ownership; release only the listeners this fixture adds.
    const spies = [document, window].map(target => {
        const add = target.addEventListener.bind(target);
        return vi.spyOn(target, 'addEventListener').mockImplementation((...args) => {
            navbarListeners.push([target, args]);
            add(...args);
        });
    });
    initNavbar();
    spies.forEach(spy => spy.mockRestore());
    return document.getElementById('navbar');
}

test.each([375, 768, 1440].flatMap(width => ['radio', 'label'].map(pointer => ({ width, pointer }))))(
    '$width px: $pointer selection keeps the navbar open through translation and reopening', async ({ width, pointer }) => {
        const navbar = mountNavbar(width);
        const { selector, button, panel, anchor, measurements } = mountSelector();
        const removeListener = vi.spyOn(window, 'removeEventListener');
        button.click();
        expect(panel.parentElement).toBe(document.body);
        // A stale queued geometry update must be cancelled by the language change.
        resizeObservers[0].callback();
        const radio = panel.querySelector('input[value="fi"]');
        (pointer === 'radio' ? radio : panel.querySelector(`label[for="${radio.id}"]`)).click();
        expect(localStorage.getItem('chosen_language')).toBe('fi');
        expect(navbar.classList.contains('collapsed')).toBe(false);
        await translatePage.mock.results.at(-1).value;
        await Promise.resolve(); // Deliver translation mutations to the owner observer.
        expect(document.documentElement.lang).toBe('fi');
        expect(button.getAttribute('aria-label')).toBe('Valitse valikoiden kieli');
        expect(button.querySelector('.language-code-label').textContent).toBe('FI');
        expect(panel.querySelector('[data-lang-key]').textContent).toBe('Valitse valikoiden kieli');
        expect(selector.querySelector('button')).toBe(button);
        expect(selector.getBoundingClientRect()).toBe(anchor);
        expect(panel.parentElement).toBe(selector);
        expect(panel.classList.contains('hidden')).toBe(true);
        expect(resizeObservers[0].disconnect).toHaveBeenCalledTimes(1);
        expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function));
        expect(removeListener).toHaveBeenCalledWith('scroll', expect.any(Function), true);
        const closedMeasurements = measurements.mock.calls.length;
        resizeObservers[0].callback(); // Even an already-delivered callback cannot resume tracking.
        window.dispatchEvent(new Event('resize'));
        vi.advanceTimersByTime(1000);
        expect(measurements).toHaveBeenCalledTimes(closedMeasurements);

        button.click();
        expect(button.getAttribute('aria-expanded')).toBe('true');
        expect(panel.parentElement).toBe(document.body);
        expect(panel.style.bottom).toBe('129px');
        expect(panel.style.left).toBe('38px');
        panel.querySelector('[data-lang-key]').click();
        expect(navbar.classList.contains('collapsed')).toBe(false);
        expect(panel.classList.contains('hidden')).toBe(false);
        resizeObservers[1].callback();
        vi.advanceTimersByTime(1000);
        expect(measurements).toHaveBeenCalledTimes(closedMeasurements + 2);
        document.body.click();
        expect(navbar.classList.contains('collapsed')).toBe(true);
        expect(panel.classList.contains('hidden')).toBe(true);
    },
);

test('replacing a translated selector disposes the old anchors, observers and interactions', async () => {
    mountNavbar(375);
    const old = mountSelector();
    old.button.click();
    old.panel.querySelector('input[value="fi"]').click();
    await translatePage.mock.results.at(-1).value;
    old.button.click();
    resizeObservers[1].callback();
    old.selector.remove();
    const next = mountSelector();
    await Promise.resolve();
    expect(ownerObservers[0].disconnect).toHaveBeenCalledTimes(1);
    expect(resizeObservers[1].disconnect).toHaveBeenCalledTimes(1);
    expect(old.panel.parentElement).toBe(old.selector);
    const oldMeasurements = old.measurements.mock.calls.length;
    old.button.click();
    old.panel.querySelector('input[value="en"]').click();
    window.dispatchEvent(new Event('resize'));
    resizeObservers[1].callback();
    vi.advanceTimersByTime(1000);
    expect(old.measurements).toHaveBeenCalledTimes(oldMeasurements);
    expect(old.panel.classList.contains('hidden')).toBe(true);
    expect(localStorage.getItem('chosen_language')).toBe('fi');
    expect(document.querySelectorAll('[data-testid="language-menu-panel"]')).toHaveLength(1);
    next.button.click();
    expect(next.panel.parentElement).toBe(document.body);
    expect(next.panel.style.bottom).toBe('129px');
    expect(next.panel.querySelector('input[value="fi"]').checked).toBe(true);
    next.panel.querySelector('input[value="en"]').click();
    await translatePage.mock.results.at(-1).value;
    expect(document.documentElement.lang).toBe('en');
    expect(document.getElementById('navbar').classList.contains('collapsed')).toBe(false);
});
