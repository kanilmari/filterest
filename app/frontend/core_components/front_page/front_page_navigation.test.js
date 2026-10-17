// front_page_navigation.test.js
// Verifies the Home address, selection and title transition through navigation.
// Uses the real page renderer to prove one request per visit and bootstrap invalidation.
// Keeps cold Home loads away from the dataset results path.
// @vitest-environment jsdom

import { HOME_AVAILABILITY_CHANGED_EVENT, isSeparateFrontPageEnabled,
    setFrontPageAvailability } from './front_page_availability.js';
import { beforeEach, expect, test, vi } from 'vitest';
import { openFrontPage, openNormalStartView } from './front_page_navigation.js';
import { renderFrontPage } from './front_page_printer.js';
import { VIEW_DEACTIVATE_EVENT } from '../../reusable_components/view_lifecycle_events.js';
import { invalidateSessionGeneration } from '../auth/session_generation_store.js';
import * as customRoot from './custom_root_navigation.js';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), request: vi.fn(), clear: vi.fn(),
    write: vi.fn(), title: vi.fn(), refreshTabs: vi.fn(), start: vi.fn() }));
vi.mock('../admin_tools/main/table_loader_handler.js', () => ({ load_tables: mocks.start }));
vi.mock('../navigation/nav_engine/navigation_handler.js', () => ({ handle_all_navigation: mocks.navigate }));
vi.mock('../navigation/admin_and_user_tools/custom_view_reader.js', () => ({ custom_views: [{ name: 'front_page' }] }));
vi.mock('../state_stores/dataset_selection_saver.js', () => ({ clearSelectedDataset: mocks.clear }));
vi.mock('../navigation/nav_engine/history_entry_state.js', () => ({ writeHistoryEntry: mocks.write }));
vi.mock('../navigation/nav_engine/browser_tab_title_writer.js', () => ({ updateBrowserTabTitle: mocks.title }));
vi.mock('../navigation/main_tabs/main_tab_active_state.js', () => ({ refreshMainTabPresentation: mocks.refreshTabs }));
vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: mocks.request }));
vi.mock('../lang/translation_handler.js', () => ({ getTranslationForKey: (key) => key }));

beforeEach(() => {
    customRoot.setCustomRootEnabled(false);
    invalidateSessionGeneration({ revalidate: false });
    document.getElementById('front_page_container')?.dispatchEvent(new Event(VIEW_DEACTIVATE_EVENT));
    document.body.innerHTML = '<div id="tabs_container"></div>';
    localStorage.clear(); setFrontPageAvailability({});
    setFrontPageAvailability({ separate_front_page: true });
    vi.clearAllMocks();
    mocks.request.mockResolvedValue({ viewer_id: 42, blocks: [] });
    mocks.navigate.mockImplementation(async () => {
        const old = document.getElementById('front_page_container');
        old?.dispatchEvent(new Event(VIEW_DEACTIVATE_EVENT));
        const page = renderFrontPage();
        page.classList.remove('hidden');
        return { abort: false };
    });
});

test('custom Home skips SPA rendering and history even when SPA Home is disabled', async () => {
    setFrontPageAvailability({ separate_front_page: false });
    customRoot.setCustomRootEnabled(true);
    const departure = vi.spyOn(customRoot, 'loadCustomRoot').mockResolvedValue(true);
    expect(await openFrontPage()).toEqual({ abort: true, reason: 'custom_root_document' });
    expect(departure).toHaveBeenCalledExactlyOnceWith({ replace: false, isCurrentNavigation: undefined, userActivation: false });
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    departure.mockRestore();
    customRoot.setCustomRootEnabled(false);
});

test('deliberate Home activation reaches document recovery without rendering the SPA', async () => {
    customRoot.setCustomRootEnabled(true);
    const departure = vi.spyOn(customRoot, 'loadCustomRoot').mockResolvedValue(true);
    try {
        await openFrontPage({ userActivation: true });
        expect(departure).toHaveBeenCalledExactlyOnceWith({ replace: false, isCurrentNavigation: undefined, userActivation: true });
        expect(mocks.navigate).not.toHaveBeenCalled();
        expect(mocks.write).not.toHaveBeenCalled();
    } finally { departure.mockRestore(); customRoot.setCustomRootEnabled(false); }
});

