// front_page_link.js
// Shares Home labels, root destination and activation between the menu and top navigation.
// Loads the navigation pipeline on activation so rendering needs no view modules.
// Keeps native gestures and keyboard activation on an ordinary accessible link.
import { createSymbolMaskElement } from '../../reusable_components/symbol_asset_resolver.js';
import { bindDatasetLanguageRenderer } from '../table_views/dataset_value_localizer.js';
import { getTranslationForKey } from '../lang/translation_handler.js';
import { formatSiteNameForDisplay } from '../state_stores/site_identity_reader.js';
import { isSeparateFrontPageEnabled } from './front_page_availability.js';

export function canShowFrontPageLink(isLoggedIn) {
    return isSeparateFrontPageEnabled()
        && (isLoggedIn || localStorage.getItem('login_required_for_browse') !== 'true');
}

/** Both menu and top navigation use this exact destination and activation path. */
export function createFrontPageLink({ topNavigation = false, current = false } = {}) {
    const link = document.createElement('a');
    link.href = '/';
    link.className = 'navbar-front-page-link';
    if (topNavigation) {
        link.classList.add('top-nav-home-button');
        link.dataset.testid = 'top-nav-home-button';
    }
    if (current) link.setAttribute('aria-current', 'page');
    link.append(createSymbolMaskElement('home', 'navbar-front-page-icon'));
    const label = document.createElement('span');
    label.className = 'navbar-front-page-label';
    bindDatasetLanguageRenderer(label, () => {
        const text = formatSiteNameForDisplay(localStorage.getItem('front_page_button_site_name'))
            || getTranslationForKey('front_page', { countUsage: false });
        label.textContent = text;
        link.title = text;
        link.setAttribute('aria-label', text);
        link.closest('#navbarFrontPage')?.setAttribute('aria-label', text);
    });
    link.append(label);
    link.addEventListener('click', event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        // A Home activation is navigation, not a click on the page outside the
        // menu. Preserve the existing outside-click policy for every other click.
        if (topNavigation) event.stopPropagation();
        // Native pointer and keyboard clicks can retry; synthetic/startup calls cannot.
        void import('./front_page_navigation.js').then(({ openFrontPage }) =>
            openFrontPage({ userActivation: event.isTrusted }));
    });
    return link;
}
