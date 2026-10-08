// multiselect_dropdown_popup.test.js
// Verifies opt-in dialog presentation, blocking limits, stable updates and popup ownership.
// Connects shared library configuration to keyboard, focus and accessibility behavior in jsdom.
// Protects existing input defaults while category callers add richer portalled controls.
// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createMultiselectDropdown } from './multiselect_dropdown_builder.js';
import { VIEW_DEACTIVATE_EVENT } from '../view_lifecycle_events.js';

const instances = [];
function mount(config = {}) {
    const owner = document.createElement('section');
    const container = document.createElement('div');
    const trigger = document.createElement('button');
    trigger.textContent = 'Heading';
    owner.append(container, trigger);
    document.body.appendChild(owner);
    const dropdown = createMultiselectDropdown({ containerElement: container,
        options: [{ value: 'zero', label: '<Zero>', count: 0, dimmed: true }, { value: 'hit', label: 'Hit', count: 3 }],
        ...config,
        ...(config.external ? { triggerElement: trigger, ownerElement: owner,
            popupHeader: { title: 'Heading', showCloseButton: true }, allowExclude: false } : {}),
    });
    instances.push(dropdown);
    const popup = document.querySelectorAll('.msd-dropdown-list')[instances.length - 1];
    return { owner, container, trigger, dropdown, popup, search: popup.querySelector('input'),
        rows: () => [...popup.querySelectorAll('[role="option"]')] };
}

beforeEach(() => { document.body.replaceChildren(); });
afterEach(() => { instances.forEach(instance => instance.destroy()); instances.length = 0; vi.restoreAllMocks(); });

test('default input presentation resets search on reopen and leaves count-free options unchanged', () => {
    const { dropdown, container, popup, search } = mount({ options: [{ value: 'a', label: 'Alpha' }] });
    expect(container.querySelector('[role="combobox"]')).not.toBeNull();
    expect(popup.hasAttribute('role')).toBe(false);
    expect(popup.classList.contains('msd-dropdown-list--rich')).toBe(false);
    expect(popup.querySelector('.msd-option-count').hidden).toBe(true);
    dropdown.open(); search.value = 'missing'; search.dispatchEvent(new Event('input'));
    dropdown.close(); dropdown.open();
    expect(search.value).toBe('');
    expect(popup.querySelector('[role="option"]')).not.toBeNull();
});

test('external trigger opens a named nonmodal dialog with one include target, safe counts and a caller slot', () => {
    const content = document.createElement('div');
    const hint = document.createElement('p'); hint.id = 'hint'; hint.textContent = 'Match guidance'; content.append(hint);
    const { dropdown, container, trigger, popup, rows, search } = mount({ external: true,
        beforeSearchElement: content, popupDescriptionId: hint.id, closeLabel: 'Sulje', preserveViewState: true });
    expect(container.querySelector('input')).toBeNull();
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-controls')).toBe(popup.id);
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(search);
    expect(popup.getAttribute('role')).toBe('dialog');
    expect(popup.getAttribute('aria-modal')).toBe('false');
    expect(document.getElementById(popup.getAttribute('aria-labelledby')).textContent).toBe('Heading');
    expect(popup.getAttribute('aria-describedby')).toBe('hint');
    const listbox = popup.querySelector('[role="listbox"]');
    expect(listbox.getAttribute('aria-labelledby')).toBe(popup.getAttribute('aria-labelledby'));
    expect(listbox.getAttribute('aria-describedby')).toBe('hint');
    expect(listbox.getAttribute('aria-multiselectable')).toBe('true');
    expect(content.parentElement).toBe(popup);
    expect(content.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rows()[0].getAttribute('aria-label')).toBe('<Zero>: 0');
    expect(rows()[0].querySelector('.msd-option-count').textContent).toBe('0');
    expect(popup.querySelector('zero')).toBeNull();
    expect(rows()[0].querySelector('button')).toBeNull();
    expect(rows()[0].querySelector('.msd-option-checkbox').getAttribute('aria-hidden')).toBe('true');
    expect(rows()[0].hasAttribute('aria-disabled')).toBe(false);
    rows()[0].click();
    expect(dropdown.getValue()).toEqual(['zero']);
    expect(rows()[0].classList.contains('msd-option--dimmed')).toBe(true);
});

test('invalid counts render neither visual count nor count in accessible names', () => {
    const { rows } = mount({ options: [-1, 0.5, Infinity, '2', Number.MAX_SAFE_INTEGER + 1]
        .map((count, i) => ({ value: String(i), label: 'Value', count })) });
    rows().forEach(row => {
        expect(row.getAttribute('aria-label')).toBe('Value');
        expect(row.querySelector('.msd-option-count').hidden).toBe(true);
    });
});

