// front_page_top_row_builder.js
// Composes Home's site identity, shared dataset tabs and administrator actions.
// Borrows the shell's one menu button and restores it when Home leaves the view.
// Owns the tab subscription and navbar listener for exactly one mounted top row.

import { createHeroDatasetTabs } from '../navigation/main_tabs/hero_dataset_tabs.js';
import { formatSiteNameForDisplay, getCurrentSiteName } from '../state_stores/site_identity_reader.js';
import { NAVBAR_VISIBILITY_CHANGED_EVENT, syncNavbarMenuButtonAccessibility } from '../navigation/menu_button/navbar_visibility_handler.js';
import { createFrontPageSettingsHeroButton } from '../admin_tools/front_page_settings_modal.js';

/** Reuse the hero grid/actions and tabs; no active dataset is selected on Home. */
export function createFrontPageTopRow(siteName, onSaved) {
    const element = document.createElement('div');
    element.className = 'front-page-top-row filterbar-inline-hero__top-row';
    const start = document.createElement('div');
    start.className = 'front-page-top-row__identity';
    const menuSlot = document.createElement('div');
    menuSlot.className = 'dataset-shared-topbar__menu-slot';
    const menuButton = document.getElementById('showMenuButton');
    const bookmark = document.createComment('Home menu button return point');
    if (menuButton) {
        menuButton.before(bookmark);
        menuSlot.append(menuButton);
    }
    const icon = document.createElement('img');
    icon.className = 'front-page-site-icon';
    icon.alt = '';
    icon.width = icon.height = 32;
    const favicon = document.querySelector('link[rel~="icon"]');
    if (favicon?.href) icon.src = favicon.href;
    else icon.hidden = true;
    const title = document.createElement('div');
    title.className = 'dataset-shared-topbar__dataset-title';
    // A site without a saved name shows the shell's own name, as dataset heroes do.
    title.textContent = formatSiteNameForDisplay(siteName || getCurrentSiteName());
    title.title = title.textContent;
    start.append(menuSlot, icon, title);
    const tabs = createHeroDatasetTabs();
    const actions = document.createElement('div');
    actions.className = 'filterbar-inline-hero__actions';
    const gear = createFrontPageSettingsHeroButton(onSaved);
    if (gear) actions.append(gear);
    element.append(start, tabs.element, actions);
    function syncMenu() {
        const visible = Boolean(menuButton) && document.getElementById('navbar')?.classList.contains('collapsed');
        menuSlot.hidden = !visible;
        menuSlot.inert = !visible;
        menuSlot.setAttribute('aria-hidden', String(!visible));
        menuSlot.classList.toggle('dataset-shared-topbar__menu-slot--visible', visible);
    }
    syncMenu();
    syncNavbarMenuButtonAccessibility();
    window.addEventListener(NAVBAR_VISIBILITY_CHANGED_EVENT, syncMenu);
    return {
        element,
        destroy() {
            tabs.destroy();
            window.removeEventListener(NAVBAR_VISIBILITY_CHANGED_EVENT, syncMenu);
            if (menuButton && bookmark.parentNode) bookmark.replaceWith(menuButton);
            syncNavbarMenuButtonAccessibility();
        },
    };
}
