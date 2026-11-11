// @vitest-environment jsdom
// A card header uses the selected row presentation. Inside a classic article,
// the compact record list opens its target directly. Both share the real Close and history owners.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DEFAULT_DATASET_APPEARANCE } from '../../../shared/dataset_appearance/validator.js';
import { appearanceValuesForPlace } from '../../../shared/dataset_appearance/snapshot.js';
import { setAllSpecs } from '../../state_stores/table_specs_reader.js';
import { getChosenDatasetView } from '../../state_stores/dataset_view_choice_saver.js';
import { load_tables } from '../../admin_tools/main/table_loader_handler.js';
import '../../navigation/nav_engine/history_navigation_handler.js';
import { disposeCardResources } from './card_resource_lifecycle.js';

const dataset = 'examples';
const records = [{ id: 3, title: 'Harbour' }, { id: 7, title: 'Forest' }];
const columns = ['id', 'title'];
const types = {
    id: { data_type: 'integer', card_element: 'details', show_value_on_card: true },
    title: { data_type: 'text', card_element: 'header', show_value_on_card: true },
};
const meta = { dataset_name: dataset, table_uid: 42, default_view_name: 'card', can_read_rows: true };
const permissions = ['/api/get-results', '/ui/view/card', '/ui/view/article_view'];
const appearance = { dataset_uid: 42, schema_version: 2, version: '1', shared_version: '1',
    defaults: appearanceValuesForPlace(DEFAULT_DATASET_APPEARANCE, 'site_default'),
    site_values: appearanceValuesForPlace(DEFAULT_DATASET_APPEARANCE, 'site_only'),
    tab_values: appearanceValuesForPlace(DEFAULT_DATASET_APPEARANCE, 'tab_only'), overrides: {} };

async function backend(route, { url_params = '', body_data = {} } = {}) {
    const query = new URLSearchParams(url_params);
    switch (route) {
    case 'productIdentity': return { private_upstream: false };
    case 'fetchContentTables': return { datasets: [meta], tab_order: [dataset] };
    case 'getResults': {
        const id = query.get('id');
        const data = id ? records.filter(row => String(row.id) === id) : records;
        return { columns, types, data, row_count: data.length, resultsPerLoad: 25,
            table_meta: meta, has_geo: false, dataset_appearance: appearance };
    }
    case 'fetchDynamicChildren': return { child_tables: [] };
    case 'fetchUserProfile': return { user_id: 1, username: 'Reader', language: 'en' };
    case 'getFilterbarSectionLayout': return { sections: [] };
    case 'getDatasetSortDefault': return { dataset, configured: false };
    case 'getViewFieldSets': return { dataset, view_key: query.get('view_key'), field_sets: [] };
    case 'getArticleSectionDefaults': return { dataset, presentation_key: query.get('presentation_key'), initial_open: {} };
    case 'checkTableRight': return { allowed: permissions.includes(query.get('route')) };
    case 'checkTableRights': return { allowed_by_route: Object.fromEntries(body_data.routes.map(key => [key, permissions.includes(key)])) };
    case 'assetLinkingStatus': return { attachment_asset_linkings: [] };
    default: throw new Error('Missing article-list fixture endpoint: ' + route);
    }
}
vi.mock('../../endpoints/endpoint_router.js', async original => ({ ...await original(), endpoint_router: (...args) => backend(...args) }));
vi.mock('../../endpoints/sse_subscriber.js', async original => ({
    ...await original(), setSSEActiveDataset() {}, clearSSEActiveDataset() {},
}));
vi.mock('../../lang/translation_handler.js', async original => ({ ...await original(), getTranslationForKey: key => key }));

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
afterEach(() => {
    const root = document.getElementById('examples_container');
    if (root) disposeCardResources(root);
    root?.querySelector('.filterbar-panel')?.destroy?.();
    document.body.replaceChildren();
    if (originalScrollIntoView) HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    else delete HTMLElement.prototype.scrollIntoView;
    vi.unstubAllGlobals();
    sessionStorage.clear();
    localStorage.clear();
});