test('blocking limit counts includes locally, never evicts or emits on refused activation, and allows removal', () => {
    const onChange = vi.fn();
    const { dropdown, rows } = mount({ external: true, selectionLimit: { max: 1 }, onChange });
    rows()[0].click(); rows()[1].click();
    expect(dropdown.getValue()).toEqual(['zero']);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(rows()[1].getAttribute('aria-disabled')).toBe('true');
    rows()[0].click(); rows()[1].click();
    expect(dropdown.getValue()).toEqual(['hit']);
    expect(onChange).toHaveBeenCalledTimes(3);
});

test('authoritative limits include values absent from the heading, and excluded values do not count locally', () => {
    let total = 20;
    const onChange = vi.fn();
    const { dropdown, rows } = mount({ external: true, selectionLimit: { max: 20, getSelectionCount: () => total }, onChange,
        initialState: { includeValues: ['zero'] } });
    rows()[1].click(); expect(onChange).not.toHaveBeenCalled();
    rows()[0].click(); expect(dropdown.getValue()).toEqual([]);
    total = 19; dropdown.setValue([]); rows()[1].click();
    expect(dropdown.getValue()).toEqual(['hit']);
    const other = mount({ selectionLimit: { max: 1 }, initialState: { excludeValues: ['hit'] } });
    other.rows()[0].click(); expect(other.dropdown.getValue()).toEqual(['zero']);
});

test('an excluded value remains removable when included selections reach the blocking limit', () => {
    const { dropdown, rows } = mount({ selectionLimit: { max: 1 },
        initialState: { includeValues: ['zero'], excludeValues: ['hit'] } });
    expect(rows()[1].hasAttribute('aria-disabled')).toBe(false);
    rows()[1].querySelector('.msd-option-checkbox').click();
    expect(dropdown.getState()).toEqual({ includeValues: ['zero'], excludeValues: [] });
});

test('rejects ambiguous blocking and replacement limits', () => {
    const container = document.createElement('div'); document.body.append(container);
    expect(() => createMultiselectDropdown({ containerElement: container, maxSelections: 1, selectionLimit: { max: 20 } })).toThrow(/cannot be combined/);
    expect(() => createMultiselectDropdown({ containerElement: container, selectionLimit: { max: 0 } })).toThrow(/positive/);
});

test('preserved query, scroll, option focus and search caret survive updates and reopening', () => {
    const { dropdown, popup, rows, search } = mount({ external: true, preserveViewState: true });
    dropdown.open(); search.value = 'i'; search.dispatchEvent(new Event('input')); search.setSelectionRange(1, 1);
    const row = rows()[0]; row.focus();
    popup.querySelector('[role="listbox"]').scrollTop = 87;
    dropdown.setOptions([{ value: 'hit', label: 'Hit translated', count: 4 }]);
    dropdown.setValue(['hit']);
    expect(rows()[0]).toBe(row); expect(document.activeElement).toBe(row);
    expect(row.getAttribute('aria-label')).toBe('Hit translated: 4');
    expect(popup.querySelector('[role="listbox"]').scrollTop).toBe(87);
    dropdown.close(); dropdown.open();
    expect(search.value).toBe('i'); expect(search.selectionStart).toBe(1);
    dropdown.setOptions([]); expect(document.activeElement).toBe(search);
    expect(popup.querySelector('[role="status"]').hidden).toBe(false);
    expect(popup.querySelector('[role="listbox"] [role="status"]')).toBeNull();
});

test('language-only options and labels refresh default callers without callbacks or replacing focus', () => {
    const onChange = vi.fn(); const onSearch = vi.fn();
    const { dropdown, search, rows } = mount({ onChange, onSearch });
    dropdown.open(); onSearch.mockClear(); search.value = 'i'; search.dispatchEvent(new Event('input'));
    const row = rows()[0]; row.focus(); dropdown.setValue(['hit']);
    const currentRow = rows()[0]; currentRow.focus();
    dropdown.setLabels({ searchPlaceholder: 'Haku', clearLabel: 'Tyhjennä valinta', noResultsLabel: 'Ei tuloksia' });
    dropdown.setOptions([{ value: 'hit', label: 'Osuma i' }], { preserveViewState: true });
    expect(rows()[0]).toBe(currentRow); expect(document.activeElement).toBe(currentRow);
    expect(search.value).toBe('i'); expect(search.placeholder).toBe('Haku');
    expect(dropdown.getValue()).toEqual(['hit']); expect(onChange).not.toHaveBeenCalled();
});

