// front_page_session_navigation.test.js
// Exercises Home privacy after the real navigation cleanup retains its container.
// Connects the navigation pipeline, Home renderer and broadcast/session lifecycle.
// Prevents account blocks surviving Home → dataset → Home with login sync off.
// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { handle_all_navigation } from '../navigation/nav_engine/navigation_handler.js';
import { renderFrontPage } from './front_page_printer.js';
import { getSessionGeneration, invalidateSessionGeneration } from '../auth/session_generation_store.js';
import { runApiPipeline } from '../pipeline/api_pipeline.js';

const mocks = vi.hoisted(() => ({ request: vi.fn(), selected: null }));
vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: mocks.request }));
vi.mock('../lang/translation_handler.js', () => ({ getTranslationForKey: key => key }));
vi.mock('../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js', () => ({
    refreshTableUnified: name => {
        const container = document.createElement('div');
        container.id = `${name}_container`;
        container.className = 'content_div';
        container.textContent = 'Dataset';
        document.getElementById('tabs_container').append(container);
    },
}));
vi.mock('../table_views/view_selector_printer.js', () => ({ applyViewStyling: vi.fn() }));
vi.mock('../state_stores/dataset_selection_saver.js', () => ({
    setSelectedDataset: name => { mocks.selected = name; }, getSelectedDataset: () => mocks.selected,
}));
vi.mock('../navigation/nav_engine/query_params.js', () => ({
    getParams: () => ({}), DATASET_PREFIX: '/', useStorageParams: vi.fn(), useUrlParams: vi.fn(), updateURL: vi.fn(),
}));
vi.mock('../navigation/nav_engine/recent_tab_saver.js', () => ({
    update_recently_viewed_list: vi.fn(), update_recently_viewed_status: vi.fn(),
}));
vi.mock('../navigation/nav_engine/active_heading_updater.js', () => ({ update_active_heading: vi.fn() }));
vi.mock('../navigation/admin_and_user_tools/custom_view_reader.js', () => ({
    custom_views: [{ name: 'front_page', requiredPermission: '/api/front-page' }],
    ensure_private_custom_views_loaded: vi.fn(),
}));
vi.mock('../route_permission_checker.js', () => ({ hasRoutePermission: () => true, hasDatasetPermission: async () => true }));
// The real loading indicator stays: navigation puts its spinner into the emptied Home
// container before it decides to load, exactly as in the browser.
vi.mock('../navigation/nav_engine/dataset_address_writer.js', () => ({ updateDatasetAddress: vi.fn() }));
vi.mock('../navigation/nav_engine/browser_tab_title_writer.js', () => ({ updateBrowserTabTitle: vi.fn() }));
vi.mock('../navigation/main_tabs/main_tab_active_state.js', () => ({
    applyMainTabActiveState: vi.fn(), clearMainTabActiveState: vi.fn(),
}));
vi.mock('../navigation/nav_engine/dataset_scroll_retention.js', () => ({
    captureDatasetScrollState: vi.fn(), clearDatasetScrollState: vi.fn(), restoreDatasetScrollState: vi.fn(),
}));
vi.mock('../ai_features/table_chat/table_chat_printer.js', () => ({ destroy_chat: vi.fn() }));
vi.mock('../endpoints/sse_subscriber.js', () => ({ clearSSEActiveDataset: vi.fn(), setSSEActiveDataset: vi.fn() }));

function account(viewerID, title) {
    return { viewer_id: viewerID, blocks: [{ dataset: 'news', result_limit: 5,
        columns: ['title'], types: { title: { card_element: 'header', show_value_on_card: true } },
        data: [{ id: 42, title }],
    }] };
}

const views = [{ name: 'front_page', containerId: 'front_page_container', loadFunction: renderFrontPage }];
const home = () => handle_all_navigation('front_page', views, { skipUrlUpdate: true });

beforeEach(() => {
    invalidateSessionGeneration({ revalidate: false });
    document.body.innerHTML = '<div id="tabs_container"></div>';
    localStorage.clear();
    localStorage.setItem('cross_tab_login_sync', 'false');
    mocks.selected = null;
    mocks.request.mockReset().mockResolvedValue(account(42, 'Account A blocks'));
});

