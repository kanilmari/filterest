// front_page_top_row_builder.js
// Composes Home's site identity, shared dataset tabs and administrator actions.
// Borrows the shell's one menu button and restores it when Home leaves the view.
// Owns the tab subscription and navbar listener for exactly one mounted top row.

import { createHeroDatasetTabs } from '../navigation/main_tabs/hero_dataset_tabs.js';
import { formatSiteNameForDisplay, getCurrentSiteName } from '../state_stores/site_identity_reader.js';
import { NAVBAR_VISIBILITY_CHANGED_EVENT, syncNavbarMenuButtonAccessibility } from '../navigation/menu_button/navbar_visibility_handler.js';
import { createMaskIconSpan } from '../../icons/icon_mask_builder.js';
import { hasRoutePermission } from '../route_permission_checker.js';
import { HOME_PALETTE_COPY } from '../admin_tools/home_palette_copy.js';
import { getPaletteCopy } from '../admin_tools/presentation_palette_shell.js';
import { showToast } from '../../reusable_components/notifications/toast_notification_printer.js';
import { createFrontPageSettingsHeroButton } from '../admin_tools/front_page_settings_modal.js';

/** Reuse the hero grid/actions and tabs; no active dataset is selected on Home. */
export function createFrontPageTopRow(siteName, onSaved, paletteOptions = {}) {
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
    let destroyed = false;
    let palette = null;
    let paletteButton = null;
    let paletteLanguageObserver = null;
    if (hasRoutePermission('/api/admin/front-page')) {
        paletteButton = document.createElement('button');
        paletteButton.type = 'button';
        paletteButton.className = 'filterbar-inline-hero__cover-palette-button fw-btn';
        paletteButton.dataset.testid = 'home-palette-button';
        paletteButton.setAttribute('aria-expanded', 'false');
        paletteButton.append(createMaskIconSpan('/frontend/icons/general/home-palette-icon.svg', 'filterbar-inline-hero__cover-palette-icon'));
        const syncPaletteButtonCopy = () => {
            paletteButton.title = getPaletteCopy(HOME_PALETTE_COPY).button;
            paletteButton.setAttribute('aria-label', paletteButton.title);
        };
        syncPaletteButtonCopy();
        paletteLanguageObserver = new MutationObserver(syncPaletteButtonCopy);
        paletteLanguageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
        paletteButton.addEventListener('click', async event => {
            if (palette) return; // Once mounted, the shell owns the click toggle.
            event.preventDefault(); event.stopPropagation();
            paletteButton.disabled = true;
            try {
                const { mountHomePalette } = await import('../admin_tools/home_palette_builder.js');
                if (destroyed || !hasRoutePermission('/api/admin/front-page')) return;
                palette = mountHomePalette(paletteButton, paletteOptions);
                palette?.openPanel();
            } catch {
                if (!destroyed) showToast({ content: getPaletteCopy(HOME_PALETTE_COPY).loadFailed, level: 'error' });
            } finally { if (!destroyed) paletteButton.disabled = false; }
        });
        actions.append(paletteButton);
    }
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
            destroyed = true;
            paletteLanguageObserver?.disconnect();
            palette?.destroy();
            tabs.destroy();
            window.removeEventListener(NAVBAR_VISIBILITY_CHANGED_EVENT, syncMenu);
            if (menuButton && bookmark.parentNode) bookmark.replaceWith(menuButton);
            syncNavbarMenuButtonAccessibility();
        },
    };
}
