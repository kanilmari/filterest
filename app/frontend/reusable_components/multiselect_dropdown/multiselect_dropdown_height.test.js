// multiselect_dropdown_height.test.js
// Exercises pointer/keyboard resizing and optional viewer-local height persistence.
// Connects the real shared builder and placement listeners to mocked viewport measurements.
// Protects plain callers, short screens and teardown when storage is unavailable.
// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createMultiselectDropdown } from './multiselect_dropdown_builder.js';

const instances = [];
beforeEach(() => {
    localStorage.clear();
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(1000);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1440);
});
afterEach(() => {
    instances.forEach(instance => instance.destroy()); instances.length = 0;
    document.body.replaceChildren(); vi.restoreAllMocks(); vi.useRealTimers(); localStorage.clear();
});

function mount(rich = true, bottom = 100) {
    const container = document.createElement('div');
    document.body.append(container);
    const dropdown = createMultiselectDropdown({ containerElement: container,
        popupHeader: rich ? { title: 'Luokitus', showCloseButton: true } : null,
        placeholder: 'Valitse', options: Array.from({ length: 30 }, (_, index) => ({ value: String(index), label: `Arvo ${index}` })),
    });
    instances.push(dropdown);
    vi.spyOn(container.querySelector('.msd-dropdown-input-row'), 'getBoundingClientRect')
        .mockReturnValue({ top: bottom - 44, bottom, left: 20, width: 300 });
    const popup = document.body.lastElementChild;
    if (rich) vi.spyOn(popup.querySelector('.msd-popup-header'), 'getBoundingClientRect').mockReturnValue({ height: 100 });
    dropdown.open();
    return { dropdown, popup, handle: popup.querySelector('.msd-popup-resize') };
}

function key(handle, value) {
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
}
function pointer(target, type, y, id = 1) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { pointerId: id, button: 0, clientY: y });
    target.dispatchEvent(event);
}

test.each([true, false])('screen-sized default and keyboard resize stay within bounds (rich: %s)', rich => {
    const { popup, handle } = mount(rich);
    expect(Number.parseFloat(popup.style.maxHeight)).toBeLessThanOrEqual(600);
    expect(handle.getAttribute('role')).toBe('separator');
    expect(handle.getAttribute('aria-orientation')).toBe('horizontal');
    expect(handle.tabIndex).toBe(0);
    expect(handle.getAttribute('aria-controls')).toBe(popup.id);
    handle.focus(); key(handle, 'ArrowUp');
    expect(popup.style.height).toBe('580px');
    key(handle, 'End'); expect(handle.getAttribute('aria-valuenow')).toBe('600');
    key(handle, 'ArrowDown'); expect(handle.getAttribute('aria-valuenow')).toBe('600');
    key(handle, 'Home'); expect(handle.getAttribute('aria-valuenow')).toBe(handle.getAttribute('aria-valuemin'));
    key(handle, 'ArrowUp'); expect(handle.getAttribute('aria-valuenow')).toBe(handle.getAttribute('aria-valuemin'));
    expect(document.activeElement).toBe(handle);
    if (!rich) {
        const dropdown = instances.at(-1); dropdown.setLabels({ placeholder: 'Select' });
        expect(handle.getAttribute('aria-label')).toBe('Select');
    }
});

test('pointer resizing follows drag direction and stores only this popup kind', () => {
    const { popup, handle, dropdown } = mount();
    pointer(handle, 'pointerdown', 600);
    pointer(window, 'pointermove', 460, 2); // Ignore unrelated touches.
    expect(popup.style.height).toBe('');
    pointer(window, 'pointermove', 460);
    expect(popup.style.height).toBe('460px');
    pointer(window, 'pointerup', 460);
    expect(localStorage.getItem('filterest.multiselect.height.rich')).toBe('460');
    dropdown.close(); dropdown.open(); expect(popup.style.height).toBe('460px');
    const another = mount(); expect(another.popup.style.height).toBe('460px');
    const plain = mount(false); expect(plain.popup.style.height).toBe('');
    expect(localStorage.getItem('filterest.multiselect.height.plain')).toBeNull();
});

test('upward resizing reverses pointer/arrow direction while preserving the anchor edge', () => {
    const { popup, handle } = mount(true, 900);
    const bottom = popup.style.bottom;
    key(handle, 'ArrowDown'); expect(handle.getAttribute('aria-valuenow')).toBe('580');
    pointer(handle, 'pointerdown', 500); pointer(window, 'pointermove', 460); pointer(window, 'pointerup', 460);
    expect(handle.getAttribute('aria-valuenow')).toBe('600');
    expect(popup.style.bottom).toBe(bottom);
});

test.each(['getItem', 'setItem'])('resize works when storage %s throws', operation => {
    vi.spyOn(Storage.prototype, operation).mockImplementation(() => { throw new Error('Storage denied'); });
    const { popup, handle, dropdown } = mount();
    expect(() => key(handle, 'ArrowUp')).not.toThrow();
    const height = popup.style.height;
    dropdown.close(); expect(() => dropdown.open()).not.toThrow();
    expect(popup.style.height).toBe(height);
});

test('resize works even when accessing localStorage itself throws', () => {
    const denied = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('Denied'); });
    const { handle, dropdown } = mount();
    expect(() => key(handle, 'ArrowUp')).not.toThrow();
    dropdown.close(); expect(() => dropdown.open()).not.toThrow();
    denied.mockRestore();
});

test.each(['NaN', '-1', '601', 'Infinity', ''])('ignores an invalid stored height: %s', stored => {
    localStorage.setItem('filterest.multiselect.height.rich', stored);
    expect(mount().popup.style.height).toBe('');
});

test('viewport shrink clamps a stored height without overwriting the viewer preference', async () => {
    vi.useFakeTimers();
    localStorage.setItem('filterest.multiselect.height.rich', '540');
    const { popup, handle } = mount();
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(200);
    window.dispatchEvent(new Event('resize')); await vi.advanceTimersByTimeAsync(20);
    expect(Number.parseFloat(popup.style.height)).toBeLessThanOrEqual(184);
    expect(Number(handle.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(Number(handle.getAttribute('aria-valuemax')));
    expect(localStorage.getItem('filterest.multiselect.height.rich')).toBe('540');
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(1000);
    window.dispatchEvent(new Event('resize')); await vi.advanceTimersByTimeAsync(20);
    expect(popup.style.height).toBe('540px');
});

test.each(['close', 'destroy'])('%s removes an unfinished drag and viewport listeners', action => {
    const { popup, handle, dropdown } = mount();
    const remove = vi.spyOn(window, 'removeEventListener');
    pointer(handle, 'pointerdown', 600);
    dropdown[action]();
    const height = popup.style.height;
    pointer(window, 'pointermove', 460); pointer(window, 'pointerup', 460);
    expect(popup.style.height).toBe(height);
    expect(remove).toHaveBeenCalledWith('pointermove', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('pointerup', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('pointercancel', expect.any(Function));
});
