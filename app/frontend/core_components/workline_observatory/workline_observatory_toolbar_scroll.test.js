// workline_observatory_toolbar_scroll.test.js
// Proves compact controls follow the responsive observatory scroll owner.
// Exercises the real renderer inside the shared results and legacy view hosts.
// Guards breakpoint rebinding, redraws, context menus and teardown without a browser.
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../lang/translation_handler.js', () => ({ getTranslationForKey: () => undefined }));
vi.mock('../state_stores/lang_preference_reader.js', () => ({ getLanguageWithBrowserFallback: () => 'en' }));
vi.mock('../../icons/icon_loader.js', () => ({ setElementSvgContent: vi.fn() }));
vi.mock('./workline_observatory_api_adapter.js', () => ({
    fetchWorklineObservatoryBoard: vi.fn(), fetchWorklineObservatoryReportHistory: vi.fn(),
    applyWorklineStatusAction: vi.fn(), applyWorklinePriorityAction: vi.fn(),
    applyWorklineReleaseGoalAction: vi.fn(), createWorklineReleaseGoal: vi.fn(),
    saveWorklinePublication: vi.fn(), saveWorklineReleaseContract: vi.fn(),
}));

import { renderWorklineObservatory } from './workline_observatory_view_printer.js';

let controller;
let shared;
let container;
let sentinelBottom;
let toolbar;

function setViewport(width) {
    vi.stubGlobal('innerWidth', width);
    window.dispatchEvent(new Event('resize'));
}

function mount() {
    controller = renderWorklineObservatory(container, { worklines: [{ id: 1, title: 'Scroll proof' }] });
    toolbar = container.querySelector('.workline-observatory__status-toolbar');
    container.querySelector('.workline-observatory__toolbar-sentinel').getBoundingClientRect = () => ({ bottom: sentinelBottom });
    return Promise.resolve(); // Let the initial measurement run with the mounted geometry.
}

function scroll(element, bottom, top = 500) {
    element.scrollTop = top;
    sentinelBottom = bottom;
    element.dispatchEvent(new Event('scroll')); // Native element scroll events do not bubble.
}

beforeEach(() => {
    document.body.innerHTML = '<div class="tab-content-body"><div class="scrollable_content"><main></main></div></div>';
    window.localStorage.clear();
    shared = document.querySelector('.scrollable_content');
    container = shared.querySelector('main');
    shared.style.overflowY = 'auto';
    container.style.overflowX = 'auto';
    container.style.overflowY = 'auto'; // Browsers compute this from overflow-x:auto.
    for (const element of [shared, container]) {
        Object.defineProperties(element, {
            clientHeight: { configurable: true, value: 500 },
            scrollHeight: { configurable: true, value: 1200 },
        });
    }
    shared.getBoundingClientRect = () => ({ top: 100 });
    container.getBoundingClientRect = () => ({ top: 160 });
    sentinelBottom = 180;
});