test('Escape from caller radios and header close return focus with accurate transition reasons', () => {
    const content = document.createElement('div'); const radio = document.createElement('input'); radio.type = 'radio'; content.append(radio);
    const onOpen = vi.fn(); const onClose = vi.fn();
    const { dropdown, trigger, popup } = mount({ external: true, beforeSearchElement: content, onOpen, onClose });
    dropdown.open(); dropdown.open(); radio.focus(); radio.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).toBe(trigger); expect(onClose).toHaveBeenLastCalledWith({ reason: 'escape' });
    dropdown.close(); expect(onClose).toHaveBeenCalledTimes(1); expect(onOpen).toHaveBeenCalledTimes(1);
    dropdown.open(); const close = popup.querySelector('.msd-popup-close'); close.focus();
    dropdown.setLabels({ popupTitle: 'Otsikko', closeLabel: 'Sulje' });
    expect(document.activeElement).toBe(close); expect(close.getAttribute('aria-label')).toBe('Sulje'); expect(close.title).toBe('Sulje');
    close.click(); expect(document.activeElement).toBe(trigger); expect(onClose).toHaveBeenLastCalledWith({ reason: 'close-button' });
    dropdown.open(); trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onClose).toHaveBeenLastCalledWith({ reason: 'trigger' });
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    trigger.click(); expect(onClose).toHaveBeenLastCalledWith({ reason: 'trigger' });
    dropdown.open(); document.body.click(); expect(onClose).toHaveBeenLastCalledWith({ reason: 'outside' });
    dropdown.open(); dropdown.close({ returnFocus: true }); expect(onClose).toHaveBeenLastCalledWith({ reason: 'programmatic' });
});

test('option keys preserve local navigation and Tab exits to the following page control', () => {
    const { dropdown, trigger, search, rows, popup } = mount({ external: true, preserveViewState: true });
    const next = document.createElement('button'); next.textContent = 'Next'; trigger.after(next);
    vi.spyOn(next, 'getClientRects').mockReturnValue([{}]); vi.spyOn(trigger, 'getClientRects').mockReturnValue([{}]);
    dropdown.open(); search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(rows()[0]);
    rows()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(rows()[1]);
    rows()[1].dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(dropdown.getValue()).toEqual(['hit']); expect(document.activeElement).toBe(rows()[1]);
    rows()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })); expect(document.activeElement).toBe(rows()[0]);
    rows()[1].focus(); rows()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(popup.style.display).toBe('none'); expect(document.activeElement).toBe(next);
    dropdown.open(); const close = popup.querySelector('button'); close.focus();
    close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })); expect(document.activeElement).toBe(trigger);
});

test('an opening key on an open dropdown returns to search, with a fresh query for callers that do not preserve it', () => {
    const onOpen = vi.fn();
    const { dropdown, container, search } = mount({ onOpen, options: [{ value: 'a', label: 'Alpha' }] });
    const input = container.querySelector('[role="combobox"]');
    dropdown.open(); search.value = 'alp'; search.dispatchEvent(new Event('input'));
    input.focus(); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(search); expect(search.value).toBe(''); expect(onOpen).toHaveBeenCalledTimes(1);
    const rich = mount({ external: true, preserveViewState: true, onOpen });
    rich.dropdown.open(); rich.search.value = 'i'; rich.search.dispatchEvent(new Event('input'));
    rich.trigger.focus(); rich.trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(rich.search); expect(rich.search.value).toBe('i'); expect(onOpen).toHaveBeenCalledTimes(2);
});

test('Escape inside a popup closes only that popup, so a surrounding form or modal stays open', () => {
    const outer = vi.fn(); document.addEventListener('keydown', outer);
    const { dropdown, container, popup, search, rows } = mount({ options: [{ value: 'a', label: 'Alpha' }] });
    dropdown.open(); search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(popup.style.display).toBe('none'); expect(document.activeElement).toBe(container.querySelector('[role="combobox"]'));
    dropdown.open(); rows()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(popup.style.display).toBe('none');
    expect(outer).not.toHaveBeenCalled();
    document.removeEventListener('keydown', outer);
});

test('keys on an exclude action reach the action instead of toggling the value', () => {
    const { dropdown, rows } = mount({ options: [{ value: 'a', label: 'Alpha' }] });
    dropdown.open();
    const action = rows()[0].querySelector('.msd-option-action');
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    action.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false); expect(dropdown.getState()).toEqual({ includeValues: [], excludeValues: [] });
    action.click(); expect(dropdown.getState()).toEqual({ includeValues: [], excludeValues: ['a'] });
});

