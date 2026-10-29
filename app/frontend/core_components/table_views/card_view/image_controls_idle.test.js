// image_controls_idle.test.js
// Pins the shared idle timer, control hover, focus and disposal contract.
// Modal tests retain the original IFAV integration assertions unchanged.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { installImageControlsIdle } from './image_controls_idle.js';

beforeEach(() => { vi.useFakeTimers(); document.body.innerHTML = ''; });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

for (const active of ['image-modal-controls-active', 'article-image-controls-active']) {
    test(`${active}: image activity expires at 1200 ms, controls hold, focus reveals, leave expires`, () => {
        const root = document.createElement('div');
        root.innerHTML = '<img><button class="row_article_row_navigation_button"><span></span></button>';
        document.body.append(root);
        const image = root.querySelector('img'), button = root.querySelector('button');
        const teardown = installImageControlsIdle(root, active);
        const pointer = (element, type, relatedTarget) => element.dispatchEvent(
            new PointerEvent(type, { bubbles: true, relatedTarget }));
        vi.advanceTimersByTime(1199);
        expect(root.classList.contains(active)).toBe(true);
        vi.advanceTimersByTime(1);
        expect(root.classList.contains(active)).toBe(false);
        pointer(image, 'pointermove');
        vi.advanceTimersByTime(1199);
        expect(root.classList.contains(active)).toBe(true);
        vi.advanceTimersByTime(1);
        expect(root.classList.contains(active)).toBe(false);
        pointer(button.firstChild, 'pointerover');
        vi.advanceTimersByTime(2100);
        expect(root.classList.contains(active)).toBe(true);
        pointer(button, 'pointerout', image);
        vi.advanceTimersByTime(1200);
        expect(root.classList.contains(active)).toBe(false);
        button.focus();
        expect(root.classList.contains(active)).toBe(true);
        pointer(root, 'pointerleave');
        vi.advanceTimersByTime(1200);
        expect(root.classList.contains(active)).toBe(false);
        pointer(image, 'pointermove');
        teardown(); teardown();
        pointer(image, 'pointermove'); button.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        expect(root.classList.contains(active)).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });
}

test('reinstall releases the previous binding without leaving timers or listeners', () => {
    const root = document.createElement('div');
    const old = installImageControlsIdle(root, 'old');
    const dispose = installImageControlsIdle(root, 'current');
    old();
    expect(root.classList.contains('old')).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    dispose();
    expect(vi.getTimerCount()).toBe(0);
});
