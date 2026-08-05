// auth_broadcast_sync.js
// Applies cross-tab auth invalidation events to the current SPA shell.
// Bridges auth-broadcast events and the existing logout/login-entry shell reset path.
// Exists to keep sibling tabs in sync when one tab logs out, resets the session, or logs in.

import { subscribeToAuthBroadcast } from "./auth_broadcast.js";
import { applyLoggedOutShellReset, navigateToPostLogoutPath } from "./logout_shell_reset.js";
import { setAuthModes } from "../admin_tools/auth_mode_handler.js";
import { initTabs } from "../navigation/main_tabs/main_tab_printer.js";
import { handleLoginShellEntry } from "./login_shell_entry.js";
import { runPostAuthBootstrap } from "./post_auth_bootstrap.js";
import { hideModal } from "../../reusable_components/modal/modal_builder.js";
import { isCrossTabLoginSyncEnabled } from "../config_fetcher.js";

let syncStarted = false;
let inFlightLogoutSync = null;
let inFlightLoginSync = null;

function clearGuestAuthEntryParams() {
    const params = new URLSearchParams(window.location.search);
    let changed = false;

    if (params.get("login-entry") === "1") {
        params.delete("login-entry");
        params.delete("redirect");
        changed = true;
    }

    if (params.get("register-entry") === "1") {
        params.delete("register-entry");
        changed = true;
    }

    if (!changed) {
        return;
    }

    const cleanSearch = params.toString();
    const cleanUrl = `${window.location.pathname}${cleanSearch ? `?${cleanSearch}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", cleanUrl);
}

export async function handleAuthBroadcastEvent(event) {
    if (!event?.type) {
        return;
    }

    if (event.type === "logout") {
        if (inFlightLogoutSync) {
            return inFlightLogoutSync;
        }

        inFlightLogoutSync = (async () => {
            const resetResult = await applyLoggedOutShellReset({
                postLogoutPath: event.detail?.postLogoutPath,
            });
            if (navigateToPostLogoutPath(resetResult?.postLogoutPath)) {
                return;
            }

            try {
                await setAuthModes();
            } catch (error) {
                console.warn("Cross-tab auth sync: setAuthModes failed", error);
            }

            await initTabs({ dataAlreadyLoaded: false });
            await handleLoginShellEntry();
        })().finally(() => {
            inFlightLogoutSync = null;
        });

        return inFlightLogoutSync;
    }

    if (event.type !== "login" || !(await isCrossTabLoginSyncEnabled())) {
        return;
    }

    if (inFlightLoginSync) {
        return inFlightLoginSync;
    }

    inFlightLoginSync = (async () => {
        hideModal();
        clearGuestAuthEntryParams();
        try {
            await setAuthModes();
        } catch (error) {
            console.warn("Cross-tab auth sync: setAuthModes failed", error);
        }

        await runPostAuthBootstrap({ refreshAuthModes: false });
    })().finally(() => {
        inFlightLoginSync = null;
    });

    return inFlightLoginSync;
}

export function startAuthBroadcastSync() {
    if (syncStarted) {
        return () => {};
    }

    const unsubscribe = subscribeToAuthBroadcast(handleAuthBroadcastEvent);
    syncStarted = true;

    return () => {
        syncStarted = false;
        unsubscribe();
    };
}