test('keyboard focus reveals an option inside a popup that scrolls as a whole on a short screen', () => {
    const { dropdown, popup, rows, search } = mount({ external: true, preserveViewState: true });
    const listbox = popup.querySelector('[role="listbox"]');
    dropdown.open();
    popup.style.overflowY = 'auto';
    vi.spyOn(popup, 'getBoundingClientRect').mockReturnValue({ top: 16, bottom: 334 });
    vi.spyOn(listbox, 'getBoundingClientRect').mockReturnValue({ top: 200, bottom: 600 });
    vi.spyOn(rows()[0], 'getBoundingClientRect').mockReturnValue({ top: 220, bottom: 264 });
    vi.spyOn(rows()[1], 'getBoundingClientRect').mockReturnValue({ top: 556, bottom: 600 });
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(popup.scrollTop).toBe(0);
    rows()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(rows()[1]);
    expect(listbox.scrollTop).toBe(0); expect(popup.scrollTop).toBe(266);
});

test('focus returning to search is revealed inside a popup that scrolls as a whole', () => {
    const { dropdown, trigger, popup, rows, search } = mount({ external: true, preserveViewState: true });
    popup.style.overflowY = 'auto';
    vi.spyOn(popup, 'getBoundingClientRect').mockReturnValue({ top: 16, bottom: 334 });
    const searchBox = vi.spyOn(search, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 144 });
    popup.scrollTop = 256;
    dropdown.open();
    expect(popup.scrollTop).toBe(0); expect(document.activeElement).toBe(search);
    // After End scrolled the popup, search sits above its visible top: an opening key on the open trigger reveals it.
    popup.scrollTop = 256; searchBox.mockReturnValue({ top: -53, bottom: -9 });
    trigger.focus(); trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(search); expect(popup.scrollTop).toBe(187);
    // So does the fallback when the focused option disappears in a preserved update.
    popup.scrollTop = 256; rows()[1].focus();
    dropdown.setOptions([{ value: 'zero', label: '<Zero>', count: 0 }]);
    expect(document.activeElement).toBe(search); expect(popup.scrollTop).toBe(187);
});

test('a preserved update that moves the focused option reveals it, and one that does not keeps both scrolls', () => {
    const { dropdown, popup, rows } = mount({ external: true, preserveViewState: true });
    const listbox = popup.querySelector('[role="listbox"]');
    dropdown.open();
    popup.style.overflowY = 'auto';
    vi.spyOn(popup, 'getBoundingClientRect').mockReturnValue({ top: 16, bottom: 334 });
    vi.spyOn(listbox, 'getBoundingClientRect').mockReturnValue({ top: -150, bottom: 340 });
    const hit = rows()[1];
    const hitBox = vi.spyOn(hit, 'getBoundingClientRect').mockReturnValue({ top: 290, bottom: 334 });
    // As after End: the last option at the popup's bottom, both containers scrolled.
    hit.focus(); popup.scrollTop = 270; listbox.scrollTop = 100;
    dropdown.setOptions([{ value: 'zero', label: '<Zero>', count: 1 }, { value: 'hit', label: 'Hit', count: 3 }]);
    expect(document.activeElement).toBe(hit); expect(popup.scrollTop).toBe(270); expect(listbox.scrollTop).toBe(100);
    // A reordering update moves it above the popup's visible top.
    hitBox.mockReturnValue({ top: -106, bottom: -62 });
    dropdown.setOptions([{ value: 'hit', label: 'Hit', count: 3 }, { value: 'zero', label: '<Zero>', count: 1 }]);
    expect(rows()[0]).toBe(hit); expect(document.activeElement).toBe(hit);
    expect(listbox.scrollTop).toBe(100); expect(popup.scrollTop).toBe(148);
});

test('a preserved update reveals focus anywhere in the popup, such as search pushed down by caller content', () => {
    const notice = document.createElement('p');
    const { dropdown, popup, search } = mount({ external: true, preserveViewState: true, beforeSearchElement: notice });
    dropdown.open();
    popup.style.overflowY = 'auto';
    vi.spyOn(popup, 'getBoundingClientRect').mockReturnValue({ top: 16, bottom: 334 });
    let shift = 0;
    vi.spyOn(search, 'getBoundingClientRect').mockImplementation(() => ({
        top: 290 + shift - popup.scrollTop, bottom: 334 + shift - popup.scrollTop }));
    search.focus();
    dropdown.setOptions([{ value: 'hit', label: 'Hit', count: 4 }]);
    expect(popup.scrollTop).toBe(0);
    // A caller notice above search appears (for example the selection limit) and pushes search below the bottom.
    shift = 40;
    dropdown.setOptions([{ value: 'hit', label: 'Hit', count: 5 }]);
    expect(document.activeElement).toBe(search); expect(popup.scrollTop).toBe(40);
});

