// filterbar_menu_history.test.js
// Verifies menu ownership between a retained dataset and Home on history return.
// Exercises the real filterbar runtime, Home row and navbar accessibility wiring.
// Proves focus follows the outgoing menu control without focusing the destination.
// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupFilterBarBuilderTestDom, resetFilterBarBuilderTestDom } from './filter_bar_builder_test_setup.js';

let row;
let style;
beforeEach(() => {
    resetFilterBarBuilderTestDom();
    style = document.createElement('style');
    style.textContent = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'shared_topbar.css'), 'utf8');
    document.head.append(style);
    localStorage.clear();
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(700);
    vi.doUnmock('./shared_topbar_builder.js');
    vi.doUnmock('../navigation/menu_button/navbar_visibility_handler.js');
    vi.doMock('../../ui_config.js', async importOriginal => ({ ...await importOriginal(), FILTERBAR_PANEL_MODE: 'inline-hero' }));
    vi.doMock('../admin_tools/front_page_settings_modal.js', () => ({ createFrontPageSettingsHeroButton: () => null }));
    const tabs = document.createElement('div');
    tabs.id = 'tabs_container';
    document.body.append(tabs);
    tabs.append(document.getElementById('demo_container'));
    document.getElementById('navbar').append(document.getElementById('hideMenuButton'));
    document.getElementById('navbar').classList.add('collapsed');
});

const scrollRestoreCases = [1280, 1849, 1850, 1851].flatMap(width =>
    ['card', 'article_view'].flatMap(view => [false, true].flatMap(open =>
        [false, true].flatMap(focused => ['topbar', 'fallback'].map(startingOwner =>
            ({ width, view, open, focused, startingOwner }))))));

test.each(scrollRestoreCases)(
    '$width px $view restores hero scroll after Forward from $startingOwner with open=$open and menu focus=$focused',
    async ({ width, view, open, focused, startingOwner }) => {
    vi.useFakeTimers();
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(width);
    const scrollable = document.getElementById('demo_card_view_container');
    scrollable.scrollTop = startingOwner === 'topbar' ? 350 : 24;
    const originalBounds = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
        if (this === scrollable) return { top: 0, bottom: 600, height: 600 };
        if (this.classList.contains('filterbar-inline-hero')) {
            return { top: -scrollable.scrollTop, bottom: 300 - scrollable.scrollTop, height: 300 };
        }
        return originalBounds.call(this);
    });
    const { create_filter_bar } = await import('./filter_bar_builder.js');
    const { createFrontPageTopRow } = await import('../front_page/front_page_top_row_builder.js');
    const { toggleNavbarVisibility } = await import('../navigation/menu_button/navbar_visibility_handler.js');
    const { VIEW_DEACTIVATE_EVENT } = await import('../../reusable_components/view_lifecycle_events.js');
    toggleNavbarVisibility();
    const panel = create_filter_bar('demo', 'demo_uid', ['id'], { id: 'INTEGER' }, 1, false, view);
    const dataset = document.getElementById('demo_container');
    const source = document.getElementById('showMenuButton');
    const close = document.getElementById('hideMenuButton');
    const bar = dataset.querySelector('.dataset-shared-topbar');
    const topbarMenu = bar.querySelector('[data-testid="shared-topbar-menu-button"]');
    // Model the slot's delayed visibility during a fade. Only the button's
    // synchronous ownership rule can hide it before the animation finishes.
    topbarMenu.parentElement.style.visibility = 'visible';
    const heroMenu = dataset.querySelector('.dataset-corner-controls--start button');
    // Keep the topbar eligible when the menu is open, including card view.
    panel.querySelector('.hide_filter_bar_button').click();
    if (open) toggleNavbarVisibility();
    dataset.dispatchEvent(new CustomEvent(VIEW_DEACTIVATE_EVENT));
    dataset.classList.add('hidden');
    const home = document.createElement('div');
    home.className = 'content_div front-page';
    document.getElementById('tabs_container').append(home);
    row = createFrontPageTopRow('Site'); home.append(row.element); row.mount();
    const unrelated = document.createElement('button');
    document.body.append(unrelated);
    // Focus only the outgoing Home control. Every subsequent handoff is automatic.
    (focused ? open ? close : source : unrelated).focus();
    row.destroy(); row = null; home.remove();
    dataset.classList.remove('hidden');
    await Promise.resolve();

    function expectOwner(opener) {
        const incoming = open ? close : opener;
        expect(document.activeElement).toBe(focused ? incoming : unrelated);
        expect(incoming.tabIndex).toBe(0);
        expect(incoming.getAttribute('aria-hidden')).toBe('false');
        expect(incoming.closest('[hidden], [inert], .hidden, [aria-hidden="true"]')).toBeNull();
        for (const button of [source, topbarMenu, heroMenu, close]) {
            expect(button.getAttribute('aria-hidden')).toBe(String(button !== incoming));
            expect(button.tabIndex).toBe(button === incoming ? 0 : -1);
        }
        expect(getComputedStyle(topbarMenu).visibility).toBe(topbarMenu === incoming ? 'visible' : 'hidden');
        expect(getComputedStyle(incoming).visibility).not.toBe('hidden');
        expect([source, topbarMenu, heroMenu, close].filter(button =>
            button.getAttribute('aria-hidden') === 'false' && button.tabIndex === 0
            && !button.closest('[hidden], [inert], .hidden, [aria-hidden="true"]')
            && getComputedStyle(button).visibility !== 'hidden')).toEqual([incoming]);
    }
    const startsInTopbar = startingOwner === 'topbar';
    expect(bar.getAttribute('aria-hidden')).toBe(String(!startsInTopbar));
    expect(bar.inert).toBe(!startsInTopbar);
    expectOwner(startsInTopbar ? topbarMenu : source);

    function scrollTo(scrollTop, opener) {
        scrollable.scrollTop = scrollTop;
        scrollable.dispatchEvent(new Event('scroll'));
        expect(bar.getAttribute('aria-hidden')).toBe(String(scrollTop < 300));
        expect(bar.inert).toBe(scrollTop < 300);
        // Announcing the incoming owner must start its CSS reveal in this task.
        expect(bar.classList.contains('dataset-shared-topbar--visible')).toBe(scrollTop >= 300);
        expectOwner(opener);
        // Sample before the hide deadline, during the incoming CSS reveal,
        // and after completion. No incoming control receives supplied focus.
        for (const elapsed of [16, 74, 89, 80, 1]) {
            vi.advanceTimersByTime(elapsed);
            expectOwner(opener);
        }
    }

    // History restores a partially visible hero after the topbar took focus.
    // Its corner is offscreen, so hiding the bar must hand focus to the fallback.
    if (startsInTopbar) scrollTo(24, source);
    // Mirror: the fallback owns focus when the hero scrolls away and the bar shows.
    scrollTo(350, topbarMenu);
    scrollTo(24, source);
    // Restore the hero's corner, then scroll it away while the hero stays visible.
    scrollTo(0, heroMenu);
    scrollTo(24, source);
    panel.__syncSharedTopBar();
    await Promise.resolve();
    expectOwner(source);
});
afterEach(() => {
    row?.destroy(); row = null;
    // Finish the shell transition before jsdom is destroyed, cancelling its
    // existing completion fallback rather than leaving a late window callback.
    const end = new Event('transitionend');
    Object.defineProperty(end, 'propertyName', { value: 'transform' });
    document.getElementById('navbar')?.dispatchEvent(end);
    cleanupFilterBarBuilderTestDom();
    style?.remove();
    vi.restoreAllMocks();
    localStorage.clear();
    document.body.replaceChildren();
});