afterEach(() => {
    document.getElementById('front_page_container')?.__cleanupListeners?.();
    vi.unstubAllGlobals();
});

async function returnHome() {
    await home();
    const page = document.getElementById('front_page_container');
    await vi.waitFor(() => expect(page.textContent).toContain('Account A blocks'));
    const cleanup = page.__cleanupListeners;
    await handle_all_navigation('news', views, { skipUrlUpdate: true });
    expect(page.hasChildNodes()).toBe(false);
    expect(page.__cleanupListeners).toBeUndefined();
    await home();
    expect(document.getElementById('front_page_container')).toBe(page);
    expect(page.__cleanupListeners).not.toBe(cleanup);
    await vi.waitFor(() => expect(page.textContent).toContain('Account A blocks'));
    expect(mocks.request).toHaveBeenCalledTimes(2);
    // A retained reference to the completed cleanup must not end this new visit.
    cleanup();
    expect(page.textContent).toContain('Account A blocks');
    return page;
}

test('remote sign-in after returning Home clears A before identity validation or B content', async () => {
    const page = await returnHome();
    window.dispatchEvent(new StorageEvent('storage', { key: 'easelect:auth-broadcast',
        newValue: JSON.stringify({ type: 'login', tabId: 'remote', eventId: 'remote-login-1' }),
    }));
    await Promise.resolve(); // The real broadcaster delivers subscribers in a microtask.
    expect(page.hasChildNodes()).toBe(false);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    let verify;
    mocks.request.mockImplementation(route => {
        if (route === 'fetchAuthModes') return Promise.resolve({ needs_button: 'logout' });
        if (route === 'fetchUserProfile') return new Promise(resolve => { verify = resolve; });
        return Promise.resolve(account(73, 'Account B blocks'));
    });
    await home();
    await vi.waitFor(() => expect(verify).toBeTypeOf('function'));
    expect(page.textContent).not.toContain('Account A blocks');
    expect(mocks.request.mock.calls.filter(([route]) => route === 'frontPage')).toHaveLength(2);
    verify({ user_id: 73 });
    await vi.waitFor(() => expect(page.textContent).toContain('Account B blocks'));
});

test.each([401, 403])('expiry after returning Home clears A through the real API pipeline (%s)', async status => {
    const page = await returnHome();
    const generation = getSessionGeneration();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ auth_failure: true }), { status })));
    const result = await runApiPipeline({ routeName: 'frontPage', suppressAuthRedirect: true });
    expect(result.abort).toBe(true);
    expect(getSessionGeneration()).toBe(generation + 1);
    expect(page.hasChildNodes()).toBe(false);
});

test.each([false, true])('resume after returning Home clears A before validation, expiry during response=%s', async expires => {
    const page = await returnHome();
    let verify;
    let finishB;
    mocks.request.mockImplementation(route => {
        if (route === 'fetchAuthModes') return Promise.resolve({ needs_button: 'logout' });
        if (route === 'fetchUserProfile') return new Promise(resolve => { verify = resolve; });
        return new Promise(resolve => { finishB = resolve; });
    });
    window.dispatchEvent(new Event('focus'));
    expect(page.textContent).not.toContain('Account A blocks');
    await vi.waitFor(() => expect(verify).toBeTypeOf('function'));
    expect(mocks.request.mock.calls.filter(([route]) => route === 'frontPage')).toHaveLength(2);
    verify({ user_id: 73 });
    await vi.waitFor(() => expect(finishB).toBeTypeOf('function'));
    if (expires) {
        invalidateSessionGeneration({ reason: 'expiry' });
        expect(page.hasChildNodes()).toBe(false);
    }
    finishB(account(73, 'Account B blocks'));
    await Promise.resolve(); await Promise.resolve();
    if (expires) expect(page.hasChildNodes()).toBe(false);
    else await vi.waitFor(() => expect(page.textContent).toContain('Account B blocks'));
    expect(page.textContent).not.toContain('Account A blocks');
});
