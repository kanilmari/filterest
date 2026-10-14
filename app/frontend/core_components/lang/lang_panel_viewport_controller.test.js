// lang_panel_viewport_controller.test.js
// Verifies language-menu geometry, portal interactions and listener cleanup.
// Connects measured phone/desktop anchors to the real selector and shared placement rule.
// Protects reachable translated options without requiring a browser layout engine.
// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
vi.mock('./translation_handler.js', () => ({ translatePage: vi.fn(async () => {}) }));
import { initializeLanguageSelector } from './lang_panel_printer.js';

const lifetimes = [];
beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(375);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(667);
    localStorage.setItem('chosen_language', 'en');
});
afterEach(() => {
    lifetimes.splice(0).forEach(lifetime => lifetime.abort());
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

function mount({ top = 548, bottom = 592, height = 206, right = 280 } = {}) {
    const navbar = document.createElement('nav');
    navbar.style.overflowY = 'auto';
    // Pin the original long, scrolling bar ending at the phone screen's bottom.
    vi.spyOn(navbar, 'getBoundingClientRect').mockReturnValue({ top: 536, bottom: 667, height: 131 });
    Object.defineProperty(navbar, 'scrollHeight', { configurable: true, value: 1100 });
    const selector = document.createElement('div');
    selector.className = 'language-selection menu-language-selection';
    navbar.appendChild(selector);
    document.body.appendChild(navbar);
    const lifetime = new AbortController();
    lifetimes.push(lifetime);
    initializeLanguageSelector(selector, { signal: lifetime.signal, languages: [
        { id: 'en', value: 'en', label: 'English', shortLabel: 'EN' },
        { id: 'fi', value: 'fi', label: 'Suomi', shortLabel: 'FI' },
    ] });
    const button = selector.querySelector('button');
    const panel = selector.querySelector('.floating-language-panel');
    const anchor = vi.spyOn(selector, 'getBoundingClientRect').mockReturnValue({ top, bottom, right });
    const panelRect = vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ width: 242, height });
    Object.defineProperty(panel, 'scrollHeight', { configurable: true, get: () => height });
    return { navbar, selector, button, panel, anchor, panelRect, lifetime };
}

test('the bottom-of-screen menu opens above, outside the scrolling menu bar', () => {
    const { navbar, selector, button, panel } = mount();
    button.focus(); button.click();
    expect(panel.parentElement).toBe(document.body);
    expect(navbar.contains(panel)).toBe(false);
    expect(panel.style.top).toBe('');
    expect(panel.style.bottom).toBe('129px');
    expect(panel.style.maxHeight).toBe('530px');
    expect(panel.style.left).toBe('38px');
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe(panel.id);
    button.click();
    expect(panel.parentElement).toBe(selector);
    expect(button.getAttribute('aria-expanded')).toBe('false');
});

test('desktop keeps the original gap, width and right-aligned anchor', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1440);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(900);
    const { button, panel } = mount({ top: 50, bottom: 94, right: 700 });
    button.click();
    expect(panel.style.top).toBe('104px');
    expect(panel.style.bottom).toBe('');
    expect(panel.style.left).toBe('458px');
    expect(panel.style.minWidth).toBe('220px');
    expect(panel.style.maxHeight).toBe('788px');
});

test.each([[210, 254, '', '200px', '192px'], [140, 184, '194px', '', '198px']])(
    'neither side fits at %i; cap the larger side', (top, bottom, expectedTop, expectedBottom, maxHeight) => {
        vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(400);
        const { button, panel } = mount({ top, bottom, height: 500 });
        button.click();
        expect(panel.style.top).toBe(expectedTop);
        expect(panel.style.bottom).toBe(expectedBottom);
        expect(panel.style.maxHeight).toBe(maxHeight);
    },
);

test('resize and captured menu-bar scroll remeasure an open panel without resetting its scroll', () => {
    const { navbar, button, panel, anchor, panelRect } = mount();
    button.click(); panel.scrollTop = 37;
    anchor.mockReturnValue({ top: 50, bottom: 94, right: 280 });
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(20);
    expect(panel.style.top).toBe('104px');
    expect(panel.style.bottom).toBe('');
    anchor.mockReturnValue({ top: 548, bottom: 592, right: 280 });
    navbar.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(20);
    expect(panel.style.bottom).toBe('129px');
    expect(panel.scrollTop).toBe(37);
    button.click();
    const measurements = panelRect.mock.calls.length;
    window.dispatchEvent(new Event('resize'));
    navbar.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(20);
    expect(panelRect).toHaveBeenCalledTimes(measurements);
    anchor.mockReturnValue({ top: 100, bottom: 144, right: 280 });
    button.click();
    expect(panel.style.top).toBe('154px');
});

