// login_shell_entry.js
// Detects explicit ?login-entry=1 SPA query parameters and opens the login UI.
// Bridges backend /login redirects and the in-shell login modal behavior.
// Exists so direct login URLs do not strand users in an empty guest shell while
// automatic auth failures can still avoid surprise modals.

export function buildLoginEntryPath(redirectUrl = "") {
    const params = new URLSearchParams();
    params.set("login-entry", "1");
    if (redirectUrl) {
        params.set("redirect", redirectUrl);
    }
    return `/?${params.toString()}`;
}

export function shouldAutoOpenForcedLoginModal() {
    return new URLSearchParams(window.location.search).get("login-entry") === "1";
}

/**
 * Check if the current URL has login-entry=1 and open the explicit login modal.
 *
 * Call this once after the guest shell is ready (post setAuthModes / checkFingerprint / initTabs).
 */
export async function handleLoginShellEntry() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("login-entry") !== "1") {
        return false;
    }

    const { showLoginModal } = await import("./login_modal_printer.js");
    await showLoginModal(params.get("redirect") || "");
    return true;
}

export function clearLoginEntryQueryFromUrl() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("login-entry") !== "1") {
        return false;
    }

    params.delete("login-entry");
    params.delete("redirect");
    const cleanSearch = params.toString();
    const cleanUrl = window.location.pathname + (cleanSearch ? `?${cleanSearch}` : "") + window.location.hash;
    window.history.replaceState({}, "", cleanUrl);
    return true;
}

/**
 * Navigate to the SPA login entry point.
 * Use this instead of raw `window.location = '/login'` so the login page
 * stays inside the SPA guest shell.
 *
 * @param {string} [redirectUrl] - optional post-login redirect target
 */
export function navigateToLoginEntry(redirectUrl) {
    window.history.replaceState({}, "", buildLoginEntryPath(redirectUrl));
}
