// @vitest-environment jsdom
// top_nav_home_button.test.js
// Proves shared Home policy/destination, a single movable control and shared menu closing.
// Uses real link rendering and effective custom-root availability, with navigation isolated.
import { createHeroDatasetTabs } from '../navigation/main_tabs/hero_dataset_tabs.js';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createTopNavHomeButton, placeTopNavHomeButton } from './top_nav_home_button.js';
import { renderNavbarFrontPage } from './navbar_front_page.js';
import { setCustomRootEnabled } from './custom_root_navigation.js';
import { refreshLocalizedDatasetValues } from '../table_views/dataset_value_localizer.js';
import { createSharedTopbarVisibilityController } from '../filterbar/shared_topbar_visibility_controller.js';
import { HOME_AVAILABILITY_CHANGED_EVENT, setFrontPageAvailability } from './front_page_availability.js';
const mocks = vi.hoisted(() => ({ open: vi.fn(), heroVisible: true, datasetOpen: vi.fn() }));
vi.mock('../navigation/main_tabs/main_tab_printer.js', () => ({ openNavTab: mocks.datasetOpen }));
vi.mock('../navigation/main_tabs/main_dataset_tabs.js', () => ({
    getMainDatasetTabs: () => [{ dataset: 'demo', text: 'Demo', langKey: 'demo' }],
    subscribeMainDatasetTabs: () => () => {},
}));
vi.mock('./front_page_navigation.js', () => ({ openFrontPage: mocks.open, isFrontPageShowing: () => false }));
vi.mock('../lang/translation_handler.js', () => ({ getTranslationForKey: () => 'Etusivu' }));
vi.mock('../filterbar/dataset_corner_controls.js', () => ({ isHeroControlAreaVisible: () => mocks.heroVisible }));
vi.mock('../filterbar/mobile_topbar_search_controller.js', () => ({
    createMobileTopbarSearchController: () => ({ sync() {}, destroy() {} }),
}));
vi.mock('../navigation/menu_button/navbar_visibility_handler.js', () => ({ updateShowMenuButtonPosition() {} }));
vi.mock('../state_stores/dataset_view_choice_saver.js', () => ({ getChosenDatasetView: () => 'card' }));

beforeEach(() => {
    localStorage.clear(); setFrontPageAvailability({}); mocks.open.mockReset(); mocks.heroVisible = true;
    document.body.innerHTML = '<nav id="navbarFrontPage" hidden></nav><div id="tabs_container"></div>'
        + '<div id="hero"></div><div id="compact"></div>';
});
afterEach(() => { setCustomRootEnabled(false); localStorage.clear(); });

test.each([null, 'false', 'true', 'disabled'])('Home setting %s uses exactly the menu visibility rule', setting => {
    setFrontPageAvailability({ separate_front_page: setting === 'true' });
    for (const signedIn of [true, false]) {
        localStorage.setItem('button_state', signedIn ? 'logout' : 'login');
        for (const privateBrowse of [true, false]) {
            localStorage.setItem('login_required_for_browse', String(privateBrowse));
            renderNavbarFrontPage({ isLoggedIn: signedIn });
            const link = createTopNavHomeButton();
            const expected = setting === 'true' && (signedIn || !privateBrowse);
            expect(Boolean(link)).toBe(expected);
            expect(document.getElementById('navbarFrontPage').hidden).toBe(!expected);
        }
    }
});

test.each([false, true])('menu and top Home share root href and activation with custom root=%s', async customRoot => {
    setFrontPageAvailability({ separate_front_page: !customRoot });
    setCustomRootEnabled(customRoot);
    renderNavbarFrontPage({ isLoggedIn: true });
    const menu = document.querySelector('#navbarFrontPage a');
    const top = createTopNavHomeButton();
    document.getElementById('hero').append(top);
    expect(top.getAttribute('href')).toBe(menu.getAttribute('href'));
    expect(top.getAttribute('href')).toBe('/');
    menu.click();
    await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledTimes(1));
    top.click();
    await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledTimes(2));
    expect(mocks.open.mock.calls).toEqual([[{ userActivation: false }], [{ userActivation: false }]]);
    const modified = new MouseEvent('click', { ctrlKey: true, cancelable: true });
    top.dispatchEvent(modified); expect(modified.defaultPrevented).toBe(false);
});

