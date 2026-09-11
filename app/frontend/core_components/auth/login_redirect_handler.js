// login_redirect_handler.js
// Resolves the correct post-auth redirect UX after unauthorized frontend states.
// Bridges forced-login full-page redirects and guest-shell modal login recovery.
// Exists to keep auth redirect behavior centralized instead of duplicating
// fallback navigation rules across views. Only explicit authentication failures
// may interrupt public browsing; permission denials never call this handler.

let loginRedirectScheduled = false;

import { clearDatasetSelectionState } from '../state_stores/dataset_selection_saver.js';
import { buildLoginPathWithAuthNotice, SESSION_ENDED_NOTICE } from './auth_session_notice_handler.js';

function buildStandaloneLoginPath() {
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (!currentPath || currentPath === '/login' || currentPath === '/') {
        return '/login';
    }

    const params = new URLSearchParams();
    params.set('redirect', currentPath);
    return `/login?${params.toString()}`;
}

export async function requestLoginRedirect({ userInitiated = false, authenticationFailure = false } = {}) {
    if (loginRedirectScheduled) {
        return;
    }

    if (window.location.pathname.startsWith('/login')) {
        return;
    }

    const browseRequiresLogin = localStorage.getItem('login_required_for_browse') === 'true';
    if (!userInitiated && !browseRequiresLogin && !authenticationFailure) {
        return;
    }

    loginRedirectScheduled = true;
    clearDatasetSelectionState();

    let navigationStarted = false;
    try {
        if (browseRequiresLogin || authenticationFailure) {
            const loginPath = buildStandaloneLoginPath();
            const destination = authenticationFailure
                ? buildLoginPathWithAuthNotice(loginPath, SESSION_ENDED_NOTICE)
                : loginPath;
            window.location.assign(destination);
            navigationStarted = true;
            return;
        }

        if (!userInitiated) {
            return;
        }

        const { showLoginModal } = await import('./login_modal_printer.js');
        await showLoginModal();
    } finally {
        // Hard navigation keeps the guard until this document is replaced.
        // Parallel auth failures must not schedule repeated redirects.
        if (!navigationStarted) loginRedirectScheduled = false;
    }
}
