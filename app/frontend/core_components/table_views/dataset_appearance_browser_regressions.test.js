// dataset_appearance_browser_regressions.test.js
// Exercises cover previews and the card-to-article transition through real owners.
// Connects results, view assembly, article authorization and detached content.
// Reproduces browser failures without a server, database or network requests.
import { paletteSnapshot } from '../admin_tools/dataset_appearance_palette_test_fixtures.js';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const { fetchChildren, request } = vi.hoisted(() => ({ fetchChildren: vi.fn(async () => ({ child_tables: [] })), request: vi.fn() }));

vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: request }));
vi.mock('../endpoints/endpoint_data_fetcher.js', () => ({ fetchDatasetData: vi.fn() }));
vi.mock('../endpoints/stable_endpoint_router.js', () => ({
    fetchSitePresentationSettings: vi.fn(),
    fetchAdminUIFeatureFlags: vi.fn(), fetchCardVisibility: vi.fn(), saveDatasetAppearance: vi.fn(),
    saveAdminSitePresentationSettings: vi.fn(),
}));
vi.mock('../route_permission_checker.js', () => ({
    hasRoutePermission: () => true, hasDatasetPermission: async () => false, primeDatasetPermissions: vi.fn(),
}));
vi.mock('../config_fetcher.js', () => ({
    getDefaultViewSync: () => 'card', getDefaultDatasetSortSync: () => ({ column: '__newest', direction: 'DESC' }),
}));
vi.mock('../user_tools/current_user_profile_fetcher.js', () => ({ fetchCurrentUserProfile: async () => ({ user_id: 1 }) }));
vi.mock('../navigation/nav_engine/dataset_address_writer.js', async original => ({
    ...await original(), updateDatasetAddress: vi.fn(),
}));
vi.mock('../infinite_scroll/infinite_scroll_handler.js', () => ({
    initializeInfiniteScroll: vi.fn(), seedInfiniteScrollRowCount: vi.fn(), disconnectInfiniteScroll: vi.fn(),
    resetOffset: vi.fn(), updateOffset: vi.fn(), captureInfiniteScrollState: vi.fn(), resumeInfiniteScrollState: vi.fn(),
}));
vi.mock('../filterbar/filter_bar_builder.js', () => ({ create_filter_bar: vi.fn() }));
vi.mock('../filterbar/filter_list/active_filter_tag_printer.js', () => ({ renderActiveFilters: vi.fn() }));
vi.mock('../filterbar/filter_list/row_group_facet_printer.js', () => ({ renderRowGroupFacets: vi.fn() }));
vi.mock('./card_view/row_article_section_defaults.js', async original => ({
    ...await original(), loadRowArticleSectionDefaults: async () => ({}),
}));
vi.mock('./card_view/row_article_load_session.js', () => ({ createRowArticleLoadSession: () => ({
    fetchAttachmentLinking: async () => null, fetchDynamicChildren: fetchChildren,
}) }));

import { datasetAppearanceState } from './dataset_appearance_state.js';
import { DEFAULT_DATASET_APPEARANCE } from '../../shared/dataset_appearance/validator.js';
import { generate_table } from './dataset_view_printer.js';
import { openRowArticleView } from './card_view/row_article_opener.js';
import { buildRowArticleContent } from './card_view/row_article_content_builder.js';
import { setChosenDatasetView, getChosenDatasetView } from '../state_stores/dataset_view_choice_saver.js';
import { setAllSpecs } from '../state_stores/table_specs_reader.js';
import { fetchDatasetData } from '../endpoints/endpoint_data_fetcher.js';
import { fetchSitePresentationSettings } from '../endpoints/stable_endpoint_router.js';
import { mountDatasetCoverTestPalette } from '../admin_tools/dataset_cover_test_palette.js';
import { resetSitePresentationStatesForTests } from '../admin_tools/site_presentation_state.js';
import { primeDatasetAccessRegistry } from '../navigation/nav_engine/dataset_access_registry.js';
import { setUnifiedTableState } from '../state_stores/table_state_store.js';
import { captureLoadedDatasetRows } from './dataset_loaded_rows.js';
import { runApiToolsChatQuery, runCodingAgentChatQuery } from '../ai_features/table_chat/table_chat_query_runner.js';
import { invalidateSessionGeneration } from '../auth/session_generation_store.js';
import { refreshTableUnified } from '../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js';
import { renderActiveFilters } from '../filterbar/filter_list/active_filter_tag_printer.js';
import { setParams } from '../navigation/nav_engine/query_params.js';

