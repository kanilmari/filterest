// @vitest-environment jsdom
// Proves article denials through the real history handler and dataset address owner.
// Uses actual Back/Forward, URL/cache/entry stores and notices; replaces network and drawing.
// Keeps a denial from repairing the landed entry now or during a later settled refresh.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const shell = vi.hoisted(() => ({
    navigate: vi.fn(async () => ({})), close: vi.fn(), openImage: vi.fn(),
    title: vi.fn(async () => true), root: vi.fn(async () => false), endpoint: vi.fn(),
}));
vi.mock('./navigation_handler.js', () => ({ handle_all_navigation: shell.navigate }));
vi.mock('./browser_tab_title_writer.js', () => ({ updateBrowserTabTitle: shell.title }));
vi.mock('../../front_page/custom_root_navigation.js', () => ({ loadCustomRootFromHistory: shell.root }));
vi.mock('../../table_views/card_view/row_article_ui_handler.js', () => ({ closeRowArticle: shell.close }));
vi.mock('../../table_views/card_view/image_first_view_opener.js', () => ({ openImageFirstView: shell.openImage }));
vi.mock('../../endpoints/endpoint_router.js', () => ({ endpoint_router: shell.endpoint }));
vi.mock('../admin_and_user_tools/custom_view_reader.js', () => ({ custom_views: [] }));
vi.mock('../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js', async () => ({
    ...await import('../../state_stores/table_state_store.js'), invalidateTableRefresh: vi.fn(),
}));
vi.mock('./card_article_return_state.js', () => ({
    canRestoreCardArticleReturn: () => false, restoreCardArticleReturn: () => false,
    getCardArticleReturnToken: () => null, refreshCardArticleReturnViewport: vi.fn(),
}));

import './history_navigation_handler.js';
import { primeDatasetAccessRegistry } from './dataset_access_registry.js';
import { setParams } from './query_params.js';
import { getUnifiedTableState, setUnifiedTableState } from '../../state_stores/table_state_store.js';
import { getChosenDatasetView, setChosenDatasetView } from '../../state_stores/dataset_view_choice_saver.js';
import { setDatasetRowSelected, getDatasetRowSelection, resetDatasetRowSelectionStoreForTests } from '../../table_views/dataset_row_selection_store.js';
import { updateDatasetAddress, replaceDatasetAddressQuery, writeDatasetAddress, resetDatasetAddressOwnershipForTests } from './dataset_address_writer.js';
import { handleImageFirstViewHistory, beginImageFirstViewOpen } from './image_first_view_history.js';

const notice = '[data-lang-key="article_view_permission_missing"]';
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
async function traverse(direction) {
    const landed = await new Promise(resolve => {
        window.addEventListener('popstate', () => resolve({ href: location.href, state: structuredClone(history.state) }), { once: true });
        history[direction]();
    });
    await settle();
    await settle();
    return landed;
}

beforeEach(() => {
    vi.restoreAllMocks(); vi.clearAllMocks();
    shell.navigate.mockReset().mockResolvedValue({});
    shell.root.mockReset().mockResolvedValue(false);
    shell.openImage.mockReset().mockResolvedValue({});
    localStorage.clear(); sessionStorage.clear();
    resetDatasetAddressOwnershipForTests();
    history.replaceState({ __filterestEntryId: 'source' }, '', '/events?view=card');
    primeDatasetAccessRegistry({ datasets: [{ dataset_name: 'events', table_uid: 7, can_read_rows: true }] });
    sessionStorage.setItem('user_permissions', '[]');
    setChosenDatasetView('events', 'card');
    setParams('events', { view: 'card' });
    setUnifiedTableState('events', { articleView: { collapsed: false, expandedId: null } });
    resetDatasetRowSelectionStoreForTests();
    setDatasetRowSelected('events', 4, { id: 4, title: 'Selected row' }, true);
    document.body.innerHTML = '<div id="events_container"><div class="tab_parts_container" data-view="card"><div class="scrollable_content"><span id="retained">Current rows</span></div></div></div>';
    document.querySelector('.scrollable_content').scrollTop = 271;
    const range = document.createRange(); range.selectNodeContents(document.getElementById('retained'));
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
});
afterEach(() => { window.getSelection().removeAllRanges(); resetDatasetRowSelectionStoreForTests(); vi.restoreAllMocks(); });