test('custom Home bootstrap preserves login/register shell entry without rendering Home', async () => {
    const departure = vi.spyOn(customRoot, 'loadCustomRoot').mockResolvedValue(true);
    customRoot.setCustomRootEnabled(true);
    for (const query of ['?login-entry=1', '?register-entry=1']) {
        window.history.replaceState({}, '', '/'+query);
        expect(await openFrontPage({ replace: true })).toMatchObject({ reason: 'auth_entry' });
    }
    expect(departure).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    departure.mockRestore();
    customRoot.setCustomRootEnabled(false);
    window.history.replaceState({}, '', '/');
});

test('Home itself refuses a dirty departure and navigates after saving without rendering the SPA', async () => {
    const assign = vi.fn();
    const guard = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    vi.stubGlobal('window', { location: { pathname: '/events', search: '', assign },
        check_manage_permissions_dirty: guard });
    customRoot.setCustomRootEnabled(true);
    try {
        await openFrontPage();
        expect(guard).toHaveBeenCalledOnce();
        expect(assign).not.toHaveBeenCalled();
        await openFrontPage();
        expect(assign).toHaveBeenCalledExactlyOnceWith('/');
        expect(mocks.navigate).not.toHaveBeenCalled();
        expect(mocks.request).not.toHaveBeenCalled();
        expect(mocks.write).not.toHaveBeenCalled();
    } finally { customRoot.setCustomRootEnabled(false); vi.unstubAllGlobals(); }
});

test('writes root once after success, clears selection, then retitles and refreshes tab shapes', async () => {
    await openFrontPage({ replace: true });
    expect(mocks.navigate).toHaveBeenCalledWith('front_page', expect.any(Array), {
        skipUrlUpdate: true, forceReload: false, isCurrentNavigation: expect.any(Function),
    });
    expect(mocks.write).toHaveBeenCalledExactlyOnceWith('/', {}, { replace: true });
    expect(mocks.clear).toHaveBeenCalledTimes(1);
    expect(mocks.title).toHaveBeenCalledTimes(1);
    expect(mocks.clear.mock.invocationCallOrder[0]).toBeLessThan(mocks.write.mock.invocationCallOrder[0]);
    expect(mocks.write.mock.invocationCallOrder[0]).toBeLessThan(mocks.title.mock.invocationCallOrder[0]);
    expect(mocks.refreshTabs).toHaveBeenCalledTimes(1);
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith('frontPage', expect.any(Object));
});

test('concurrent opens are single-flight, and an already visible Home does nothing', async () => {
    const first = openFrontPage();
    expect(openFrontPage()).toBe(first);
    await first;
    await openFrontPage();
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.request).toHaveBeenCalledTimes(1);
});

test('bootstrap forceReload invalidates the visible page and starts one current-session request', async () => {
    await openFrontPage({ replace: true });
    await openFrontPage({ replace: true, forceReload: true });
    expect(mocks.navigate).toHaveBeenLastCalledWith('front_page', expect.any(Array), {
        skipUrlUpdate: true, forceReload: true, isCurrentNavigation: expect.any(Function),
    });
    expect(mocks.request).toHaveBeenCalledTimes(2);
});

test('a bootstrap supersedes an older pending open without letting it rewrite the newer entry', async () => {
    let finishOld;
    mocks.navigate.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    const old = openFrontPage();
    await openFrontPage({ replace: true, forceReload: true });
    finishOld({ abort: false });
    expect(await old).toMatchObject({ abort: true, reason: 'stale_navigation' });
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.write).toHaveBeenCalledTimes(1);
});

test('returning after deactivation starts exactly one new facade request', async () => {
    await openFrontPage();
    const page = document.getElementById('front_page_container');
    page.dispatchEvent(new Event(VIEW_DEACTIVATE_EVENT));
    page.classList.add('hidden');
    await openFrontPage({ replace: true });
    expect(mocks.request).toHaveBeenCalledTimes(2);
});

