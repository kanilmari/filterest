// @vitest-environment jsdom
// modal_backdrop.test.js
// Exercises singleton and stacked dialog dismissal with native pointer and assistive events.
// Connects the public modal options to draft retention, cancellation and close controls.
// Prevents form selections and login backdrop clicks from losing pending input.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createModal, createStackedModal, hideModal, showModal } from './modal_builder.js';
import { showConfirmModal, showInputModal } from './confirm_modal_builder.js';

vi.mock('../../icons/icon_loader.js', () => ({ setElementSvgContent: vi.fn() }));
function pointer(target, type, options = {}) {
    target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, ...options,
    }));
}
function leavePointerHistory(overlay, ending) {
    pointer(overlay, 'pointerdown');
    if (ending === 'cancel') pointer(overlay, 'pointercancel');
    else {
        pointer(overlay, 'pointerup');
        if (ending === 'stopped click') {
            // An earlier capture listener may consume the click before the overlay sees it.
            document.addEventListener('click', event => event.stopPropagation(), { capture: true, once: true });
            pointer(overlay, 'click', { detail: 1 });
        }
    }
}
function open(stacked = false, options = {}) {
    const field = document.createElement('input');
    field.value = 'unsaved text';
    const base = createModal({ titlePlainText: 'Edit', contentElements: stacked ? [] : [field], ...(stacked ? {} : options) });
    showModal();
    const dialog = stacked ? createStackedModal({ titlePlainText: 'Pick', contentElements: [field], ...options }) : base;
    if (stacked) dialog.show();
    const overlay = dialog.modal_overlay;
    return { field, overlay, base: base.modal_overlay, isOpen: () => overlay.isConnected && overlay.getAttribute('aria-hidden') === 'false' };
}
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { hideModal({ immediate: true }); vi.runAllTimers(); document.body.replaceChildren(); vi.useRealTimers(); });

describe.each([false, true])('backdrop of stacked=%s', stacked => {
    test.each(['mouse', 'touch'])('%s selection ending outside preserves the draft; a fresh tap closes just this layer', pointerType => {
        const { field, overlay, base, isOpen } = open(stacked);
        pointer(field, 'pointerdown', { pointerType });
        pointer(overlay, 'pointerup', { pointerType });
        pointer(overlay, 'click', { pointerType });
        expect(isOpen()).toBe(true);
        expect(field.value).toBe('unsaved text');
        for (const type of ['pointerdown', 'pointerup', 'click']) pointer(overlay, type, { pointerType });
        expect(isOpen()).toBe(false);
        if (stacked) expect(base.getAttribute('aria-hidden')).toBe('false');
    });
    test('canceled, unmatched and incomplete pointer clicks cannot close the dialog; the close button still works', () => {
        const { overlay, isOpen } = open(stacked);
        pointer(overlay, 'click');
        pointer(overlay, 'pointerdown'); pointer(overlay, 'pointercancel');
        pointer(overlay, 'pointerup'); pointer(overlay, 'click');
        pointer(overlay, 'pointerdown'); pointer(overlay, 'pointerup', { pointerId: 8 }); pointer(overlay, 'click');
        expect(isOpen()).toBe(true);
        overlay.querySelector('.modal_close_button').click();
        expect(isOpen()).toBe(false);
    });
    test('activation without pointer history can still dismiss ordinary dialogs', () => {
        const { overlay, isOpen } = open(stacked);
        overlay.click();
        expect(isOpen()).toBe(false);
    });
    test.each(['cancel', 'release', 'stopped click'])('assistive activation after %s dismisses and reaches false/null cancel listeners', async ending => {
        for (const cancelValue of [false, null]) {
            const { overlay, isOpen } = open(stacked);
            const canceled = vi.fn();
            const answer = new Promise(resolve => {
                overlay.addEventListener('click', () => resolve(cancelValue), { once: true });
            });
            answer.then(canceled);
            leavePointerHistory(overlay, ending);
            expect(isOpen()).toBe(true);
            expect(canceled).not.toHaveBeenCalled();
            overlay.click();
            await Promise.resolve();
            expect(isOpen()).toBe(false);
            expect(canceled).toHaveBeenCalledExactlyOnceWith(cancelValue);
        }
    });
    test.each(['cancel', 'release'])('a new dialog accepts its first assistive activation after the previous dialog %s', ending => {
        const previous = open();
        leavePointerHistory(previous.overlay, ending);
        const next = open(stacked);
        const canceled = vi.fn();
        next.overlay.addEventListener('click', canceled);
        next.overlay.click();
        expect(next.isOpen()).toBe(false);
        expect(canceled).toHaveBeenCalledOnce();
    });
    test.each(['mouse', 'touch', 'legacy mouse'])('%s clicks after cancel or drag-out stay rejected with positive detail', pointerType => {
        const { field, overlay, isOpen } = open(stacked);
        const canceled = vi.fn();
        overlay.addEventListener('click', canceled);
        const click = () => pointerType === 'legacy mouse'
            ? overlay.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, button: 0 }))
            : pointer(overlay, 'click', { pointerType, detail: 1 });
        pointer(field, 'pointerdown', { pointerType });
        pointer(overlay, 'pointerup', { pointerType });
        click();
        expect(isOpen()).toBe(true);
        leavePointerHistory(overlay, 'cancel');
        click();
        expect(isOpen()).toBe(true);
        expect(canceled).not.toHaveBeenCalled();
        overlay.querySelector('.modal_close_button').click();
    });
    test.each(['close', 'escape'])('opted-out backdrop preserves its draft until %s', action => {
        const { field, overlay, isOpen } = open(stacked, { closeOnBackdrop: false });
        const cancel = vi.fn();
        overlay.addEventListener('click', cancel);
        for (const type of ['pointerdown', 'pointerup', 'click']) pointer(overlay, type);
        leavePointerHistory(overlay, 'cancel');
        overlay.click();
        expect(isOpen()).toBe(true);
        expect(field.value).toBe('unsaved text');
        expect(cancel).not.toHaveBeenCalled();
        if (action === 'escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        else overlay.querySelector('.modal_close_button').click();
        expect(isOpen()).toBe(false);
    });
});

