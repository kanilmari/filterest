// @vitest-environment jsdom
// Proves server authority and live cross-tab Home invalidation without any writes to a server.
// Connects persisted refresh signals to the same policy consumed by links and routing.
// Refuses stale cache values and late policy responses after a newer setting wins.
import { beforeEach, expect, test, vi } from 'vitest';
import { HOME_AVAILABILITY_CHANGED_EVENT, isSeparateFrontPageEnabled,
    setFrontPageAvailability } from './front_page_availability.js';
import { isCustomRootEnabled } from './custom_root_navigation.js';
import { setAuthModes } from '../admin_tools/auth_mode_handler.js';
const mocks = vi.hoisted(() => ({ request: vi.fn(), auth: vi.fn() }));
vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: mocks.request }));
vi.mock('../endpoints/stable_endpoint_router.js', () => ({ fetchAuthModes: mocks.auth, fetchUserPermissions: vi.fn() }));
vi.mock('../theme.js', () => ({ synchronizeThemePreferenceForAuthState: vi.fn() }));
vi.mock('../dev_tools/function_counter.js', () => ({ count_this_function: vi.fn() }));

beforeEach(() => {
    setFrontPageAvailability({});
    localStorage.clear();
    mocks.request.mockReset().mockResolvedValue({ separate_front_page: false });
    mocks.auth.mockReset();
});

function changed(key = 'separate_front_page', newValue = 'false') {
    window.dispatchEvent(new StorageEvent('storage', { key, newValue, storageArea: localStorage }));
}

test('a stale persisted flag or local event cannot enable Home before server confirmation', () => {
    localStorage.setItem('separate_front_page', 'true');
    window.dispatchEvent(new Event(HOME_AVAILABILITY_CHANGED_EVENT));
    expect(isSeparateFrontPageEnabled()).toBe(false);
});

test.each([{}, { separate_front_page: false }, { separate_front_page: 'true' },
    { separate_front_page: true }, { display_index_html_at_startup: true }])('server policy %j replaces the flag', data => {
    setFrontPageAvailability(data);
    expect(isSeparateFrontPageEnabled()).toBe(data.separate_front_page === true || data.display_index_html_at_startup === true);
    expect(isCustomRootEnabled()).toBe(data.display_index_html_at_startup === true);
});

test.each(['separate_front_page', 'front_page_button_site_name', null])('%s storage signal hides Home immediately and confirms off', async key => {
    setFrontPageAvailability({ separate_front_page: true });
    let confirm;
    mocks.request.mockImplementation(() => new Promise(resolve => { confirm = resolve; }));
    const snapshots = [];
    const listener = () => snapshots.push(isSeparateFrontPageEnabled());
    window.addEventListener(HOME_AVAILABILITY_CHANGED_EVENT, listener);
    try {
        changed(key);
        expect(isSeparateFrontPageEnabled()).toBe(false);
        await vi.waitFor(() => expect(confirm).toBeTypeOf('function'));
        confirm({ separate_front_page: false });
        await vi.waitFor(() => expect(localStorage.getItem('separate_front_page')).toBe('false'));
        expect(snapshots).toEqual([false, false]);
        expect(mocks.request).toHaveBeenCalledExactlyOnceWith('fetchAuthModes',
            { suppressErrorToast: true, suppressAuthRedirect: true });
    } finally { window.removeEventListener(HOME_AVAILABILITY_CHANGED_EVENT, listener); }
});

test('a storage enable signal is verified, including the custom document destination', async () => {
    mocks.request.mockResolvedValue({ separate_front_page: false, display_index_html_at_startup: true });
    changed('separate_front_page', 'true');
    expect(isSeparateFrontPageEnabled()).toBe(false);
    await vi.waitFor(() => expect(isCustomRootEnabled()).toBe(true));
    expect(isSeparateFrontPageEnabled()).toBe(true);
});

test('failed policy verification never resurrects a stale flag', async () => {
    setFrontPageAvailability({ separate_front_page: true });
    mocks.request.mockRejectedValue(new Error('offline'));
    changed();
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());
    expect(isSeparateFrontPageEnabled()).toBe(false);
});

test('a late cross-tab response cannot override a newer save or unavailable response', async () => {
    let confirm;
    mocks.request.mockImplementation(() => new Promise(resolve => { confirm = resolve; }));
    changed();
    await vi.waitFor(() => expect(confirm).toBeTypeOf('function'));
    setFrontPageAvailability({ separate_front_page: false });
    confirm({ separate_front_page: true });
    await Promise.resolve(); await Promise.resolve();
    expect(isSeparateFrontPageEnabled()).toBe(false);
});

test.each([[true, false], [false, true]])(
    'older auth Home=%s arriving after storage Home=%s preserves the newer policy', async (older, newer) => {
        let finishAuth;
        mocks.auth.mockReturnValueOnce(new Promise(resolve => { finishAuth = resolve; }));
        const pendingAuth = setAuthModes();
        mocks.request.mockResolvedValue({ separate_front_page: newer, front_page_button_site_name: 'Newer' });
        changed('separate_front_page', String(newer));
        await vi.waitFor(() => expect(localStorage.getItem('front_page_button_site_name')).toBe('Newer'));
        expect(isSeparateFrontPageEnabled()).toBe(newer);
        finishAuth({ needs_button: 'login', separate_front_page: older,
            display_index_html_at_startup: older, front_page_button_site_name: 'Older' });
        await pendingAuth;
        expect(isSeparateFrontPageEnabled()).toBe(newer);
        expect(isCustomRootEnabled()).toBe(false);
        expect(localStorage.getItem('separate_front_page')).toBe(String(newer));
        expect(localStorage.getItem('front_page_button_site_name')).toBe('Newer');
    });

test('unrelated storage events do not request Home policy', () => {
    changed('navVisibleWide');
    expect(mocks.request).not.toHaveBeenCalled();
});
