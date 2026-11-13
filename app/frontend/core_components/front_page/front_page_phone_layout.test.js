// @vitest-environment jsdom
// front_page_phone_layout.test.js
// Exercises reversible movement of the real Home controls without cloning.
// Measures the border box and verifies focus and listener/observer teardown.
// Browser specs provide sticky geometry and native drawer scrolling proofs.
import { afterEach, expect, test, vi } from 'vitest';
import { planHomeNavigationRows } from './front_page_phone_navigation_rows.js';
import { mountFrontPagePhoneLayout } from './front_page_phone_layout.js';

let layout;
afterEach(() => { layout?.destroy(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

function fixture(width = 701) {
    const media = new EventTarget();
    media.matches = width <= 700;
    vi.stubGlobal('matchMedia', vi.fn(() => media));
    const observations = [];
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback) { this.callback = callback; this.disconnect = vi.fn(); observations.push(this); }
        observe = vi.fn();
    });
    document.body.innerHTML = '<div id="navbar" class="collapsed"><button id="hideMenuButton" aria-hidden="true"></button></div>'
        + '<div class="front-page"><div class="front-page-background"></div><div class="front-page-top-row">'
        + '<div class="front-page-top-row__identity"><div class="dataset-shared-topbar__menu-slot">'
        + '<button id="showMenuButton" aria-hidden="false" aria-expanded="false"></button></div>'
        + '<img class="front-page-site-icon"><span class="front-page-site-name">Matkailusivusto</span></div>'
        + '<nav class="hero-dataset-tabs"><a href="/">Etusivu</a><button>Aineistot</button></nav>'
        + '<div class="front-page-article-buttons"><a href="/contact">Yhteystiedot</a></div>'
        + '<div class="filterbar-inline-hero__actions"><button class="gear"></button><button class="palette"></button></div>'
        + '</div><div class="front-page-scroller"><div class="front-page-content"></div></div></div>';
    const row = document.querySelector('.front-page-top-row');
    const scroller = document.querySelector('.front-page-scroller');
    const original = document.querySelector('.front-page').innerHTML;
    const move = next => { media.matches = next <= 700; media.dispatchEvent(new Event('change')); };
    return { row, scroller, original, media, observations, move };
}

test('701px keeps the original desktop DOM; 700px puts menu | identity | search before the scrolling row', () => {
    const { row, scroller, original, move } = fixture();
    layout = mountFrontPagePhoneLayout(row, scroller);
    expect(row.nextElementSibling).toBe(scroller);
    expect(document.querySelector('.front-page-phone-topbar')).toBeNull();
    expect(document.querySelector('.front-page').innerHTML).toBe(original);
    const identity = row.firstElementChild;
    const slot = identity.firstElementChild;
    move(700);
    const bar = scroller.firstElementChild;
    expect(bar.className).toBe('front-page-phone-topbar');
    expect([...bar.children].slice(0, 2)).toEqual([slot, identity]);
    expect(bar.lastElementChild.className).toBe('front-page-phone-topbar__end');
    expect(bar.lastElementChild.hasAttribute('aria-hidden')).toBe(false);
    expect(bar.lastElementChild.querySelector('button').getAttribute('aria-expanded')).toBe('false');
    expect(bar.nextElementSibling).toBe(row);
    expect(row.nextElementSibling.className).toBe('front-page-content');
    expect(scroller.contains(document.querySelector('.front-page-background'))).toBe(false);
    move(701);
    expect(document.querySelector('.front-page').innerHTML).toBe(original);
    expect(row.firstElementChild).toBe(identity);
    expect(identity.firstElementChild).toBe(slot);
});

test.each(['#showMenuButton', 'nav a', 'nav button', '.front-page-article-buttons a', '.gear', '.palette'])(
'700 ↔ 701 retains the SAME %s node, focus, attributes and listeners', selector => {
    const { row, scroller, move } = fixture();
    const desktopParent = row.parentElement;
    const nodes = [...row.querySelectorAll('*')];
    const target = row.querySelector(selector);
    const clicked = vi.fn(); target.addEventListener('probe', clicked);
    layout = mountFrontPagePhoneLayout(row, scroller);
    target.focus();
    for (const width of [700, 701, 700, 701]) {
        move(width);
        expect(row.parentElement).toBe(width <= 700 ? scroller : desktopParent);
        expect(document.activeElement).toBe(target);
        expect(nodes.every(node => node.isConnected)).toBe(true);
        expect(document.querySelector(selector)).toBe(target);
        target.dispatchEvent(new Event('probe'));
    }
    expect(clicked).toHaveBeenCalledTimes(4);
    expect(document.querySelector('#showMenuButton').getAttribute('aria-expanded')).toBe('false');
});

