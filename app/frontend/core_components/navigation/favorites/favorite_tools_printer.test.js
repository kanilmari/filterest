// @vitest-environment jsdom
// favorite_tools_printer.test.js
// Verifies mapping, accessible stars, persistence failures, focus and auth lifecycle.
// Connects admitted tree leaves with mocked typed API responses and navigation.
// Keeps decorative icon clicks and translated names within the existing controls.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { renderFavoriteTools } from './favorite_tools_printer.js';
import { fetchFavorites, addAdminToolFavorite, removeAdminToolFavorite } from './favorites_api.js';
import { hasRoutePermission } from '../../route_permission_checker.js';
import { handle_all_navigation } from '../nav_engine/navigation_handler.js';
import { showToast } from '../../../reusable_components/notifications/toast_notification_printer.js';
import { ensureNavbarFavoritesSection, getFavoritesSectionAccount } from './navbar_favorites_section.js';
import { fetchCurrentUserProfile } from '../../user_tools/current_user_profile_fetcher.js';

vi.mock('../../user_tools/current_user_profile_fetcher.js', () => ({ fetchCurrentUserProfile: vi.fn(async () => ({ user_id: 42 })) }));
vi.mock('./favorites_api.js', () => ({ fetchFavorites: vi.fn(), addAdminToolFavorite: vi.fn(), removeAdminToolFavorite: vi.fn() }));
vi.mock('../../route_permission_checker.js', () => ({ hasRoutePermission: vi.fn(() => true) }));
vi.mock('../nav_engine/navigation_handler.js', () => ({ handle_all_navigation: vi.fn() }));
vi.mock('../../lang/translation_handler.js', () => ({ getTranslationForKey: (key) => ({
    favorites_heading: 'Suosikit', favorite_add: 'Lisää suosikkeihin', favorite_remove: 'Poista suosikeista',
    permissions: 'Käyttöoikeudet', site_languages: 'Sivuston kielet', favorite_save_failed: 'Suosikkia ei voitu tallentaa.',
    close: 'Sulje',
})[key] || key }));
vi.mock('../../../reusable_components/notifications/toast_notification_printer.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, showToast: vi.fn(actual.showToast) };
});

