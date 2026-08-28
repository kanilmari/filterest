// @vitest-environment jsdom
// ui_language_catalog.test.js
// Verifies the public site-language catalogue and its offline-safe fallback.
// Bridges administrator-approved locale rows with application and auth selectors.
// Exists so incomplete regional Chinese translations cannot appear publicly.

import { afterEach, describe, expect, test, vi } from "vitest";

afterEach(() => {
    vi.resetModules();
});

describe("ui_language_catalog", () => {
    test("loads only enabled and public-ready canonical languages", async () => {
        const module = await import("./ui_language_catalog.js");
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                languages: [
                    { language_code: "en", english_name: "English", native_name: "English", is_enabled: true, is_default: true, public_selector_ready: true, sort_order: 10 },
                    { language_code: "fi", english_name: "Finnish", native_name: "Suomi", is_enabled: true, is_default: false, public_selector_ready: true, sort_order: 20 },
                    { language_code: "zh-CN", english_name: "Chinese (Simplified, Mainland China)", native_name: "简体中文（中国大陆）", is_enabled: false, is_default: false, public_selector_ready: false, sort_order: 30 },
                ],
            }),
        });

        await module.loadPublicUiLanguageCatalog({ fetchImpl });

        expect(module.getUiLanguageOptions("application").map(({ value }) => value)).toEqual(["en", "fi"]);
        expect(module.getUiLanguageOptions("auth").map(({ value }) => value)).toEqual(["en", "fi"]);
    });

    test("keeps the bundled catalogue when the public endpoint is unavailable", async () => {
        const module = await import("./ui_language_catalog.js");
        await module.loadPublicUiLanguageCatalog({
            fetchImpl: vi.fn().mockRejectedValue(new Error("offline")),
        });

        expect(module.getUiLanguageOptions("application").map(({ value }) => value)).toEqual(["en", "fi", "yue"]);
    });
});
