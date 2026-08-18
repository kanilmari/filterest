// translation_handler_synthetic_keys.test.js
// Verifies development translation discovery ignores synthetic test-dataset keys.
// Bridges DOM mutation translation discovery with the protected AI translation route.
// Exists so browser tests cannot create noisy AI calls or persistent language keys.
// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    endpointRouter: vi.fn(),
}));

vi.mock("../endpoints/endpoint_router.js", () => ({
    endpoint_router: mocks.endpointRouter,
}));
vi.mock("../table_views/card_view/card_view_printer.js", () => ({
    refreshCardLanguages: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../table_views/dataset_value_localizer.js", () => ({
    refreshLocalizedDatasetValues: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../reusable_components/notifications/toast_notification_printer.js", () => ({
    showToast: vi.fn(),
}));
vi.mock("./dev_lang_key_editor.js", () => ({
    initDevLangKeyEditor: vi.fn(),
}));

beforeEach(() => {
    vi.resetModules();
    mocks.endpointRouter.mockReset();
    document.head.innerHTML = '<meta name="app-env" content="dev">';
    document.body.innerHTML = "";
    window.translationPromises = {
        en: Promise.resolve({}),
    };
});

afterEach(() => {
    delete window.translationPromises;
    document.head.innerHTML = "";
    document.body.innerHTML = "";
});

test("does not send test_perm_table keys to the AI translation route", async () => {
    const { translatePage } = await import("./translation_handler.js");
    await translatePage("en");
    mocks.endpointRouter.mockClear();

    for (const key of [
        "test_perm_table_desktop_card_1786923499508_assets",
        "search_slogan_test_perm_table_desktop_card_1786923499508",
        "add_row_e2e_dataset_123",
    ]) {
        const label = document.createElement("span");
        label.dataset.langKey = key;
        document.body.appendChild(label);
    }

    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(mocks.endpointRouter).not.toHaveBeenCalledWith(
        "generateTranslations",
        expect.anything()
    );
});
