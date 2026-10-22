// front_page_link.js
// Shares Home labels, root destination and activation between the menu and top navigation.
// Loads the navigation pipeline on activation so rendering needs no view modules.
// Keeps native gestures and keyboard activation on an ordinary accessible link.
import { createSymbolMaskElement } from '../../reusable_components/symbol_asset_resolver.js';
import { bindDatasetLanguageRenderer } from '../table_views/dataset_value_localizer.js';
import { getTranslationForKey, loadTranslationsForLanguage } from '../lang/translation_handler.js';
import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';
import { formatSiteNameForDisplay } from '../state_stores/site_identity_reader.js';
import { isSeparateFrontPageEnabled } from './front_page_availability.js';

export function canShowFrontPageLink(isLoggedIn) {
    return isSeparateFrontPageEnabled()
        && (isLoggedIn || localStorage.getItem('login_required_for_browse') !== 'true');
}

/** Load label copy alongside Home's content, without waiting for the page translation pass.
 * Both reads share the translator's request cache; English is only the missing-key fallback.
 */
export async function loadFrontPageNavigationLanguage(language) {
    const languages = language === 'en' ? ['en'] : [language, 'en'];
    await Promise.all(languages.map(async code => {
        try { await loadTranslationsForLanguage(code); }
        catch (error) {
            // A dictionary outage must leave Home's existing readable fallback available.
            console.warn('Home navigation translations unavailable:', code, error);
        }
    }));
}

/** Settings refresh and language changes share the same visible/accessibility copy. */
export function refreshFrontPageLinkLabel(link, language = getLanguageWithBrowserFallback()) {
    const text = formatSiteNameForDisplay(localStorage.getItem('front_page_button_site_name'))
        || getTranslationForKey('front_page', { countUsage: false, language });
    const label = link.querySelector('.navbar-front-page-label');
    if (label.textContent !== text) label.textContent = text;
    if (link.title !== text) link.title = text;
    if (link.getAttribute('aria-label') !== text) link.setAttribute('aria-label', text);
    const region = link.closest('#navbarFrontPage');
    if (region && region.getAttribute('aria-label') !== text) region.setAttribute('aria-label', text);
}

/** Both menu and top navigation use this exact destination and activation path. */
export function createFrontPageLink({ topNavigation = false, current = false,
    language = getLanguageWithBrowserFallback() } = {}) {
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
    link.append(label);
    bindDatasetLanguageRenderer(label, code => refreshFrontPageLinkLabel(link, code), language);
    link.addEventListener('click', event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        // Bubble through the same document outside-click closer as dataset tabs.
        // Native pointer and keyboard clicks can retry; synthetic/startup calls cannot.
        void import('./front_page_navigation.js').then(({ openFrontPage }) =>
            openFrontPage({ userActivation: event.isTrusted }));
    });
    return link;
}