const clone = value => JSON.parse(JSON.stringify(value));
const types = { id: { data_type: 'integer' }, title: { data_type: 'text', card_element: 'header', show_value_on_card: true },
    detail: { data_type: 'text', card_element: 'details', show_value_on_card: true } };
function result() {
    const effective = clone(DEFAULT_DATASET_APPEARANCE);
    return { data: [{ id: 42, title: 'Otsikko', detail: 'Arvo' }], columns: Object.keys(types), types, row_count: 1,
        dataset_appearance: { dataset_uid: 104, schema_version: 1, version: '1', shared_version: 'site-1',
            effective, shared: clone(effective), overrides: {} } };
}
let palette;
beforeEach(() => {
    datasetAppearanceState.clear(); request.mockReset(); request.mockResolvedValue({});
    resetSitePresentationStatesForTests(); localStorage.clear(); sessionStorage.clear(); setAllSpecs({});
    document.body.innerHTML = '<div id="tabs_container"></div>'; document.documentElement.lang = 'fi';
    window.history.replaceState({}, '', '/');
    setParams('demo', {});
    vi.mocked(fetchSitePresentationSettings).mockResolvedValue({ version: 'site-1',
        dataset_cover_theme: clone(DEFAULT_DATASET_APPEARANCE) });
    vi.mocked(fetchDatasetData).mockImplementation(async () => result());
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    fetchChildren.mockClear();
    vi.mocked(renderActiveFilters).mockReset();
    palette = null;
});
afterEach(() => { palette?.destroy(); vi.restoreAllMocks(); });

test.each(['start', 'end'])('empty searched cards keep %s chips when the first tree confirms their authorized UID', async side => {
    const response = result(); response.data = []; response.row_count = 0;
    response.dataset_appearance = paletteSnapshot(104);
    response.dataset_appearance.site_values['shared.active_filter_remove_side'] = side;
    setChosenDatasetView('demo', 'card'); setParams('demo', { search: 'chip-proof' });
    const realTags = await vi.importActual('../filterbar/filter_list/active_filter_tag_printer.js');
    vi.mocked(renderActiveFilters).mockImplementation(realTags.renderActiveFilters);
    let completeSettings;
    vi.mocked(fetchSitePresentationSettings).mockImplementationOnce(() => new Promise(resolve => { completeSettings = resolve; }));
    const pending = generate_table('demo', response.columns, [], types, 0, false, null, null, null,
        { datasetAppearance: response.dataset_appearance });
    await vi.waitFor(() => expect(completeSettings).toBeTypeOf('function'));
    // Startup runs the tree and initial dataset in parallel. A delayed public
    // settings read lets the first tree register this already authorized UID.
    setAllSpecs({ demo: { table_uid: 104 } });
    completeSettings({ schema_version: 2, version: 'site-1',
        site_values: response.dataset_appearance.site_values, defaults: response.dataset_appearance.defaults });
    expect(await pending).not.toBeNull();
    const row = document.querySelector('#demo_card_top_controls [data-testid="active-filters"]');
    expect(row).not.toBeNull(); expect(row.textContent).toContain('chip-proof');
    const chip = row.querySelector('[data-testid="active-filter-item"]');
    expect(chip.dataset.removeSide).toBe(side);
    expect(chip.firstElementChild.tagName).toBe(side === 'start' ? 'BUTTON' : 'SPAN');
    expect(document.querySelectorAll('[data-testid="active-filters"]')).toHaveLength(1);
    expect(document.querySelector('#demo_card_view_container .card_view_wrapper')).not.toBeNull();
    expect(document.querySelectorAll('#demo_card_view_container .card')).toHaveLength(0);
    expect(document.querySelector('#demo_card_top_controls [data-result-count="0"]')).not.toBeNull();
});

