// front_page_navigation.test.js
// Verifies the Home address, selection and title transition through navigation.
// Uses the real page renderer to prove one request per visit and bootstrap invalidation.
// Keeps cold Home loads away from the dataset results path.
// @vitest-environment jsdom

import { beforeEach, expect, test, vi } from 'vitest';
import { openFrontPage } from './front_page_navigation.js';
import { renderFrontPage } from './front_page_printer.js';
import { VIEW_DEACTIVATE_EVENT } from '../../reusable_components/view_lifecycle_events.js';
import { invalidateSessionGeneration } from '../auth/session_generation_store.js';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), request: vi.fn(), clear: vi.fn(),
    write: vi.fn(), title: vi.fn(), refreshTabs: vi.fn() }));
vi.mock('../navigation/nav_engine/navigation_handler.js', () => ({ handle_all_navigation: mocks.navigate }));
vi.mock('../navigation/admin_and_user_tools/custom_view_reader.js', () => ({ custom_views: [{ name: 'front_page' }] }));
vi.mock('../state_stores/dataset_selection_saver.js', () => ({ clearSelectedDataset: mocks.clear }));
vi.mock('../navigation/nav_engine/history_entry_state.js', () => ({ writeHistoryEntry: mocks.write }));
vi.mock('../navigation/nav_engine/browser_tab_title_writer.js', () => ({ updateBrowserTabTitle: mocks.title }));
vi.mock('../navigation/main_tabs/main_tab_active_state.js', () => ({ refreshMainTabPresentation: mocks.refreshTabs }));
vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: mocks.request }));
vi.mock('../lang/translation_handler.js', () => ({ getTranslationForKey: (key) => key }));

beforeEach(() => {
    invalidateSessionGeneration({ revalidate: false });
    document.getElementById('front_page_container')?.dispatchEvent(new Event(VIEW_DEACTIVATE_EVENT));
    document.body.innerHTML = '<div id="tabs_container"></div>';
    localStorage.clear();
    localStorage.setItem('separate_front_page', 'true');
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
    localStorage.setItem('separate_front_page', 'false');
    mocks.navigate.mockClear();
    await openFrontPage();
    expect(mocks.navigate).not.toHaveBeenCalled();
});

test('session change supersedes pending opens and prevents A from rewriting B history', async () => {
    let finishA;
    mocks.navigate.mockImplementationOnce(() => new Promise(resolve => { finishA = resolve; }));
    const accountA = openFrontPage();
    invalidateSessionGeneration({ reason: 'login', revalidate: false });
    await openFrontPage({ replace: true });
    finishA({ abort: false });
    expect(await accountA).toMatchObject({ abort: true, reason: 'stale_navigation' });
    expect(mocks.write).toHaveBeenCalledTimes(1);
});
