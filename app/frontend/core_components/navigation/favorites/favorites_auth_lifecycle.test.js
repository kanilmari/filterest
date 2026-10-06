// @vitest-environment jsdom
// Verifies personal shortcuts against real auth shell transitions and optional loading.
// Connects bootstrap, tree building, logout and modal credentials with controlled API results.
// Exists to prove account checks do not depend on broadcasts or erase still-valid favorites.
import { beforeEach, expect, test, vi } from 'vitest';
import { runPostAuthBootstrap } from '../../auth/post_auth_bootstrap.js';
import { applyLoggedOutShellReset, performSpaLogoutReset, navigateToSignOut } from '../../auth/logout_shell_reset.js';
import { handleAuthBroadcastEvent } from '../../auth/auth_broadcast_sync.js';
import { showLoginModal } from '../../auth/login_modal_printer.js';
import { setAuthModes } from '../../admin_tools/auth_mode_handler.js';
import { initTabs } from '../main_tabs/main_tab_printer.js';
import { create_navigation_buttons } from '../database_tree/nav_builder.js';
import { fetchCurrentUserProfile } from '../../user_tools/current_user_profile_fetcher.js';
import { endpoint_router } from '../../endpoints/endpoint_router.js';
import { isCrossTabLoginSyncEnabled } from '../../config_fetcher.js';
import { hideModal } from '../../../reusable_components/modal/modal_builder.js';
import { fetchFavorites, addAdminToolFavorite } from './favorites_api.js';

const permissions = vi.hoisted(() => new Set());
vi.mock('../../admin_tools/auth_mode_handler.js', () => ({
    setAuthModes: vi.fn(), hasRoutePermission: (route) => permissions.has(route), getButtonState: () => 'logout',
}));
vi.mock('../../admin_tools/main/oid_updater.js', () => ({ update_oids_and_table_names: vi.fn() }));
vi.mock('../../admin_tools/main/table_loader_handler.js', () => ({ load_tables: vi.fn(async () => create_navigation_buttons(views)) }));
vi.mock('../main_tabs/main_tab_printer.js', () => ({ initTabs: vi.fn() }));
vi.mock('../main_tabs/tab_reorder_handler.js', () => ({ enableTabDragAndDrop: vi.fn() }));
vi.mock('../../vanilla_tree/van_tr_components/admin_tree_builder.js', () => ({ initializeTreeCallAdmin: vi.fn() }));
vi.mock('../nav_engine/dataset_aliases.js', () => ({ refreshDatasetAliasRegistry: vi.fn(), getInternalDatasetName: vi.fn() }));
vi.mock('../../route_permission_checker.js', () => ({ clearPermissionCache: vi.fn(), hasRoutePermission: (route) => permissions.has(route) }));
vi.mock('../../admin_tools/admin_update_notice_subscriber.js', () => ({ syncAdminUpdateNoticeSubscriber: vi.fn(), stopAdminUpdateNoticeSubscriber: vi.fn() }));
vi.mock('../../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn() }));
vi.mock('../../pipeline/api_pipeline.js', () => ({ ensureCsrfToken: vi.fn(async () => null) }));
vi.mock('../../ai_features/table_chat/table_chat_printer.js', () => ({ destroy_chat: vi.fn() }));
vi.mock('../../auth/auth_broadcast.js', () => ({ publishAuthLogout: vi.fn(), publishAuthLogin: vi.fn(), subscribeToAuthBroadcast: vi.fn() }));
vi.mock('../../auth/login_shell_entry.js', () => ({ handleLoginShellEntry: vi.fn() }));
vi.mock('../../auth/session_access_prompt.js', () => ({ requestSessionAccessPrompt: vi.fn() }));
vi.mock('../../config_fetcher.js', () => ({ isCrossTabLoginSyncEnabled: vi.fn() }));
vi.mock('../../../reusable_components/modal/modal_builder.js', () => ({
    hideModal: vi.fn(), showModal: vi.fn(), createModal: vi.fn(({ contentElements }) => document.body.append(...contentElements)),
}));
vi.mock('../../auth/password_visibility_icon_reader.js', () => ({
    ensurePasswordVisibilityIconsLoaded: vi.fn(async () => {}), getPasswordVisibilityIcons: () => ({ visibilityOffSvg: '', visibilityOnSvg: '' }),
}));
vi.mock('../../../reusable_components/browser_identity_builder.js', () => ({ gather_browser_fingerprint_hash: vi.fn(async () => 'test-fingerprint') }));
vi.mock('../nav_engine/navigation_handler.js', () => ({ handle_all_navigation: vi.fn() }));
vi.mock('../../lang/translation_handler.js', () => ({ getTranslationForKey: (key) => key }));
vi.mock('../../user_tools/current_user_profile_fetcher.js', () => ({ fetchCurrentUserProfile: vi.fn() }));
vi.mock('./favorites_api.js', () => ({ fetchFavorites: vi.fn(), addAdminToolFavorite: vi.fn(), removeAdminToolFavorite: vi.fn() }));
vi.mock('../../../reusable_components/vanilla_tree/vanilla_tree_builder.js', () => ({
    render_tree: vi.fn(async () => {
        document.getElementById('admin_tools_tree').innerHTML = '<div id="tree_node_permissions_admin"><div class="node-row"><button>Permissions</button></div></div>';
    }),
}));

const views = [{ name: 'permissions', group: 'admin_tools', requiredPermission: '/ui/admin/permissions' }];
const item = { id: 8, type: 'admin_tool', route: '/ui/admin/permissions', sort_order: 0 };
const section = () => document.getElementById('navbarFavoritesSection');
const star = () => document.querySelector('#admin_tools_tree .favorite-star');
const deferred = () => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
};
const loginForm = '<form class="auth-form"><input id="username"><input id="password" type="password"><input id="csrf_token" value="token"><div id="otp-section"></div><input type="submit"></form>';