test.each(['API tools', 'coding agent'])('%s chat carries its pre-request appearance guard to the real renderer', async mode => {
    const response = result();
    let complete;
    if (mode === 'coding agent') request.mockResolvedValueOnce({ job_id: 'fixture', status: 'queued' });
    request.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const pending = mode === 'API tools' ? runApiToolsChatQuery('demo', 'find') : runCodingAgentChatQuery('demo', 'find');
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    const before = datasetAppearanceState.capture('demo').sequence;
    const accept = vi.spyOn(datasetAppearanceState, 'accept');
    complete({ status: 'completed', answer: 'Found', result: response });
    await pending;
    expect(document.getElementById('demo_container').dataset.datasetAppearanceUid).toBe('104');
    expect(accept.mock.calls[0][2].token.sequence).toBeLessThan(before);
});

test.each(['API tools', 'coding agent'].flatMap(mode => ['sign-out', 'deletion', 'ownership'].map(reason => [mode, reason])))(
    'delayed %s chat cannot restore private appearance after %s', async (mode, reason) => {
        const response = result();
        response.dataset_appearance.overrides = { 'shared.card_style_variant': 'standard' };
        response.dataset_appearance.effective.shared.card_style_variant = 'standard';
        datasetAppearanceState.accept('demo', response.dataset_appearance);
        const surface = document.createElement('section'); document.body.append(surface);
        datasetAppearanceState.bind(surface, 'demo');
        let complete;
        if (mode === 'coding agent') request.mockResolvedValueOnce({ job_id: 'fixture', status: 'queued' });
        request.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
        const pending = mode === 'API tools' ? runApiToolsChatQuery('demo', 'find') : runCodingAgentChatQuery('demo', 'find');
        const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError',
            failureNotice: { langKey: 'request_failed_notice' } });
        await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
        if (reason === 'sign-out') invalidateSessionGeneration({ reason: 'logout' });
        else if (reason === 'deletion') datasetAppearanceState.forget('demo');
        else setAllSpecs({ demo: { table_uid: 22 }, renamed: { table_uid: 104 } });
        complete({ status: 'completed', answer: 'Found', result: response });
        await rejected;
        expect(document.getElementById('demo_container')).toBeNull();
        expect(datasetAppearanceState.savedSnapshot('demo')).toBeNull();
        if (reason !== 'ownership') {
            expect(surface.dataset.datasetAppearanceUid).toBeUndefined();
            expect(surface.dataset.cardStyleVariant).toBeUndefined();
        }
    },
);

test('the real renderer rejects a mismatched snapshot before binding another dataset appearance', async () => {
    const response = result();
    datasetAppearanceState.accept('demo', response.dataset_appearance);
    const rejected = { ...response.dataset_appearance, dataset_uid: 22 };
    await generate_table('demo', response.columns, response.data, types, 1, false, null, null, null,
        { datasetAppearance: rejected, appearanceToken: datasetAppearanceState.capture('demo') });
    expect(document.getElementById('demo_container')).toBeNull();
});

test.each(['API tools', 'coding agent'])('%s chat cannot claim success after the renderer rejects a different UID', async mode => {
    const response = result(); datasetAppearanceState.accept('demo', response.dataset_appearance);
    response.dataset_appearance = { ...response.dataset_appearance, dataset_uid: 22 };
    if (mode === 'coding agent') request.mockResolvedValueOnce({ job_id: 'fixture', status: 'queued' });
    request.mockResolvedValueOnce({ status: 'completed', answer: 'Found', result: response });
    const pending = mode === 'API tools' ? runApiToolsChatQuery('demo', 'find') : runCodingAgentChatQuery('demo', 'find');
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(document.getElementById('demo_container')).toBeNull();
});

test('ordinary results and refresh discard a delayed snapshot after registry ownership changes', async () => {
    const response = result(); response.dataset_appearance.dataset_uid = 11;
    datasetAppearanceState.accept('demo', response.dataset_appearance);
    setAllSpecs({ demo: { table_uid: 11 } });
    let complete;
    vi.mocked(fetchDatasetData).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const pending = refreshTableUnified('demo', { skipUrlParams: true });
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    setAllSpecs({ demo: { table_uid: 22 }, renamed: { table_uid: 11 } });
    complete(response); await pending;
    expect(document.getElementById('demo_container')).toBeNull();
    expect(datasetAppearanceState.savedSnapshot('demo')).toBeNull();
});

