// front_page_top_row_builder.test.js
// Verifies Home composes the live dataset tabs and releases their subscription.
// Connects main-tab snapshots to one real hero tab renderer, without navigation.
// Prevents detached Home rows from retaining stale permission-dependent tabs.
// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ snapshot: [{ dataset: 'news', text: 'News', langKey: 'news' }], listeners: new Set(), unsubscribe: vi.fn() }));
vi.mock('../navigation/main_tabs/main_dataset_tabs.js', () => ({
    getMainDatasetTabs: () => mocks.snapshot,
    subscribeMainDatasetTabs: listener => {
        mocks.listeners.add(listener);
        return () => { mocks.listeners.delete(listener); mocks.unsubscribe(); };
    },
}));
vi.mock('../navigation/main_tabs/main_tab_printer.js', () => ({ openNavTab: vi.fn() }));
vi.mock('./front_page_navigation.js', () => ({ openFrontPage: vi.fn(), isSeparateFrontPageEnabled: () => true, isFrontPageShowing: () => true }));
vi.mock('../admin_tools/front_page_settings_modal.js', () => ({ createFrontPageSettingsHeroButton: () => null }));
vi.mock('../lang/translation_handler.js', () => ({ getTranslationForKey: (_key, options) => options.fallback }));
import { createFrontPageTopRow } from './front_page_top_row_builder.js';
import { HOME_AVAILABILITY_CHANGED_EVENT, setFrontPageAvailability } from './front_page_availability.js';
beforeEach(() => mocks.unsubscribe.mockClear());
afterEach(() => { document.head.replaceChildren(); document.body.className = ''; vi.unstubAllGlobals(); });

test.each(['light', 'dark'])('Home %s icon follows theme in the real phone projection and releases it on destroy', async theme => {
    const { mountFrontPagePhoneLayout } = await import('./front_page_phone_layout.js');
    const { buildMobileSiteIdentity } = await import('../filterbar/mobile_site_identity_builder.js');
    const media = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', vi.fn(() => media));
    document.head.innerHTML = '<link rel="icon" sizes="128x128" href="/chosen-128.png" data-home-dark-href="/chosen-128-dark-v1.png">';
    document.body.className = `${theme}-mode`;
    document.body.innerHTML = '<div id="navbar" class="collapsed"></div><button id="showMenuButton"></button><main></main><div class="front-page-scroller"></div>';
    const row = createFrontPageTopRow('Site'); document.querySelector('main').append(row.element); row.mount();
    const icon = row.element.querySelector('.front-page-site-icon');
    const scroller = document.querySelector('.front-page-scroller');
    const projection = mountFrontPagePhoneLayout(row.element, scroller);
    try {
        expect(scroller.querySelector('.front-page-phone-topbar .front-page-site-icon')).toBe(icon);
        expect(icon.src.endsWith('-128-dark-v1.png')).toBe(theme === 'dark');
        expect(buildMobileSiteIdentity().querySelector('img').src).toMatch(/chosen-128\.png$/);
        document.body.className = `${theme === 'light' ? 'dark' : 'light'}-mode`; await Promise.resolve();
        expect(icon.src.endsWith('-128-dark-v1.png')).toBe(theme === 'light');
        projection.destroy();
        expect(row.element.querySelector('.front-page-site-icon')).toBe(icon);
        document.body.className = 'dark-mode'; await Promise.resolve();
        expect(icon.src).toMatch(/chosen-128-dark-v1\.png$/);
        row.destroy();
        document.body.className = 'light-mode'; await Promise.resolve(); icon.dispatchEvent(new Event('error'));
        expect(icon.src).toMatch(/chosen-128-dark-v1\.png$/);
    } finally { projection.destroy(); row.destroy(); row.element.remove(); }
});

