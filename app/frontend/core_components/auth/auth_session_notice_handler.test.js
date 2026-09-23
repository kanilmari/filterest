// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
    AUTH_SESSION_NOTICE_PARAM,
    OTHER_TAB_LOGOUT_NOTICE,
    SESSION_ENDED_NOTICE,
    authSessionNoticeLangKey,
    buildLoginPathWithAuthNotice,
    initializeAuthSessionNotice,
    resolveAuthSessionNoticeCopy,
} from './auth_session_notice_handler.js';

describe('auth session notices', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="login-session-notice" role="status" hidden></div>';
        history.replaceState({}, '', '/login');
    });

    test('resolves fixed copy without accepting arbitrary text', () => {
        expect(resolveAuthSessionNoticeCopy(SESSION_ENDED_NOTICE, 'fi')).toContain('Istuntosi on päättynyt');
        expect(resolveAuthSessionNoticeCopy(OTHER_TAB_LOGOUT_NOTICE, 'en')).toBe('You were signed out in another tab.');
        expect(resolveAuthSessionNoticeCopy('<script>alert(1)</script>', 'fi')).toBe('');
    });

    test('names the language key behind each notice marker', () => {
        expect(authSessionNoticeLangKey(SESSION_ENDED_NOTICE)).toBe('session_ended_sign_in_again');
        expect(authSessionNoticeLangKey(OTHER_TAB_LOGOUT_NOTICE)).toBe('signed_out_in_another_tab');
        expect(authSessionNoticeLangKey('untrusted-copy')).toBe('');
    });

    // The sentence has to read the same in every supported language, and a site's
    // own reviewed translation has to be able to replace it.
    test.each([
        ['fi', 'Istuntosi on päättynyt'],
        ['en', 'Your session has ended'],
        ['ch', '您的登录会话已结束'],
        ['zh-CN', '您的登录会话已结束'],
        ['yue', '你嘅登入時段已經結束'],
        ['zh-HK', '你嘅登入時段已經結束'],
    ])('explains the ended sign-in in %s', (languageCode, expectedOpening) => {
        expect(resolveAuthSessionNoticeCopy(SESSION_ENDED_NOTICE, languageCode)).toContain(expectedOpening);
    });

    test('adds a notice only to a same-origin standalone login path', () => {
        expect(buildLoginPathWithAuthNotice('/login?redirect=%2Freports', OTHER_TAB_LOGOUT_NOTICE, 'https://example.test'))
            .toBe('/login?redirect=%2Freports&auth_notice=logged-out-another-tab');
        expect(buildLoginPathWithAuthNotice('/', OTHER_TAB_LOGOUT_NOTICE, 'https://example.test')).toBe('');
        expect(buildLoginPathWithAuthNotice('https://other.test/login', OTHER_TAB_LOGOUT_NOTICE, 'https://example.test')).toBe('');
    });

    test('shows a known notice once and removes only its URL marker', () => {
        history.replaceState({}, '', `/login?redirect=%2Freports&${AUTH_SESSION_NOTICE_PARAM}=${SESSION_ENDED_NOTICE}`);
        const replaceStateSpy = vi.spyOn(history, 'replaceState');

        expect(initializeAuthSessionNotice({ languageCode: 'fi' })).toBe(true);
        expect(document.getElementById('login-session-notice').hidden).toBe(false);
        expect(document.getElementById('login-session-notice').textContent).toContain('Kirjaudu uudelleen');
        expect(document.getElementById('login-session-notice').getAttribute('data-lang-key'))
            .toBe('session_ended_sign_in_again');
        expect(replaceStateSpy).toHaveBeenLastCalledWith({}, '', '/login?redirect=%2Freports');
    });

    test('leaves the placeholder hidden for an unknown marker', () => {
        history.replaceState({}, '', '/login?auth_notice=untrusted-copy');
        expect(initializeAuthSessionNotice({ languageCode: 'fi' })).toBe(false);
        expect(document.getElementById('login-session-notice').hidden).toBe(true);
    });
});
