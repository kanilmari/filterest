// Verifies the standalone form stays usable while optional visibility icons load.
// Bridges real login startup listeners with delayed or failed asset dependencies.
// Exists so slow decorative requests cannot block authentication or password reveal.
// @vitest-environment jsdom

import { SECOND_STEP_TRANSLATION_FALLBACKS } from './second_step_translation_fallbacks.js';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { translateError } from './login_page_builder_helpers.js';

let startup;
let icons;
let uiLanguage;
const ensureIcons = vi.fn();
const fingerprint = vi.fn();
const initializeShell = vi.fn();
const loginCopy = {
    en: {
        send_code: 'Send code',
        login: 'Login',
        reset_password: 'Reset password',
        password_reset_code_sent: 'If the account exists, a verification code was sent. Enter the code and your new password.',
        password_updated_sign_in: 'Password updated. Log in with the new password.',
        verify: 'Verify',
        enter_otp: 'Enter the verification code.',
    },
    fi: {
        send_code: 'Lähetä koodi',
        login: 'Kirjaudu',
        reset_password: 'Vaihda salasana',
        password_reset_code_sent: 'Jos käyttäjä löytyy, vahvistuskoodi on lähetetty. Syötä koodi ja uusi salasana.',
        password_updated_sign_in: 'Salasana vaihdettu. Kirjaudu sisään uudella salasanalla.',
        verify: 'Vahvista',
        enter_otp: 'Syötä vahvistuskoodi.',
    },
};

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
    vi.doMock('./auth_broadcast.js', () => ({ publishAuthLogin: vi.fn(), publishAuthInvalidation: vi.fn(), subscribeToAuthBroadcast: vi.fn(() => () => {}) }));
    vi.doMock('../config_fetcher.js', () => ({ isCrossTabLoginSyncEnabled: async () => false }));
    vi.doMock('./login_page_shell_builder.js', () => ({ initializeStandaloneLoginShell: initializeShell }));
    vi.doMock('./auth_session_notice_handler.js', () => ({ initializeAuthSessionNotice: vi.fn() }));
    vi.doMock('./auth_preference_controls.js', () => ({}));
    vi.doMock('../state_stores/lang_preference_reader.js', () => ({
        getLanguageWithBrowserFallback: () => uiLanguage,
    }));
    vi.doMock('../lang/translation_handler.js', () => ({
        getTranslationForKey: (key, { fallback } = {}) => loginCopy[uiLanguage][key] || SECOND_STEP_TRANSLATION_FALLBACKS[key]?.[uiLanguage] || fallback || '',
    }));

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
    uiLanguage = 'en';
    document.body.innerHTML = `
        <form class="auth-form">
            <input id="username" value="fixture-user">
            <input id="password" type="password" value="fixture-password">
            <button type="button" id="toggle-password" aria-label="Show password">
                <svg data-fallback="password" fill="currentColor"></svg>
            </button>
            <input id="csrf_token" value="test-csrf">
            <a id="forgot-password-link" href="#">Forgot password?</a>
            <a id="back-to-login-link" href="#" style="display:none">Back to login</a>
            <div id="password-reset-section" style="display:none">
                <div id="password-reset-message"></div>
            </div>
            <input id="password-reset-new-password" type="password" value="fixture-reset">
            <button type="button" id="toggle-password-reset" aria-label="Show password">
                <svg data-fallback="reset" fill="currentColor"></svg>
            </button>
            <div id="submit"><input type="submit" data-lang-key="login" value="Login" data-testid="login-submit"></div>
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

    test('English recovery send control is not Finnish and retargets its lang key', async () => {
        await loadStartup();
        startup();

        document.getElementById('forgot-password-link').dispatchEvent(
            new MouseEvent('click', { bubbles: true, cancelable: true })
        );

        const submitBtn = document.querySelector('[data-testid="login-submit"]');
        expect(submitBtn.dataset.langKey).toBe('send_code');
        expect(submitBtn.value).toBe('Send code');
        expect(submitBtn.value).not.toBe('Lähetä koodi');
    });

    test('Finnish recovery send control stays Finnish', async () => {
        uiLanguage = 'fi';
        await loadStartup();
        startup();

        document.getElementById('forgot-password-link').dispatchEvent(
            new MouseEvent('click', { bubbles: true, cancelable: true })
        );

        const submitBtn = document.querySelector('[data-testid="login-submit"]');
        expect(submitBtn.dataset.langKey).toBe('send_code');
        expect(submitBtn.value).toBe('Lähetä koodi');
    });

    test('language switch after opening recovery keeps the send control on send_code', async () => {
        await loadStartup();
        startup();
        document.getElementById('forgot-password-link').dispatchEvent(
            new MouseEvent('click', { bubbles: true, cancelable: true })
        );

        const submitBtn = document.querySelector('[data-testid="login-submit"]');
        expect(submitBtn.dataset.langKey).toBe('send_code');

        uiLanguage = 'fi';
        const { applyLoginLangKey } = await import('./login_page_builder_helpers.js');
        applyLoginLangKey(submitBtn, 'send_code', loginCopy.fi.send_code);
        expect(submitBtn.value).toBe('Lähetä koodi');

        uiLanguage = 'en';
        applyLoginLangKey(submitBtn, 'send_code', loginCopy.en.send_code);
        expect(submitBtn.value).toBe('Send code');
        expect(submitBtn.value).not.toBe('Lähetä koodi');
        expect(submitBtn.dataset.langKey).toBe('send_code');
    });
    test('standalone recovery uses the shared view and announces completion as a status', async () => {
        const doc = new DOMParser().parseFromString(readFileSync('frontend/templates/login.html', 'utf8'), 'text/html');
        document.body.replaceChildren(doc.querySelector('form.auth-form'));
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
        vi.stubGlobal('fetch', fetchMock);
        await loadStartup();
        startup();
        const form = document.querySelector('form');
        document.getElementById('username').value = 'fixture';
        document.getElementById('forgot-password-link').click();
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(form.classList.contains('is-verifying')).toBe(true));
        document.getElementById('password-reset-otp').value = 'abc 234 def';
        document.getElementById('password-reset-new-password').value = '  exact replacement  ';
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(form.querySelector('[data-login-status]')?.textContent).toBe(loginCopy.en.password_updated_sign_in));
        expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ otp_code: 'abc234def', new_password: '  exact replacement  ' });
        expect(form.querySelector('[data-login-status]').getAttribute('role')).toBe('status');
        expect(document.getElementById('login-error-msg')?.textContent || '').toBe('');
    });

    test('both password reveal controls retain Finnish accessible names', async () => {
        uiLanguage = 'fi';
        await loadStartup();
        startup();
        const form = document.querySelector('form');
        for (const id of ['toggle-password', 'toggle-password-reset']) {
            const button = form.querySelector('#' + id);
            expect(button.getAttribute('aria-label')).toBe('Näytä salasana');
            button.click();
            expect(button.getAttribute('aria-label')).toBe('Piilota salasana');
            expect(button.dataset.ariaLabelLangKey).toBe('hide_password');
        }
    });

    test.each([['en', 'otp'], ['fi', 'otp'], ['en', 'recovery'], ['fi', 'recovery']])(
        '%s %s verification preserves all pre-auth policy messages and unknown errors', async (language, phase) => {
            uiLanguage = language;
            const doc = new DOMParser().parseFromString(readFileSync('frontend/templates/login.html', 'utf8'), 'text/html');
            document.body.replaceChildren(doc.querySelector('form.auth-form'));
            const fetchMock = vi.fn().mockResolvedValue({
                ok: true, json: async () => ({ otp_required: true, verification_method: 'email' }),
                clone: () => ({ json: async () => ({ otp_required: true }) }),
            });
            vi.stubGlobal('fetch', fetchMock);
            await loadStartup();
            startup();
            const form = document.querySelector('form');
            form.querySelector('#username').value = 'fixture';
            form.querySelector('#password').value = 'fixture value';
            if (phase === 'recovery') form.querySelector('#forgot-password-link').click();
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            await vi.waitFor(() => expect(form.classList.contains('is-verifying')).toBe(true));
            const root = form.querySelector(phase === 'otp' ? '#otp-section' : '#password-reset-section');
            root.querySelector('[data-verify="input"]').value = 'abc234def';
            form.querySelector('#password-reset-new-password').value = 'replacement value';
            let finishVerification;
            fetchMock.mockImplementationOnce(() => new Promise(resolve => { finishVerification = resolve; }));
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
            const resend = root.querySelector('[data-verify="resend"]');
            resend.click();
            for (const key of ['Enter', ' ']) {
                const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
                resend.dispatchEvent(event);
                expect(event.defaultPrevented).toBe(true);
                resend.click();
            }
            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(form.querySelector('input[type="submit"]').disabled).toBe(true);
            expect(resend.getAttribute('aria-disabled')).toBe('true');
            expect(resend.getAttribute('tabindex')).toBe('-1');
            finishVerification({ ok: false, json: async () => ({ error: 'wrong_otp' }) });
            await vi.waitFor(() => expect(form.querySelector('input[type="submit"]').disabled).toBe(false));
            for (const code of ['login_not_allowed', 'authentication_policy_unavailable', 'fingerprint_required', 'legacy_form_login_disabled', 'unknown_failure']) {
                for (const error of [code, `HTTP 403: ${code}`]) {
                    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error }) });
                    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                    await vi.waitFor(() => expect(root.querySelector('[data-verify="error"]').textContent).toBe(translateError(error, language)));
                    expect(form.querySelector('input[type="submit"]').disabled).toBe(false);
                }
            }
        },
    );

});