test.each(['article_view', 'image_first_view'].flatMap(view => ['back', 'forward'].flatMap(direction =>
    ['login', 'logout'].flatMap(mode => ['address', 'history'].map(source => [view, direction, mode, source])))))(
    'denied %s via %s for %s from %s retains the exact landed address, entry and mounted surface', async (view, direction, mode, source) => {
        localStorage.setItem('button_state', mode);
        const url = source === 'history' ? '/events?search=harbour#image=one.jpg'
            : `/events/7?view=${view}&search=harbour#image=one.jpg`;
        const targetState = source === 'history' ? {
            __filterestDatasetView: { dataset: 'events', path: '/events', view },
            unrelated: { keep: 9 }, nullable: null,
        } : { bigCard: true, dataset: 'events', rowId: '7', unrelated: { keep: 9 },
            ...(view === 'image_first_view' ? { imageFirstView: { dataset: 'events', rowId: '7', scroll: 420 } } : {}) };
        // No entry ID is required: denial must not add one through ensureHistoryEntryId.
        if (direction === 'back') {
            history.replaceState(targetState, '', url);
            history.pushState({ __filterestEntryId: 'source' }, '', '/events?view=card');
        } else {
            history.pushState(targetState, '', url);
            await traverse('back');
        }
        const retained = document.getElementById('retained');
        const state = structuredClone(getUnifiedTableState('events'));
        const scroll = document.querySelector('.scrollable_content').scrollTop;
        const selection = window.getSelection().toString();
        const selectedRows = getDatasetRowSelection('events');
        vi.clearAllMocks();
        const replace = vi.spyOn(history, 'replaceState'), push = vi.spyOn(history, 'pushState');
        const landed = await traverse(direction);
        expect(landed.href).toBe(new URL(url, location.origin).href);
        expect(landed.state).toEqual(targetState);
        expect(location.href).toBe(landed.href);
        expect(history.state).toEqual(landed.state);
        expect(document.querySelectorAll(notice)).toHaveLength(1);
        expect(document.getElementById('retained')).toBe(retained);
        expect(getChosenDatasetView('events')).toBe('card');
        expect(getUnifiedTableState('events')).toEqual(state);
        expect(document.querySelector('.scrollable_content').scrollTop).toBe(scroll);
        expect(window.getSelection().toString()).toBe(selection);
        expect(getDatasetRowSelection('events')).toEqual(selectedRows);
        expect(shell.navigate).not.toHaveBeenCalled(); expect(shell.close).not.toHaveBeenCalled();
        expect(shell.openImage).not.toHaveBeenCalled();
        expect(shell.title).not.toHaveBeenCalled();
        // These are the writers a later table refresh/filter cleanup invokes.
        expect(await updateDatasetAddress({ dataset: 'events' })).toBe(false);
        expect(replaceDatasetAddressQuery('events', { view: 'card' })).toBe(false);
        expect(location.href).toBe(landed.href); expect(history.state).toEqual(landed.state);
        expect(replace).not.toHaveBeenCalled(); expect(push).not.toHaveBeenCalled();
        // An intentional navigation can leave the denied entry normally.
        writeDatasetAddress('events', { view: 'card' });
        expect(location.pathname + location.search).toBe('/events?view=card');
    }
);

test.each(['article_view', 'image_first_view'].flatMap(view => ['back', 'forward'].map(direction => [view, direction])))(
    'allowed history-only %s via %s restores its recorded view and reconciles the address', async (view, direction) => {
        sessionStorage.setItem('user_permissions', JSON.stringify(['/ui/view/article_view']));
        const targetState = { __filterestEntryId: 'allowed-history', other: { keep: 4 },
            __filterestDatasetView: { dataset: 'events', path: '/events', view } };
        if (direction === 'back') {
            history.replaceState(targetState, '', '/events?search=harbour#saved');
            history.pushState({ __filterestEntryId: 'source' }, '', '/events?view=card');
        } else {
            history.pushState(targetState, '', '/events?search=harbour#saved');
            await traverse('back');
        }
        shell.navigate.mockClear();
        await traverse(direction);
        expect(getChosenDatasetView('events')).toBe(view);
        expect(shell.navigate).toHaveBeenCalledOnce();
        expect(location.pathname + location.search + location.hash).toBe(`/events?search=harbour&view=${view}#saved`);
        expect(history.state).toMatchObject({ __filterestEntryId: 'allowed-history', other: { keep: 4 } });
        expect(document.querySelectorAll(notice)).toHaveLength(0);
    }
);

