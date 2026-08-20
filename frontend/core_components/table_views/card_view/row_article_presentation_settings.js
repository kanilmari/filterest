// Resolves public site presentation settings used by card-family rendering.
// Bridges the typed site-settings API with card and article timestamp formatters.
// Keeps one cached policy so ordinary cards and article-side summaries stay consistent.
// Falls back safely when the public setting is temporarily unavailable.

import { fetchSitePresentationSettings } from "../../endpoints/stable_endpoint_router.js";
import {
    normalizeTimestampDisplayMode,
    TIMESTAMP_DISPLAY_MODE_DATE_TIME,
} from "../timestamp_display_formatter.js";

let presentationSettingsPromise = null;

async function loadSitePresentationSettings() {
    if (!presentationSettingsPromise) {
        presentationSettingsPromise = fetchSitePresentationSettings().catch((error) => {
            presentationSettingsPromise = null;
            console.warn("Unable to load site presentation settings; using defaults", error);
            return {};
        });
    }
    return presentationSettingsPromise;
}

/**
 * Resolves the site-wide card and article timestamp presentation policy.
 * Bridges the typed public site setting with all card-family renderers.
 * Keeps the legacy row-article setting key as the shared compatibility contract.
 */
export async function resolveSiteTimestampDisplayOptions(locale = "") {
    const settings = await loadSitePresentationSettings();
    return {
        displayMode: normalizeTimestampDisplayMode(
            settings?.row_article_timestamp_display_mode
                || TIMESTAMP_DISPLAY_MODE_DATE_TIME
        ),
        locale,
    };
}

export async function resolveRowArticleTimestampDisplayOptions(locale = "") {
    return resolveSiteTimestampDisplayOptions(locale);
}

export function resetRowArticlePresentationSettingsCacheForTests() {
    presentationSettingsPromise = null;
}