beforeEach(() => {
    vi.clearAllMocks();
    setAuthModes.mockReset().mockResolvedValue(undefined);
    isCrossTabLoginSyncEnabled.mockResolvedValue(true);
    fetchCurrentUserProfile.mockResolvedValue({ user_id: 42 });
    fetchFavorites.mockReset().mockResolvedValue({ owner_user_id: 42, favorites: [item] });
    addAdminToolFavorite.mockReset().mockResolvedValue({ owner_user_id: 42, favorite: item, created: true });
    endpoint_router.mockReset().mockImplementation(async (route) => {
        if (route === 'login') return { ok: true, text: async () => loginForm };
        if (route === 'logout') throw new Error('logout unavailable');
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'wrong_credentials' }) })));
    permissions.clear();
    ['/ui/nav_container', '/ui/nav_tree', '/api/favorites', '/ui/admin/permissions'].forEach((route) => permissions.add(route));
    localStorage.clear();
    sessionStorage.clear();
    history.replaceState({}, '', '/');
    document.body.innerHTML = '<div id="navbar"><div class="navtabs_relative"></div></div>';
});

async function beginPendingResult(operation) {
    const pending = deferred();
    if (operation === 'GET') fetchFavorites.mockReturnValueOnce(pending.promise);
    else {
        fetchFavorites.mockResolvedValueOnce({ owner_user_id: 42, favorites: [] });
        addAdminToolFavorite.mockReturnValueOnce(pending.promise);
    }
    await runPostAuthBootstrap();
    await vi.waitFor(() => expect(fetchFavorites).toHaveBeenCalledOnce());
    if (operation === 'save') {
        await vi.waitFor(() => expect(star()).not.toBeNull());
        star().click();
    }
    return pending;
}

function completeResult(pending, operation, owner = 42) {
    pending.resolve(operation === 'GET' ? { owner_user_id: owner, favorites: [item] }
        : { owner_user_id: owner, favorite: item, created: true });
}

test.each(['GET', 'save'].flatMap((operation) => [false, true].map((sync) => [operation, sync])))(
    'discards a delayed %s for account B in account A tab (login sync: %s)', async (operation, sync) => {
    const pending = await beginPendingResult(operation);
    const originalSection = section();
    isCrossTabLoginSyncEnabled.mockResolvedValue(sync);
    const authRefresh = deferred();
    setAuthModes.mockReturnValueOnce(authRefresh.promise);
    // With sync off the publisher emits nothing. With sync on an overlapping
    // event can arrive before the first shell refresh has verified account B.
    const transition = sync ? handleAuthBroadcastEvent({ type: 'login', eventId: 'first' }) : Promise.resolve();
    let overlappingTransition;
    if (sync) {
        await vi.waitFor(() => expect(setAuthModes).toHaveBeenCalledTimes(2));
        overlappingTransition = handleAuthBroadcastEvent({ type: 'login', eventId: 'second' });
    }
    completeResult(pending, operation, 99);
    await vi.waitFor(() => expect(document.querySelectorAll('.favorite-star')).toHaveLength(0));
    expect(section()).toBe(originalSection);
    expect(section().hidden).toBe(true);
    expect(section().childElementCount).toBe(0);
    if (sync) {
        fetchCurrentUserProfile.mockResolvedValueOnce({ user_id: 99 });
        fetchFavorites.mockResolvedValueOnce({ owner_user_id: 99, favorites: [item] });
        authRefresh.resolve();
        await Promise.all([transition, overlappingTransition]);
        await vi.waitFor(() => expect(section().hidden).toBe(false));
        expect(section()).toBe(originalSection);
        expect(fetchCurrentUserProfile).toHaveBeenLastCalledWith({ forceRefresh: true });
    }
});

