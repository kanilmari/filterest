// @vitest-environment jsdom
// mobile_topbar_search_controller.test.js
// Proves measured field/button selection and search covering the name in either layout.
// Connects full title geometry, translations, font changes, focus and submission events.
// Prevents layout feedback from oscillating between modes or losing keyboard access.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createMobileTopbarSearchController, shouldUseTopbarSearchButton } from './mobile_topbar_search_controller.js';

vi.mock('../state_stores/lang_preference_reader.js', () => ({ getLanguageWithBrowserFallback: () => 'en' }));
vi.mock('../lang/translation_handler.js', () => ({ getTranslationForKey: (_key, options) => options.fallback }));

let controller;
let resize;
let fonts;
let originalFonts;
beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback) { this.callback = callback; resize = this; }
        observe = vi.fn();
        disconnect = vi.fn();
    });
    originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
    fonts = new EventTarget();
    fonts.ready = Promise.resolve();
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
});
afterEach(() => {
    controller?.destroy(); controller = null;
    document.body.replaceChildren();
    if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
    else delete document.fonts;
    vi.unstubAllGlobals();
});

function fixture(phone = false, withTitle = true) {
    document.body.innerHTML = `<div data-filterbar-shared-topbar-for="demo">
        <div class="dataset-shared-topbar__inner" style="column-gap:18px">
            <div class="dataset-shared-topbar__slot--start">
                <div class="dataset-shared-topbar__menu-slot"></div>
                <div class="dataset-shared-topbar__dataset-title">Matkatarjoukset</div>
            </div>
            <div class="dataset-shared-topbar__center">
                <div class="dataset-shared-topbar__site-identity">Fintravel</div>
                <div class="dataset-search-panel"><input value="Helsinki"></div>
            </div>
            <div class="dataset-shared-topbar__slot--end" style="column-gap:8px;min-width:44px">
                <button class="existing-control"></button><button class="existing-control"></button>
            </div>
        </div></div>`;
    const bar = document.body.firstElementChild;
    const title = bar.querySelector('.dataset-shared-topbar__dataset-title');
    const identity = bar.querySelector('.dataset-shared-topbar__site-identity');
    const search = bar.querySelector('.dataset-search-panel');
    const input = search.querySelector('input');
    const dimensions = { innerWidth: 800, titleWidth: 337, titleClientWidth: 180, menuWidth: 52 };
    const rect = (element, width) => {
        element.getBoundingClientRect = () => ({ width: typeof width === 'function' ? width() : width });
    };
    rect(bar.querySelector('.dataset-shared-topbar__inner'), () => dimensions.innerWidth);
    rect(bar.querySelector('.dataset-shared-topbar__menu-slot'), () => dimensions.menuWidth);
    for (const control of bar.querySelectorAll('.existing-control')) rect(control, 44);
    Object.defineProperty(title, 'scrollWidth', { get: () => dimensions.titleWidth });
    Object.defineProperty(title, 'clientWidth', { get: () => dimensions.titleClientWidth });
    if (!withTitle) title.remove();
    controller = createMobileTopbarSearchController(bar);
    const toggle = bar.querySelector('.dataset-shared-topbar__search-toggle');
    rect(toggle, () => toggle.hidden ? 0 : 44);
    rect(bar.querySelector('.dataset-shared-topbar__slot--end'), () => toggle.hidden ? 96 : 148);
    controller.sync({ phone, active: true });
    return { bar, title, identity, search, input, toggle, dimensions };
}

test.each([[802, false], [801, false], [800, true]])('field/button decision at %ipx includes full title, controls and gaps', (innerWidth, expected) => {
    expect(shouldUseTopbarSearchButton({ innerWidth, titleWidth: 337,
        startWidth: 52, endWidth: 96, columnGap: 18 })).toBe(expected);
});

