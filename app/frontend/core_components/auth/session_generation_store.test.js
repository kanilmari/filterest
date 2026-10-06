// session_generation_store.test.js
// Proves mandatory session invalidation with optional login synchronization on and off.
// Connects real pre-auth responses and broadcast delivery to the real Home renderer.
// Prevents delayed bootstrap steps and missing login events from retaining private blocks.
// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { renderFrontPage } from '../front_page/front_page_printer.js';
import { getSessionGeneration, invalidateSessionGeneration } from './session_generation_store.js';
import { postPreAuthJson } from './pre_auth_request_sender.js';
import { handleAuthBroadcastEvent } from './auth_broadcast_sync.js';

const mocks = vi.hoisted(() => ({ subscribers: [], invalidation: vi.fn(), request: vi.fn(),
    sync: vi.fn(), authModes: vi.fn(), bootstrap: vi.fn() }));
vi.mock('./auth_broadcast.js', () => ({
    subscribeToAuthBroadcast: handler => { mocks.subscribers.push(handler); return () => {}; },
    publishAuthInvalidation: mocks.invalidation,
}));
vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: mocks.request }));
vi.mock('../pipeline/api_pipeline.js', () => ({ ensureCsrfToken: vi.fn() }));
vi.mock('../config_fetcher.js', () => ({ isCrossTabLoginSyncEnabled: mocks.sync }));
vi.mock('../admin_tools/auth_mode_handler.js', () => ({ setAuthModes: mocks.authModes }));
vi.mock('./post_auth_bootstrap.js', () => ({ runPostAuthBootstrap: mocks.bootstrap }));
vi.mock('./logout_shell_reset.js', () => ({ applyLoggedOutShellReset: vi.fn(), navigateToPostLogoutPath: vi.fn() }));
vi.mock('../navigation/main_tabs/main_tab_printer.js', () => ({ initTabs: vi.fn() }));
vi.mock('./login_shell_entry.js', () => ({ handleLoginShellEntry: vi.fn() }));
vi.mock('../../reusable_components/modal/modal_builder.js', () => ({ hideModal: vi.fn() }));
vi.mock('../lang/translation_handler.js', () => ({ getTranslationForKey: key => key }));

const accountA = { viewer_id: 42, site_name: 'Account A', blocks: [] };

beforeEach(() => {
    invalidateSessionGeneration({ revalidate: false });
    document.body.innerHTML = '<div id="tabs_container"></div>';
    vi.clearAllMocks();
    mocks.request.mockResolvedValue(accountA);
    mocks.authModes.mockResolvedValue(undefined);
    mocks.bootstrap.mockResolvedValue(undefined);
});

afterEach(() => {
    document.getElementById('front_page_container')?.__cleanupListeners?.();
    vi.unstubAllGlobals();
});

test.each([true, false])('successful sign-in invalidates locally and broadcasts before returning, sync=%s', async enabled => {
    mocks.sync.mockResolvedValue(enabled);
    const page = renderFrontPage();
    await vi.waitFor(() => expect(page.textContent).toContain('Account A'));
    const before = getSessionGeneration();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ authenticated: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
    })));
    const response = await postPreAuthJson('/api/login', null, () => ({}));
    expect(getSessionGeneration()).toBeGreaterThan(before);
    expect(page.hasChildNodes()).toBe(false);
    expect(mocks.invalidation).toHaveBeenCalledExactlyOnceWith({ reason: 'login' });
    expect(await response.json()).toEqual({ authenticated: true });
    expect(mocks.sync).not.toHaveBeenCalled();
});

test.each([true, false])('mandatory remote invalidation clears Home before optional sync or delayed bootstrap, sync=%s', async enabled => {
    const page = renderFrontPage();
    await vi.waitFor(() => expect(page.textContent).toContain('Account A'));
    const before = getSessionGeneration();
    for (const subscriber of mocks.subscribers) subscriber({ type: 'session-invalidated' });
    expect(getSessionGeneration()).toBeGreaterThan(before);
    expect(page.hasChildNodes()).toBe(false);
    let finishPolicy;
    mocks.sync.mockReturnValueOnce(new Promise(resolve => { finishPolicy = resolve; }));
    const loginSync = handleAuthBroadcastEvent({ type: 'login' });
    expect(page.hasChildNodes()).toBe(false);
    finishPolicy(enabled);
    let finishBootstrap;
    mocks.authModes.mockReturnValueOnce(new Promise(resolve => { finishBootstrap = resolve; }));
    if (enabled) {
        await vi.waitFor(() => expect(mocks.authModes).toHaveBeenCalledTimes(1));
        expect(page.hasChildNodes()).toBe(false);
        finishBootstrap();
    }
    await loginSync;
    expect(mocks.bootstrap).toHaveBeenCalledTimes(enabled ? 1 : 0);
});
