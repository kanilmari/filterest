// multiselect_dropdown_placement.test.js
// Verifies content-aware placement for plain and rich multiselect popups.
// Connects measured fixed controls and option rows to viewport geometry and resize tracking.
// Protects search stability, phone sizing and short-screen scrolling without a browser layout engine.
// @vitest-environment jsdom

import { afterEach, expect, test, vi } from 'vitest';
import { createMultiselectDropdown } from './multiselect_dropdown_builder.js';

const instances = [];
afterEach(() => {
    instances.forEach(instance => instance.destroy());
    instances.length = 0;
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

// Mock only layout measurements; real builder nodes, filtering, listeners and controller code still run.
function mount({ rich = true, below = 300, height = 1000, width = 1440, count = 8,
    callerHeight = 110, rowHeight = rich ? 44 : 28, groupHeight = 0, preserveViewState = rich } = {}) {
    const owner = document.createElement('section');
    const container = document.createElement('div');
    const trigger = document.createElement('button');
    const content = document.createElement('div');
    owner.append(container, trigger);
    document.body.append(owner);
    const dropdown = createMultiselectDropdown({ containerElement: container,
        preserveViewState,
        options: Array.from({ length: count }, (_, index) => ({ value: String(index), label: `Value ${index}`,
            ...(groupHeight ? { groupLabel: 'Group' } : {}) })),
        ...(rich ? { triggerElement: trigger, ownerElement: owner, minPopupWidth: 360,
            popupHeader: { title: 'Heading', showCloseButton: true }, beforeSearchElement: content,
            allowExclude: false } : {}),
    });
    instances.push(dropdown);
    const popup = document.body.lastElementChild;
    const list = popup.querySelector('[role="listbox"]');
    const search = popup.querySelector('.msd-dropdown-search-input');
    popup.style.boxSizing = 'border-box';
    popup.style.padding = rich ? '12px' : '0';
    popup.style.border = '1px solid';
    let fixedCallerHeight = callerHeight;
    let currentRowHeight = rowHeight;
    const margin = rich && width <= 600 ? 16 : 8;
    const anchor = rich ? trigger : container.querySelector('.msd-dropdown-input-row');
    let anchorBottom = height - margin - 4 - below;
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(height);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(width);
    vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(() => ({
        left: 100, width: 140, top: anchorBottom - 44, bottom: anchorBottom, height: 44 }));
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect() {
        const index = [...list.querySelectorAll('[role="option"]')].indexOf(this);
        if (index >= 0) return { top: groupHeight + index * currentRowHeight - list.scrollTop,
            bottom: groupHeight + (index + 1) * currentRowHeight - list.scrollTop, height: currentRowHeight };
        if (this === list) return { top: 0, height: 340, bottom: 340 };
        return { top: 0, bottom: 0, height: this === content ? fixedCallerHeight
            : this.classList.contains('msd-popup-header') ? 44
                : this.classList.contains('msd-dropdown-search') ? rich ? 56 : 30 : 0 };
    });
    return { dropdown, popup, search, list, content,
        fixedHeight: rich ? 126 + callerHeight : 32,
        setCallerHeight: value => { fixedCallerHeight = value; },
        setRowHeight: value => { currentRowHeight = value; },
        setBelow: value => { anchorBottom = height - margin - 4 - value; },
        above: () => anchorBottom - 44 - margin - 4 };
}

test.each([220, 280, 350])('rich fixed content plus three rows flips upward with %i px below', below => {
    const fixture = mount({ below });
    fixture.dropdown.open();
    expect(fixture.popup.classList.contains('msd-dropdown-list--open-upward')).toBe(true);
    expect(fixture.popup.style.top).toBe('');
    expect(fixture.popup.style.bottom).toBe(`${below + 60}px`);
    const popupHeight = Number.parseFloat(fixture.popup.style.maxHeight);
    expect(popupHeight).toBe(400);
    // The first option and the useful three-row minimum fit after all fixed content.
    expect(popupHeight - fixture.fixedHeight).toBeGreaterThanOrEqual(3 * 44);
    expect(fixture.above() - popupHeight).toBeGreaterThanOrEqual(0);
});

test.each([368, 440, 600])('rich popup stays downward when the useful content fits in %i px below', below => {
    const { dropdown, popup } = mount({ below });
    dropdown.open();
    expect(popup.classList.contains('msd-dropdown-list--open-upward')).toBe(false);
    expect(popup.style.top).toBe(`${992 - below}px`);
    expect(popup.style.maxHeight).toBe(`${Math.min(400, below)}px`);
});

test.each([1, 2])('a short rich list requires its whole %i-row list rather than three rows', count => {
    const fixture = mount({ count, below: 325 });
    fixture.dropdown.open();
    expect(fixture.popup.classList.contains('msd-dropdown-list--open-upward')).toBe(false);
    expect(325 - fixture.fixedHeight).toBeGreaterThanOrEqual(count * 44);
});

test('required content is capped at 400 px even when controls and wrapped rows need more', () => {
    const { dropdown, popup } = mount({ callerHeight: 200, rowHeight: 80, below: 440 });
    dropdown.open();
    expect(popup.classList.contains('msd-dropdown-list--open-upward')).toBe(false);
    expect(popup.style.maxHeight).toBe('400px');
});

test('group labels are included in the minimum option extent, independently of list scroll', () => {
    const { dropdown, popup, list } = mount({ below: 380, groupHeight: 30 });
    list.scrollTop = 50;
    dropdown.open();
    expect(popup.classList.contains('msd-dropdown-list--open-upward')).toBe(true);
});

test.each([[600, false, 400], [300, false, 300], [220, false, 220], [180, true, 400]])(
    'plain dropdown preserves placement with %i px below', (below, upward, maxHeight) => {
        const { dropdown, popup } = mount({ rich: false, below });
        dropdown.open();
        expect(popup.classList.contains('msd-dropdown-list--open-upward')).toBe(upward);
        expect(popup.style.maxHeight).toBe(`${maxHeight}px`);
        expect(popup.style.bottom === '').toBe(!upward);
    });

test('plain mode also accounts for unusually tall option rows', () => {
    const { dropdown, popup } = mount({ rich: false, below: 300, rowHeight: 100 });
    dropdown.open();
    expect(popup.classList.contains('msd-dropdown-list--open-upward')).toBe(true);
});

test.each([{ rich: false, mode: 'plain' }, { rich: true, mode: 'category (rich)' }])(
    '$mode mode resamples the restored list when reopening after filtering', async ({ rich }) => {
        vi.useFakeTimers();
        const { dropdown, popup, search, list, fixedHeight } = mount({ rich, below: 300,
            rowHeight: 100, callerHeight: 20, preserveViewState: false });
        dropdown.open();
        expect(list.querySelectorAll('[role="option"]')).toHaveLength(8);
        expect(fixedHeight + 3 * 100).toBeGreaterThan(300);
        expect(popup.classList.contains('msd-dropdown-list--open-upward')).toBe(true);
        for (const query of ['Value 0', 'missing', 'Value 0']) {
            search.value = query;
            search.dispatchEvent(new Event('input'));
            await vi.advanceTimersByTimeAsync(20);
            expect(list.querySelectorAll('[role="option"]')).toHaveLength(query === 'missing' ? 0 : 1);
            // Searching within this opening must keep the full list's budget, even with no matches.
            expect(popup.classList.contains('msd-dropdown-list--open-upward')).toBe(true);
        }
        dropdown.close();
        dropdown.open();
        expect(search.value).toBe('');
        expect(list.querySelectorAll('[role="option"]')).toHaveLength(8);
        expect(popup.classList.contains('msd-dropdown-list--open-upward')).toBe(true);
        await vi.advanceTimersByTimeAsync(20);
        expect(popup.classList.contains('msd-dropdown-list--open-upward')).toBe(true);
    });

test('category mode resamples its preserved filtered list only on reopening', async () => {
    vi.useFakeTimers();
    const { dropdown, popup, search, list } = mount({ rowHeight: 100, callerHeight: 20 });
    dropdown.open();
    search.value = 'Value 0';
    search.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(20);
    expect(popup.classList.contains('msd-dropdown-list--open-upward')).toBe(true);
    dropdown.close();
    dropdown.open();
    expect(search.value).toBe('Value 0');
    expect(list.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(popup.classList.contains('msd-dropdown-list--open-upward')).toBe(false);
    search.value = '';
    search.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(20);
    expect(list.querySelectorAll('[role="option"]')).toHaveLength(8);
    expect(popup.classList.contains('msd-dropdown-list--open-upward')).toBe(false);
    dropdown.close();
    dropdown.open();
    expect(popup.classList.contains('msd-dropdown-list--open-upward')).toBe(true);
});

test.each([{ rich: true, mode: 'category (rich)', rowHeight: 44 },
    { rich: false, mode: 'plain', rowHeight: 100 }])(
    '$mode mode freezes a preserved zero-match opening until close', async ({ rich, rowHeight }) => {
        vi.useFakeTimers();
        const { dropdown, popup, search, list, fixedHeight } = mount({ rich, rowHeight,
            below: 300, preserveViewState: true });
        expect(fixedHeight).toBeLessThanOrEqual(300);
        expect(fixedHeight + 3 * rowHeight).toBeGreaterThan(300);
        dropdown.open();
        expect(popup.classList.contains('msd-dropdown-list--open-upward')).toBe(true);
        search.value = 'missing';
        search.dispatchEvent(new Event('input'));
        await vi.advanceTimersByTimeAsync(20);
        expect(list.querySelectorAll('[role="option"]')).toHaveLength(0);
        expect(popup.classList.contains('msd-dropdown-list--open-upward')).toBe(true);
        dropdown.close();
        dropdown.open();
        expect(search.value).toBe('missing');
        expect(list.querySelectorAll('[role="option"]')).toHaveLength(0);
        expect(popup.classList.contains('msd-dropdown-list--open-upward')).toBe(false);
        await vi.advanceTimersByTimeAsync(20);
        expect(popup.classList.contains('msd-dropdown-list--open-upward')).toBe(false);
        search.value = '';
        search.dispatchEvent(new Event('input'));
        await vi.advanceTimersByTimeAsync(20);
        expect(list.querySelectorAll('[role="option"]')).toHaveLength(8);
        expect(popup.style.display).toBe('flex');
        expect(popup.classList.contains('msd-dropdown-list--open-upward')).toBe(false);
        window.dispatchEvent(new Event('resize'));
        await vi.advanceTimersByTimeAsync(20);
        expect(popup.classList.contains('msd-dropdown-list--open-upward')).toBe(false);
        dropdown.close();
        dropdown.open();
        expect(list.querySelectorAll('[role="option"]')).toHaveLength(8);
        expect(popup.classList.contains('msd-dropdown-list--open-upward')).toBe(true);
        await vi.advanceTimersByTimeAsync(20);
        expect(popup.classList.contains('msd-dropdown-list--open-upward')).toBe(true);
    });

test('when neither side fits, use the larger side and cap its height', () => {
    const fixture = mount({ height: 700, below: 300 });
    fixture.dropdown.open();
    expect(fixture.popup.classList.contains('msd-dropdown-list--open-upward')).toBe(true);
    expect(fixture.popup.style.maxHeight).toBe(`${fixture.above()}px`);
    expect(fixture.above() - fixture.fixedHeight).toBeGreaterThanOrEqual(44);
    fixture.setBelow(330);
    window.dispatchEvent(new Event('resize'));
    // Flush through fake timers in the separate event/observer proof; here closing/reopening positions synchronously.
    fixture.dropdown.close(); fixture.dropdown.open();
    expect(fixture.popup.classList.contains('msd-dropdown-list--open-upward')).toBe(false);
    expect(fixture.popup.style.maxHeight).toBe('330px');
});

test('phone rich popup retains full viewport width and flips above a bottom heading', () => {
    const fixture = mount({ width: 375, height: 667, below: 220 });
    fixture.dropdown.open();
    expect(fixture.popup.style.left).toBe('16px');
    expect(fixture.popup.style.width).toBe('343px');
    expect(fixture.popup.classList.contains('msd-dropdown-list--open-upward')).toBe(true);
    expect(fixture.popup.style.maxHeight).toBe(`${fixture.above()}px`);
    expect(fixture.above() - fixture.fixedHeight).toBeGreaterThanOrEqual(44);
});

test('short visual viewport keeps the existing whole-popup branch and keyboard offsets', () => {
    vi.stubGlobal('visualViewport', { width: 375, height: 180, offsetLeft: 10, offsetTop: 200,
        addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const { dropdown, popup } = mount({ width: 375, height: 1000, below: 690 });
    dropdown.open();
    expect(popup.style.left).toBe('26px');
    expect(popup.style.width).toBe('343px');
    expect(popup.style.top).toBe('216px');
    expect(popup.style.bottom).toBe('');
    expect(popup.style.maxHeight).toBe('148px');
    expect(popup.classList.contains('msd-dropdown-list--open-upward')).toBe(false);
});

test('visual viewport resize and scroll re-evaluate the open popup and detach on close', async () => {
    vi.useFakeTimers();
    const viewport = Object.assign(new EventTarget(), { width: 1440, height: 1000, offsetLeft: 0, offsetTop: 0 });
    vi.stubGlobal('visualViewport', viewport);
    const removeListener = vi.spyOn(viewport, 'removeEventListener');
    const { dropdown, popup } = mount();
    dropdown.open();
    expect(popup.classList.contains('msd-dropdown-list--open-upward')).toBe(true);
    viewport.height = 1300;
    viewport.dispatchEvent(new Event('resize'));
    await vi.advanceTimersByTimeAsync(20);
    expect(popup.classList.contains('msd-dropdown-list--open-upward')).toBe(false);
    viewport.height = 1000; viewport.offsetTop = 300;
    viewport.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(20);
    expect(popup.classList.contains('msd-dropdown-list--open-upward')).toBe(false);
    viewport.offsetTop = 0;
    viewport.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(20);
    expect(popup.classList.contains('msd-dropdown-list--open-upward')).toBe(true);
    dropdown.close();
    expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith('scroll', expect.any(Function));
});

test('content growth repositions a capped popup, while filtering retains its opening option budget', async () => {
    vi.useFakeTimers();
    const observers = [];
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe = vi.fn();
        disconnect = vi.fn();
    });
    const fixture = mount({ below: 300, callerHeight: 20 });
    fixture.dropdown.open();
    expect(fixture.popup.classList.contains('msd-dropdown-list--open-upward')).toBe(false);
    expect(observers[0].observe).toHaveBeenCalledWith(fixture.content);
    fixture.setCallerHeight(110);
    observers[0].callback();
    await vi.advanceTimersByTimeAsync(20);
    expect(fixture.popup.classList.contains('msd-dropdown-list--open-upward')).toBe(true);
    for (const query of ['Value 0', 'missing', '']) {
        fixture.search.value = query;
        fixture.search.dispatchEvent(new Event('input'));
        observers[0].callback();
        await vi.advanceTimersByTimeAsync(20);
        expect(fixture.popup.classList.contains('msd-dropdown-list--open-upward')).toBe(true);
    }
    fixture.search.value = 'Value 0'; fixture.search.dispatchEvent(new Event('input'));
    fixture.dropdown.close();
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
    fixture.dropdown.open();
    expect(fixture.popup.classList.contains('msd-dropdown-list--open-upward')).toBe(false);
    // Taller search results cannot change sides either; reopening resamples the current list.
    fixture.setRowHeight(100); observers[1].callback();
    await vi.advanceTimersByTimeAsync(20);
    expect(fixture.popup.classList.contains('msd-dropdown-list--open-upward')).toBe(false);
    fixture.dropdown.close(); fixture.dropdown.open();
    expect(fixture.popup.classList.contains('msd-dropdown-list--open-upward')).toBe(true);
    fixture.setBelow(500); window.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(20);
    expect(fixture.popup.classList.contains('msd-dropdown-list--open-upward')).toBe(false);
    fixture.setBelow(280); window.dispatchEvent(new Event('resize'));
    await vi.advanceTimersByTimeAsync(20);
    expect(fixture.popup.classList.contains('msd-dropdown-list--open-upward')).toBe(true);
    fixture.dropdown.destroy();
    expect(observers[1].disconnect).toHaveBeenCalledTimes(1);
    expect(observers[2].disconnect).toHaveBeenCalledTimes(1);
});