afterEach(() => {
    controller?.destroy();
    controller = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('responsive compact toolbar scroll binding', () => {
    test('compacts after shared scrolling passes the hero/search header, then expands back at the top', async () => {
        setViewport(1920);
        sentinelBottom = 760;
        await mount();
        scroll(shared, 260, 500);
        expect(toolbar.dataset.compact).toBe('false'); // Still below the scrollport's top.
        scroll(shared, -40, 800);
        expect(toolbar.dataset.compact).toBe('true');
        scroll(shared, 760, 0);
        expect(toolbar.dataset.compact).toBe('false');
    });

    test.each([901, 1024, 1920])('uses the shared owner above 900px (%ipx), even before overflow is measurable', async (width) => {
        setViewport(width);
        Object.defineProperty(shared, 'scrollHeight', { configurable: true, value: 500 });
        const subscribe = vi.spyOn(shared, 'addEventListener');
        await mount();
        expect(subscribe).toHaveBeenCalledWith('scroll', expect.any(Function), true);
        expect(toolbar.dataset.compact).toBe('false');
        // A nearer overflow wrapper must not determine the desktop sticky boundary.
        scroll(shared, 140);
        expect(toolbar.dataset.compact).toBe('false');
        scroll(shared, 90);
        expect(toolbar.dataset.compact).toBe('true');
        scroll(shared, 180);
        expect(toolbar.dataset.compact).toBe('false');
    });

    test.each([390, 900])('keeps the original ancestor boundary and nested board events at %ipx', async (width) => {
        setViewport(width);
        const subscribe = vi.spyOn(window, 'addEventListener');
        await mount();
        expect(subscribe).toHaveBeenCalledWith('scroll', expect.any(Function), true);
        scroll(container, 170);
        expect(toolbar.dataset.compact).toBe('false');
        scroll(container, 140);
        expect(toolbar.dataset.compact).toBe('true');
        scroll(shared, 180); // The original capture must also hear ancestors of the view.
        expect(toolbar.dataset.compact).toBe('false');
        scroll(container.querySelector('.workline-observatory__board'), 140);
        expect(toolbar.dataset.compact).toBe('true');
        Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 500 });
        scroll(shared, 140); // Preserve re-evaluation of the original overflow boundary.
        expect(toolbar.dataset.compact).toBe('false');
    });

    test('rebinds both ways across 900px, remeasures immediately and removes the old listeners', async () => {
        setViewport(901);
        const sharedAdd = vi.spyOn(shared, 'addEventListener');
        const sharedRemove = vi.spyOn(shared, 'removeEventListener');
        const narrowAdd = vi.spyOn(window, 'addEventListener');
        const narrowRemove = vi.spyOn(window, 'removeEventListener');
        await mount();
        const desktopListener = sharedAdd.mock.calls.find(([event]) => event === 'scroll')[1];
        sentinelBottom = 140;
        setViewport(900);
        expect(toolbar.dataset.compact).toBe('true');
        expect(sharedRemove).toHaveBeenCalledWith('scroll', desktopListener, true);
        const narrowListener = narrowAdd.mock.calls.find(([event]) => event === 'scroll')[1];
        scroll(shared, 180);
        expect(toolbar.dataset.compact).toBe('false');
        sentinelBottom = 140;
        setViewport(901);
        expect(toolbar.dataset.compact).toBe('false');
        expect(narrowRemove).toHaveBeenCalledWith('scroll', narrowListener, true);
        sentinelBottom = 90;
        window.dispatchEvent(new Event('scroll'));
        expect(toolbar.dataset.compact).toBe('false'); // The old window listener is gone.
        scroll(container, 90);
        expect(toolbar.dataset.compact).toBe('true'); // Captured by the current shared owner.
        controller.destroy();
        expect(sharedRemove).toHaveBeenLastCalledWith('scroll', desktopListener, true);
    });

    test('supports the direct legacy management host on desktop', async () => {
        setViewport(1280);
        container.classList.add('management_forms');
        const subscribe = vi.spyOn(container, 'addEventListener');
        await mount();
        expect(subscribe).toHaveBeenCalledWith('scroll', expect.any(Function), true);
        scroll(container, 140);
        expect(toolbar.dataset.compact).toBe('true');
    });

    test('releases scroll/resize observers across redraw, replacement and teardown', async () => {
        setViewport(1920);
        const added = vi.spyOn(shared, 'addEventListener');
        const removed = vi.spyOn(shared, 'removeEventListener');
        const resizeAdded = vi.spyOn(window, 'addEventListener');
        const resizeRemoved = vi.spyOn(window, 'removeEventListener');
        const disconnect = vi.fn();
        vi.stubGlobal('ResizeObserver', class { observe() {} disconnect = disconnect; });
        await mount();
        container.querySelector('.workline-observatory__workline-checkbox').click();
        await mount(); // Replacing the controller also tears down the previous view.
        controller.destroy();
        for (const [event, listener, capture] of added.mock.calls.filter(([name]) => name === 'scroll')) {
            expect(removed).toHaveBeenCalledWith(event, listener, capture);
        }
        for (const [event, listener] of resizeAdded.mock.calls.filter(([name]) => name === 'resize')) {
            expect(resizeRemoved).toHaveBeenCalledWith(event, listener);
        }
        expect(disconnect).toHaveBeenCalledTimes(3);
        const compact = toolbar.dataset.compact;
        scroll(shared, 90);
        setViewport(900);
        expect(toolbar.dataset.compact).toBe(compact);
    });

    test('cancels the pending initial measurement when destroyed before its microtask', async () => {
        setViewport(1920);
        const mounted = mount();
        controller.destroy();
        sentinelBottom = -10;
        await mounted;
        expect(toolbar.dataset.compact).toBe('false');
    });

    test.each([390, 1920])('dismisses context menus on all scroll owners and releases capture on teardown (%ipx)', async (width) => {
        setViewport(width);
        const added = vi.spyOn(window, 'addEventListener');
        const removed = vi.spyOn(window, 'removeEventListener');
        await mount();
        for (const selector of ['.scrollable_content', '.workline-observatory__board']) {
            container.querySelector('[data-row-actions]').click();
            expect(document.querySelector('.workline-observatory__context-menu')).not.toBeNull();
            document.querySelector(selector).dispatchEvent(new Event('scroll'));
            expect(document.querySelector('.workline-observatory__context-menu')).toBeNull();
        }
        controller.destroy();
        for (const [event, listener, capture] of added.mock.calls.filter(([name]) => name === 'scroll')) {
            expect(removed).toHaveBeenCalledWith(event, listener, capture);
        }
    });
});
