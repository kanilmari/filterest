// root_redirect_handler.js
// Handles redirect notices and SPA-safe root redirects after dataset-level navigation events.
// Bridges redirect-notice storage, toast rendering, history updates, and post-auth shell rebuilds.
// Exists to reuse one no-reload root-return path instead of duplicating full browser navigations.

import { consumeRedirectNotice } from "../state_stores/dataset_selection_saver.js";
import { runPostAuthBootstrap } from "../auth/post_auth_bootstrap.js";
import { showInfoToast } from "../../reusable_components/notifications/toast_notification_printer.js";

/**
 * Builds a user-facing message for dataset redirect notices.
 * @param {{ datasetName?: string, reason?: string } | null} notice
 * @returns {string}
 */
export function buildDatasetRedirectNoticeMessage(notice) {
    if (!notice || typeof notice !== "object") {
        return "";
    }

    const datasetName = notice?.datasetName || "";
    const reason = notice?.reason || "deleted";
    if (reason === "missing") {
        return datasetName
            ? `Näkymää ${datasetName} ei löytynyt. Siirryttiin oletusnäkymään.`
            : "Valittua näkymää ei löytynyt. Siirryttiin oletusnäkymään.";
    }

    return datasetName
        ? `Taulu ${datasetName} on poistettu. Siirryttiin oletusnäkymään.`
        : "Taulu on poistettu. Siirryttiin oletusnäkymään.";
}

/**
 * Shows and consumes a queued dataset redirect notice, if one exists.
 */
export function showDatasetRedirectNoticeIfAvailable() {
    const notice = consumeRedirectNotice();
    if (!notice) {
        return;
    }

    const message = buildDatasetRedirectNoticeMessage(notice);
    if (message) {
        showInfoToast(message);
    }
}

/**
 * Returns to the app root without a hard reload and rebuilds the current SPA shell.
 * @param {{ refreshAuthModes?: boolean }} [options]
 */
export async function redirectToRootInSpa({ refreshAuthModes = false } = {}) {
    window.history.replaceState({}, "", "/");
    await runPostAuthBootstrap({ refreshAuthModes });
    showDatasetRedirectNoticeIfAvailable();
}
