// auth_session_notice_handler.js
// Renders fixed, localized explanations when authentication ends outside the current view.
// Bridges protected-page redirects, cross-tab logout, and the standalone login page.
// Exists so safe shell teardown also tells the person why the login page appeared.

import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';
import { resolveAuthSessionNoticeFallback } from './auth_session_notice_copy.js';

export const AUTH_SESSION_NOTICE_PARAM = 'auth_notice';
export const SESSION_ENDED_NOTICE = 'session-ended';
export const OTHER_TAB_LOGOUT_NOTICE = 'logged-out-another-tab';

// The notice code travels in the address, so it stays a short fixed marker. The
// sentence a person reads is a language key, which is why the two are separate.
// The server writes the same markers; its twin is
// app/backend/core_components/session_expiry/session_expiry_responder.go.
const NOTICE_LANG_KEYS = Object.freeze({
    [SESSION_ENDED_NOTICE]: 'session_ended_sign_in_again',
    [OTHER_TAB_LOGOUT_NOTICE]: 'signed_out_in_another_tab',
});

const SUPPORTED_NOTICE_CODES = new Set(Object.keys(NOTICE_LANG_KEYS));

/** The language key whose text explains one notice code. */
export function authSessionNoticeLangKey(code) {
    return NOTICE_LANG_KEYS[code] || '';
}

export function resolveAuthSessionNoticeCopy(code, languageCode = 'en') {
    const langKey = authSessionNoticeLangKey(code);
    if (!langKey) return '';
    return resolveAuthSessionNoticeFallback(langKey, languageCode);
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

// Consumes a fixed notice from the standalone login URL. The sentence is written
// with textContent so it is readable immediately, and the element also carries
// its language key so the site's own reviewed translation replaces the bootstrap
// copy as soon as translations arrive. The marker is removed from the address at
// once, so an ordinary later refresh does not repeat an old explanation.
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
    noticeElement.setAttribute('data-lang-key', authSessionNoticeLangKey(noticeCode));
    noticeElement.hidden = false;
    removeConsumedNoticeFromAddress(locationObject, historyObject);
    return true;
}