test('the current Home control follows live availability without moving menu focus', () => {
    setFrontPageAvailability({ separate_front_page: true });
    document.body.innerHTML = '<div id="navbar" class="collapsed"></div><button id="showMenuButton"></button>';
    const row = createFrontPageTopRow('Site'); document.body.append(row.element); row.mount();
    const menu = document.getElementById('showMenuButton');
    const home = row.element.querySelector('.top-nav-home-button');
    expect([...row.element.querySelectorAll('a[href], button')].slice(0, 3)).toEqual([
        menu, home, row.element.querySelector('.hero-dataset-tabs__button'),
    ]);
    menu.focus();
    try {
        for (const enabled of [true, false, true]) {
            setFrontPageAvailability({ separate_front_page: enabled });
            window.dispatchEvent(new Event(HOME_AVAILABILITY_CHANGED_EVENT));
            expect(home.hidden).toBe(!enabled);
            expect(document.activeElement).toBe(menu);
            expect(home.getAttribute('aria-current')).toBe('page');
        }
    } finally { row.destroy(); row.element.remove(); localStorage.clear(); setFrontPageAvailability({}); }
});

test('Home tabs have no active dataset, update from the shared model and unsubscribe on teardown', () => {
    document.body.innerHTML = '<div id="navbar"></div>';
    const row = createFrontPageTopRow('Site');
    document.body.append(row.element);
    row.mount();
    expect(row.element.querySelectorAll('.hero-dataset-tabs__button')).toHaveLength(1);
    expect(row.element.querySelector('.hero-dataset-tabs__button[aria-current]')).toBeNull();
    const home = row.element.querySelector('.top-nav-home-button');
    const tabs = row.element.querySelector('.hero-dataset-tabs');
    expect(home.getAttribute('aria-current')).toBe('page');
    expect(row.element.querySelector('.filterbar-inline-hero__actions > .top-nav-home-button')).toBeNull();
    expect(tabs.firstElementChild).toBe(home);
    expect(home.nextElementSibling).toBe(tabs.querySelector('button'));
    for (const listener of mocks.listeners) listener([{ dataset: 'events', text: 'Events', langKey: 'events' }]);
    expect(row.element.querySelector('.hero-dataset-tabs__button').dataset.dataset).toBe('events');
    expect(tabs.firstElementChild).toBe(home);
    expect(home.nextElementSibling).toBe(tabs.querySelector('button'));
    row.destroy();
    expect(mocks.listeners.size).toBe(0);
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
});

test('Home remains reachable when there are no dataset tabs', () => {
    const previous = mocks.snapshot;
    mocks.snapshot = [];
    setFrontPageAvailability({ separate_front_page: true });
    const row = createFrontPageTopRow('Site');
    try {
        const tabs = row.element.querySelector('.hero-dataset-tabs');
        const home = row.element.querySelector('.top-nav-home-button');
        expect(tabs.hidden).toBe(false);
        expect(tabs.firstElementChild).toBe(home);
        expect(home.hidden).toBe(false);
    } finally { row.destroy(); mocks.snapshot = previous; setFrontPageAvailability({}); }
});

// Owner 14.10.2026: only the hidden menu borrows Home's slot; the open menu keeps its closer.
test.each([false, true])('Home mounts with collapsed=%s and updates its menu slot live without changing identity', async collapsed => {
    const { buildMobileSiteIdentity } = await import('../filterbar/mobile_site_identity_builder.js');
    const { NAVBAR_VISIBILITY_CHANGED_EVENT } = await import('../navigation/menu_button/navbar_visibility_handler.js');
    const width = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(320);
    document.head.innerHTML = '<link rel="icon" sizes="16x16" href="/chosen-16.png"><link rel="icon" sizes="128x128" href="/chosen-128.png">';
    document.body.innerHTML = `<div id="navbar" class="${collapsed ? 'collapsed' : ''}"><button id="hideMenuButton"></button></div><button id="showMenuButton"></button>`;
    const button = document.getElementById('showMenuButton');
    const row = createFrontPageTopRow('Fintravel');
    document.body.append(row.element);
    row.mount();
    try {
        expect(row.element.querySelector('.front-page-site-icon').src).toMatch(/chosen-128\.png$/);
        expect(buildMobileSiteIdentity().querySelector('img').src).toMatch(/chosen-128\.png$/);
        for (const hidden of [collapsed, !collapsed, collapsed]) {
            document.getElementById('navbar').classList.toggle('collapsed', hidden);
            window.dispatchEvent(new Event(NAVBAR_VISIBILITY_CHANGED_EVENT));
            const slot = row.element.querySelector('.dataset-shared-topbar__menu-slot');
            expect(slot.hidden).toBe(!hidden);
            expect(slot.inert).toBe(!hidden);
            expect(slot.getAttribute('aria-hidden')).toBe(String(!hidden));
            expect(slot.classList.contains('dataset-shared-topbar__menu-slot--visible')).toBe(hidden);
            expect(button.getAttribute('aria-hidden')).toBe(String(!hidden));
            expect(button.tabIndex).toBe(hidden ? 0 : -1);
            expect(button.classList.contains('menu-toggle-visible')).toBe(hidden);
            const close = document.getElementById('hideMenuButton');
            expect(close.getAttribute('aria-hidden')).toBe(String(hidden));
            expect(close.tabIndex).toBe(hidden ? -1 : 0);
            expect(row.element.querySelector('.front-page-site-name').textContent).toBe('Fintravel');
        }
        document.getElementById('navbar').classList.remove('collapsed');
        width.mockReturnValue(706);
        window.dispatchEvent(new Event('resize'));
        expect(row.element.querySelector('.dataset-shared-topbar__menu-slot').hidden).toBe(true);
        document.getElementById('navbar').classList.add('collapsed');
        window.dispatchEvent(new Event('resize'));
        expect(row.element.querySelector('.dataset-shared-topbar__menu-slot').hidden).toBe(false);
    } finally {
        row.destroy(); width.mockRestore(); document.head.replaceChildren();
    }
    expect(button.parentElement).toBe(document.body);
});

