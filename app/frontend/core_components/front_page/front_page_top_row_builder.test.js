// front_page_top_row_builder.test.js
// Verifies Home composes the live dataset tabs and releases their subscription.
// Connects main-tab snapshots to one real hero tab renderer, without navigation.
// Prevents detached Home rows from retaining stale permission-dependent tabs.
// @vitest-environment jsdom

import { expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ snapshot: [{ dataset: 'news', text: 'News', langKey: 'news' }], listeners: new Set(), unsubscribe: vi.fn() }));
vi.mock('../navigation/main_tabs/main_dataset_tabs.js', () => ({
    getMainDatasetTabs: () => mocks.snapshot,
    subscribeMainDatasetTabs: listener => {
        mocks.listeners.add(listener);
        return () => { mocks.listeners.delete(listener); mocks.unsubscribe(); };
    },
}));
vi.mock('../navigation/main_tabs/main_tab_printer.js', () => ({ openNavTab: vi.fn() }));
vi.mock('../admin_tools/front_page_settings_modal.js', () => ({ createFrontPageSettingsHeroButton: () => null }));
vi.mock('../lang/translation_handler.js', () => ({ getTranslationForKey: (_key, options) => options.fallback }));
import { createFrontPageTopRow } from './front_page_top_row_builder.js';

test('Home tabs have no active dataset, update from the shared model and unsubscribe on teardown', () => {
    document.body.innerHTML = '<div id="navbar"></div>';
    const row = createFrontPageTopRow('Site');
    document.body.append(row.element);
    row.mount();
    expect(row.element.querySelectorAll('.hero-dataset-tabs__button')).toHaveLength(1);
    expect(row.element.querySelector('[aria-current]')).toBeNull();
    for (const listener of mocks.listeners) listener([{ dataset: 'events', text: 'Events', langKey: 'events' }]);
    expect(row.element.querySelector('.hero-dataset-tabs__button').dataset.dataset).toBe('events');
    row.destroy();
    expect(mocks.listeners.size).toBe(0);
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
});

test('Home and phone identities prefer the resolved 128px icon; phone menu stays beside the full name when open', async () => {
    const { buildMobileSiteIdentity } = await import('../filterbar/mobile_site_identity_builder.js');
    const { NAVBAR_VISIBILITY_CHANGED_EVENT } = await import('../navigation/menu_button/navbar_visibility_handler.js');
    const width = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(320);
    document.head.innerHTML = '<link rel="icon" sizes="16x16" href="/chosen-16.png"><link rel="icon" sizes="128x128" href="/chosen-128.png">';
    document.body.innerHTML = '<div id="navbar" class="collapsed"></div><button id="showMenuButton"></button>';
    const button = document.getElementById('showMenuButton');
    const row = createFrontPageTopRow('Fintravel');
    document.body.append(row.element);
    row.mount();
    try {
        expect(row.element.querySelector('.front-page-site-icon').src).toMatch(/chosen-128\.png$/);
        expect(buildMobileSiteIdentity().querySelector('img').src).toMatch(/chosen-128\.png$/);
        for (const collapsed of [false, true]) {
            document.getElementById('navbar').classList.toggle('collapsed', collapsed);
            window.dispatchEvent(new Event(NAVBAR_VISIBILITY_CHANGED_EVENT));
            expect(row.element.querySelector('.dataset-shared-topbar__menu-slot').hidden).toBe(false);
            expect(button.getAttribute('aria-hidden')).toBe('false');
            expect(button.tabIndex).toBe(0);
            expect(row.element.querySelector('.front-page-site-name').textContent).toBe('Fintravel');
        }
        document.getElementById('navbar').classList.remove('collapsed');
        width.mockReturnValue(706);
        window.dispatchEvent(new Event('resize'));
        expect(row.element.querySelector('.dataset-shared-topbar__menu-slot').hidden).toBe(false);
    } finally {
        row.destroy(); width.mockRestore(); document.head.replaceChildren();
    }
    expect(button.parentElement).toBe(document.body);
});

test('the overlay menu follows the complete header height and releases its measurement on teardown', () => {
    const callbacks = [];
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback) { callbacks.push(callback); }
        observe() {}
        disconnect() {}
    });
    document.body.innerHTML = '<div class="body_content"><div id="navbar"></div></div>';
    const body = document.querySelector('.body_content');
    const row = createFrontPageTopRow('Fintravel');
    body.append(row.element);
    row.mount();
    const measure = vi.spyOn(row.element, 'getBoundingClientRect').mockReturnValue({ height: 272 });
    try {
        callbacks.at(-1)();
        expect(body.style.getPropertyValue('--home-top-row-height')).toBe('272px');
        measure.mockReturnValue({ height: 316 });
        callbacks.at(-1)();
        expect(body.style.getPropertyValue('--home-top-row-height')).toBe('316px');
    } finally {
        row.destroy(); vi.unstubAllGlobals();
    }
    expect(body.style.getPropertyValue('--home-top-row-height')).toBe('');
});
