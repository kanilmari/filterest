// auth_session_notice_handler.js
// Renders fixed, localized explanations when authentication ends outside the current view.
// Bridges protected-page redirects, cross-tab logout, and the standalone login page.
// Exists so safe shell teardown also tells the person why the login page appeared.

import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';

export const AUTH_SESSION_NOTICE_PARAM = 'auth_notice';
export const SESSION_ENDED_NOTICE = 'session-ended';
export const OTHER_TAB_LOGOUT_NOTICE = 'logged-out-another-tab';

const SUPPORTED_NOTICE_CODES = new Set([
    SESSION_ENDED_NOTICE,
    OTHER_TAB_LOGOUT_NOTICE,
]);

export function resolveAuthSessionNoticeCopy(code, languageCode = 'en') {
    if (!SUPPORTED_NOTICE_CODES.has(code)) return '';

    const finnish = String(languageCode).toLowerCase().startsWith('fi');
    if (code === OTHER_TAB_LOGOUT_NOTICE) {
        return finnish
            ? 'Sinut kirjattiin ulos toisessa välilehdessä.'
            : 'You were signed out in another tab.';
    }
    return finnish
        ? 'Istuntosi on päättynyt tai et ole enää kirjautuneena sisään. Kirjaudu uudelleen jatkaaksesi.'
        : 'Your session has ended or you are no longer signed in. Sign in again to continue.';
}

// Returns a same-origin login path carrying a fixed notice code. Other paths
// return an empty string so callers can use a non-navigation guest-shell flow.
export function buildLoginPathWithAuthNotice(
    rawPath,
    noticeCode,
    currentOrigin = window.location.origin
) {
    if (!rawPath || !SUPPORTED_NOTICE_CODES.has(noticeCode)) return '';

    try {
        const parsed = new URL(rawPath, currentOrigin);
        if (parsed.origin !== currentOrigin || parsed.pathname !== '/login') return '';
        parsed.searchParams.set(AUTH_SESSION_NOTICE_PARAM, noticeCode);
        return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
        return '';
    }
}

function removeConsumedNoticeFromAddress(locationObject, historyObject) {
    const parsed = new URL(locationObject.href);
    parsed.searchParams.delete(AUTH_SESSION_NOTICE_PARAM);
    const cleanPath = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    historyObject.replaceState({}, '', cleanPath);
}

// Consumes a fixed notice from the standalone login URL. The visible copy is
// assigned with textContent, and the marker is removed immediately so an
// ordinary later refresh does not repeat an old explanation.
export function initializeAuthSessionNotice({
    doc = document,
    locationObject = window.location,
    historyObject = window.history,
    languageCode = getLanguageWithBrowserFallback(),
} = {}) {
    const noticeElement = doc.getElementById('login-session-notice');
    if (!noticeElement) return false;

    const params = new URLSearchParams(locationObject.search);
    const noticeCode = params.get(AUTH_SESSION_NOTICE_PARAM) || '';
    const copy = resolveAuthSessionNoticeCopy(noticeCode, languageCode);
    if (!copy) return false;

    noticeElement.textContent = copy;
    noticeElement.hidden = false;
    removeConsumedNoticeFromAddress(locationObject, historyObject);
    return true;
}
