// root_redirect_handler.js
// Handles redirect notices and SPA-safe root redirects after dataset-level navigation events.
// Bridges redirect-notice storage, toast rendering, history updates, and post-auth shell rebuilds.
// Exists to reuse one no-reload root-return path instead of duplicating full browser navigations.

import { consumeRedirectNotice } from "../state_stores/dataset_selection_saver.js";
import { datasetFormText } from "../general_tables/dataset_form/dataset_form_text.js";
import { getTranslationForKey } from "../lang/translation_handler.js";
import { applyTranslationVariable } from "../lang/translation_handler_helpers.js";
import { runPostAuthBootstrap } from "../auth/post_auth_bootstrap.js";
import { showToast } from "../../reusable_components/notifications/toast_notification_printer.js";
import { resolveDatasetRedirectNoticeFallback } from "./dataset_redirect_notice_copy.js";

// Only fixed management-result keys may enter the shared translation surface.
// A stored notice never supplies arbitrary HTML or an arbitrary translation key.
function managementNoticeKey(notice) {
    return ['manage_table_hidden_success', 'manage_table_deleted_success'].includes(notice?.messageLangKey)
        ? notice.messageLangKey : '';
}

// A missing or a deleted dataset has two fixed sentences each: one names the
// dataset through the key's $table_name, the other serves a notice without a name.
function datasetRedirectNoticeKey(reason, datasetName) {
    if (reason === "missing") {
        return datasetName ? "dataset_redirect_missing_named" : "dataset_redirect_missing";
    }
    return datasetName ? "dataset_redirect_deleted_named" : "dataset_redirect_deleted";
}

/**
 * Resolves a stored notice into its language key, the dataset name that fills
 * the key's $table_name, and its text in the page's current language.
 * @param {{ datasetName?: string, reason?: string, messageLangKey?: string } | null} notice
 * @returns {{ key: string, datasetName: string, message: string } | null}
 */
function resolveDatasetRedirectNotice(notice) {
    if (!notice || typeof notice !== "object") {
        return null;
    }

    const managementKey = managementNoticeKey(notice);
    if (managementKey) {
        return { key: managementKey, datasetName: "", message: datasetFormText(managementKey) };
    }

    const datasetName = notice.datasetName ? String(notice.datasetName) : "";
    const key = datasetRedirectNoticeKey(notice.reason, datasetName);
    // The site's reviewed translation comes first. Before translations load, the
    // page's own language (the server writes it into <html lang>) picks the
    // bootstrap copy, so the notice never shows a key name.
    const fallback = resolveDatasetRedirectNoticeFallback(key, document.documentElement.lang);
    const translated = getTranslationForKey(key, { fallback, countUsage: false });
    const text = !translated || translated === key ? fallback : translated;
    return { key, datasetName, message: applyTranslationVariable(text, datasetName) };
}

/**
 * Builds a user-facing message for dataset redirect notices.
 * @param {{ datasetName?: string, reason?: string } | null} notice
 * @returns {string}
 */
export function buildDatasetRedirectNoticeMessage(notice) {
    return resolveDatasetRedirectNotice(notice)?.message || "";
}

/**
 * Shows and consumes a queued dataset redirect notice, if one exists.
 */
export function showDatasetRedirectNoticeIfAvailable() {
    const notice = resolveDatasetRedirectNotice(consumeRedirectNotice());
    if (!notice?.message) {
        return;
    }

    // Startup consumes notices before language loading finishes. Keep a
    // text-only translation node so the selected language updates it; the page
    // translator fills the key's $table_name from data-lang-variable.
    const content = document.createElement('span');
    content.dataset.langKey = notice.key;
    if (notice.datasetName) content.dataset.langVariable = notice.datasetName;
    content.textContent = notice.message;
    showToast({ content, level: "info" });
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
