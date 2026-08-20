// Verifies card-family presentation settings consume only the typed public contract.
// Bridges the settings cache, safe timestamp-mode fallback, and stable endpoint wrapper.
// Covers ordinary cards and article rendering through one shared public setting.
// Exists so invalid or unavailable configuration never restores raw ISO timestamps.

import { beforeEach, describe, expect, test, vi } from "vitest";

const { fetchSitePresentationSettingsMock } = vi.hoisted(() => ({
    fetchSitePresentationSettingsMock: vi.fn(),
}));

vi.mock("../../endpoints/stable_endpoint_router.js", () => ({
    fetchSitePresentationSettings: fetchSitePresentationSettingsMock,
}));

import {
    resetRowArticlePresentationSettingsCacheForTests,
    resolveRowArticleTimestampDisplayOptions,
    resolveSiteTimestampDisplayOptions,
} from "./row_article_presentation_settings.js";

describe("row_article_presentation_settings", () => {
    beforeEach(() => {
        fetchSitePresentationSettingsMock.mockReset();
        resetRowArticlePresentationSettingsCacheForTests();
    });

    test("returns the allowlisted timestamp mode with the current UI language", async () => {
        fetchSitePresentationSettingsMock.mockResolvedValue({
            row_article_timestamp_display_mode: "date_only",
            dataset_cover_theme: {},
        });

        await expect(resolveRowArticleTimestampDisplayOptions("fi")).resolves.toEqual({
            displayMode: "date_only",
            locale: "fi",
        });
    });

    test("falls back to date_time for unsupported values", async () => {
        fetchSitePresentationSettingsMock.mockResolvedValue({
            row_article_timestamp_display_mode: "raw_iso",
        });

        await expect(resolveRowArticleTimestampDisplayOptions("en")).resolves.toEqual({
            displayMode: "date_time",
            locale: "en",
        });
    });

    test("caches one successful site-settings read for the current page", async () => {
        fetchSitePresentationSettingsMock.mockResolvedValue({});

        await resolveRowArticleTimestampDisplayOptions("en");
        await resolveRowArticleTimestampDisplayOptions("fi");

        expect(fetchSitePresentationSettingsMock).toHaveBeenCalledTimes(1);
    });

    test("shares the same typed timestamp policy with ordinary cards", async () => {
        fetchSitePresentationSettingsMock.mockResolvedValue({
            row_article_timestamp_display_mode: "date_only",
        });

        await expect(resolveSiteTimestampDisplayOptions("fi")).resolves.toEqual({
            displayMode: "date_only",
            locale: "fi",
        });
    });
});