test('a destination hidden by fitting transfers focus to the visible menu on return', () => {
    const { row, scroller, move } = fixture(700);
    layout = mountFrontPagePhoneLayout(row, scroller);
    const destination = row.querySelector('nav button'); destination.focus(); destination.hidden = true;
    move(701);
    expect(document.activeElement.id).toBe('showMenuButton');
});

test('border-box measurement includes safe-area growth and clears on desktop and destroy', () => {
    const { row, scroller, move, media, observations } = fixture(700);
    const removeMedia = vi.spyOn(media, 'removeEventListener');
    const removeWindow = vi.spyOn(window, 'removeEventListener');
    layout = mountFrontPagePhoneLayout(row, scroller);
    const bar = scroller.firstElementChild;
    expect(observations[0].observe).toHaveBeenCalledWith(bar, { box: 'border-box' });
    observations[0].callback([{ borderBoxSize: [{ blockSize: 89 }] }]);
    expect(scroller.style.getPropertyValue('--home-phone-bar-size')).toBe('89px');
    move(701);
    expect(observations[0].disconnect).toHaveBeenCalledOnce();
    expect(scroller.style.getPropertyValue('--home-phone-bar-size')).toBe('');
    observations[0].callback([{ borderBoxSize: [{ blockSize: 99 }] }]);
    expect(scroller.style.getPropertyValue('--home-phone-bar-size')).toBe('');
    move(700);
    const nextBar = document.querySelector('.front-page-phone-topbar');
    const nextObserver = observations.find(o => o.observe.mock.calls.some(([node]) => node === nextBar));
    nextObserver.callback([{ borderBoxSize: { blockSize: 69 } }]);
    expect(scroller.style.getPropertyValue('--home-phone-bar-size')).toBe('69px');
    layout.destroy(); layout.destroy();
    expect(nextObserver.disconnect).toHaveBeenCalledOnce();
    expect(removeMedia).toHaveBeenCalledWith('change', expect.any(Function));
    expect(removeWindow).toHaveBeenCalledWith('navbar-visibility-changed', expect.any(Function));
    nextObserver.callback([{ borderBoxSize: [{ blockSize: 99 }] }]); move(700);
    expect(scroller.style.getPropertyValue('--home-phone-bar-size')).toBe('');
    expect(scroller.querySelector('.front-page-phone-topbar')).toBeNull();
    removeWindow.mockRestore();
});

test.each([
    [[], []],
    [[60], [1]],
    [[44, 56, 80], [3]],
    [[60, 60, 60, 60], [2, 2]], // Greedy wrapping would leave one button on the last row.
    [[85, 90, 44, 44, 44], [2, 3]],
    [[44, 44, 44, 85, 90], [3, 2]],
    [[200, 60, 60, 200], [1, 2, 1]], // A full-width final label necessarily stands alone.
])('balances ordered button widths %j in a 200px row', (widths, counts) => {
    const rows = planHomeNavigationRows(widths, 200, 4);
    expect(rows.map(row => row.end - row.start)).toEqual(counts);
});

test('phone rows refit resized labels, hidden and new controls, then clear their sizes on desktop', async () => {
    const { row, move, observations } = fixture(390);
    row.style.padding = '0px';
    row.style.columnGap = '4px';
    row.getBoundingClientRect = () => ({ width: 200 });
    const first = row.querySelector('nav a'), second = row.querySelector('nav button');
    const list = row.querySelector('.front-page-article-buttons'), article = list.firstElementChild;
    for (const button of [first, second, article]) {
        button.getBoundingClientRect = () => ({ width: button.hidden ? 0 : 80 });
    }
    const label = document.createElement('span');
    label.className = 'hero-dataset-tabs__label';
    label.textContent = second.textContent;
    second.replaceChildren(label);
    const size = button => button.style.getPropertyValue('--home-phone-button-basis');
    layout = mountFrontPagePhoneLayout(row, row.parentElement.querySelector('.front-page-scroller'));
    expect([size(first), size(second), size(article)]).toEqual(['200px', '98px', '98px']);
    // Changing a loaded font in a stylesheet can resize a label while the row stays 200px.
    second.getBoundingClientRect = () => ({ width: second.hidden ? 0 : 84 });
    const labelObserver = observations.find(o => o.observe.mock.calls.some(([node]) => node === label));
    labelObserver.callback([{ target: label }]);
    await vi.waitFor(() => expect([size(second), size(article)]).toEqual(['100px', '96px']));
    second.hidden = true;
    await vi.waitFor(() => expect(size(first)).toBe('98px'));
    const extra = document.createElement('a');
    extra.textContent = 'Another article';
    extra.getBoundingClientRect = () => ({ width: 80 });
    list.append(extra);
    await vi.waitFor(() => expect([size(first), size(article), size(extra)]).toEqual(['200px', '98px', '98px']));
    move(701);
    expect([first, second, article, extra].every(button => size(button) === '')).toBe(true);
});