const historyCases = [700, 1280, 1849, 1850, 1851].flatMap(width =>
    ['card', 'article_view'].flatMap(view => [false, true].flatMap(open =>
        [false, true].flatMap(focused => ['Back', 'Forward'].map(direction => ({ width, view, open, focused, direction }))))));

test.each(historyCases)(
    '$width px $view $direction with open=$open and outgoing menu focus=$focused', async ({ width, view, open, focused, direction }) => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(width);
    const { create_filter_bar } = await import('./filter_bar_builder.js');
    const { createFrontPageTopRow } = await import('../front_page/front_page_top_row_builder.js');
    const { toggleNavbarVisibility } = await import('../navigation/menu_button/navbar_visibility_handler.js');
    const { VIEW_DEACTIVATE_EVENT } = await import('../../reusable_components/view_lifecycle_events.js');
    toggleNavbarVisibility();
    const panel = create_filter_bar('demo', 'demo_uid', ['id'], { id: 'INTEGER' }, 1, false, view);
    const dataset = document.getElementById('demo_container');
    const source = document.getElementById('showMenuButton');
    const close = document.getElementById('hideMenuButton');
    const local = dataset.querySelector('[data-testid="shared-topbar-menu-button"]');
    const owner = source.__sharedTopbarMenuOwner;
    expect(source.classList.contains('shared-topbar-menu-source-hidden')).toBe(true);
    expect(source.tabIndex).toBe(-1);
    expect(local.tabIndex).toBe(0);
    if (open) toggleNavbarVisibility();
    const unrelated = document.createElement('button');
    document.body.append(unrelated);
    const outgoingDataset = open ? close : local;
    const backFocused = focused && direction === 'Back';
    (backFocused ? outgoingDataset : unrelated).focus();
    expect(document.activeElement).toBe(backFocused ? outgoingDataset : unrelated);

    // Navigation retains the dataset DOM; only its content container becomes hidden.
    dataset.dispatchEvent(new CustomEvent(VIEW_DEACTIVATE_EVENT));
    dataset.classList.add('hidden');
    const home = document.createElement('div');
    home.id = 'front_page_container'; home.className = 'content_div front-page';
    document.getElementById('tabs_container').append(home);
    row = createFrontPageTopRow('Site'); home.append(row.element); row.mount();
    expect(panel.isConnected).toBe(true);
    expect(source.classList.contains('shared-topbar-menu-source-hidden')).toBe(false);
    expect(source.__sharedTopbarMenuOwner).toBeNull();
    expect(source.getAttribute('aria-hidden')).toBe(String(open));
    expect(source.tabIndex).toBe(open ? -1 : 0);
    const incomingHome = open ? close : source;
    const expectSingleOwner = incoming => {
        expect([source, close, ...dataset.querySelectorAll('[data-navbar-menu-button="true"]')].filter(button =>
            button.getAttribute('aria-hidden') === 'false' && button.tabIndex === 0
            && !button.closest('[hidden], [inert], .hidden, [aria-hidden="true"]'))).toEqual([incoming]);
    };
    expectSingleOwner(incomingHome);
    expect(document.activeElement).toBe(backFocused ? incomingHome : unrelated);
    expect(incomingHome.getAttribute('aria-hidden')).toBe('false');
    expect(incomingHome.tabIndex).toBe(0);
    const slot = row.element.querySelector('.dataset-shared-topbar__menu-slot');
    expect(slot.hidden).toBe(open); expect(slot.inert).toBe(open);
    expect(slot.getAttribute('aria-hidden')).toBe(String(open));
    expect(local.tabIndex).toBe(-1);
    expect(getComputedStyle(local).visibility).toBe('hidden');
    // Pending dataset observers must also keep Home's source released.
    await Promise.resolve();
    expect(source.classList.contains('shared-topbar-menu-source-hidden')).toBe(false);
    expect(source.getAttribute('aria-hidden')).toBe(String(open));
    expect(document.activeElement).toBe(backFocused ? incomingHome : unrelated);

    // Only the OUTGOING Home control receives explicit focus before Forward.
    (focused ? incomingHome : unrelated).focus();
    row.destroy(); row = null; home.remove();
    dataset.classList.remove('hidden');
    await Promise.resolve();
    // Round 5: the navbar closer owns an open menu at every width, including phones.
    const localVisible = !open;
    expect(source.__sharedTopbarMenuOwner).toBe(localVisible ? owner : null);
    expect(source.classList.contains('shared-topbar-menu-source-hidden')).toBe(localVisible);
    expect(source.getAttribute('aria-hidden')).toBe('true'); expect(source.tabIndex).toBe(-1);
    expect(local.getAttribute('aria-hidden')).toBe(String(!localVisible));
    expect(local.tabIndex).toBe(localVisible ? 0 : -1);
    expect(getComputedStyle(local).visibility).toBe(localVisible ? 'visible' : 'hidden');
    const incomingDataset = open ? close : local;
    expectSingleOwner(incomingDataset);
    expect(incomingDataset.getAttribute('aria-hidden')).toBe('false');
    expect(incomingDataset.tabIndex).toBe(0);
    expect(document.activeElement).toBe(focused ? incomingDataset : unrelated);

    if (open) return;
    // Retain the original action and live Home-state proof after history checks.
    local.click();
    expect(document.getElementById('navbar').classList.contains('collapsed')).toBe(false);
    expect(close.getAttribute('aria-hidden')).toBe('false'); expect(close.tabIndex).toBe(0);
    expect(source.tabIndex).toBe(-1);
    expect(source.classList.contains('shared-topbar-menu-source-hidden')).toBe(false);
    expectSingleOwner(close);
    dataset.dispatchEvent(new CustomEvent(VIEW_DEACTIVATE_EVENT));
    dataset.classList.add('hidden');
    document.getElementById('tabs_container').append(home);
    row = createFrontPageTopRow('Site'); home.append(row.element); row.mount();
    const openSlot = row.element.querySelector('.dataset-shared-topbar__menu-slot');
    expect(openSlot.hidden).toBe(true); expect(openSlot.inert).toBe(true);
    expect(openSlot.getAttribute('aria-hidden')).toBe('true');
    expect(close.getAttribute('aria-hidden')).toBe('false'); expect(close.tabIndex).toBe(0);
    // Home's own state toggle must also preserve outgoing menu focus.
    close.focus();
    toggleNavbarVisibility();
    expect(openSlot.hidden).toBe(false); expect(openSlot.inert).toBe(false);
    expect(document.activeElement).toBe(source);
    toggleNavbarVisibility();
    expect(openSlot.hidden).toBe(true); expect(openSlot.inert).toBe(true);
    expect(document.activeElement).toBe(close);
});
