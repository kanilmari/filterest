// @vitest-environment jsdom
// navigation_fit_controller.test.js
// Proves prefix fitting and remeasurement when space and translated copy change.
// Uses measured button widths with real hiding, focus and lifetime behaviour.
import { afterEach, expect, test, vi } from 'vitest';
import { countFittingNavigationButtons, createNavigationFitController } from './navigation_fit_controller.js';
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); document.body.replaceChildren(); });

test('hides only whole trailing buttons with their inter-button gaps', () => {
    expect(countFittingNavigationButtons([100, 130, 150], 396, 8)).toBe(3);
    expect(countFittingNavigationButtons([100, 130, 150], 395, 8)).toBe(2);
    expect(countFittingNavigationButtons([100, 130, 150], 237, 8)).toBe(1);
    expect(countFittingNavigationButtons([100], 99)).toBe(0);
});

test('remeasures hidden buttons after translation, restores on grow, and gives focus to menu', async () => {
    vi.useFakeTimers();
    const element = document.createElement('nav');
    element.style.columnGap = '8px';
    element.innerHTML = '<button>Matkainfo</button><button>Matkatarjoukset</button><button>Blogit</button>';
    document.body.innerHTML = '<button id="showMenuButton">Menu</button>';
    document.body.append(element);
    let availableWidth = 400;
    let widths = [100, 130, 150];
    Object.defineProperty(element, 'clientWidth', { get: () => availableWidth });
    const buttons = [...element.children];
    buttons.forEach((button, index) => vi.spyOn(button, 'getBoundingClientRect').mockImplementation(() => ({ width: widths[index] })));
    const fit = createNavigationFitController(element);
    fit.sync(); await vi.advanceTimersByTimeAsync(20);
    expect(buttons.map(button => button.hidden)).toEqual([false, false, false]);
    buttons[2].focus(); availableWidth = 250;
    window.dispatchEvent(new Event('resize')); await vi.advanceTimersByTimeAsync(20);
    expect(buttons.map(button => button.hidden)).toEqual([false, false, true]);
    expect(document.activeElement.id).toBe('showMenuButton');
    widths = [160, 180, 200]; fit.sync(); await vi.advanceTimersByTimeAsync(20);
    expect(buttons.map(button => button.hidden)).toEqual([false, true, true]);
    availableWidth = 600; fit.sync(); await vi.advanceTimersByTimeAsync(20);
    expect(buttons.every(button => !button.hidden)).toBe(true);
    expect(buttons.every(button => !button.hasAttribute('style'))).toBe(true);
    fit.destroy(); availableWidth = 100;
    window.dispatchEvent(new Event('resize')); await vi.advanceTimersByTimeAsync(20);
    expect(buttons.every(button => !button.hidden)).toBe(true);
});

test('restores caller styles through CSSOM when CSP rejects style-attribute writes', async () => {
    vi.useFakeTimers();
    const element = document.createElement('nav');
    element.innerHTML = '<button>First</button><button>Second</button>';
    document.body.append(element);
    Object.defineProperty(element, 'clientWidth', { value: 250 });
    const buttons = [...element.children];
    buttons[0].style.setProperty('color', 'red', 'important');
    buttons[0].style.padding = '6px';
    const originalStyle = buttons[0].style.cssText;
    buttons.forEach(button => {
        vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ width: 100 });
        const setAttribute = button.setAttribute.bind(button);
        vi.spyOn(button, 'setAttribute').mockImplementation((name, value) => {
            if (name === 'style') throw new Error('CSP rejects a style attribute');
            setAttribute(name, value);
        });
    });
    const fit = createNavigationFitController(element);
    try {
        fit.sync(); await vi.advanceTimersByTimeAsync(20);
        expect(buttons[0].style.cssText).toBe(originalStyle);
        expect(buttons[1].hasAttribute('style')).toBe(false);
        expect(buttons.every(button => !button.hidden && button.style.visibility !== 'hidden')).toBe(true);
    } finally { fit.destroy(); }
});
