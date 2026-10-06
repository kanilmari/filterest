// navbar_favorites_section.js
// Places the personal quick list between dataset tabs and administrator tools.
// Bridges the post-auth shell with a renderer loaded only for an allowed administrator.
// Exists to keep shell setup lightweight and preserve section identity across async work.
import { fetchCurrentUserProfile } from '../../user_tools/current_user_profile_fetcher.js';

export const NAVBAR_FAVORITES_SECTION_ID = 'navbarFavoritesSection';
const sectionAccounts = new WeakMap();

export function getFavoritesSectionAccount(section) {
    return sectionAccounts.get(section);
}

export function isFavoritesSectionAccountCurrent(section, account) {
    return Boolean(account) && sectionAccounts.get(section) === account;
}

/** Start an optional, freshly verified account binding for this shell bootstrap. */
export function ensureNavbarFavoritesSection(navbar, anchor) {
    let section = document.getElementById(NAVBAR_FAVORITES_SECTION_ID);
    if (!section) {
        section = document.createElement('section');
        section.id = NAVBAR_FAVORITES_SECTION_ID;
        section.hidden = true;
    }
    // Bind this bootstrap to the existing Account profile API, never to a favorites
    // response or browser storage. Refresh even within the profile cache's short TTL.
    const account = { userId: null, ready: null };
    sectionAccounts.set(section, account);
    section.replaceChildren();
    section.hidden = true;
    document.querySelectorAll('#admin_tools_tree .favorite-star').forEach((button) => button.remove());
    account.ready = fetchCurrentUserProfile({ forceRefresh: true }).then((profile) => {
        if (Number.isSafeInteger(profile?.user_id) && profile.user_id > 1) account.userId = profile.user_id;
    }).catch(() => {}); // Optional shortcuts stay hidden if the profile cannot be verified.
    navbar.insertBefore(section, anchor.nextSibling);
    return section;
}

/** Render only tools admitted by the existing admin tree's permission filter. */
export async function renderNavbarFavorites(section, treeContainer, visibleViews, customViews,
    account = getFavoritesSectionAccount(section)) {
    if (!section || !isFavoritesSectionAccountCurrent(section, account)) return;
    const { renderFavoriteTools } = await import('./favorite_tools_printer.js');
    if (section.isConnected && isFavoritesSectionAccountCurrent(section, account)) {
        await renderFavoriteTools(section, treeContainer, visibleViews, customViews, account);
    }
}
