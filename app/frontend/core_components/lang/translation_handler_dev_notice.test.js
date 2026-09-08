// translation_handler_dev_notice.test.js
// Verifies translation maintenance stays in developer diagnostics instead of user toasts.
// Connects missing/orphan key discovery, readable fallbacks, and endpoint outcomes.
// Protects Finnish/English pages in either theme from maintenance-only notifications.
// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    endpointRouter: vi.fn(),
    showToast: vi.fn(),
}));
vi.mock("../endpoints/endpoint_router.js", () => ({ endpoint_router: mocks.endpointRouter }));
vi.mock("../table_views/card_view/card_view_printer.js", () => ({
    refreshCardLanguages: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../table_views/dataset_value_localizer.js", () => ({
    refreshLocalizedDatasetValues: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../reusable_components/notifications/toast_notification_printer.js", () => ({
    showToast: mocks.showToast,
}));
vi.mock("./dev_lang_key_editor.js", () => ({ initDevLangKeyEditor: vi.fn() }));

const NativeMutationObserver = globalThis.MutationObserver;
let observers;

beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    mocks.endpointRouter.mockReset();
    mocks.showToast.mockReset();
    for (const method of ["warn", "error", "info", "log"]) {
        vi.spyOn(console, method).mockImplementation(() => {});
    }
    observers = [];
    vi.stubGlobal("MutationObserver", class extends NativeMutationObserver {
        constructor(callback) {
            super(callback);
            observers.push(this);
        }
    });
    document.head.innerHTML = '<meta name="app-env" content="dev">';
    document.body.innerHTML = "";
    sessionStorage.clear();
    window.translationPromises = { en: Promise.resolve({}), fi: Promise.resolve({}) };
});

afterEach(() => {
    observers.forEach((observer) => observer.disconnect());
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete window.translationPromises;
    document.head.innerHTML = "";
    document.body.innerHTML = "";
});

test.each([
    ["fi", "light", "Metadatan oletus on käytössä"],
    ["fi", "dark", "Metadatan oletus on käytössä"],
    ["en", "light", "Metadata default in use"],
    ["en", "dark", "Metadata default in use"],
])("keeps %s fallback readable in %s theme without a repair toast", async (language, theme, copy) => {
    document.documentElement.dataset.theme = theme;
    const { translatePage } = await import("./translation_handler.js");
    await translatePage(language);
    mocks.endpointRouter.mockResolvedValueOnce([]);
    const label = document.createElement("span");
    label.dataset.langKey = "field_set_source_metadata";
    document.body.appendChild(label);
    const missingLabel = document.createElement("span");
    missingLabel.dataset.langKey = "missing_reviewed_field_label";
    document.body.appendChild(missingLabel);

    await vi.advanceTimersByTimeAsync(375);

    expect(label.textContent).toBe(copy);
    expect(mocks.endpointRouter).toHaveBeenCalledWith(
        "generateTranslations", expect.objectContaining({ method: "POST" })
    );
    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("No translations were added"));
});

test.each([
    ["complete", { first_missing_label: "First", second_missing_label: "Second" }, "info", "AI added 2/2"],
    ["partial", { first_missing_label: "First" }, "warn", "1 key(s) still need reviewed values"],
])("records a %s result in diagnostics without a toast", async (_, response, method, message) => {
    const { translatePage } = await import("./translation_handler.js");
    await translatePage("en");
    mocks.endpointRouter.mockResolvedValueOnce(response);
    for (const key of ["first_missing_label", "second_missing_label"]) {
        const label = document.createElement("span");
        label.dataset.langKey = key;
        document.body.appendChild(label);
    }
    await vi.advanceTimersByTimeAsync(375);

    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(console[method]).toHaveBeenCalledWith(expect.stringContaining(message));
    expect(document.body.firstElementChild.textContent).toBe("First");
});

test("records failed discovery in diagnostics without a toast", async () => {
    const { translatePage } = await import("./translation_handler.js");
    await translatePage("en");
    mocks.endpointRouter.mockRejectedValueOnce(new Error("maintenance unavailable"));
    const label = document.createElement("span");
    label.dataset.langKey = "use_metadata_default";
    document.body.appendChild(label);
    const missingLabel = document.createElement("span");
    missingLabel.dataset.langKey = "missing_reviewed_field_label";
    document.body.appendChild(missingLabel);
    await vi.advanceTimersByTimeAsync(375);

    expect(label.textContent).toBe("Use metadata default");
    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("maintenance unavailable"));
});

test("reports an orphan key only in diagnostics while rendering its translation", async () => {
    window.translationPromises.en = Promise.resolve({
        translations: { orphan_label: "Existing translation" },
        orphan_keys: ["orphan_label"],
    });
    const label = document.createElement("span");
    label.dataset.langKey = "orphan_label";
    document.body.appendChild(label);
    const { translatePage } = await import("./translation_handler.js");
    await translatePage("en");

    expect(label.textContent).toBe("Existing translation");
    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("[ORPHAN KEY]"));
});

test("does not run development discovery or notices on production pages", async () => {
    document.head.innerHTML = '<meta name="app-env" content="production">';
    const { translatePage } = await import("./translation_handler.js");
    await translatePage("fi");
    const label = document.createElement("span");
    label.dataset.langKey = "use_metadata_default";
    document.body.appendChild(label);
    await vi.advanceTimersByTimeAsync(375);

    expect(label.textContent).toBe("Käytä metadatan oletusta");
    expect(mocks.endpointRouter).not.toHaveBeenCalled();
    expect(mocks.showToast).not.toHaveBeenCalled();
});