test.each([false, true])('a missing title leaves search usable and observes only elements (phone=%s)', phone => {
    const { bar, search, input, toggle, dimensions } = fixture(phone, false);
    expect(bar.querySelector('.dataset-shared-topbar__dataset-title')).toBeNull();
    expect(bar.dataset.topbarSearchMode).toBe(phone ? 'phone' : 'field');
    expect(search.hidden).toBe(phone);
    // No heading consumes width; only the controls, gaps and minimum field matter.
    dimensions.innerWidth = 464;
    resize.callback();
    expect(bar.dataset.topbarSearchMode).toBe(phone ? 'phone' : 'field');
    dimensions.innerWidth = 463;
    resize.callback();
    expect(bar.dataset.topbarSearchMode).toBe(phone ? 'phone' : 'button');
    expect(search.hidden).toBe(true);
    expect(resize.observe.mock.calls.every(([element]) => element instanceof Element)).toBe(true);
    toggle.click();
    expect(search.hidden).toBe(false); expect(search.inert).toBe(false);
    expect(document.activeElement).toBe(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(search.hidden).toBe(true); expect(document.activeElement).toBe(toggle);
    expect(input.value).toBe('Helsinki');
});

test('the full scroll width keeps the decision stable while the title is clipped and the toggle takes room', () => {
    const { bar, title, search, toggle, dimensions } = fixture();
    expect(title.clientWidth).toBeLessThan(title.scrollWidth);
    for (let attempt = 0; attempt < 5; attempt++) {
        resize.callback();
        expect(bar.dataset.topbarSearchMode).toBe('button');
        expect(toggle.hidden).toBe(false); expect(search.hidden).toBe(true);
    }
    dimensions.innerWidth = 801;
    resize.callback();
    expect(bar.dataset.topbarSearchMode).toBe('field');
    expect(toggle.hidden).toBe(true); expect(search.hidden).toBe(false);
    resize.callback();
    expect(bar.dataset.topbarSearchMode).toBe('field');
    dimensions.innerWidth = 800;
    resize.callback();
    expect(bar.dataset.topbarSearchMode).toBe('button');
});

test('desktop search covers the title, focuses the draft and restores title and toggle focus on Escape or toggle', () => {
    const { bar, title, search, input, toggle } = fixture();
    toggle.click();
    controller.sync({ phone: false, active: true });
    expect(search.hidden).toBe(false); expect(search.inert).toBe(false);
    expect(search.getAttribute('aria-hidden')).toBe('false');
    expect(bar.dataset.topbarSearchOpen).toBe('true');
    expect(title.getAttribute('aria-hidden')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe(search.id);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(search.hidden).toBe(true); expect(search.inert).toBe(true);
    expect(title.getAttribute('aria-hidden')).toBe('false');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(toggle); expect(input.value).toBe('Helsinki');
    toggle.click(); toggle.click();
    expect(search.hidden).toBe(true); expect(document.activeElement).toBe(toggle);
});

test.each([false, true])('a submitted search closes the open field and restores the name and focus (phone=%s)', phone => {
    const { bar, title, identity, search, input, toggle } = fixture(phone);
    toggle.click();
    expect(document.activeElement).toBe(input);
    const notify = (dataset, committed) => window.dispatchEvent(new CustomEvent('dataset-committed-search-changed', {
        detail: { dataset, committed },
    }));
    notify('other', true); notify('demo', false);
    expect(search.hidden).toBe(false);
    notify('demo', true);
    expect(bar.dataset.topbarSearchOpen).toBe('false'); expect(search.hidden).toBe(true);
    expect(title.getAttribute('aria-hidden')).toBe(String(phone));
    expect(identity.hidden).toBe(!phone); expect(document.activeElement).toBe(toggle);
});

test('title translations, font completion and menu changes remeasure without a viewport breakpoint', async () => {
    const { bar, title, dimensions } = fixture();
    dimensions.titleWidth = 100;
    title.textContent = 'Trips';
    await Promise.resolve();
    expect(bar.dataset.topbarSearchMode).toBe('field');
    dimensions.titleWidth = 500;
    fonts.dispatchEvent(new Event('loadingdone'));
    expect(bar.dataset.topbarSearchMode).toBe('button');
    dimensions.titleWidth = 337; dimensions.menuWidth = 0;
    resize.callback();
    expect(bar.dataset.topbarSearchMode).toBe('field');
    expect(resize.observe).toHaveBeenCalledWith(bar);
    expect(resize.observe).toHaveBeenCalledWith(title);
    expect(resize.observe).toHaveBeenCalledWith(bar.querySelector('.dataset-shared-topbar__menu-slot'));
});

test('phone retains its own decision; crossing the boundary or deactivating closes without stealing focus', () => {
    const { bar, title, identity, search, input, toggle, dimensions } = fixture(true);
    dimensions.innerWidth = 2000;
    resize.callback();
    expect(bar.dataset.topbarSearchMode).toBe('phone'); expect(search.hidden).toBe(true);
    toggle.click(); expect(identity.hidden).toBe(true); expect(title.getAttribute('aria-hidden')).toBe('true');
    controller.sync({ phone: false, active: true });
    expect(search.hidden).toBe(false); expect(toggle.hidden).toBe(true);
    controller.sync({ phone: true, active: true });
    expect(search.hidden).toBe(true); expect(identity.hidden).toBe(false);
    toggle.click(); controller.sync({ phone: true, active: false });
    expect(search.hidden).toBe(true); expect(document.activeElement).not.toBe(input); expect(toggle.tabIndex).toBe(-1);
    controller.destroy();
    expect(resize.disconnect).toHaveBeenCalledOnce();
    expect(toggle.isConnected).toBe(false);
});
