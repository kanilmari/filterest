// @vitest-environment jsdom
// front_page_phone_layout.test.js
// Exercises reversible movement of the real Home controls without cloning.
// Measures the border box and verifies focus and listener/observer teardown.
// Browser specs provide sticky geometry and native drawer scrolling proofs.
import { afterEach, expect, test, vi } from 'vitest';
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
    observations[1].callback([{ borderBoxSize: { blockSize: 69 } }]);
    expect(scroller.style.getPropertyValue('--home-phone-bar-size')).toBe('69px');
    layout.destroy(); layout.destroy();
    expect(observations[1].disconnect).toHaveBeenCalledOnce();
    expect(removeMedia).toHaveBeenCalledWith('change', expect.any(Function));
    expect(removeWindow).toHaveBeenCalledWith('navbar-visibility-changed', expect.any(Function));
    observations[1].callback([{ borderBoxSize: [{ blockSize: 99 }] }]); move(700);
    expect(scroller.style.getPropertyValue('--home-phone-bar-size')).toBe('');
    expect(scroller.querySelector('.front-page-phone-topbar')).toBeNull();
    removeWindow.mockRestore();
});
