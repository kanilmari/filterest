// translation_handler_dev_notice.test.js
// Verifies development translation discovery reports one actionable final result.
// Bridges missing DOM language keys, the AI endpoint, and the shared toast system.
// Exists so an intentional empty AI response is not presented as two vague errors.
// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    endpointRouter: vi.fn(),
    showToast: vi.fn(),
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
    showToast: mocks.showToast,
}));
vi.mock("./dev_lang_key_editor.js", () => ({
    initDevLangKeyEditor: vi.fn(),
}));

beforeEach(() => {
    vi.resetModules();
    mocks.endpointRouter.mockReset();
    mocks.showToast.mockReset();
    document.head.innerHTML = '<meta name="app-env" content="dev">';
    document.body.innerHTML = "";
    window.translationPromises = { en: Promise.resolve({}) };
});

afterEach(() => {
    vi.useRealTimers();
    delete window.translationPromises;
    document.head.innerHTML = "";
    document.body.innerHTML = "";
});

test("shows one actionable warning when AI adds none of the missing keys", async () => {
    vi.useFakeTimers();
    const { translatePage } = await import("./translation_handler.js");
    await translatePage("en");
    mocks.endpointRouter.mockResolvedValueOnce([]);
    mocks.showToast.mockClear();

    const label = document.createElement("span");
    label.dataset.langKey = "missing_reviewed_feature_label";
    document.body.appendChild(label);

    await vi.advanceTimersByTimeAsync(375);

    expect(mocks.endpointRouter).toHaveBeenCalledWith(
        "generateTranslations",
        expect.objectContaining({ method: "POST" })
    );
    expect(mocks.showToast).toHaveBeenCalledTimes(1);
    expect(mocks.showToast).toHaveBeenCalledWith(expect.objectContaining({
        level: "warning",
        message: expect.stringContaining("No translations were added for 1 missing key(s)"),
    }));
});
