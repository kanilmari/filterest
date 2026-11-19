// navbar_all_articles_link.js
// Renders the menu's "All articles" link to the plain article index (/articles, WL175, owner decision D4).
// Bridges the accepted main dataset tabs, the browse-without-sign-in setting and the translation dictionary.
// An ordinary link: the plain index needs no application JavaScript, so the browser opens it as a new page.
import { bindDatasetLanguageRenderer } from '../../table_views/dataset_value_localizer.js';
import { getTranslationForKey } from '../../lang/translation_handler.js';

/** True when visitors may browse without signing in, as the auth-mode handler stored it. */
function siteIsBrowsableWithoutSignIn() {
    try {
        return localStorage.getItem('login_required_for_browse') !== 'true';
    } catch {
        return false;
    }
}

/**
 * Show the link when the menu lists at least one dataset whose rows the plain
 * index can publish (a project dataset or About) and the site can be browsed
 * without signing in; the index shows only what a signed-out visitor may read.
 * @param {{ tabs?: Array<{ dataset?: string, isProjectTable?: boolean }> }} options
 */
export function renderNavbarAllArticlesLink({ tabs = [] } = {}) {
    const container = document.getElementById('navbarAllArticles');
    if (!container) return;
    container.replaceChildren();
    const hasArticleDatasets = tabs.some(tab => tab?.isProjectTable === true || tab?.dataset === 'system_about');
    container.hidden = !(hasArticleDatasets && siteIsBrowsableWithoutSignIn());
    if (container.hidden) return;

    const link = document.createElement('a');
    link.href = '/articles';
    link.className = 'navbar-all-articles-link';
    link.dataset.testid = 'navbar-all-articles';
    bindDatasetLanguageRenderer(link, language => {
        const text = getTranslationForKey('public_articles_all', { countUsage: false, language });
        if (link.textContent !== text) link.textContent = text;
        if (container.getAttribute('aria-label') !== text) container.setAttribute('aria-label', text);
    });
    container.append(link);
}