test('the real renderer keeps detached renamed UID and replacement UID surfaces separate', async () => {
    const response = result(); response.dataset_appearance.dataset_uid = 11;
    response.dataset_appearance.overrides = { 'shared.card_style_variant': 'standard' };
    response.dataset_appearance.effective.shared.card_style_variant = 'standard';
    setAllSpecs({ demo: { table_uid: 11 } });
    await generate_table('demo', response.columns, response.data, types, 1, false, null, null, null,
        { datasetAppearance: response.dataset_appearance });
    const detached = document.getElementById('demo_container'); detached.remove();
    setAllSpecs({ renamed: { table_uid: 11 }, demo: { table_uid: 22 } });
    response.dataset_appearance = { ...result().dataset_appearance, dataset_uid: 22 };
    await generate_table('demo', response.columns, response.data, types, 1, false, null, null, null,
        { datasetAppearance: response.dataset_appearance });
    const replacement = document.getElementById('demo_container');
    datasetAppearanceState.paint('demo');
    expect(detached.dataset.datasetAppearanceUid).toBe('11');
    expect(detached.dataset.cardStyleVariant).toBe('standard');
    expect(replacement.dataset.datasetAppearanceUid).toBe('22');
    expect(replacement.dataset.cardStyleVariant).toBe('modern');
});

test('a card opens its authorized article in the visible article host and closes it', async () => {
    primeDatasetAccessRegistry({ datasets: [{ dataset_name: 'demo' }] });
    window.history.replaceState({}, '', '/demo');
    setChosenDatasetView('demo', 'card');
    setUnifiedTableState('demo', { offset: 1 });
    const response = result();
    await generate_table('demo', response.columns, response.data, types, 1, false, null, null, null,
        { datasetAppearance: response.dataset_appearance });
    const card = document.querySelector('.card');
    expect(card.querySelector('[data-testid="card-item-header"]')).not.toBeNull();
    card.querySelector('[data-testid="card-item-header"]').click();
    await vi.waitFor(() => expect(document.querySelector('[data-testid="big-card-container"]')).not.toBeNull());
    const article = document.querySelector('[data-testid="big-card-container"]');
    expect(getChosenDatasetView('demo')).toBe('article_view');
    expect(article.closest('.scrollable_content').style.display).toBe('block');
    expect(article.closest('.card_view_wrapper').classList.contains('big-card-open')).toBe(true);
    article.querySelector('[data-testid="big-card-close"]').click();
    expect(article.isConnected).toBe(false);
});

test.each([false, true])('the real v2 palette reaches a results-owned cover (card override: %s) and releases its preview', async overridden => {
    const response = result();
    response.dataset_appearance = paletteSnapshot(11, overridden ? { 'shared.card_detail_columns': 3 } : {});
    response.dataset_appearance.defaults['shared.card_detail_columns'] = 3;
    datasetAppearanceState.accept('demo', response.dataset_appearance);
    const host = document.getElementById('tabs_container'); datasetAppearanceState.bind(host, 'demo');
    const hero = document.createElement('section'); hero.className = 'filterbar-inline-hero--has-cover'; host.append(hero);
    palette = await mountDatasetCoverTestPalette(hero, 'demo', {
        permissionCheck: () => true, requestFn: async () => ({ view_admin_cover_image_test_palette: true }),
        settingsRequestFn: async () => ({ schema_version: 2, version: 'site-1',
            site_values: response.dataset_appearance.site_values, defaults: response.dataset_appearance.defaults }),
        datasetSettingsRequestFn: async () => ({ dataset_appearance: response.dataset_appearance, columns: [] }),
    });
    const toggle = palette.panel.querySelector('[data-testid="dataset-cover-test-palette-mask-enabled"]');
    toggle.click();
    expect(hero.style.getPropertyValue('--dataset-cover-light-mask-image')).toBe('none');
    expect(hero.dataset.cardDetailColumns).toBe('3');
    palette.panel.querySelector('[data-testid="dataset-cover-test-palette-tab-dark"]').click();
    toggle.click();
    expect(hero.style.getPropertyValue('--dataset-cover-dark-mask-image')).toBe('initial');
    palette.panel.querySelector('[data-testid="dataset-cover-test-palette-reset"]').click();
    expect(hero.style.getPropertyValue('--dataset-cover-light-mask-image')).toBe('initial');
    expect(hero.style.getPropertyValue('--dataset-cover-dark-mask-image')).toBe('none');
});

