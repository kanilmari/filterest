// top_nav_home_button.js
// Keeps one Home link reachable in the active dataset's header or compact bar.
// Reuses the menu's link, including translations, gestures and custom root handling.
// Moving the same node avoids duplicate controls during header transitions.
import { canShowFrontPageLink, createFrontPageLink } from './front_page_link.js';

export function createTopNavHomeButton() {
    return canShowFrontPageLink(localStorage.getItem('button_state') === 'logout')
        ? createFrontPageLink({ topNavigation: true }) : null;
}

export function placeTopNavHomeButton(link, host) {
    if (!link || !host || link.parentElement === host) return;
    const focused = document.activeElement === link;
    const inHero = host.classList.contains('hero-dataset-tabs');
    link.classList.toggle('hero-dataset-tabs__button', inHero);
    // Use exactly the tab surface here; the menu's base link rules are larger.
    link.classList.toggle('navbar-front-page-link', !inHero);
    host.prepend(link);
    // The dataset navigation may have no ordinary tabs, but still has Home.
    host.hidden = false;
    if (focused) link.focus({ preventScroll: true });
}
