// Verifies the standalone form stays usable while optional visibility icons load.
// Bridges real login startup listeners with delayed or failed asset dependencies.
// Exists so slow decorative requests cannot block authentication or password reveal.
// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

let startup;
let icons;
const ensureIcons = vi.fn();
const fingerprint = vi.fn();
const initializeShell = vi.fn();

async function loadStartup() {
    vi.resetModules();
    vi.doMock('./password_visibility_icon_reader.js', () => ({
        ensurePasswordVisibilityIconsLoaded: ensureIcons,
        getPasswordVisibilityIcons: () => icons,
    }));
    vi.doMock('../../reusable_components/browser_identity_builder.js', () => ({
        gather_browser_fingerprint_hash: fingerprint,
    }));
    vi.doMock('../../reusable_components/modal/modal_builder.js', () => ({
        createModal: vi.fn(), showModal: vi.fn(),
    }));
    vi.doMock('../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn() }));
    vi.doMock('../../reusable_components/dom_container_builder.js', () => ({
        renderAllowedHtml: () => document.createElement('div'),
    }));
    vi.doMock('./auth_broadcast.js', () => ({ publishAuthLogin: vi.fn() }));
    vi.doMock('../config_fetcher.js', () => ({ isCrossTabLoginSyncEnabled: async () => false }));
    vi.doMock('./login_page_shell_builder.js', () => ({ initializeStandaloneLoginShell: initializeShell }));
    vi.doMock('./auth_session_notice_handler.js', () => ({ initializeAuthSessionNotice: vi.fn() }));
    vi.doMock('./auth_preference_controls.js', () => ({}));

    const original = document.addEventListener.bind(document);
    vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
        if (type === 'DOMContentLoaded') startup = listener;
        else original(type, listener, options);
    });
    await import('./login_page_builder.js');
}

beforeEach(() => {
    startup = null;
    icons = { visibilityOffSvg: '', visibilityOnSvg: '' };
    ensureIcons.mockReset().mockImplementation(() => new Promise(() => {}));
    fingerprint.mockReset().mockResolvedValue('test-fingerprint');
    initializeShell.mockReset();
    document.body.innerHTML = `
        <form class="auth-form">
            <input id="username" value="fixture-user">
            <input id="password" type="password" value="fixture-password">
            <button type="button" id="toggle-password" aria-label="Show password">
                <svg data-fallback="password" fill="currentColor"></svg>
            </button>
            <input id="csrf_token" value="test-csrf">
            <input id="password-reset-new-password" type="password" value="fixture-reset">
            <button type="button" id="toggle-password-reset" aria-label="Show password">
                <svg data-fallback="reset" fill="currentColor"></svg>
            </button>
            <div id="submit"><input type="submit" value="Login"></div>
        </form>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false, json: async () => ({ error: 'wrong_credentials' }),
    }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('standalone login startup', () => {
    test.each(['pending', 'failed'])('binds submit and both reveal controls with %s icon requests', async (state) => {
        if (state === 'failed') ensureIcons.mockRejectedValue(new Error('asset connection aborted'));
        await loadStartup();
        startup();
        expect(initializeShell).toHaveBeenCalledOnce();

        for (const [buttonId, inputId] of [
            ['toggle-password', 'password'],
            ['toggle-password-reset', 'password-reset-new-password'],
        ]) {
            const button = document.getElementById(buttonId);
            const input = document.getElementById(inputId);
            button.focus();
            button.click();
            expect(input.type).toBe('text');
            expect(button.getAttribute('aria-label')).toBe('Hide password');
            expect(button.getAttribute('aria-pressed')).toBe('true');
            expect(document.activeElement).toBe(button);
            expect(button.querySelector('[data-fallback]')).not.toBeNull();
            button.click();
            expect(input.type).toBe('password');
            expect(button.getAttribute('aria-pressed')).toBe('false');
        }

        const event = new Event('submit', { bubbles: true, cancelable: true });
        document.querySelector('form').dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/login', expect.objectContaining({
            method: 'POST', credentials: 'include',
        })));
        expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
            username: 'fixture-user', password: 'fixture-password',
            fingerprint: 'test-fingerprint', csrf_token: 'test-csrf',
        });
    });

    test('late icons preserve the active reveal state and button focus', async () => {
        let finish;
        ensureIcons.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
        await loadStartup();
        startup();
        const button = document.getElementById('toggle-password');
        button.focus();
        button.click();
        icons = {
            visibilityOffSvg: '<svg data-state="off" fill="currentColor"></svg>',
            visibilityOnSvg: '<svg data-state="on" fill="currentColor"></svg>',
        };
        finish();
        await vi.waitFor(() => expect(button.querySelector('[data-state="on"]')).not.toBeNull());
        expect(document.activeElement).toBe(button);
        expect(document.getElementById('password').type).toBe('text');
        expect(button.getAttribute('aria-pressed')).toBe('true');
        button.click();
        expect(button.querySelector('[data-state="off"]')).not.toBeNull();
        expect(document.getElementById('password').type).toBe('password');
    });

    test('the optional source-mode translation prefetch does not block parsing or DOMContentLoaded', () => {
        const html = readFileSync('frontend/templates/login.html', 'utf8');
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const prefetch = doc.querySelector('script[src$="translation_prefetcher.js"]');
        expect(prefetch.hasAttribute('async')).toBe(true);
        expect(prefetch.hasAttribute('defer')).toBe(false);
    });
});