test('repeated hero/compact handoffs retain one keyboard-reachable node and its full label', async () => {
    setFrontPageAvailability({ separate_front_page: true });
    localStorage.setItem('front_page_button_site_name', 'A long multilingual site name');
    const top = createTopNavHomeButton();
    placeTopNavHomeButton(top, document.getElementById('hero'));
    top.focus();
    for (const id of ['hero', 'compact', 'hero', 'hero', 'compact']) {
        placeTopNavHomeButton(top, document.getElementById(id));
        expect(document.querySelectorAll('[data-testid="top-nav-home-button"]')).toHaveLength(1);
        expect(document.activeElement).toBe(top);
        expect(top.tabIndex).toBe(0);
        expect(top.getAttribute('aria-label')).toBe('A long multilingual site name');
    }
    localStorage.removeItem('front_page_button_site_name');
    await refreshLocalizedDatasetValues('fi');
    expect(top.getAttribute('aria-label')).toBe('Etusivu');
});

test('Home and dataset tabs have identical overlay/docked menu state and storage; native gestures never close', async () => {
    setFrontPageAvailability({ separate_front_page: true });
    document.body.innerHTML = '<div class="body_content"><button id="showMenuButton"></button>'
        + '<nav id="navbar"><button id="hideMenuButton"></button><div id="navbarFrontPage"></div></nav>'
        + '<div id="tabs_container"><div id="hero"></div></div></div>';
    const { initNavbar, toggleNavbarVisibility, NAVBAR_VISIBILITY_CHANGED_EVENT } =
        await vi.importActual('../navigation/menu_button/navbar_visibility_handler.js');
    const navbar = document.getElementById('navbar');
    const home = createTopNavHomeButton();
    const tabs = createHeroDatasetTabs('demo');
    const tab = tabs.element.querySelector('button');
    document.getElementById('hero').append(home, tabs.element);
    const changed = vi.fn();
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    const snapshot = () => ({ collapsed: navbar.classList.contains('collapsed'),
        expanded: document.getElementById('showMenuButton').getAttribute('aria-expanded'),
        closerExpanded: document.getElementById('hideMenuButton').getAttribute('aria-expanded'),
        narrow: localStorage.getItem('navVisibleNarrow'), wide: localStorage.getItem('navVisibleWide') });
    localStorage.setItem('navVisibleNarrow', 'true'); localStorage.setItem('navVisibleWide', 'true');
    const registrations = vi.spyOn(document, 'addEventListener');
    initNavbar();
    window.addEventListener(NAVBAR_VISIBILITY_CHANGED_EVENT, changed);
    try {
        for (const width of [375, 768, 1440, 1849, 1850, 1920]) {
            vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(width);
            const results = [];
            for (const target of [home, tab]) {
                if (navbar.classList.contains('collapsed')) toggleNavbarVisibility();
                localStorage.setItem('navVisibleNarrow', 'true'); localStorage.setItem('navVisibleWide', 'true');
                changed.mockClear(); writes.mockClear();
                mocks.open.mockClear();
                target.click();
                if (target === home) await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledOnce());
                results.push(snapshot());
                expect(changed).toHaveBeenCalledTimes(width < 1850 ? 1 : 0);
                expect(writes.mock.calls.filter(([key]) => key === 'navVisibleNarrow' || key === 'navVisibleWide'))
                    .toHaveLength(width < 1850 ? 1 : 0);
            }
            expect(results[0]).toEqual(results[1]);
            expect(results[0]).toEqual({ collapsed: width < 1850, expanded: String(width >= 1850),
                closerExpanded: String(width >= 1850), narrow: String(width >= 1850), wide: 'true' });
        }
        vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(375);
        if (navbar.classList.contains('collapsed')) toggleNavbarVisibility();
        const before = snapshot();
        for (const gesture of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { button: 2 }]) {
            changed.mockClear(); mocks.open.mockClear(); writes.mockClear();
            const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...gesture });
            home.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(false);
            await Promise.resolve();
            expect(mocks.open).not.toHaveBeenCalled();
            expect(changed).not.toHaveBeenCalled();
            expect(snapshot()).toEqual(before);
            expect(writes).not.toHaveBeenCalled();
        }
        renderNavbarFrontPage({ isLoggedIn: true });
        document.querySelector('#navbarFrontPage a').click();
        expect(snapshot()).toEqual(before);
    } finally {
        tabs.destroy();
        for (const [type, listener] of registrations.mock.calls) document.removeEventListener(type, listener);
        window.removeEventListener(NAVBAR_VISIBILITY_CHANGED_EVENT, changed);
        vi.restoreAllMocks();
    }
});

