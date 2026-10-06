// @vitest-environment jsdom
// Verifies favorites consume the existing tree's admitted tools, including API permissions.
// Connects the nav builder and favorite renderer without changing shared tree code.
import { beforeEach, expect, test, vi } from 'vitest';
import { create_navigation_buttons } from '../database_tree/nav_builder.js';
import { hasRoutePermission } from '../../route_permission_checker.js';
import { fetchFavorites } from './favorites_api.js';
import { render_tree } from '../../../reusable_components/vanilla_tree/vanilla_tree_builder.js';
import { ensureNavbarFavoritesSection, getFavoritesSectionAccount, renderNavbarFavorites } from './navbar_favorites_section.js';

import * as favoritesSection from './navbar_favorites_section.js';
vi.mock('../../user_tools/current_user_profile_fetcher.js', () => ({ fetchCurrentUserProfile: vi.fn(async () => ({ user_id: 42 })) }));

vi.mock('../../route_permission_checker.js', () => ({ hasRoutePermission: vi.fn() }));
vi.mock('../nav_engine/navigation_handler.js', () => ({ handle_all_navigation: vi.fn() }));
vi.mock('./favorites_api.js', () => ({ fetchFavorites: vi.fn(), addAdminToolFavorite: vi.fn(), removeAdminToolFavorite: vi.fn() }));
vi.mock('../../lang/translation_handler.js', () => ({ getTranslationForKey: (key) => key }));
vi.mock('../../../reusable_components/notifications/toast_notification_printer.js', () => ({ showToast: vi.fn() }));
vi.mock('../../../reusable_components/vanilla_tree/vanilla_tree_builder.js', () => ({
    render_tree: vi.fn(async (nodes) => {
        const tree = document.getElementById('admin_tools_tree');
        const appendLeaves = (entries) => entries.forEach((node) => {
            if (node.children) { appendLeaves(node.children); return; }
            const element = document.createElement('div');
            element.id = `tree_node_${node.id}_admin`;
            element.innerHTML = `<div class="node-row"><button>${node.name}</button></div>`;
            tree.appendChild(element);
        });
        appendLeaves(nodes);
    }),
}));

const views = [
    { name: 'permissions', group: 'admin_tools', requiredPermission: '/ui/admin/permissions' },
    { name: 'site_languages', group: 'admin_tools', requiredPermission: '/api/admin/ui-languages' },
];

beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="navbar"><div class="navtabs_relative"></div><section id="navbarFavoritesSection" hidden></section><div id="navContainer"></div></div>';
    ensureNavbarFavoritesSection(document.getElementById('navbar'), document.querySelector('.navtabs_relative'));
    await getFavoritesSectionAccount(document.getElementById('navbarFavoritesSection')).ready;
    fetchFavorites.mockResolvedValue({ owner_user_id: 42, favorites: views.map((view, i) => ({ id: i + 1, sort_order: i, type: 'admin_tool', route: view.requiredPermission })) });
});

test('maps only the permission-filtered leaves of the existing tree', async () => {
    hasRoutePermission.mockImplementation((route) => route !== '/api/admin/ui-languages');
    await create_navigation_buttons(views);
    await vi.waitFor(() => expect(document.querySelectorAll('.favorite-star')).toHaveLength(2));
    expect(document.querySelectorAll('.favorite-star')).toHaveLength(2);
    expect(document.querySelectorAll('#navbarFavoritesSection .navigation_buttons')).toHaveLength(1);
    expect(document.querySelector('#navbarFavoritesSection [data-lang-key="site_languages"]')).toBeNull();
});

test('API-backed tools use their existing route identity too', async () => {
    hasRoutePermission.mockReturnValue(true);
    await create_navigation_buttons(views);
    await vi.waitFor(() => expect(document.querySelectorAll('.favorite-star')).toHaveLength(4));
    expect(document.querySelector('#navbarFavoritesSection [data-lang-key="site_languages"]')).not.toBeNull();
    expect(document.querySelector('#tree_node_site_languages_admin .favorite-star').dataset.favoriteRoute).toBe('/api/admin/ui-languages');
});

test('ordinary users receive neither the administrator tree nor favorites', async () => {
    hasRoutePermission.mockReturnValue(false);
    await create_navigation_buttons(views);
    expect(render_tree).not.toHaveBeenCalled();
    expect(fetchFavorites).not.toHaveBeenCalled();
    expect(document.querySelectorAll('.favorite-star')).toHaveLength(0);
    expect(document.getElementById('navbarFavoritesSection').hidden).toBe(true);
});

test('a tree build started in the previous bootstrap cannot start a favorites GET', async () => {
    hasRoutePermission.mockReturnValue(true);
    let finishTree;
    render_tree.mockReturnValueOnce(new Promise((resolve) => { finishTree = resolve; }));
    const building = create_navigation_buttons(views);
    const section = document.getElementById('navbarFavoritesSection');
    const tree = document.getElementById('admin_tools_tree');

    ensureNavbarFavoritesSection(document.getElementById('navbar'), document.querySelector('.navtabs_relative'));
    finishTree();
    await building;

    expect(section.isConnected && tree.isConnected).toBe(true);
    expect(section.hidden).toBe(true);
    expect(fetchFavorites).not.toHaveBeenCalled();
});

test('a lazy renderer import cannot adopt the next bootstrap account', async () => {
    hasRoutePermission.mockReturnValue(true);
    const section = document.getElementById('navbarFavoritesSection');
    const tree = document.getElementById('navContainer');
    const rendering = renderNavbarFavorites(section, tree, views, views);
    ensureNavbarFavoritesSection(document.getElementById('navbar'), document.querySelector('.navtabs_relative'));
    section.hidden = false;
    section.textContent = 'Current account';

    await rendering;

    expect(section.textContent).toBe('Current account');
    expect(fetchFavorites).not.toHaveBeenCalled();
});


test('a stalled favorites GET does not hold up the completed tree build', async () => {
    hasRoutePermission.mockReturnValue(true);
    fetchFavorites.mockReturnValueOnce(new Promise(() => {}));
    await create_navigation_buttons(views);
    await vi.waitFor(() => expect(fetchFavorites).toHaveBeenCalledOnce());
    expect(document.getElementById('admin_tools_tree')).not.toBeNull();
    expect(document.getElementById('navbarFavoritesSection').hidden).toBe(true);
});

test('catches a rejected optional renderer promise', async () => {
    hasRoutePermission.mockReturnValue(true);
    const failure = new Error('renderer failed');
    vi.spyOn(favoritesSection, 'renderNavbarFavorites').mockRejectedValueOnce(failure);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await create_navigation_buttons(views);
    expect(warning).toHaveBeenCalledWith('Favorites rendering failed', failure);
});
