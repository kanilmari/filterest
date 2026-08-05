// login_redirect_handler.js
// Resolves the correct post-auth redirect UX after unauthorized frontend states.
// Bridges forced-login full-page redirects and guest-shell modal login recovery.
// Exists to keep auth redirect behavior centralized instead of duplicating
// fallback navigation rules across views.

let loginRedirectScheduled = false;

import { clearDatasetSelectionState } from '../state_stores/dataset_selection_saver.js';

function buildStandaloneLoginPath() {
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (!currentPath || currentPath === '/login' || currentPath === '/') {
        return '/login';
    }

    const params = new URLSearchParams();
    params.set('redirect', currentPath);
    return `/login?${params.toString()}`;
}

export async function requestLoginRedirect({ userInitiated = false } = {}) {
    if (loginRedirectScheduled) {
        return;
    }

    if (window.location.pathname.startsWith('/login')) {
        return;
    }

    const browseRequiresLogin = localStorage.getItem('login_required_for_browse') === 'true';
    if (!userInitiated && !browseRequiresLogin) {
        return;
    }

    loginRedirectScheduled = true;
    clearDatasetSelectionState();

    try {
        if (browseRequiresLogin) {
            window.location.assign(buildStandaloneLoginPath());
            return;
        }

        if (!userInitiated) {
            return;
        }

        const { showLoginModal } = await import('./login_modal_printer.js');
        await showLoginModal();
    } finally {
        loginRedirectScheduled = false;
    }
}