// Model the browser clamp that jsdom lacks: expanding a capped scroll box during
// a layout read loses its scroll position before the cap can be reapplied.
function simulateCappedLayout(panel, panelRect, naturalHeight) {
    panelRect.mockImplementation(() => {
        const cap = Number.parseFloat(panel.style.maxHeight);
        const height = Number.isFinite(cap) ? Math.min(naturalHeight, cap) : naturalHeight;
        panel.scrollTop = Math.min(panel.scrollTop, Math.max(0, naturalHeight - height));
        return { width: 242, height };
    });
}

test.each(['panel', 'descendant'])('scrolling the %s keeps its position without scheduling placement', target => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(400);
    const { button, panel, panelRect } = mount({ top: 140, bottom: 184, height: 500 });
    simulateCappedLayout(panel, panelRect, 500);
    button.click();
    expect(panel.style.maxHeight).toBe('198px');
    panel.scrollTop = 137;
    const measurements = panelRect.mock.calls.length;
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame');
    (target === 'panel' ? panel : panel.firstElementChild).dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(40);
    expect(panel.scrollTop).toBe(137);
    expect(requestFrame).not.toHaveBeenCalled();
    expect(panelRect).toHaveBeenCalledTimes(measurements);
});

test.each(['resize', 'ancestor', 'viewport'])(
    '%s still repositions a capped panel without expanding its scroll box', trigger => {
        vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(400);
        const { navbar, button, panel, panelRect, anchor } = mount({ top: 140, bottom: 184, height: 500 });
        simulateCappedLayout(panel, panelRect, 500);
        button.click();
        panel.scrollTop = 137;
        const measurements = panelRect.mock.calls.length;
        anchor.mockReturnValue({ top: 130, bottom: 174, right: 280 });
        const target = trigger === 'ancestor' ? navbar : window;
        target.dispatchEvent(new Event(trigger === 'resize' ? 'resize' : 'scroll'));
        vi.advanceTimersByTime(40);
        expect(panelRect).toHaveBeenCalledTimes(measurements + 1);
        expect(panel.style.top).toBe('184px');
        expect(panel.style.maxHeight).toBe('208px');
        expect(panel.scrollTop).toBe(137);
    },
);

test('a taller viewport reopens the downward side without moving the selector', () => {
    const { button, panel } = mount();
    button.click();
    expect(panel.style.bottom).toBe('129px');
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(1000);
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(20);
    expect(panel.style.top).toBe('602px');
    expect(panel.style.bottom).toBe('');
    expect(panel.style.maxHeight).toBe('390px');
});

test.each([20, 900])('horizontal placement is bounded when the selector right edge is %i', right => {
    const { button, panel } = mount({ right });
    button.click();
    const left = Number.parseFloat(panel.style.left);
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left + 242).toBeLessThanOrEqual(375 - 8);
});

test('a narrow viewport caps the menu width as well as its height', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(200);
    const { button, panel, panelRect } = mount({ right: 200 });
    panelRect.mockReturnValue({ width: 184, height: 206 });
    button.click();
    expect(panel.style.left).toBe('8px');
    expect(panel.style.minWidth).toBe('184px');
    expect(panel.style.maxWidth).toBe('184px');
});

test('visual viewport resize and scroll stay inside the visible screen when the anchor leaves it', () => {
    const viewport = new EventTarget();
    Object.assign(viewport, { width: 320, height: 260, offsetLeft: 15, offsetTop: 100 });
    vi.stubGlobal('visualViewport', viewport);
    const { button, panel } = mount();
    button.click();
    expect(panel.style.top).toBe('108px');
    expect(panel.style.bottom).toBe('');
    expect(panel.style.maxHeight).toBe('244px');
    expect(panel.style.maxWidth).toBe('304px');
    viewport.height = 200;
    viewport.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(20);
    expect(panel.style.maxHeight).toBe('184px');
    viewport.offsetTop = 120;
    viewport.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(20);
    expect(panel.style.top).toBe('128px');
});

