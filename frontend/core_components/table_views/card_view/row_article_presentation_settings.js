// Resolves the public site presentation settings used by row article rendering.
// Bridges the typed site-settings API and the article timestamp formatter.
// Exists so a missing or temporarily unavailable setting degrades to Filterest's safe default.

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

export async function resolveRowArticleTimestampDisplayOptions(locale = "") {
    const settings = await loadSitePresentationSettings();
    return {
        displayMode: normalizeTimestampDisplayMode(
            settings?.row_article_timestamp_display_mode
                || TIMESTAMP_DISPLAY_MODE_DATE_TIME
        ),
        locale,
    };
}

export function resetRowArticlePresentationSettingsCacheForTests() {
    presentationSettingsPromise = null;
}