describe.each([
    ['confirmation', showConfirmModal, false],
    ['text input', showInputModal, null],
])('%s prompt cancellation', (_name, showPrompt, cancelValue) => {
    test.each(['cancel', 'release', 'replacement'])('first assistive activation after %s resolves cancellation', async ending => {
        if (ending === 'replacement') {
            const previous = open();
            leavePointerHistory(previous.overlay, 'cancel');
        }
        const answer = showPrompt();
        const canceled = vi.fn();
        answer.then(canceled);
        const overlay = document.getElementById('custom_modal_overlay');
        if (ending !== 'replacement') leavePointerHistory(overlay, ending);
        overlay.click();
        await Promise.resolve();
        expect(overlay.getAttribute('aria-hidden')).toBe('true');
        expect(canceled).toHaveBeenCalledExactlyOnceWith(cancelValue);
    });
});

test('a later singleton dialog gets its own default backdrop policy', () => {
    const login = open(false, { closeOnBackdrop: false });
    login.overlay.click();
    expect(login.isOpen()).toBe(true);
    const ordinary = open();
    ordinary.overlay.click();
    expect(ordinary.isOpen()).toBe(false);
});
test('touch released over a form despite implicit capture on the backdrop does not dismiss it', () => {
    const { field, overlay, isOpen } = open();
    const prior = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => field });
    try {
        for (const type of ['pointerdown', 'pointerup', 'click']) pointer(overlay, type, { pointerType: 'touch' });
        expect(isOpen()).toBe(true);
    } finally {
        if (prior) Object.defineProperty(document, 'elementFromPoint', prior);
        else delete document.elementFromPoint;
    }
});
test('a gesture started on the previous dialog cannot close its replacement', () => {
    const first = open();
    pointer(first.overlay, 'pointerdown');
    const next = open();
    pointer(next.overlay, 'pointerup'); pointer(next.overlay, 'click');
    expect(next.isOpen()).toBe(true);
});
test('input prompt does not resolve as canceled when selection ends on its overlay', async () => {
    const answer = showInputModal({ titlePlainText: 'Name', labelPlainText: 'Name' });
    const field = document.querySelector('[data-testid="input-modal-input"]');
    const overlay = document.getElementById('custom_modal_overlay');
    field.value = 'still my draft';
    pointer(field, 'pointerdown'); pointer(overlay, 'pointerup'); pointer(overlay, 'click');
    expect(overlay.getAttribute('aria-hidden')).toBe('false');
    document.querySelector('[data-testid="input-modal-confirm-button"]').click();
    await expect(answer).resolves.toBe('still my draft');
});