test('aborted, stale and disabled opens write no address and clear no selection', async () => {
    mocks.navigate.mockResolvedValueOnce({ abort: true });
    await openFrontPage();
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    await openFrontPage({ isCurrentNavigation: () => false });
    expect(mocks.write).not.toHaveBeenCalled();
    setFrontPageAvailability({ separate_front_page: false });
    await openNormalStartView();
    expect(mocks.start).toHaveBeenCalledOnce();
    mocks.navigate.mockClear();
    await openFrontPage();
    expect(mocks.navigate).not.toHaveBeenCalled();
});

test('session change supersedes pending opens and prevents A from rewriting B history', async () => {
    let finishA;
    mocks.navigate.mockImplementationOnce(() => new Promise(resolve => { finishA = resolve; }));
    const accountA = openFrontPage();
    invalidateSessionGeneration({ reason: 'login', revalidate: false });
    // B's bootstrap confirms its current policy before opening its Home.
    setFrontPageAvailability({ separate_front_page: true });
    await openFrontPage({ replace: true });
    finishA({ abort: false });
    expect(await accountA).toMatchObject({ abort: true, reason: 'stale_navigation' });
    expect(mocks.write).toHaveBeenCalledTimes(1);
});


test('normal start uses the existing startup resolver once and clears Home selection', async () => {
    document.body.replaceChildren();
    setFrontPageAvailability({});
    const first = openNormalStartView();
    expect(openNormalStartView()).toBe(first);
    await first;
    expect(mocks.clear).toHaveBeenCalledOnce();
    expect(mocks.write).toHaveBeenCalledExactlyOnceWith('/', {}, { replace: true });
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.navigate).not.toHaveBeenCalled();
});

test('normal start abandons a late handoff when the person navigated elsewhere', async () => {
    document.body.replaceChildren();
    const start = openNormalStartView();
    window.history.replaceState({}, '', '/other');
    await start;
    expect(mocks.start).not.toHaveBeenCalled();
    window.history.replaceState({}, '', '/');
});

test.each(['failed', 'pending'])('unavailable Home settles after a %s storage refresh', async refreshState => {
    let failHome, failRefresh, finishRefresh;
    const content = new Promise((_, reject) => { failHome = reject; });
    const policy = new Promise((resolve, reject) => { finishRefresh = resolve; failRefresh = reject; });
    mocks.request.mockImplementation(route => route === 'fetchAuthModes' ? policy : content);
    const page = renderFrontPage();
    const confirmations = [];
    const changed = event => confirmations.push(event.detail.confirmed);
    window.addEventListener(HOME_AVAILABILITY_CHANGED_EVENT, changed);
    try {
        expect(isSeparateFrontPageEnabled()).toBe(true);
        expect(page.querySelector('.front-page-skeleton')).not.toBeNull();
        // Tab A's disable is only a refresh hint in B; the real listener reserves newer policy order.
        localStorage.setItem('separate_front_page', 'false');
        window.dispatchEvent(new StorageEvent('storage', {
            key: 'separate_front_page', newValue: 'false', storageArea: localStorage,
        }));
        expect(isSeparateFrontPageEnabled()).toBe(false);
        await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledWith('fetchAuthModes', expect.any(Object)));
        if (refreshState === 'failed') {
            failRefresh(new Error('policy refresh offline'));
            await policy.catch(() => {});
        }
        expect(mocks.start).not.toHaveBeenCalled();
        failHome(Object.assign(new Error('front page unavailable'), {
            status: 404, responseBody: 'front page unavailable',
        }));
        await vi.waitFor(() => expect(page.getAttribute('aria-busy')).toBe('false'));
        expect(mocks.start).toHaveBeenCalledOnce();
        expect(page.querySelector('.front-page-skeleton')).toBeNull();
        expect(page.querySelector('.front-page-status')).toBeNull();
        expect(isSeparateFrontPageEnabled()).toBe(false);
        // The stale 404 settles its visit without publishing an obsolete policy write/event.
        expect(confirmations).toEqual([false]);
        expect(mocks.request.mock.calls.filter(([route]) => route === 'frontPage')).toHaveLength(1);
    } finally {
        finishRefresh({ separate_front_page: false });
        await policy.catch(() => {});
        window.removeEventListener(HOME_AVAILABILITY_CHANGED_EVENT, changed);
        page.dispatchEvent(new Event(VIEW_DEACTIVATE_EVENT));
    }
});
