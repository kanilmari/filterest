// @vitest-environment jsdom
// ai_translation_retry_cache.test.js
// Verifies unresolved AI translation requests receive a bounded per-language cooldown.
// Bridges sessionStorage persistence with reload-safe translation request suppression.
// Exists so empty responses neither hammer the backend nor become permanently cached.

import { beforeEach, describe, expect, test } from "vitest";
import {
    AI_TRANSLATION_RETRY_COOLDOWN_MS,
    getSuppressedAITranslationKeys,
    suppressUnresolvedAITranslationKeys,
} from "./ai_translation_retry_cache.js";

describe("AI translation retry cache", () => {
    beforeEach(() => {
        sessionStorage.clear();
    });

    test("persists unresolved keys for the same language and browser tab", () => {
        suppressUnresolvedAITranslationKeys("EN", ["missing_title", "missing_title"], {
            now: 1_000,
        });

        expect([...getSuppressedAITranslationKeys("en", { now: 2_000 })]).toEqual([
            "missing_title",
        ]);
        expect([...getSuppressedAITranslationKeys("fi", { now: 2_000 })]).toEqual([]);
    });

    test("allows a retry after the bounded cooldown", () => {
        suppressUnresolvedAITranslationKeys("en", ["missing_title"], {
            now: 1_000,
        });

        expect([
            ...getSuppressedAITranslationKeys("en", {
                now: 1_000 + AI_TRANSLATION_RETRY_COOLDOWN_MS - 1,
            }),
        ]).toEqual(["missing_title"]);
        expect([
            ...getSuppressedAITranslationKeys("en", {
                now: 1_000 + AI_TRANSLATION_RETRY_COOLDOWN_MS,
            }),
        ]).toEqual([]);
    });

    test("fails open when cached browser data is malformed", () => {
        sessionStorage.setItem("easelect_ai_translation_retry_cache_v1", "not-json");

        expect([...getSuppressedAITranslationKeys("en", { now: 2_000 })]).toEqual([]);

        suppressUnresolvedAITranslationKeys("en", ["missing_title"], { now: 2_000 });
        expect([...getSuppressedAITranslationKeys("en", { now: 2_001 })]).toEqual([
            "missing_title",
        ]);
    });
});