test('the real toolbar controller moves one node through phone, scroll, open menu and hero states', () => {
    setFrontPageAvailability({ separate_front_page: true });
    document.getElementById('hero').innerHTML = '<nav class="hero-dataset-tabs"></nav>';
    const hero = document.getElementById('hero');
    const compact = document.getElementById('compact');
    compact.innerHTML = '<div class="dataset-shared-topbar__slot--start"><button class="menu"></button></div>'
        + '<div class="dataset-shared-topbar__slot--end"></div>';
    const close = document.createElement('button'); compact.append(close);
    let navbarVisible = false;
    const controller = createSharedTopbarVisibilityController({
        tableName: 'demo', currentView: 'card', tablePartsContainer: document.body,
        sharedTopBar: compact, sharedTopBarArticleClose: close, inlineHeroHost: hero,
        getState: () => ({ bigCardOpen: false, inlineHeroVisible: mocks.heroVisible }),
        isHidden: () => true, isNavbarVisible: () => navbarVisible,
        captureMenuFocus: () => false, syncCornerControls() {},
    });
    try {
        let focusedLink;
        for (const [width, heroVisible, open, target] of [
            [1440, true, false, 'hero'], [1000, true, false, 'hero'],
            [1000, false, false, 'compact'], [1000, true, true, 'hero'],
            [375, true, false, 'compact'], [1440, true, false, 'hero'],
        ]) {
            vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(width);
            mocks.heroVisible = heroVisible; navbarVisible = open;
            controller.syncSharedTopBar();
            expect(document.querySelectorAll('.top-nav-home-button')).toHaveLength(1);
            expect(document.getElementById(target).querySelector('.top-nav-home-button')).not.toBeNull();
            if (target === 'compact') {
                expect(compact.inert).toBe(false);
                const slot = compact.querySelector(width <= 700 ? '.dataset-shared-topbar__slot--start' : '.dataset-shared-topbar__slot--end');
                expect(slot.querySelector('.top-nav-home-button')).not.toBeNull();
                if (width <= 700) expect(slot.firstElementChild.className).toBe('menu');
                expect(compact.querySelector('a').classList.contains('navbar-front-page-link')).toBe(true);
            }
            else {
                expect(hero.querySelector('nav').firstElementChild).toBe(document.querySelector('.top-nav-home-button'));
                expect(hero.querySelector('a').classList.contains('hero-dataset-tabs__button')).toBe(true);
                expect(hero.querySelector('a').classList.contains('navbar-front-page-link')).toBe(false);
                expect(document.body.dataset.sharedTopbarVisible).toBe('false');
            }
            const link = document.querySelector('.top-nav-home-button');
            if (focusedLink) {
                expect(link).toBe(focusedLink);
                expect(document.activeElement).toBe(focusedLink);
            } else { link.focus(); focusedLink = link; }
            controller.syncSharedTopBar();
            expect(document.activeElement).toBe(link);
            setFrontPageAvailability({ separate_front_page: true, front_page_button_site_name: 'Current site name' });
            expect(link.getAttribute('aria-label')).toBe('Current site name');
            expect(document.activeElement).toBe(link);
        }
    } finally { controller.destroy(); vi.restoreAllMocks(); }
    expect(document.querySelector('.top-nav-home-button')).toBeNull();
});