test('cleanup after the window lost its methods, as in a torn-down test environment, does not throw', () => {
    const { dropdown } = mount({ external: true });
    dropdown.open();
    // The test environment keeps the method as the global's own property, so put the original back afterwards.
    const original = window.removeEventListener;
    window.removeEventListener = undefined;
    try { expect(() => dropdown.destroy()).not.toThrow(); } finally { window.removeEventListener = original; }
    expect(typeof window.removeEventListener).toBe('function');
});

test('explicit owner preserves transient detached anchors and destroys closed or open instances on removal', async () => {
    const { dropdown, container, owner, trigger, popup } = mount({ external: true, preserveViewState: true });
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ left: 40, width: 100, top: 80, bottom: 124 });
    dropdown.open(); const left = popup.style.left;
    container.remove(); trigger.remove();
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(popup.isConnected).toBe(true); expect(popup.style.left).toBe(left);
    owner.append(container, trigger); await new Promise(resolve => setTimeout(resolve, 25));
    expect(container.__dropdown).toBe(dropdown);
    dropdown.close(); owner.remove();
    await vi.waitFor(() => expect(popup.isConnected).toBe(false)); expect(container.__dropdown).toBeUndefined();
});

test('deactivation and destruction close once without stealing focus', () => {
    document.body.innerHTML = '<div id="tabs_container"></div>';
    const onClose = vi.fn(); const { owner, dropdown, popup } = mount({ external: true, onClose });
    owner.className = 'content_div'; document.getElementById('tabs_container').append(owner);
    // Ownership listeners bind at construction; use an owner already in the view for deactivation.
    dropdown.destroy();
    const container = document.createElement('div'); owner.append(container);
    const viewDropdown = createMultiselectDropdown({ containerElement: container, ownerElement: owner, options: [], onClose });
    const other = document.createElement('button'); document.body.append(other); other.focus();
    viewDropdown.open(); other.focus(); owner.dispatchEvent(new CustomEvent(VIEW_DEACTIVATE_EVENT));
    expect(onClose).toHaveBeenLastCalledWith({ reason: 'deactivate' }); expect(document.activeElement).toBe(other);
    viewDropdown.open(); other.focus(); viewDropdown.destroy();
    expect(onClose).toHaveBeenLastCalledWith({ reason: 'destroy' }); expect(document.activeElement).toBe(other);
    expect(popup.isConnected).toBe(false);
});

test('rich geometry bounds desktop and phone widths and short visual viewports', () => {
    const { dropdown, trigger, popup } = mount({ external: true, minPopupWidth: 360 });
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ left: 200, width: 90, top: 100, bottom: 144 });
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(601);
    dropdown.open(); expect(popup.style.width).toBe('360px'); dropdown.close();
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(320);
    dropdown.open(); expect(popup.style.width).toBe('288px'); expect(popup.style.left).toBe('16px'); dropdown.close();
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: { width: 375, height: 180, offsetTop: 0,
        addEventListener: vi.fn(), removeEventListener: vi.fn() } });
    dropdown.open(); expect(popup.style.width).toBe('343px'); expect(popup.style.top).toBe('16px'); expect(popup.style.maxHeight).toBe('148px');
    delete window.visualViewport;
});

test('a rich popup whose anchor has left a short view stays inside the view', () => {
    const { dropdown, trigger, popup } = mount({ external: true, minPopupWidth: 360 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: { width: 375, height: 350, offsetTop: 0,
        addEventListener: vi.fn(), removeEventListener: vi.fn() } });
    // The heading sits below a 350 px view, as when the window shrinks or an on-screen keyboard opens.
    const rect = vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ left: 20, width: 120, top: 500, bottom: 544 });
    dropdown.open();
    expect(popup.style.top).toBe('16px');
    expect(popup.style.bottom).toBe('');
    expect(popup.style.maxHeight).toBe('318px');
    dropdown.close();
    // Above the view as well.
    rect.mockReturnValue({ left: 20, width: 120, top: -200, bottom: -156 });
    dropdown.open();
    expect(popup.style.top).toBe('16px');
    expect(popup.style.maxHeight).toBe('318px');
    dropdown.close();
    delete window.visualViewport;
    // A desktop page scrolled past the heading keeps the popup in view at its usual height, not the view's.
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(1000);
    dropdown.open();
    expect(popup.style.top).toBe('8px');
    expect(popup.style.maxHeight).toBe('400px');
});
