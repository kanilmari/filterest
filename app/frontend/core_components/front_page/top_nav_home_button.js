// top_nav_home_button.js
// Keeps an opted-in Home link in wide Home/dataset headers or the compact bar.
// Reuses the menu's link, including translations, gestures and custom root handling.
// Moving the same node avoids duplicate controls during header transitions.
import { canShowFrontPageLink, createFrontPageLink } from './front_page_link.js';
import { isHomeButtonInTopBarOnWideScreensEnabled } from './front_page_availability.js';
import { LAYOUT_BREAKPOINTS } from '../../ui_config.js';

/** Menu availability stays independent; phones never render a top-bar Home. */
export function canShowTopNavHomeButton() {
    return canShowFrontPageLink(localStorage.getItem('button_state') === 'logout')
        && window.innerWidth > LAYOUT_BREAKPOINTS.phone
        && isHomeButtonInTopBarOnWideScreensEnabled();
}

export function createTopNavHomeButton(options = {}) {
    return canShowTopNavHomeButton()
        ? createFrontPageLink({ ...options, topNavigation: true }) : null;
}

export function placeTopNavHomeButton(link, host) {
    if (!link || !host || link.parentElement === host) return;
    const focused = document.activeElement === link;
    const inHero = host.classList.contains('hero-dataset-tabs');
    link.classList.toggle('hero-dataset-tabs__button', inHero);
    // Keep tab colours and typography; shared Home CSS owns its larger target.
    link.classList.toggle('navbar-front-page-link', !inHero);
    host.prepend(link);
    // The dataset navigation may have no ordinary tabs, but still has Home.
    host.hidden = false;
    if (focused) link.focus({ preventScroll: true });
}
