// logout_shell_reset.js
// Performs logged-in shell teardown after server-side logout, then follows the server redirect.
// Bridges the logout endpoint, client-side auth caches, and rendered SPA shell reset.
// Exists to clear local auth state before loading the backend-selected destination.

import { datasetAppearanceState } from '../table_views/dataset_appearance_state.js';
import { endpoint_router } from "../endpoints/endpoint_router.js";
import { ensureCsrfToken } from "../pipeline/api_pipeline.js";
import { clearPermissionCache } from "../route_permission_checker.js";
import { getSelectedDataset } from "../state_stores/dataset_selection_saver.js";
import { forgetPageDatasetParams } from "../navigation/nav_engine/query_params.js";
import { forgetTabSessionFallback } from "../state_stores/tab_session_storage.js";
import { destroy_chat } from "../ai_features/table_chat/table_chat_printer.js";
import { publishAuthLogout } from "./auth_broadcast.js";
import { stopAdminUpdateNoticeSubscriber } from "../admin_tools/admin_update_notice_subscriber.js";

// These settings describe the browser/device, not the authenticated user or
// the datasets they were allowed to inspect. Everything else remains subject
// to the full logout reset below.
const LOGOUT_SAFE_LOCAL_STORAGE_KEYS = Object.freeze([
    "theme",
    "chosen_language",
    "navVisibleWide",
    "navVisibleNarrow",
    "filterest_public_presentation_v1", // Old public cache may survive a cutover.
    "filterest_public_presentation_v2", // Public site appearance only; no user or authorization state.
]);

export function resolvePostLogoutPath(responseUrl, currentOrigin = window.location.origin) {
    if (!responseUrl) {
        return "/";
    }

    try {
        const parsedUrl = new URL(responseUrl, currentOrigin);
        if (parsedUrl.origin !== currentOrigin) {
            return "/";
        }
        return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
    } catch (err) {
        console.warn("resolvePostLogoutPath failed:", err);
    }

    return "/";
}

/**
 * Navigate to the post-logout page chosen by the server.
 * Bridges logout reset results and browser navigation so callers can leave
 * the SPA shell without knowing the login_to_browse configuration.
 */
export function navigateToPostLogoutPath(postLogoutPath, locationObject = window.location) {
    const targetPath = typeof postLogoutPath === "string" ? postLogoutPath.trim() : "";
    if (!targetPath) {
        return false;
    }

    locationObject.assign(targetPath);
    return true;
}

function teardownRenderedShell() {
    const previouslySelectedDataset = getSelectedDataset();
    if (previouslySelectedDataset) {
        destroy_chat(previouslySelectedDataset);
    }

    document.querySelectorAll("#tabs_container > .content_div").forEach((containerElement) => {
        if (typeof containerElement.__cleanupListeners === "function") {
            containerElement.__cleanupListeners();
        }
        containerElement.remove();
    });

    document.getElementById("navContainer")?.remove();
    document.getElementById("nav_tree")?.remove();
    document.getElementById("navbarFavoritesSection")?.remove();
    document.getElementById("navbarAdminToolsSection")?.remove();
    document.getElementById("navmenu")?.replaceChildren();
}

export async function clearClientAuthArtifacts() {
    datasetAppearanceState.clear();
    stopAdminUpdateNoticeSubscriber();
    // What this page holds in memory belongs to the signed-out session as well:
    // each dataset's address parameters, the view kept only in memory included,
    // and the views and open rows kept there because the browser refused session
    // storage. They go first, because a refusing storage can stop the steps below.
    forgetPageDatasetParams();
    forgetTabSessionFallback();
    const logoutSafePreferences = new Map();
    for (const storageKey of LOGOUT_SAFE_LOCAL_STORAGE_KEYS) {
        const storedValue = localStorage.getItem(storageKey);
        if (storedValue !== null) {
            logoutSafePreferences.set(storageKey, storedValue);
        }
    }

    clearPermissionCache();
    localStorage.clear();
    sessionStorage.clear();

    for (const [storageKey, storedValue] of logoutSafePreferences) {
        localStorage.setItem(storageKey, storedValue);
    }

    // Mark the shell as guest immediately so startup helpers like dataset alias
    // hydration do not attempt authenticated-only refreshes before setAuthModes()
    // repopulates the canonical guest auth state.
    localStorage.setItem("button_state", "login");

    if ("caches" in window) {
        const cacheKeys = await caches.keys();
        await Promise.all(cacheKeys.map((key) => caches.delete(key)));
    }

    // The server owns authentication-cookie expiry. Browser-side wildcard
    // deletion would also clear sibling Easelect instances on the same host.
}

export async function applyLoggedOutShellReset({ postLogoutPath = "/" } = {}) {
    teardownRenderedShell();
    await clearClientAuthArtifacts();

    if (postLogoutPath) {
        window.history.replaceState({}, "", postLogoutPath);
    }

    return { postLogoutPath };
}

// navigateToSignOut signs out the whole page rather than the shell inside it. It
// is what is left when the in-page sign-out above could not finish: the person
// still wants to be signed out, and the server still has to hear it.
//
// It is a submitted form and not a plain address change, because signing out is
// now a POST carrying the token only this application's own pages hold. The form
// is the one shape that both posts and navigates, so the person still lands on
// whichever page the server sends them to.
//
// Without a token there is nothing to submit, and there is nothing useful to
// navigate to either: a cached token can be stale, so one refresh is worth trying,
// but if that also comes back empty the server is unreachable and the sign-out
// cannot happen at all. Sending the person to the login page would be the worst
// of both -- their sign-in is intact, so that page sends them straight back to the
// site, and they would have watched a sign-out that did nothing. This reports
// failure instead, and the caller says so.
export async function navigateToSignOut({ signOutPath = "/api/logout" } = {}) {
    const token = (await ensureCsrfToken()) || (await ensureCsrfToken({ forceRefresh: true }));
    if (!token) {
        return false;
    }

    const form = document.createElement("form");
    form.method = "POST";
    form.action = signOutPath;
    form.hidden = true;

    const tokenField = document.createElement("input");
    tokenField.type = "hidden";
    tokenField.name = "csrf_token";
    tokenField.value = token;
    form.appendChild(tokenField);

    document.body.appendChild(form);
    form.submit();
    return true;
}

export async function performSpaLogoutReset() {
    // Signing out is a POST because it is no longer something the browser can be
    // talked into by following a link. The sign-out is written down and stands, so
    // another site must not be able to cause one; the request now has to carry the
    // token only this application's own pages hold, which the pipeline attaches.
    const response = await endpoint_router("logout", {
        method: "POST",
        returnResponse: true,
        suppressAuthRedirect: true,
    });

    const postLogoutPath = resolvePostLogoutPath(response?.url || "");
    const result = await applyLoggedOutShellReset({ postLogoutPath });
    publishAuthLogout({
        reason: "logout",
        postLogoutPath: result.postLogoutPath,
    });
    return result;
}