test('Home preserves opener focus when borrowing and returning it, and hands focus between menu controls', async () => {
    const { toggleNavbarVisibility } = await import('../navigation/menu_button/navbar_visibility_handler.js');
    document.body.innerHTML = '<div id="navbar"><button id="hideMenuButton"></button></div><div id="tabs_container"></div><button id="showMenuButton"></button>';
    toggleNavbarVisibility();
    const button = document.getElementById('showMenuButton');
    const close = document.getElementById('hideMenuButton');
    button.focus();
    const row = createFrontPageTopRow('Fintravel');
    document.body.append(row.element); row.mount();
    try {
        expect(document.activeElement).toBe(button);
        toggleNavbarVisibility();
        expect(document.activeElement).toBe(close);
        expect(row.element.querySelector('.dataset-shared-topbar__menu-slot').hidden).toBe(true);
        toggleNavbarVisibility();
        expect(document.activeElement).toBe(button);
    } finally {
        row.destroy(); row.element.remove();
    }
    expect(document.activeElement).toBe(button);
    expect(button.parentElement).toBe(document.body);
    toggleNavbarVisibility();
});

test('Home follows the initial collapsed state until the animated menu entrance opens it', async () => {
    vi.useFakeTimers();
    const { initNavbar } = await import('../navigation/menu_button/navbar_visibility_handler.js');
    localStorage.setItem('navVisibleWide', 'true'); localStorage.setItem('navVisibleNarrow', 'true');
    document.body.innerHTML = '<div class="body_content" data-navbar-initial-open="true"><div id="navbar" class="collapsed"><button id="hideMenuButton"></button></div><div id="tabs_container"></div><button id="showMenuButton"></button></div>';
    const row = createFrontPageTopRow('Fintravel');
    document.getElementById('tabs_container').append(row.element); row.mount();
    const button = document.getElementById('showMenuButton');
    const close = document.getElementById('hideMenuButton');
    try {
        initNavbar(); button.focus();
        expect(row.element.querySelector('.dataset-shared-topbar__menu-slot').hidden).toBe(false);
        expect(button.getAttribute('aria-hidden')).toBe('false');
        expect(close.getAttribute('aria-hidden')).toBe('true');
        await vi.advanceTimersByTimeAsync(40);
        expect(document.getElementById('navbar').classList.contains('collapsed')).toBe(false);
        expect(row.element.querySelector('.dataset-shared-topbar__menu-slot').hidden).toBe(true);
        expect(button.getAttribute('aria-hidden')).toBe('true');
        expect(close.getAttribute('aria-hidden')).toBe('false');
        expect(document.activeElement).toBe(close);
    } finally { row.destroy(); vi.useRealTimers(); localStorage.clear(); setFrontPageAvailability({}); }
});