test('portalled options preserve inside clicks, Tab entry, native arrows and Escape focus', () => {
    const { selector, button, panel } = mount();
    button.focus(); button.click();
    panel.querySelector('label').click();
    expect(panel.classList.contains('hidden')).toBe(false);
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    const checked = panel.querySelector('input:checked');
    expect(document.activeElement).toBe(checked);
    const arrow = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    checked.dispatchEvent(arrow);
    expect(arrow.defaultPrevented).toBe(false);
    checked.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(button);
    checked.focus();
    checked.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel.classList.contains('hidden')).toBe(true);
    expect(panel.parentElement).toBe(selector);
    expect(document.activeElement).toBe(button);
    button.click(); document.body.click();
    expect(panel.classList.contains('hidden')).toBe(true);
});

test('opening a second selector closes and restores the first panel', () => {
    const first = mount();
    const second = mount();
    first.button.click(); second.button.click();
    expect(first.panel.parentElement).toBe(first.selector);
    expect(first.panel.classList.contains('hidden')).toBe(true);
    expect(first.button.getAttribute('aria-expanded')).toBe('false');
    expect(second.panel.parentElement).toBe(document.body);
    second.panel.querySelector('input[value="fi"]').dispatchEvent(new Event('change', { bubbles: true }));
    expect(second.panel.classList.contains('hidden')).toBe(true);
    expect(second.button.getAttribute('aria-expanded')).toBe('false');
    expect(localStorage.getItem('chosen_language')).toBe('fi');
});

test.each(['abort', 'remove'])('%s removes open tracking, pending frames and the overlay', async action => {
    const { selector, button, panel, panelRect, lifetime } = mount();
    const removeListener = vi.spyOn(window, 'removeEventListener');
    button.click();
    window.dispatchEvent(new Event('resize'));
    if (action === 'abort') lifetime.abort();
    else { selector.remove(); await Promise.resolve(); }
    expect(panel.parentElement).toBe(selector);
    expect(panel.classList.contains('hidden')).toBe(true);
    expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith('scroll', expect.any(Function), true);
    const measurements = panelRect.mock.calls.length;
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(20);
    expect(panelRect).toHaveBeenCalledTimes(measurements);
    button.click();
    panel.querySelector('input[value="fi"]').dispatchEvent(new Event('change', { bubbles: true }));
    expect(panel.classList.contains('hidden')).toBe(true);
    expect(localStorage.getItem('chosen_language')).toBe('en');
});

test('closing disconnects content observation and visual viewport listeners', () => {
    const viewport = Object.assign(new EventTarget(), { width: 375, height: 667, offsetTop: 0, offsetLeft: 0 });
    vi.stubGlobal('visualViewport', viewport);
    const removeListener = vi.spyOn(viewport, 'removeEventListener');
    const observers = [];
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe = vi.fn();
        disconnect = vi.fn();
    });
    const { button, panel, panelRect } = mount({ top: 400, bottom: 444, height: 100 });
    button.click();
    expect(panel.style.top).toBe('454px');
    expect(observers[0].observe).toHaveBeenCalledWith(panel.firstElementChild);
    panelRect.mockReturnValue({ width: 242, height: 600 });
    observers[0].callback();
    vi.advanceTimersByTime(20);
    expect(panel.style.bottom).toBe('277px');
    expect(panel.style.maxHeight).toBe('382px');
    button.click();
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith('scroll', expect.any(Function));
});

test('a selector inside a shared modal portals to that modal layer', () => {
    const overlay = document.createElement('div');
    overlay.id = 'custom_modal_overlay';
    document.body.appendChild(overlay);
    const { navbar, button, panel, lifetime } = mount();
    overlay.appendChild(navbar);
    const documentKeydown = vi.fn();
    document.addEventListener('keydown', documentKeydown, { signal: lifetime.signal });
    button.click();
    expect(panel.parentElement).toBe(overlay);
    expect(navbar.contains(panel)).toBe(false);
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    const checked = panel.querySelector('input:checked');
    expect(document.activeElement).toBe(checked);
    expect(documentKeydown).not.toHaveBeenCalled();
    checked.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(button);
    expect(documentKeydown).not.toHaveBeenCalled();
});

test('offscreen view builders may initialize a selector before its first connected mount', async () => {
    const selector = document.createElement('div');
    const lifetime = new AbortController();
    lifetimes.push(lifetime);
    initializeLanguageSelector(selector, { signal: lifetime.signal });
    document.body.appendChild(document.createElement('div'));
    await Promise.resolve();
    document.body.appendChild(selector);
    await Promise.resolve();
    const button = selector.querySelector('button');
    const panel = selector.querySelector('.floating-language-panel');
    button.click();
    expect(panel.parentElement).toBe(document.body);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    selector.remove();
    await Promise.resolve();
    expect(panel.parentElement).toBe(selector);
    expect(panel.classList.contains('hidden')).toBe(true);
});
