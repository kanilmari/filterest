// navbar_all_articles_link.test.js
// Pins when the menu shows its "All articles" link and where the link leads (WL175).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../lang/translation_handler.js', () => ({
    getTranslationForKey: (key, { language } = {}) => (language === 'fi' ? 'Kaikki artikkelit' : 'All articles'),
}));
vi.mock('../../table_views/dataset_value_localizer.js', () => ({
    bindDatasetLanguageRenderer: (element, render) => render('fi'),
}));

const { renderNavbarAllArticlesLink } = await import('./navbar_all_articles_link.js');

describe('renderNavbarAllArticlesLink', () => {
    beforeEach(() => {
        document.body.innerHTML = '<nav id="navbarAllArticles" hidden></nav>';
        localStorage.clear();
    });
    afterEach(() => localStorage.clear());

    test('links to the plain index when the menu has a project dataset', () => {
        renderNavbarAllArticlesLink({ tabs: [{ dataset: 'travel_deals', isProjectTable: true }] });
        const container = document.getElementById('navbarAllArticles');
        const link = container.querySelector('a');
        expect(container.hidden).toBe(false);
        expect(link.getAttribute('href')).toBe('/articles');
        expect(link.textContent).toBe('Kaikki artikkelit');
        expect(container.getAttribute('aria-label')).toBe('Kaikki artikkelit');
    });

    test('About alone is enough', () => {
        renderNavbarAllArticlesLink({ tabs: [{ dataset: 'system_about', isProjectTable: false }] });
        expect(document.getElementById('navbarAllArticles').hidden).toBe(false);
    });

    test('stays hidden without article datasets', () => {
        renderNavbarAllArticlesLink({ tabs: [{ dataset: 'system_users' }] });
        const container = document.getElementById('navbarAllArticles');
        expect(container.hidden).toBe(true);
        expect(container.children).toHaveLength(0);
    });

    test('stays hidden on a site that requires signing in', () => {
        localStorage.setItem('login_required_for_browse', 'true');
        renderNavbarAllArticlesLink({ tabs: [{ dataset: 'travel_deals', isProjectTable: true }] });
        expect(document.getElementById('navbarAllArticles').hidden).toBe(true);
    });

    test('a second render replaces the first link', () => {
        const tabs = [{ dataset: 'travel_deals', isProjectTable: true }];
        renderNavbarAllArticlesLink({ tabs });
        renderNavbarAllArticlesLink({ tabs });
        expect(document.querySelectorAll('#navbarAllArticles a')).toHaveLength(1);
    });
});
