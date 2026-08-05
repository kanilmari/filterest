// logout_shell_reset.js
// Performs logged-in shell teardown after server-side logout, then follows the server redirect.
// Bridges the logout endpoint, client-side auth caches, and rendered SPA shell reset.
// Exists to clear local auth state before loading the backend-selected destination.

import { endpoint_router } from "../endpoints/endpoint_router.js";
import { clearPermissionCache } from "../route_permission_checker.js";
import { getSelectedDataset } from "../state_stores/dataset_selection_saver.js";
import { destroy_chat } from "../ai_features/table_chat/table_chat_printer.js";
import { publishAuthLogout } from "./auth_broadcast.js";

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
    document.getElementById("navbarAdminToolsSection")?.remove();
    document.getElementById("navmenu")?.replaceChildren();
}

export async function clearClientAuthArtifacts() {
    clearPermissionCache();
    localStorage.clear();
    sessionStorage.clear();

    // Mark the shell as guest immediately so startup helpers like dataset alias
    // hydration do not attempt authenticated-only refreshes before setAuthModes()
    // repopulates the canonical guest auth state.
    localStorage.setItem("button_state", "login");

    if ("caches" in window) {
        const cacheKeys = await caches.keys();
        await Promise.all(cacheKeys.map((key) => caches.delete(key)));
    }

    document.cookie.split(";").forEach((cookieEntry) => {
        const cookieName = cookieEntry.split("=")[0]?.trim();
        if (!cookieName) {
            return;
        }
        document.cookie = `${cookieName}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
    });
}

export async function applyLoggedOutShellReset({ postLogoutPath = "/" } = {}) {
    teardownRenderedShell();
    await clearClientAuthArtifacts();

    if (postLogoutPath) {
        window.history.replaceState({}, "", postLogoutPath);
    }

    return { postLogoutPath };
}

export async function performSpaLogoutReset() {
    const response = await endpoint_router("logout", {
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
