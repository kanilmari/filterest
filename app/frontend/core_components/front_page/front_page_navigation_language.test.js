// @vitest-environment jsdom
// Proves Home's first mounted navigation uses the chosen dictionary before page translation.
// Connects the real Home printer, link, tab projection and shared translation cache.
// Keeps cold dictionaries and genuine later language changes distinct from layout fitting.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: mocks.request }));
vi.mock('../navigation/main_tabs/main_tab_printer.js', () => ({ openNavTab: vi.fn() }));
vi.mock('../navigation/main_tabs/main_dataset_tabs.js', () => ({
    getMainDatasetTabs: () => [{ dataset: 'news', text: 'News', langKey: 'news' }],
    subscribeMainDatasetTabs: () => () => {},
}));
vi.mock('./front_page_navigation.js', () => ({ openFrontPage: vi.fn(), isFrontPageShowing: () => true }));

const copy = { fi: { front_page: 'Etusivu', news: 'Pitkät matkailu-uutiset ja tarjoukset' },
    en: { front_page: 'Home', news: 'Travel news and offers' } };
let page;
beforeEach(() => {
    vi.resetModules();
    localStorage.clear(); sessionStorage.clear();
    window.translationPromises = {};
    document.body.innerHTML = '<div id="tabs_container"></div>';
    mocks.request.mockReset();
});
afterEach(() => { page?.__cleanupListeners?.(); vi.restoreAllMocks(); });

const labels = () => [...page.querySelectorAll('.navbar-front-page-label, .hero-dataset-tabs__label')];

test.each(['fi', 'en'])('cold %s Home mounts chosen labels before the later page translation', async language => {
    localStorage.setItem('chosen_language', language);
    // The shell's document language is not yet the viewer's language at startup.
    document.documentElement.lang = language === 'fi' ? 'en' : 'fi';
    let resolveTranslations;
    const dictionary = new Promise(resolve => { resolveTranslations = resolve; });
    mocks.request.mockImplementation((name, options) => {
        if (name === 'frontPage') return Promise.resolve({ viewer_id: 42, show_blocks: false, blocks: [],
            hero: { title: { fi: 'Kotisivu', en: 'Welcome' } } });
        if (name === 'translations') {
            const code = new URLSearchParams(options.url_params.replace(/^\?/, '')).get('lang');
            return code === language ? dictionary : Promise.resolve(copy[code]);
        }
        throw new Error(`Unexpected endpoint: ${name}`);
    });
    const { renderFrontPage } = await import('./front_page_printer.js');
    const { translatePage } = await import('../lang/translation_handler.js');
    const { setFrontPageAvailability } = await import('./front_page_availability.js');
    setFrontPageAvailability({ separate_front_page: true });
    page = renderFrontPage();
    await vi.waitFor(() => expect(mocks.request.mock.calls.some(([name]) => name === 'translations')).toBe(true));
    expect(labels()).toHaveLength(0);
    resolveTranslations(copy[language]);
    await vi.waitFor(() => expect(page.getAttribute('aria-busy')).toBe('false'));
    const firstLabels = labels();
    expect(firstLabels.map(label => label.textContent)).toEqual([copy[language].front_page, copy[language].news]);
    const home = firstLabels[0].closest('a');
    expect(home.title).toBe(copy[language].front_page);
    expect(home.getAttribute('aria-label')).toBe(copy[language].front_page);
    expect(firstLabels[1].closest('button').title).toBe(copy[language].news);

    const changes = [];
    const observer = new MutationObserver(records => changes.push(...records));
    for (const label of firstLabels) observer.observe(label, { childList: true, subtree: true, characterData: true });
    try {
        await translatePage(language);
        await translatePage(language);
        expect(labels()).toEqual(firstLabels);
        expect(firstLabels.map(label => label.textContent)).toEqual([copy[language].front_page, copy[language].news]);
        expect(changes).toHaveLength(0);
        expect(mocks.request.mock.calls.filter(([name]) => name === 'frontPage')).toHaveLength(1);
        expect(mocks.request.mock.calls.filter(([name, options]) => name === 'translations'
            && options.url_params === `?lang=${language}`)).toHaveLength(1);
    } finally { observer.disconnect(); }

    const next = language === 'fi' ? 'en' : 'fi';
    localStorage.setItem('chosen_language', next);
    // A real user change must still refresh both labels in place.
    window.translationPromises[next] = Promise.resolve(copy[next]);
    await translatePage(next);
    await vi.waitFor(() => expect(labels().map(label => label.textContent)).toEqual([copy[next].front_page, copy[next].news]));
});
