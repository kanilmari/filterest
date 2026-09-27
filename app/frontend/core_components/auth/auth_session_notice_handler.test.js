// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
    AUTH_SESSION_NOTICE_PARAM,
    OTHER_TAB_LOGOUT_NOTICE,
    SESSION_ENDED_NOTICE,
    SIGN_OUT_NOT_RECORDED_NOTICE,
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
        expect(authSessionNoticeLangKey(SIGN_OUT_NOT_RECORDED_NOTICE)).toBe('sign_out_not_recorded_close_tabs');
        expect(authSessionNoticeLangKey('untrusted-copy')).toBe('');
    });

    // Every marker this page understands, held against the one shared list the
    // server's own test reads. Pinning the literals here alone would let a marker
    // be renamed on the server with both sides' tests still green, and the person
    // would meet a login page that explains nothing.
    test('spells every notice marker the way the shared contract does', () => {
        const contract = JSON.parse(
            readFileSync(
                resolve(
                    dirname(fileURLToPath(import.meta.url)),
                    '../../../testing/shared_contracts/auth_session_notice_markers.json',
                ),
                'utf8',
            ),
        );
        expect(AUTH_SESSION_NOTICE_PARAM).toBe(contract.parameter);
        const understoodHere = {
            'session-ended': SESSION_ENDED_NOTICE,
            'sign-out-not-recorded': SIGN_OUT_NOT_RECORDED_NOTICE,
            'logged-out-another-tab': OTHER_TAB_LOGOUT_NOTICE,
        };
        expect(contract.notices.map((notice) => notice.marker).sort())
            .toEqual(Object.keys(understoodHere).sort());
        contract.notices.forEach((notice) => {
            expect(understoodHere[notice.marker]).toBe(notice.marker);
            expect(authSessionNoticeLangKey(notice.marker)).toBe(notice.langKey);
        });
    });

    // The marker the sign-out handler writes when it could not record the
    // sign-out. Its twin is SignOutNotRecordedNotice in
    // app/backend/core_components/session_expiry/session_expiry_responder.go; the
    // two spell the same fixed word, and a page that did not know it would show
    // the person nothing at all.
    test('explains a sign-out the site could not record, in every supported language', () => {
        expect(SIGN_OUT_NOT_RECORDED_NOTICE).toBe('sign-out-not-recorded');
        [
            ['fi', 'Sulje tämän sivuston kaikki välilehdet'],
            ['en', 'Close every tab of this site'],
            ['zh-CN', '请关闭本站的所有标签页'],
            ['yue', '請閂晒本站所有分頁'],
        ].forEach(([languageCode, expectedAdvice]) => {
            expect(resolveAuthSessionNoticeCopy(SIGN_OUT_NOT_RECORDED_NOTICE, languageCode))
                .toContain(expectedAdvice);
        });
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