beforeEach(() => {
    class Observer { observe() {} unobserve() {} disconnect() {} }
    vi.stubGlobal('innerWidth', 1440); // The wide article layout exposes its record list above 1200 px.
    vi.stubGlobal('IntersectionObserver', Observer);
    vi.stubGlobal('ResizeObserver', Observer);
    vi.stubGlobal('matchMedia', media => ({ media, matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    vi.stubGlobal('scrollTo', () => {});
    HTMLElement.prototype.scrollIntoView = () => {};
    vi.stubGlobal('fetch', async input => {
        const path = new URL(typeof input === 'string' ? input : input.url, location.href).pathname;
        if (path.endsWith('.svg')) return new Response('<svg xmlns="http://www.w3.org/2000/svg"/>');
        throw new Error('Missing article-list fixture resource: ' + path);
    });
    document.body.innerHTML = '<main class="body_content"><nav id="navbar"></nav><div id="tabs_container"></div></main>';
    sessionStorage.setItem('user_permissions', JSON.stringify(permissions));
    setAllSpecs({ [dataset]: meta });
});

const articleHost = () => document.getElementById('examples_article_view_container');
async function expectArticle(row) {
    await vi.waitFor(() => {
        expect(document.getElementById('examples_tab_parts_container').dataset.view).toBe('article_view');
        expect(getChosenDatasetView(dataset)).toBe('article_view');
        expect(location.pathname).toBe('/examples/' + row.id + '-' + row.title.toLowerCase());
        expect(new URLSearchParams(location.search).get('view')).toBe('article_view');
        expect(articleHost().querySelector('.active_row_article .big_card_header_value')?.textContent).toBe(row.title);
        expect(history.state).toMatchObject({ bigCard: true, rowId: String(row.id) });
    });
}
async function selectSecondArticle() {
    const summary = articleHost().querySelector('.card.small-card[data-id="7"] .card_small_summary');
    expect(summary.querySelector('.small_card_name_text').textContent).toBe('Forest');
    summary.click();
    await expectArticle(records[1]);
}

async function goBack() {
    const traversed = new Promise(resolve => window.addEventListener('popstate', resolve, { once: true }));
    history.back();
    await traversed;
}

test('closing B selected from the article record list restores the card list that opened A', async () => {
    history.replaceState({}, '', '/examples?view=card');
    await load_tables({ forceReload: true });
    const list = document.getElementById('examples_card_view_container');
    const originalCards = Array.from(list.querySelectorAll('.card[data-id]'));
    expect(originalCards.map(card => card.dataset.id)).toEqual(['3', '7']);
    const listURL = location.href;
    const parts = document.getElementById('examples_tab_parts_container');
    originalCards[0].querySelector('[data-testid="card-item-header"]').click();
    await expectArticle(records[0]);
    await selectSecondArticle();
    const lengthAtB = history.length;
    articleHost().querySelector('[data-testid="row-article-record-bar-close"]').click();
    await vi.waitFor(() => {
        expect(location.href).toBe(listURL);
        expect(parts.dataset.view).toBe('card');
        expect(getChosenDatasetView(dataset)).toBe('card');
        expect(list.style.display).not.toBe('none');
        expect(articleHost().querySelector('.active_row_article')).toBeNull();
        const restored = list.querySelectorAll('.card[data-id]');
        expect(restored).toHaveLength(originalCards.length);
        originalCards.forEach((card, index) => expect(restored[index]).toBe(card));
    });
    expect(history.length).toBe(lengthAtB + 1);
    await goBack();
    await expectArticle(records[1]);
});

test.each([
    { path: '/examples/3', changeRow: false, scenario: 'before changing records' },
    { path: '/examples/3/', changeRow: false, scenario: 'after normalizing a trailing slash' },
    { path: '/examples/3', changeRow: true, scenario: 'after selecting B and refreshing its slug' },
])('Close on a direct article $scenario preserves the correct Back destination', async ({ path, changeRow }) => {
    const precedingURL = '/examples?view=card&sort_column=title&sort_order=DESC';
    history.replaceState({ precedingPage: true }, '', precedingURL);
    // This models the browser visiting a bookmark. The real boot path owns the article entry.
    history.pushState(null, '', path + '?view=article_view');
    const bookmarkLength = history.length;
    await load_tables({ forceReload: true });
    await expectArticle(records[0]);
    expect(history.length).toBe(bookmarkLength);
    if (changeRow) {
        await selectSecondArticle();
        // Reload the same entry with an old row title; its refreshed slug still belongs to B.
        history.replaceState(history.state, '', '/examples/7-old-title?view=article_view');
        await load_tables({ forceReload: true });
        await expectArticle(records[1]);
        expect(history.length).toBe(bookmarkLength + 1);
    }

    const articleURL = location.pathname + location.search;
    const lengthBeforeClose = history.length;
    articleHost().querySelector('[data-testid="row-article-record-bar-close"]').click();
    await vi.waitFor(() => {
        expect(location.pathname).toBe('/examples');
        expect(new URLSearchParams(location.search).get('view')).toBe('card');
        expect(document.getElementById('examples_tab_parts_container').dataset.view).toBe('card');
    });
    const lengthAfterClose = history.length;
    await goBack();
    expect({ backURL: location.pathname + location.search, addedEntries: lengthAfterClose - lengthBeforeClose })
        .toEqual({ backURL: changeRow ? articleURL : precedingURL, addedEntries: changeRow ? 1 : 0 });
    if (changeRow) await expectArticle(records[1]);
    else expect(history.state.precedingPage).toBe(true);
});