test.each(['GET', 'save'])('the same account delayed %s renders after failed logout and failed fallback', async (operation) => {
    const pending = await beginPendingResult(operation);
    await expect(performSpaLogoutReset()).rejects.toThrow('logout unavailable');
    expect(await navigateToSignOut()).toBe(false);
    completeResult(pending, operation);
    await vi.waitFor(() => expect(section().hidden).toBe(false));
    expect(star().getAttribute('aria-pressed')).toBe('true');
});

test.each(['GET', 'save'])('the same account delayed %s renders after rejected modal credentials', async (operation) => {
    const pending = await beginPendingResult(operation);
    await showLoginModal();
    const form = document.querySelector('form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(form.querySelector('.error')).not.toBeNull());
    completeResult(pending, operation);
    await vi.waitFor(() => expect(section().hidden).toBe(false));
    expect(star().getAttribute('aria-pressed')).toBe('true');
});

test.each(['logout', 'credentials'])('existing favorites stay visible after rejected %s', async (attempt) => {
    await runPostAuthBootstrap();
    await vi.waitFor(() => expect(section().hidden).toBe(false));
    const originalSection = section();
    const originalStar = star();
    if (attempt === 'logout') await expect(performSpaLogoutReset()).rejects.toThrow('logout unavailable');
    else {
        await showLoginModal();
        const form = document.querySelector('form');
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(form.querySelector('.error')).not.toBeNull());
    }
    expect(section()).toBe(originalSection);
    expect(section().hidden).toBe(false);
    expect(star()).toBe(originalStar);
    expect(originalStar.disabled).toBe(false);
});

test('overlapping same-account login events preserve a pending result until the replacement bootstrap', async () => {
    const pending = await beginPendingResult('GET');
    const authRefresh = deferred();
    setAuthModes.mockReturnValueOnce(authRefresh.promise);
    const first = handleAuthBroadcastEvent({ type: 'login', eventId: 'first' });
    await vi.waitFor(() => expect(setAuthModes).toHaveBeenCalledTimes(2));
    const second = handleAuthBroadcastEvent({ type: 'login', eventId: 'second' });
    completeResult(pending, 'GET');
    await vi.waitFor(() => expect(section().hidden).toBe(false));
    authRefresh.resolve();
    await Promise.all([first, second]);
    await vi.waitFor(() => expect(section().hidden).toBe(false));
    expect(star().getAttribute('aria-pressed')).toBe('true');
});

test('a stalled favorites GET does not delay tabs or a successful login modal closing', async () => {
    fetchFavorites.mockReturnValue(new Promise(() => {}));
    await runPostAuthBootstrap();
    await vi.waitFor(() => expect(fetchFavorites).toHaveBeenCalledOnce());
    expect(initTabs).toHaveBeenCalledOnce();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ authenticated: true }) })));
    await showLoginModal();
    document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(hideModal).toHaveBeenCalledOnce());
    expect(initTabs).toHaveBeenCalledTimes(2);
    expect(section().hidden).toBe(true);
});

test('an unavailable profile leaves shortcuts hidden without delaying tabs', async () => {
    fetchCurrentUserProfile.mockRejectedValueOnce(new Error('profile unavailable'));
    await runPostAuthBootstrap();
    expect(initTabs).toHaveBeenCalledOnce();
    expect(fetchFavorites).not.toHaveBeenCalled();
    expect(section().hidden).toBe(true);
});

test('losing administrator tools removes an already rendered quick list', async () => {
    await runPostAuthBootstrap();
    await vi.waitFor(() => expect(section().hidden).toBe(false));
    const originalSection = section();
    permissions.delete('/ui/nav_container');
    await runPostAuthBootstrap();
    expect(originalSection.isConnected).toBe(false);
    expect(section()).toBeNull();
});

test('logout disconnects the original section before a new login creates one', async () => {
    await runPostAuthBootstrap();
    const originalSection = section();
    await applyLoggedOutShellReset({ postLogoutPath: '/' });
    expect(originalSection.isConnected).toBe(false);
    expect(section()).toBeNull();
    await runPostAuthBootstrap();
    expect(section()).not.toBe(originalSection);
});
