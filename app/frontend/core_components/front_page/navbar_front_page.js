// navbar_front_page.js
// Renders the static Home region each time the tab shell is rebuilt.
// Bridges auth-mode presentation fields, translations and the existing Home symbol.
// Observes view visibility so dataset and history navigation share one active state.

import { canShowFrontPageLink, createFrontPageLink } from './front_page_link.js';
import { isFrontPageShowing } from './front_page_navigation.js';
import { HOME_AVAILABILITY_CHANGED_EVENT } from './front_page_availability.js';

let visibilityObserver = null;
window.addEventListener(HOME_AVAILABILITY_CHANGED_EVENT, () => {
    renderNavbarFrontPage({ isLoggedIn: localStorage.getItem('button_state') === 'logout' });
});

export function renderNavbarFrontPage({ isLoggedIn }) {
    visibilityObserver?.disconnect();
    const container = document.getElementById('navbarFrontPage');
    if (!container) return;
    container.replaceChildren();
    container.hidden = !canShowFrontPageLink(isLoggedIn);
    if (container.hidden) return;

    const link = createFrontPageLink();
    container.append(link);
    container.setAttribute('aria-label', link.getAttribute('aria-label'));

    const updateActiveState = () => {
        if (isFrontPageShowing()) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    };
    updateActiveState();
    visibilityObserver = new MutationObserver(updateActiveState);
    const tabs = document.getElementById('tabs_container');
    if (tabs) visibilityObserver.observe(tabs, {
        attributes: true, attributeFilter: ['class'], childList: true, subtree: true,
    });
}
