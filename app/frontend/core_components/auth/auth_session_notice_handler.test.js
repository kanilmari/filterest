// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
    AUTH_SESSION_NOTICE_PARAM,
    OTHER_TAB_LOGOUT_NOTICE,
    SESSION_ENDED_NOTICE,
    buildLoginPathWithAuthNotice,
    initializeAuthSessionNotice,
    resolveAuthSessionNoticeCopy,
} from './auth_session_notice_handler.js';

describe('auth session notices', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="login-session-notice" role="status" hidden></div>';
        history.replaceState({}, '', '/login');
    });

    test('resolves fixed Finnish and English copy without accepting arbitrary text', () => {
        expect(resolveAuthSessionNoticeCopy(SESSION_ENDED_NOTICE, 'fi')).toContain('Istuntosi on päättynyt');
        expect(resolveAuthSessionNoticeCopy(OTHER_TAB_LOGOUT_NOTICE, 'en')).toBe('You were signed out in another tab.');
        expect(resolveAuthSessionNoticeCopy('<script>alert(1)</script>', 'fi')).toBe('');
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
        expect(replaceStateSpy).toHaveBeenLastCalledWith({}, '', '/login?redirect=%2Freports');
    });

    test('leaves the placeholder hidden for an unknown marker', () => {
        history.replaceState({}, '', '/login?auth_notice=untrusted-copy');
        expect(initializeAuthSessionNotice({ languageCode: 'fi' })).toBe(false);
        expect(document.getElementById('login-session-notice').hidden).toBe(true);
    });
});