test.each([
    ['/events?view=card', { dataset: 'events', path: '/events', view: 'article_view' }],
    ['/events', { dataset: 'other', path: '/events', view: 'article_view' }],
    ['/events', { dataset: 'events', path: '/other', view: 'image_first_view' }],
])('restoration of %s ignores a superseded or unrelated recorded view', async (url, remembered) => {
    history.replaceState({ __filterestDatasetView: remembered }, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.waitFor(() => expect(shell.navigate).toHaveBeenCalledOnce());
    expect(getChosenDatasetView('events')).toBe('card');
    expect(document.querySelectorAll(notice)).toHaveLength(0);
});

test('standalone IFAV history denial keeps its entry and blocks later refresh repair', async () => {
    history.replaceState({ imageFirstView: { dataset: 'events', rowId: '7' }, other: 4 }, '', '/events/7?view=image_first_view#image=one.jpg');
    const href = location.href, state = structuredClone(history.state);
    const replace = vi.spyOn(history, 'replaceState'), push = vi.spyOn(history, 'pushState');
    await handleImageFirstViewHistory({ tableName: 'events', rowId: '7' });
    await updateDatasetAddress({ dataset: 'events' });
    expect(replaceDatasetAddressQuery('events', { view: 'card' })).toBe(false);
    expect(location.href).toBe(href); expect(history.state).toEqual(state);
    expect(document.querySelectorAll(notice)).toHaveLength(1);
    expect(shell.openImage).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled(); expect(push).not.toHaveBeenCalled();
});

test('an allowed classic restore still reconciles the row and query in the same entry', async () => {
    sessionStorage.setItem('user_permissions', JSON.stringify(['/ui/view/article_view']));
    history.replaceState({ __filterestEntryId: 'allowed', other: 4 }, '', '/events/7?view=article_view&search=harbour');
    const push = vi.spyOn(history, 'pushState'), replace = vi.spyOn(history, 'replaceState');
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    await vi.waitFor(() => expect(shell.title).toHaveBeenCalled());
    expect(location.pathname + location.search).toBe('/events/7?search=harbour&view=article_view');
    expect(history.state).toMatchObject({ __filterestEntryId: 'allowed', other: 4, bigCard: true, dataset: 'events', rowId: '7' });
    expect(shell.navigate).toHaveBeenCalledOnce(); expect(replace).toHaveBeenCalled(); expect(push).not.toHaveBeenCalled();
    expect(document.querySelectorAll(notice)).toHaveLength(0);
});

test('an unsuitable permitted Chart restoration still rewrites to the rendered fallback', async () => {
    sessionStorage.setItem('user_permissions', JSON.stringify(['/ui/view/price_chart', '/ui/view/card']));
    history.replaceState({ __filterestEntryId: 'chart', other: 4 }, '', '/events?view=price_chart&search=harbour');
    shell.navigate.mockImplementationOnce(async () => { setChosenDatasetView('events', 'card'); return {}; });
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    await vi.waitFor(() => expect(shell.title).toHaveBeenCalled());
    expect(location.pathname + location.search).toBe('/events?search=harbour&view=card');
    expect(history.state).toMatchObject({ __filterestEntryId: 'chart', other: 4 });
    expect(document.querySelectorAll(notice)).toHaveLength(0);
});

test('an allowed IFAV restoration without an entry ID still commits its own image address', async () => {
    sessionStorage.setItem('user_permissions', JSON.stringify(['/ui/view/article_view']));
    history.replaceState({ other: 4 }, '', '/events/7?view=image_first_view#image=one.jpg');
    shell.openImage.mockImplementationOnce(({ tableName, rowItem, isCurrent }) => {
        const intent = beginImageFirstViewOpen({ tableName, rowId: rowItem.id, listPath: '/events', restoring: true, isCurrent });
        expect(intent.isCurrent()).toBe(true);
        return { entryId: intent.commit(intent.image) };
    });
    const push = vi.spyOn(history, 'pushState');
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    await vi.waitFor(() => expect(history.state.imageFirstView).toBeDefined());
    expect(location.pathname + location.search + location.hash).toBe('/events/7?view=image_first_view#image=one.jpg');
    expect(history.state).toMatchObject({ other: 4, imageFirstView: { dataset: 'events', rowId: '7', image: 'one.jpg' } });
    expect(shell.openImage).toHaveBeenCalledOnce(); expect(shell.navigate).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled(); expect(document.querySelectorAll(notice)).toHaveLength(0);
});

test('a pending older restoration cannot finalize after Back and Forward return to the same entry', async () => {
    let finish;
    shell.navigate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    history.replaceState({ __filterestEntryId: 'same' }, '', '/events?view=card');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.waitFor(() => expect(shell.navigate).toHaveBeenCalledOnce());
    const oldIsCurrent = shell.navigate.mock.calls[0][2].isCurrentNavigation;
    history.replaceState({ __filterestEntryId: 'away' }, '', '/events/7?view=article_view');
    window.dispatchEvent(new PopStateEvent('popstate')); await settle();
    history.replaceState({ __filterestEntryId: 'same' }, '', '/events?view=card');
    window.dispatchEvent(new PopStateEvent('popstate')); await settle(); await settle();
    expect(oldIsCurrent()).toBe(false);
    const state = structuredClone(history.state), href = location.href;
    const replace = vi.spyOn(history, 'replaceState'), push = vi.spyOn(history, 'pushState');
    shell.title.mockClear(); finish({}); await settle(); await settle();
    expect(location.href).toBe(href); expect(history.state).toEqual(state);
    expect(replace).not.toHaveBeenCalled(); expect(push).not.toHaveBeenCalled();
    expect(shell.title).not.toHaveBeenCalled();
});