test.each(['settings-refresh', 'cached-reactivation'])('%s reconciles both Home transitions in one document', trigger => {
    const hero = document.getElementById('hero');
    const compact = document.getElementById('compact');
    hero.innerHTML = '<nav class="hero-dataset-tabs"></nav>';
    compact.innerHTML = '<div class="dataset-shared-topbar__slot--start"><button class="menu"></button></div>'
        + '<div class="dataset-shared-topbar__slot--end"></div>';
    const dataset = document.createElement('div'); dataset.className = 'content_div';
    document.body.append(dataset); dataset.append(hero, compact);
    const close = document.createElement('button'); compact.append(close);
    const syncCornerControls = vi.fn();
    const controller = createSharedTopbarVisibilityController({
        tableName: 'demo', currentView: 'card', tablePartsContainer: dataset,
        sharedTopBar: compact, sharedTopBarArticleClose: close, inlineHeroHost: hero,
        getState: () => ({ bigCardOpen: false, inlineHeroVisible: mocks.heroVisible }),
        isHidden: () => true, isNavbarVisible: () => false,
        captureMenuFocus: () => false, syncCornerControls,
    });
    try {
        // Reuse this exact controller/DOM for enable → disable and disable → enable.
        for (const enabled of [true, false, true, false]) {
            dataset.classList.toggle('hidden', trigger === 'cached-reactivation');
            setFrontPageAvailability({ separate_front_page: enabled });
            if (trigger === 'settings-refresh') {
                window.dispatchEvent(new Event(HOME_AVAILABILITY_CHANGED_EVENT));
            } else {
                dataset.classList.remove('hidden');
                // The runtime's existing host observer calls this on activation.
                controller.syncSharedTopBar();
            }
            expect(dataset.querySelectorAll('.top-nav-home-button')).toHaveLength(enabled ? 1 : 0);
        }
    } finally { controller.destroy(); }
    syncCornerControls.mockClear();
    setFrontPageAvailability({ separate_front_page: true });
    window.dispatchEvent(new Event(HOME_AVAILABILITY_CHANGED_EVENT));
    expect(syncCornerControls).not.toHaveBeenCalled();
    expect(dataset.querySelector('.top-nav-home-button')).toBeNull();
});

// The independent oracle is the literal pre-218 rule (a9b4520c^:95-105).
const visibilityStates = [1920, 1000, 700, 390].flatMap(width =>
    [true, false].flatMap(active => [true, false].flatMap(menu =>
        [true, false].flatMap(hero => [true, false].flatMap(filter =>
            [true, false].map(home => ({ width, active, menu, hero, filter, home })))))));
test.each(visibilityStates)('pre-218 visibility: %j', state => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(state.width);
    mocks.heroVisible = state.hero;
    const dataset = document.createElement('div');
    dataset.className = state.active ? 'content_div' : 'content_div hidden';
    dataset.innerHTML = '<div id="row"><nav class="hero-dataset-tabs"><button>Dataset</button></nav></div>'
        + '<div id="bar"><div class="dataset-shared-topbar__slot--end"></div><button></button></div>';
    document.body.append(dataset);
    setFrontPageAvailability({ separate_front_page: state.home });
    const bar = dataset.querySelector('#bar');
    const controller = createSharedTopbarVisibilityController({
        tableName: 'demo', currentView: 'card', tablePartsContainer: dataset,
        sharedTopBar: bar, sharedTopBarArticleClose: bar.querySelector('button'),
        inlineHeroHost: dataset.querySelector('#row'),
        getState: () => ({ bigCardOpen: false, inlineHeroVisible: state.hero }),
        isHidden: () => !state.filter, isNavbarVisible: () => state.menu,
        captureMenuFocus: () => false, syncCornerControls() {},
    });
    try {
        controller.syncSharedTopBar();
        const expected = state.active && (state.width <= 700 || (!state.hero && (!state.menu || !state.filter)));
        expect(dataset.dataset.sharedTopbarVisible).toBe(String(expected));
    } finally { controller.destroy(); vi.restoreAllMocks(); }
});
