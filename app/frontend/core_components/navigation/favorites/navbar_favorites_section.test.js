// @vitest-environment jsdom
// navbar_favorites_section.test.js
// Keeps the empty quick-list shell stable between tabs and administrator tools.
// Connects shell renewal with account binding and decorated tree controls.
// Prevents old star icons or saved shortcuts surviving the next bootstrap.
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

test('renewing the shell removes whole star controls including their inner icons', () => {
    document.body.innerHTML = `<div id="navbar"><div class="navtabs_relative"></div>
        <section id="navbarFavoritesSection"><ul><li>
            <button class="navigation_buttons general_button_admin">Käyttöoikeudet</button>
            <button class="favorite-star"><span class="favorite-star-icon" aria-hidden="true"></span></button>
        </li></ul></section><div id="admin_tools_tree"><div class="node"><div class="node-row">
            <button class="general_button_admin favorite-tool-label">Käyttöoikeudet</button>
            <button class="favorite-star"><span class="favorite-star-icon" aria-hidden="true"></span></button>
        </div></div></div></div>`;
    const originalSection = document.getElementById('navbarFavoritesSection');
    const treeLabel = document.querySelector('#admin_tools_tree .favorite-tool-label');
    const nextSection = ensureNavbarFavoritesSection(document.getElementById('navbar'), document.querySelector('.navtabs_relative'));
    expect(nextSection).toBe(originalSection);
    expect(nextSection.hidden).toBe(true);
    expect(nextSection.childElementCount).toBe(0);
    expect(document.querySelectorAll('.favorite-star, .favorite-star-icon')).toHaveLength(0);
    expect(treeLabel.isConnected).toBe(true);
    expect(treeLabel.textContent).toBe('Käyttöoikeudet');
});
