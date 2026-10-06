// @vitest-environment jsdom
// Keeps the empty quick-list shell stable between tabs and administrator tools.
import { expect, test, vi } from 'vitest';
import { ensureNavbarFavoritesSection } from './navbar_favorites_section.js';
import { ensureNavbarAdminToolsSection } from '../database_tree/navbar_admin_tools_section.js';

vi.mock('../../user_tools/current_user_profile_fetcher.js', () => ({ fetchCurrentUserProfile: vi.fn(async () => ({ user_id: 42 })) }));

test('creates one hidden favorites section and keeps admin tools after it', () => {
    document.body.innerHTML = '<div id="navbar"><div class="navtabs_relative"></div></div>';
    const navbar = document.getElementById('navbar');
    const tabs = navbar.firstElementChild;
    for (let i = 0; i < 2; i++) {
        const favorites = ensureNavbarFavoritesSection(navbar, tabs);
        ensureNavbarAdminToolsSection(navbar, favorites);
    }
    expect([...navbar.children].map((el) => el.id || el.className)).toEqual(['navtabs_relative', 'navbarFavoritesSection', 'navbarAdminToolsSection']);
    expect(document.getElementById('navbarFavoritesSection').hidden).toBe(true);
});