test('reopening from a retained hidden card mounts only in the current article panes', async () => {
    primeDatasetAccessRegistry({ datasets: [{ dataset_name: 'demo' }] });
    window.history.replaceState({}, '', '/demo');
    setChosenDatasetView('demo', 'card'); setUnifiedTableState('demo', { offset: 1 });
    const response = result();
    await generate_table('demo', response.columns, response.data, types, 1, false, null, null, null,
        { datasetAppearance: response.dataset_appearance });
    const retainedCard = document.querySelector('.card');
    expect(captureLoadedDatasetRows('demo')).not.toBeNull();
    retainedCard.querySelector('[data-testid="card-item-header"]').click();
    await vi.waitFor(() => expect(document.querySelector('[data-testid="big-card-container"]')).not.toBeNull());
    expect(retainedCard.closest('.scrollable_content').style.display).toBe('none');
    await openRowArticleView(response.data[0], 'demo', retainedCard);
    const article = document.querySelector('[data-testid="big-card-container"]');
    expect(document.querySelectorAll('[data-testid="big-card-container"]')).toHaveLength(1);
    expect(article.closest('.scrollable_content').style.display).toBe('block');
    expect(article.closest('.article_view_wrapper').querySelector('.card_sidebar_panel')).not.toBeNull();
    expect(article.querySelector(':scope > .row_article_content .row_article_disclosure_header')).not.toBeNull();
    expect(article.querySelector(':scope > .big_card_action_bar')).not.toBeNull();
});

test('settling the article address does not cancel its related panes and toolbars', async () => {
    setChosenDatasetView('demo', 'article_view');
    const response = result();
    await generate_table('demo', response.columns, response.data, types, 1, false, null, null, null,
        { datasetAppearance: response.dataset_appearance });
    let hydrate;
    vi.mocked(window.requestAnimationFrame).mockImplementation(callback => { hydrate = callback; return 1; });
    await openRowArticleView(response.data[0], 'demo', null, { isCurrent: () => !history.state?.bigCard });
    expect(document.querySelector('[data-testid="big-card-container"]')).not.toBeNull();
    expect(history.state.bigCard).toBe(true);
    hydrate();
    await vi.waitFor(() => expect(fetchChildren).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(document.querySelector(
        '.row_article_content > .row_article_related_items_section > .row_article_disclosure_header',
    )).not.toBeNull());
});

test.each(['sign-out', 'deletion', 'navigation', 'close'])(
    'a settled article still rejects hydration after %s', async reason => {
        setChosenDatasetView('demo', 'article_view');
        const response = result();
        await generate_table('demo', response.columns, response.data, types, 1, false, null, null, null,
            { datasetAppearance: response.dataset_appearance });
        let hydrate;
        vi.mocked(window.requestAnimationFrame).mockImplementation(callback => { hydrate = callback; return 1; });
        await openRowArticleView(response.data[0], 'demo');
        if (reason === 'sign-out') datasetAppearanceState.clear();
        else if (reason === 'deletion') datasetAppearanceState.forget('demo');
        else if (reason === 'navigation') document.getElementById('demo_container').classList.add('hidden');
        else document.querySelector('[data-testid="big-card-close"]').click();
        hydrate(); await Promise.resolve();
        expect(fetchChildren).not.toHaveBeenCalled();
    },
);

test('detached real article content retains its dataset owner and full-width disclosure host', async () => {
    datasetAppearanceState.accept('demo', result().dataset_appearance);
    const { rowArticleContentElement: content } = await buildRowArticleContent(
        result().data[0], 'demo', types, Object.keys(types), 'seed', 'O', false,
    );
    expect(content.dataset.datasetAppearanceUid).toBe('104');
    expect(content.querySelector('.row_article_disclosure_header')).not.toBeNull();
    document.body.append(content);
    expect(content.querySelector('.row_article_disclosure_header').closest('.row_article_content')).toBe(content);
});