const views = [
    { name: 'permissions', requiredPermission: '/ui/admin/permissions' },
    { name: 'site_languages', requiredPermission: '/api/admin/ui-languages' },
];
const item = (i = 0, sort = i) => ({ id: i + 8, type: 'admin_tool', route: views[i].requiredPermission, sort_order: sort });
const section = () => document.getElementById('navbarFavoritesSection');
const tree = () => document.getElementById('admin_tools_tree');
const stars = () => tree().querySelectorAll('.favorite-star');
const render = () => renderFavoriteTools(section(), tree(), views, views);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('personal favorites', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        fetchCurrentUserProfile.mockReset().mockResolvedValue({ user_id: 42 });
        hasRoutePermission.mockReturnValue(true);
        fetchFavorites.mockResolvedValue({ owner_user_id: 42, favorites: [] });
        addAdminToolFavorite.mockResolvedValue({ owner_user_id: 42, favorite: item(), created: true });
        removeAdminToolFavorite.mockResolvedValue({ owner_user_id: 42, removed: true });
        document.body.innerHTML = `<div id="navbar"><div class="navtabs_relative"></div><section id="navbarFavoritesSection"></section>
            <section id="navbarAdminToolsSection"><button class="navbar-section-heading">Ylläpito</button></section>
            <div id="admin_tools_tree">${views.map((view) => `<div class="node" id="tree_node_${view.name}_admin"><div class="node-row"><button class="general_button_admin" data-lang-key="${view.name}">${view.name}</button></div></div>`).join('')}</div></div>`;
        ensureNavbarFavoritesSection(document.getElementById('navbar'), document.querySelector('.navtabs_relative'));
        await getFavoritesSectionAccount(section()).ready;
    });

    test('hides an empty list, adds accessible stars and toggles without opening the tool', async () => {
        const bubble = vi.fn();
        tree().addEventListener('click', bubble);
        await render();
        expect(section().hidden).toBe(true);
        expect(stars()).toHaveLength(2);
        const star = stars()[0];
        expect(star.type).toBe('button');
        expect(star.getAttribute('aria-pressed')).toBe('false');
        const labels = star.getAttribute('aria-labelledby').split(' ').map((id) => document.getElementById(id));
        expect(labels[0].textContent).toBe('Lisää suosikkeihin');
        expect(labels[1].dataset.langKey).toBe('permissions');
        const icon = star.querySelector(':scope > .favorite-star-icon');
        expect(icon.tagName).toBe('SPAN');
        expect(icon.getAttribute('aria-hidden')).toBe('true');
        expect(star.querySelectorAll('button, svg, img')).toHaveLength(0);
        expect(star.parentElement.lastElementChild).toBe(star);
        icon.click();
        expect(star.disabled).toBe(true);
        await settle();
        expect(addAdminToolFavorite).toHaveBeenCalledWith('/ui/admin/permissions');
        expect(bubble).not.toHaveBeenCalled();
        expect(handle_all_navigation).not.toHaveBeenCalled();
        expect(star.getAttribute('aria-pressed')).toBe('true');
        expect(labels[0].textContent).toBe('Poista suosikeista');
        expect(star.querySelector('.favorite-star-icon')).toBe(icon);
        expect(icon.textContent).toBe('');
        expect(section().hidden).toBe(false);
        expect(section().querySelector('h2').textContent).toBe('Suosikit');
        section().querySelector('.navigation_buttons').click();
        expect(handle_all_navigation).toHaveBeenCalledWith('permissions', views);
        star.click();
        await settle();
        expect(section().hidden).toBe(true);
        expect(star.getAttribute('aria-pressed')).toBe('false');
        expect(labels[0].textContent).toBe('Lisää suosikkeihin');
    });

    test('quick-list labels reuse administration buttons and keep the star last in each row', async () => {
        fetchFavorites.mockResolvedValue({ owner_user_id: 42, favorites: [item(0), item(1)] });
        await render();
        for (const row of section().querySelectorAll('li')) {
            const label = row.firstElementChild;
            const star = row.lastElementChild;
            expect(label.classList.contains('general_button_admin')).toBe(true);
            expect(label.classList.contains('general_button_nav')).toBe(false);
            expect(row.querySelectorAll(':scope > button')).toHaveLength(2);
            expect(star.className).toBe('favorite-star');
            expect(star.getAttribute('aria-pressed')).toBe('true');
            expect(star.querySelector('.favorite-star-icon').getAttribute('aria-hidden')).toBe('true');
            const name = star.getAttribute('aria-labelledby').split(' ')
                .map((id) => document.getElementById(id).textContent).join(' ');
            expect(name).toBe(`Poista suosikeista ${label.textContent}`);
            star.focus();
            expect(document.activeElement).toBe(star);
        }
    });

    test('uses insertion order and hides favorites with no visible tool', async () => {
        fetchFavorites.mockResolvedValue({ owner_user_id: 42, favorites: [item(1, 20), { ...item(), route: '/not-visible' }, item(0, 3)] });
        await render();
        expect([...section().querySelectorAll('.navigation_buttons')].map((el) => el.dataset.langKey)).toEqual(['permissions', 'site_languages']);
        expect(section().textContent).not.toContain('/not-visible');
    });

    test('removal focuses the next item and then the administrator header', async () => {
        fetchFavorites.mockResolvedValue({ owner_user_id: 42, favorites: [item(0), item(1)] });
        await render();
        section().querySelector('.favorite-star-icon').click();
        await settle();
        expect(document.activeElement.dataset.langKey).toBe('site_languages');
        expect(document.activeElement.classList.contains('general_button_admin')).toBe(true);
        section().querySelector('.favorite-star').click();
        await settle();
        expect(section().hidden).toBe(true);
        expect(document.activeElement.className).toBe('navbar-section-heading');
    });

    test('a failed save leaves the prior state and reports a translated notice', async () => {
        addAdminToolFavorite.mockRejectedValue(new Error('offline'));
        await render();
        stars()[0].click();
        await settle();
        expect(stars()[0].getAttribute('aria-pressed')).toBe('false');
        expect(stars()[0].disabled).toBe(false);
        expect(section().hidden).toBe(true);
        expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ langKey: 'favorite_save_failed' }));
        const toastClose = document.querySelector('[role="alert"] .toast-notification-close');
        expect(toastClose.tagName).toBe('BUTTON');
        expect(toastClose.getAttribute('aria-label')).toBe('Sulje');
    });

    test('a failed read renders neither stars nor list, and the rights gate makes no read', async () => {
        fetchFavorites.mockRejectedValue(new Error('offline'));
        await render();
        expect(stars()).toHaveLength(0);
        expect(section().hidden).toBe(true);
        fetchFavorites.mockClear();
        hasRoutePermission.mockReturnValue(false);
        await render();
        expect(fetchFavorites).not.toHaveBeenCalled();
    });

    test.each([false, true])('ignores a late read after logout (new login: %s)', async (newLogin) => {
        let resolve;
        fetchFavorites.mockReturnValue(new Promise((done) => { resolve = done; }));
        const rendering = render();
        await Promise.resolve();
        section().remove();
        if (newLogin) {
            const next = document.createElement('section');
            next.id = 'navbarFavoritesSection';
            next.hidden = true;
            document.body.appendChild(next);
        }
        resolve({ owner_user_id: 42, favorites: [item()] });
        await rendering;
        expect(stars()).toHaveLength(0);
        expect(section()?.children.length || 0).toBe(0);
    });

    test('a late write after logout cannot write a new login section or show a toast', async () => {
        let reject;
        addAdminToolFavorite.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
        await render();
        stars()[0].click();
        section().remove();
        reject(new Error('late failure'));
        await settle();
        expect(showToast).not.toHaveBeenCalled();
    });

    test('only the newest render can decorate a reused section', async () => {
        let resolve;
        fetchFavorites.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
        const oldRendering = render();
        await Promise.resolve();
        fetchFavorites.mockResolvedValueOnce({ owner_user_id: 42, favorites: [] });
        await render();
        resolve({ owner_user_id: 42, favorites: [item()] });
        await oldRendering;
        expect(section().hidden).toBe(true);
        expect(stars()).toHaveLength(2);
    });

    test.each(['add', 'remove'])('a %s result for another owner hides both surfaces and retires overlapping saves', async (operation) => {
        let finish;
        const pendingSave = new Promise((resolve) => { finish = resolve; });
        let finishOther;
        addAdminToolFavorite.mockReturnValueOnce(operation === 'add' ? pendingSave
            : new Promise((resolve) => { finishOther = resolve; }));
        if (operation === 'remove') {
            fetchFavorites.mockResolvedValueOnce({ owner_user_id: 42, favorites: [item()] });
            removeAdminToolFavorite.mockReturnValueOnce(pendingSave);
        }
        await render();
        const obsoleteStar = stars()[0];
        if (operation === 'remove') stars()[1].click();
        obsoleteStar.click();
        finish(operation === 'remove' ? { owner_user_id: 99, removed: true }
            : { owner_user_id: 99, favorite: item(), created: true });
        await settle();
        expect(section().hidden).toBe(true);
        expect(section().childElementCount).toBe(0);
        expect(stars()).toHaveLength(0);
        finishOther?.({ owner_user_id: 42, favorite: item(1), created: true });
        await settle();
        expect(section().hidden).toBe(true);
        expect(stars()).toHaveLength(0);
        expect(showToast).not.toHaveBeenCalled();
        obsoleteStar.click();
        expect(removeAdminToolFavorite).toHaveBeenCalledTimes(operation === 'remove' ? 1 : 0);
        expect(addAdminToolFavorite).toHaveBeenCalledTimes(1);
    });

    test.each(['add', 'remove', 'failure'])('a late %s save cannot change a newer rendering for the same owner', async (operation) => {
        let finish;
        const pending = new Promise((resolve, reject) => { finish = operation === 'failure' ? reject : resolve; });
        if (operation === 'remove') {
            fetchFavorites.mockResolvedValueOnce({ owner_user_id: 42, favorites: [item()] });
            removeAdminToolFavorite.mockReturnValueOnce(pending);
        } else addAdminToolFavorite.mockReturnValueOnce(pending);
        await render();
        const obsoleteStar = stars()[0];
        obsoleteStar.click();
        fetchFavorites.mockResolvedValueOnce({ owner_user_id: 42, favorites: [item(1)] });
        await renderFavoriteTools(section(), tree(), [views[1]], views);
        finish(operation === 'failure' ? new Error('late failure')
            : operation === 'remove' ? { owner_user_id: 42, removed: true }
                : { owner_user_id: 42, favorite: item(), created: true });
        await settle();
        expect([...section().querySelectorAll('.navigation_buttons')].map((el) => el.dataset.langKey)).toEqual(['site_languages']);
        expect(stars()).toHaveLength(1);
        expect(stars()[0].disabled).toBe(false);
        expect(showToast).not.toHaveBeenCalled();
        obsoleteStar.click();
        expect(addAdminToolFavorite).toHaveBeenCalledTimes(operation === 'remove' ? 0 : 1);
        expect(removeAdminToolFavorite).toHaveBeenCalledTimes(operation === 'remove' ? 1 : 0);
    });

    test.each([99, undefined, '42'])('rejects a delayed GET with owner %s', async (owner) => {
        let finish;
        fetchFavorites.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
        const rendering = render();
        await Promise.resolve();
        finish({ owner_user_id: owner, favorites: [item()] });
        await rendering;
        expect(section().hidden).toBe(true);
        expect(stars()).toHaveLength(0);
    });

    test.each(['GET', 'save'])('a previous account %s cannot replace account B in the same connected section and tree', async (operation) => {
        let finish;
        const pending = new Promise((resolve) => { finish = resolve; });
        let previousRendering;
        if (operation === 'GET') {
            fetchFavorites.mockReturnValueOnce(pending);
            previousRendering = render();
            await Promise.resolve();
        } else {
            addAdminToolFavorite.mockReturnValueOnce(pending);
            await render();
            stars()[0].click();
        }
        const originalSection = section();
        const originalTree = tree();
        fetchCurrentUserProfile.mockResolvedValueOnce({ user_id: 99 });
        ensureNavbarFavoritesSection(document.getElementById('navbar'), document.querySelector('.navtabs_relative'));
        fetchFavorites.mockResolvedValueOnce({ owner_user_id: 99, favorites: [item(1)] });
        await render();
        finish(operation === 'GET' ? { owner_user_id: 42, favorites: [item()] }
            : { owner_user_id: 42, favorite: item(), created: true });
        await previousRendering;
        await settle();
        expect(section()).toBe(originalSection);
        expect(tree()).toBe(originalTree);
        expect(section().hidden).toBe(false);
        expect([...section().querySelectorAll('.navigation_buttons')].map((el) => el.dataset.langKey)).toEqual(['site_languages']);
        expect(stars()).toHaveLength(2);
        expect(showToast).not.toHaveBeenCalled();
    });

    test('a replaced tree finishing late cannot clear the current quick list', async () => {
        const obsoleteTree = tree().cloneNode(true);
        fetchFavorites.mockResolvedValue({ owner_user_id: 42, favorites: [item()] });
        await render();

        await renderFavoriteTools(section(), obsoleteTree, views, views);

        expect(section().hidden).toBe(false);
        expect(section().querySelector('.navigation_buttons').dataset.langKey).toBe('permissions');
        expect(stars()).toHaveLength(2);
        expect(fetchFavorites).toHaveBeenCalledTimes(1);
    });
});
