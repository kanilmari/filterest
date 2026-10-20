// @vitest-environment jsdom
// navigation_fit_controller.test.js
// Proves prefix fitting and remeasurement when space and translated copy change.
// Uses measured button widths with real hiding, focus and lifetime behaviour.
import { afterEach, expect, test, vi } from 'vitest';
import { countFittingNavigationButtons, createNavigationFitController } from './navigation_fit_controller.js';
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); document.body.replaceChildren(); });

// Owner 14.10.2026: Home focus follows the visible closer or opener, as on dataset pages.
test.each([
    { owner: 'Home hidden menu', closeHidden: 'true', target: 'showMenuButton' },
    { owner: 'Home open menu', closeHidden: 'false', target: 'hideMenuButton' },
    { owner: 'dataset', closeHidden: 'false', target: 'hideMenuButton' },
    { owner: 'dataset shared topbar', closeHidden: 'false', target: 'sharedMenuButton' },
])('$owner hands focus to $target before hiding a trailing destination', async ({ owner, closeHidden, target }) => {
    vi.useFakeTimers();
    const homeOwnsMenu = owner.startsWith('Home');
    document.body.innerHTML = `
        ${target === 'sharedMenuButton' ? '<button id="sharedMenuButton" data-navbar-menu-button="true" aria-hidden="false">Menu</button>' : ''}
        <div id="navbar"><button id="hideMenuButton" aria-hidden="${closeHidden}">Close</button></div>
        <div class="${homeOwnsMenu ? 'front-page-top-row' : 'dataset-hero'}">
            <button id="showMenuButton" aria-hidden="${target === 'showMenuButton' ? 'false' : 'true'}">Menu</button>
            <nav><button>Matkainfo</button><button>Matkatarjoukset</button><button>Blogit</button></nav>
        </div>`;
    const element = document.querySelector('nav');
    const close = document.getElementById('hideMenuButton');
    const closeFocus = vi.spyOn(close, 'focus');
    if (closeHidden === 'true') close.style.display = 'none';
    if (target !== 'showMenuButton') document.getElementById('showMenuButton').style.display = 'none';
    element.style.flexDirection = homeOwnsMenu ? 'column' : 'row';
    let availableWidth = 400;
    vi.spyOn(element, 'clientWidth', 'get').mockImplementation(() => availableWidth);
    const buttons = [...element.children];
    buttons.forEach(button => vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ width: 100 }));
    const fit = createNavigationFitController(element);
    try {
        fit.sync(); await vi.advanceTimersByTimeAsync(20);
        expect(buttons.map(button => button.hidden)).toEqual([false, false, false]);
        buttons[2].focus();
        expect(document.activeElement).toBe(buttons[2]);
        element.style.flexDirection = 'row'; availableWidth = 250;
        window.dispatchEvent(new Event('resize')); await vi.advanceTimersByTimeAsync(20);
        expect(buttons.map(button => button.hidden)).toEqual([false, false, true]);
        expect(document.activeElement).toBe(document.getElementById(target));
        expect(window.getComputedStyle(document.activeElement).display).not.toBe('none');
        if (homeOwnsMenu) {
            expect(closeFocus).toHaveBeenCalledTimes(target === 'hideMenuButton' ? 1 : 0);
            element.style.flexDirection = 'column';
            window.dispatchEvent(new Event('resize')); await vi.advanceTimersByTimeAsync(20);
            expect(buttons.map(button => button.hidden)).toEqual([false, false, false]);
        }
    } finally { fit.destroy(); }
});

test('only a Home phone column restores destinations hidden by a narrower desktop row', async () => {
    vi.useFakeTimers();
    const home = document.createElement('div');
    home.className = 'front-page-top-row';
    const element = document.createElement('nav');
    element.innerHTML = '<button>Matkainfo</button><button>Matkatarjoukset</button><button>Blogit</button>';
    home.append(element);
    document.body.append(home);
    const buttons = [...element.children];
    vi.spyOn(element, 'clientWidth', 'get').mockReturnValue(120);
    for (const button of buttons) vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ width: 70 });
    const link = document.createElement('a'); link.className = 'top-nav-home-button';
    const homeMeasurement = vi.spyOn(link, 'getBoundingClientRect').mockImplementation(() =>
        ({ width: link.classList.contains('top-nav-home-button--compact') ? 44 : 100 }));
    element.prepend(link);
    const fit = createNavigationFitController(element);
    try {
        fit.sync(); await vi.advanceTimersByTimeAsync(20);
        expect(buttons.map(button => button.hidden)).toEqual([false, true, true]);
        expect(link.classList.contains('top-nav-home-button--compact')).toBe(true);
        link.classList.remove('top-nav-home-button--compact');
        homeMeasurement.mockClear();
        element.style.flexDirection = 'column';
        fit.sync(); await vi.advanceTimersByTimeAsync(20);
        expect(buttons.map(button => button.hidden)).toEqual([false, false, false]);
        expect(link.classList.contains('top-nav-home-button--compact')).toBe(false);
        expect(homeMeasurement).not.toHaveBeenCalled();
        // A dataset projection still fits horizontally, even if a caller stacks it.
        home.className = 'dataset-hero';
        fit.sync(); await vi.advanceTimersByTimeAsync(20);
        expect(buttons.map(button => button.hidden)).toEqual([false, true, true]);
        home.className = 'front-page-top-row';
        element.style.flexDirection = 'row';
        fit.sync(); await vi.advanceTimersByTimeAsync(20);
        expect(buttons.map(button => button.hidden)).toEqual([false, true, true]);
    } finally { fit.destroy(); }
});

