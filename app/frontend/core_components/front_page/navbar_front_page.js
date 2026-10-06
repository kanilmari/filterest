// navbar_front_page.js
// Renders the static Home region each time the tab shell is rebuilt.
// Bridges auth-mode presentation fields, translations and the existing Home symbol.
// Observes view visibility so dataset and history navigation share one active state.

import { createSymbolMaskElement } from '../../reusable_components/symbol_asset_resolver.js';
import { bindDatasetLanguageRenderer } from '../table_views/dataset_value_localizer.js';
import { getTranslationForKey } from '../lang/translation_handler.js';
import { formatSiteNameForDisplay } from '../state_stores/site_identity_reader.js';
import { isFrontPageShowing, isSeparateFrontPageEnabled, openFrontPage } from './front_page_navigation.js';

let visibilityObserver = null;

export function renderNavbarFrontPage({ isLoggedIn }) {
    visibilityObserver?.disconnect();
    const container = document.getElementById('navbarFrontPage');
    if (!container) return;
    container.replaceChildren();
    container.hidden = !isSeparateFrontPageEnabled()
        || (!isLoggedIn && localStorage.getItem('login_required_for_browse') === 'true');
    if (container.hidden) return;

    const link = document.createElement('a');
    link.href = '/';
    link.className = 'navbar-front-page-link';
    link.append(createSymbolMaskElement('home', 'navbar-front-page-icon'));
    const label = document.createElement('span');
    label.className = 'navbar-front-page-label';
    bindDatasetLanguageRenderer(label, () => {
        const text = formatSiteNameForDisplay(localStorage.getItem('front_page_button_site_name'))
            || getTranslationForKey('front_page', { countUsage: false });
        label.textContent = text;
        link.title = text;
        link.setAttribute('aria-label', text);
        container.setAttribute('aria-label', text);
    });
    link.append(label);
    link.addEventListener('click', event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        void openFrontPage();
    });
    container.append(link);

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
