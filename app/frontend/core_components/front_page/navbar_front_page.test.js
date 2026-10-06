// navbar_front_page.test.js
// Proves Home visibility, translated/site labels and observed active state.
// Bridges the static shell region with the existing symbol and language renderer.
// Keeps long site names complete for assistive technology and native link gestures.
// @vitest-environment jsdom

import { beforeEach, expect, test, vi } from 'vitest';
import { renderNavbarFrontPage } from './navbar_front_page.js';
import { refreshLocalizedDatasetValues } from '../table_views/dataset_value_localizer.js';
const mocks = vi.hoisted(() => ({ open: vi.fn(), language: 'fi' }));
vi.mock('./front_page_navigation.js', () => ({
    openFrontPage: mocks.open,
    isSeparateFrontPageEnabled: () => localStorage.getItem('separate_front_page') === 'true',
    isFrontPageShowing: () => {
        const page = document.getElementById('front_page_container');
        return Boolean(page && !page.classList.contains('hidden') && page.hasChildNodes());
    },
}));
vi.mock('../lang/translation_handler.js', () => ({ getTranslationForKey: () => mocks.language === 'fi' ? 'Etusivu' : 'Home' }));

beforeEach(() => {
    document.body.innerHTML = '<nav id="navbarFrontPage" hidden></nav><div id="tabs_container"></div>';
    localStorage.clear();
    mocks.open.mockReset(); mocks.language = 'fi';
});

test('setting off hides the region for users and guests', () => {
    for (const isLoggedIn of [true, false]) {
        renderNavbarFrontPage({ isLoggedIn });
        expect(document.getElementById('navbarFrontPage').hidden).toBe(true);
        expect(document.querySelector('a')).toBeNull();
    }
});

test('setting on is visible to signed-in users and public guests, hidden for login-only guests', () => {
    localStorage.setItem('separate_front_page', 'true');
    for (const isLoggedIn of [true, false]) {
        renderNavbarFrontPage({ isLoggedIn });
        expect(document.getElementById('navbarFrontPage').hidden).toBe(false);
        expect(document.querySelector('.navbar-front-page-icon').getAttribute('aria-hidden')).toBe('true');
    }
    localStorage.setItem('login_required_for_browse', 'true');
    renderNavbarFrontPage({ isLoggedIn: false });
    expect(document.getElementById('navbarFrontPage').hidden).toBe(true);
});

test('label falls back to translated Home and follows interface-language changes', async () => {
    localStorage.setItem('separate_front_page', 'true');
    localStorage.setItem('front_page_button_site_name', '  ');
    renderNavbarFrontPage({ isLoggedIn: true });
    expect(document.querySelector('a').getAttribute('aria-label')).toBe('Etusivu');
    mocks.language = 'en';
    await refreshLocalizedDatasetValues('en');
    expect(document.querySelector('a').getAttribute('aria-label')).toBe('Home');
});

test('long site name stays complete in text, title and accessible name', async () => {
    const name = 'Long site '.repeat(10).trim();
    localStorage.setItem('separate_front_page', 'true');
    localStorage.setItem('front_page_button_site_name', name);
    renderNavbarFrontPage({ isLoggedIn: true });
    const link = document.querySelector('a');
    expect(link.title).toBe(name);
    expect(link.getAttribute('aria-label')).toBe(name);
    expect(link.textContent).toBe(name);
    mocks.language = 'en';
    await refreshLocalizedDatasetValues('en');
    expect(link.textContent).toBe(name);
});

test('active state tracks page visibility through switches and shell rebuilds', async () => {
    localStorage.setItem('separate_front_page', 'true');
    renderNavbarFrontPage({ isLoggedIn: true });
    const page = document.createElement('div');
    page.id = 'front_page_container'; page.textContent = 'content';
    document.getElementById('tabs_container').append(page);
    await vi.waitFor(() => expect(document.querySelector('a').getAttribute('aria-current')).toBe('page'));
    page.classList.add('hidden');
    await vi.waitFor(() => expect(document.querySelector('a').hasAttribute('aria-current')).toBe(false));
    page.classList.remove('hidden');
    renderNavbarFrontPage({ isLoggedIn: true });
    expect(document.querySelector('a').getAttribute('aria-current')).toBe('page');
    expect(document.querySelectorAll('a')).toHaveLength(1);
});

test('ordinary click opens Home and modified clicks keep the root href', () => {
    localStorage.setItem('separate_front_page', 'true');
    renderNavbarFrontPage({ isLoggedIn: true });
    const link = document.querySelector('a');
    link.click();
    expect(mocks.open).toHaveBeenCalledTimes(1);
    const event = new MouseEvent('click', { cancelable: true, ctrlKey: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(new URL(link.href).pathname).toBe('/');
});
