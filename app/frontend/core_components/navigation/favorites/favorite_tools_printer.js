// favorite_tools_printer.js
// Renders personal shortcuts and decorates the existing administrator tree with stars.
// Bridges typed favorites, already-filtered tree leaves, translation and normal navigation.
// Exists to avoid a second permission filter or changes to the shared tree renderer.
import { hasRoutePermission } from '../../route_permission_checker.js';
import { handle_all_navigation } from '../nav_engine/navigation_handler.js';
import { getTranslationForKey } from '../../lang/translation_handler.js';
import { showToast } from '../../../reusable_components/notifications/toast_notification_printer.js';
import { fetchFavorites, addAdminToolFavorite, removeAdminToolFavorite } from './favorites_api.js';
import { getFavoritesSectionAccount, isFavoritesSectionAccountCurrent } from './navbar_favorites_section.js';

let labelSequence = 0;
const renderGenerations = new WeakMap();

function translatedElement(tagName, key) {
    const element = document.createElement(tagName);
    element.dataset.langKey = key;
    element.textContent = getTranslationForKey(key);
    return element;
}

/** No nested icon target: the star mask is on the button, whose click stays local. */
function createFavoriteStar(label, route, selected, onToggle) {
    if (!label.id) label.id = `favorite-tool-label-${++labelSequence}`;
    const action = translatedElement('span', selected ? 'favorite_remove' : 'favorite_add');
    action.id = `favorite-action-${++labelSequence}`;
    action.className = 'favorite-action-label';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'favorite-star';
    button.dataset.favoriteRoute = route;
    button.setAttribute('aria-pressed', String(selected));
    button.setAttribute('aria-labelledby', `${action.id} ${label.id}`);
    button.appendChild(action);
    button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void onToggle(route, button);
    });
    return button;
}

/** Apply results only to the verified section owner and its current DOM generation. */
export async function renderFavoriteTools(section, treeContainer, visibleViews, customViews,
    account = getFavoritesSectionAccount(section)) {
    // A replaced tree can finish its build after a newer tree rendered this section.
    if (!isFavoritesSectionAccountCurrent(section, account) || !section.isConnected || !treeContainer.isConnected) return;
    const generation = {};
    renderGenerations.set(section, generation);
    const current = () => isFavoritesSectionAccountCurrent(section, account) && section.isConnected && treeContainer.isConnected
        && renderGenerations.get(section) === generation && hasRoutePermission('/api/favorites');
    treeContainer.querySelectorAll('.favorite-star').forEach((button) => button.remove());
    section.replaceChildren();
    section.hidden = true;
    await account.ready;
    if (!account.userId || !current()) return;
    const ownedResult = (result) => {
        if (!current()) return false;
        if (result?.owner_user_id === account.userId) return true;
        // A different shared session makes this tab stale, even when login sync is
        // disabled. Retire this generation so overlapping saves cannot revive it.
        renderGenerations.delete(section);
        section.replaceChildren();
        section.hidden = true;
        treeContainer.querySelectorAll('.favorite-star').forEach((button) => button.remove());
        return false;
    };
    let response;
    try { response = await fetchFavorites(); } catch { return; }
    if (!ownedResult(response) || !Array.isArray(response?.favorites)) return;

    const viewsByRoute = new Map(visibleViews.filter((view) => view.requiredPermission)
        .map((view) => [view.requiredPermission, view]));
    let favorites = response.favorites.filter((item) => item.type === 'admin_tool' && viewsByRoute.has(item.route));
    favorites.sort((left, right) => left.sort_order - right.sort_order || left.id - right.id);
    const pendingRoutes = new Set();

    function drawList() {
        section.replaceChildren();
        section.hidden = favorites.length === 0;
        if (section.hidden) return;
        const heading = translatedElement('h2', 'favorites_heading');
        heading.id = 'navbarFavoritesHeading';
        section.setAttribute('aria-labelledby', heading.id);
        const list = document.createElement('ul');
        for (const item of favorites) {
            const view = viewsByRoute.get(item.route);
            const row = document.createElement('li');
            const label = translatedElement('button', view.name);
            label.type = 'button';
            label.className = 'navigation_buttons general_button_nav';
            label.dataset.testid = `favorite-view-${view.name}`;
            label.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!current()) return;
                void handle_all_navigation(view.name, customViews);
            });
            row.append(label, createFavoriteStar(label, item.route, true, toggle));
            list.appendChild(row);
        }
        section.append(heading, list);
        syncStars();
    }

    function syncStars() {
        for (const star of treeContainer.querySelectorAll('.favorite-star')) {
            const selected = favorites.some((item) => item.route === star.dataset.favoriteRoute);
            star.setAttribute('aria-pressed', String(selected));
            const action = star.firstElementChild;
            const key = selected ? 'favorite_remove' : 'favorite_add';
            action.dataset.langKey = key;
            action.textContent = getTranslationForKey(key);
        }
        for (const star of [...treeContainer.querySelectorAll('.favorite-star'), ...section.querySelectorAll('.favorite-star')]) {
            star.disabled = pendingRoutes.has(star.dataset.favoriteRoute);
        }
    }

    async function toggle(route, button) {
        if (!current() || pendingRoutes.has(route)) return;
        const index = favorites.findIndex((item) => item.route === route);
        const removing = index >= 0;
        const removedFromList = section.contains(button);
        pendingRoutes.add(route);
        syncStars();
        try {
            const result = removing ? await removeAdminToolFavorite(route) : await addAdminToolFavorite(route);
            if (!ownedResult(result)) return;
            if (removing ? typeof result?.removed !== 'boolean' : !result?.favorite) throw new Error('favorite save failed');
            if (removing) favorites = favorites.filter((item) => item.route !== route);
            else {
                favorites.push(result.favorite);
                favorites.sort((left, right) => left.sort_order - right.sort_order || left.id - right.id);
            }
            drawList();
            if (removedFromList) {
                const labels = section.querySelectorAll('li > .navigation_buttons');
                (labels[Math.min(index, labels.length - 1)]
                    || document.querySelector('#navbarAdminToolsSection > .navbar-section-heading'))?.focus();
            }
        } catch {
            if (current()) showToast({
                level: 'error', langKey: 'favorite_save_failed', message: getTranslationForKey('favorite_save_failed'),
                dismissLabel: getTranslationForKey('close'),
            });
        } finally {
            pendingRoutes.delete(route);
            if (current()) syncStars();
        }
    }

    for (const view of visibleViews) {
        if (!view.requiredPermission) continue;
        const node = document.getElementById(`tree_node_${view.name}_admin`);
        const row = node?.querySelector(':scope > .node-row');
        const label = row?.querySelector(':scope > button');
        if (!row || !label || !treeContainer.contains(row)) continue;
        label.classList.add('favorite-tool-label');
        row.appendChild(createFavoriteStar(label, view.requiredPermission,
            favorites.some((item) => item.route === view.requiredPermission), toggle));
    }
    drawList();
    syncStars();
}