test('hides only whole trailing buttons with their inter-button gaps', () => {
    expect(countFittingNavigationButtons([100, 130, 150], 396, 8)).toBe(3);
    expect(countFittingNavigationButtons([100, 130, 150], 395, 8)).toBe(2);
    expect(countFittingNavigationButtons([100, 130, 150], 237, 8)).toBe(1);
    expect(countFittingNavigationButtons([100], 99)).toBe(0);
});

test('reserves the Home link before dataset fitting and restores space when it moves away', async () => {
    vi.useFakeTimers();
    const element = document.createElement('nav');
    element.innerHTML = '<button>First</button><button>Second</button>';
    document.body.append(element);
    vi.spyOn(element, 'clientWidth', 'get').mockReturnValue(220);
    const buttons = [...element.children];
    buttons.forEach(button => vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ width: 100 }));
    const home = document.createElement('a'); home.className = 'top-nav-home-button'; home.href = '/';
    vi.spyOn(home, 'getBoundingClientRect').mockReturnValue({ width: 44 });
    const fit = createNavigationFitController(element);
    try {
        element.prepend(home); await vi.advanceTimersByTimeAsync(30);
        expect(buttons.map(button => button.hidden)).toEqual([false, true]);
        expect(home.hidden).toBe(false);
        home.remove(); await vi.advanceTimersByTimeAsync(30);
        expect(buttons.map(button => button.hidden)).toEqual([false, false]);
    } finally { fit.destroy(); }
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

test('Home hides only its visual label when the first translated dataset would not fit, then restores it', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<nav><a href="/" class="top-nav-home-button" aria-label="Site name">Site name</a><button>Dataset</button></nav>';
    const row = document.querySelector('nav');
    const home = row.querySelector('a');
    let available = 150;
    vi.spyOn(row, 'clientWidth', 'get').mockImplementation(() => available);
    vi.spyOn(home, 'getBoundingClientRect').mockImplementation(() => ({
        width: home.classList.contains('top-nav-home-button--compact') ? 36 : 100,
    }));
    vi.spyOn(row.querySelector('button'), 'getBoundingClientRect').mockReturnValue({ width: 100 });
    const fit = createNavigationFitController(row);
    try {
        fit.sync(); await vi.advanceTimersByTimeAsync(30);
        expect(home.classList.contains('top-nav-home-button--compact')).toBe(true);
        expect(row.querySelector('button').hidden).toBe(false);
        expect(home.getAttribute('aria-label')).toBe('Site name');
        available = 300; fit.sync(); await vi.advanceTimersByTimeAsync(30);
        expect(home.classList.contains('top-nav-home-button--compact')).toBe(false);
        expect(row.querySelector('button').hidden).toBe(false);
    } finally { fit.destroy(); }
});

test('a live Home site-name change refits the existing row without waiting for a resize', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<nav><a href="/" class="top-nav-home-button">Home</a><button>Dataset</button></nav>';
    const row = document.querySelector('nav'); const home = row.querySelector('a');
    vi.spyOn(row, 'clientWidth', 'get').mockReturnValue(150);
    vi.spyOn(row.querySelector('button'), 'getBoundingClientRect').mockReturnValue({ width: 100 });
    vi.spyOn(home, 'getBoundingClientRect').mockImplementation(() => ({ width:
        home.textContent === 'Home' || home.classList.contains('top-nav-home-button--compact') ? 40 : 100,
    }));
    const fit = createNavigationFitController(row);
    try {
        fit.sync(); await vi.advanceTimersByTimeAsync(30);
        expect(home.classList.contains('top-nav-home-button--compact')).toBe(false);
        home.textContent = 'Long current site name';
        await vi.advanceTimersByTimeAsync(30);
        expect(home.classList.contains('top-nav-home-button--compact')).toBe(true);
        expect(row.querySelector('button').hidden).toBe(false);
    } finally { fit.destroy(); }
});
