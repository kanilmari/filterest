// image_source_picker.test.js
// Verifies the stacked picker flow from provider URL to a local add-row File.
// Bridges endpoint responses, same-origin previews, credits, and the selection callback.
// Exists to keep credentials out of the browser contract and selections scoped to the active draft.
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../notifications/toast_notification_printer.js", () => ({
    showErrorToast: vi.fn(),
}));

vi.mock("../modal/modal_builder.js", () => ({
    createStackedModal: vi.fn(({ contentElements, cleanupCallback }) => {
        const modal = document.createElement("div");
        modal.append(...contentElements);
        const overlay = document.createElement("div");
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        return {
            modal,
            modal_overlay: overlay,
            show: vi.fn(),
            hide: vi.fn(() => {
                cleanupCallback?.();
                overlay.remove();
            }),
        };
    }),
}));

import { showErrorToast } from "../notifications/toast_notification_printer.js";
import { buildCaptionMap, getImageSourcePickerText, openImageSourcePicker, parseFilename } from "./image_source_picker.js";

const endpointRouter = vi.fn();

const selection = {
    provider: "pexels",
    provider_name: "Pexels",
    provider_asset_id: "123",
    source_page_url: "https://www.pexels.com/photo/example-123/",
    creator_name: "Example Author",
    description: "Mountain lake",
    attribution: { text: "Photo by Example Author on Pexels" },
    image: { alt_text: "Mountain lake" },
};

function imageResponse(filename = "pexels-123.jpg") {
    return {
        headers: new Headers({
            "Content-Type": "image/jpeg",
            "Content-Disposition": `attachment; filename="${filename}"`,
        }),
        blob: vi.fn(async () => new Blob(["image-bytes"], { type: "image/jpeg" })),
    };
}


function providerResponse() {
    return { providers: [{ key: "pexels", name: "Pexels", configured: true, homepage_url: "https://www.pexels.com/" }] };
}
function sourceInput() {
    return document.querySelector('[data-testid="image-source-picker-url"]');
}
function typeSource(value) {
    sourceInput().value = value;
    sourceInput().dispatchEvent(new Event("input", { bubbles: true }));
}
function statusText() {
    return document.querySelector('[data-testid="image-source-picker-status"]').textContent;
}
function resolveCalls() {
    return endpointRouter.mock.calls.filter(([route]) => route === "imageSourcePickerResolve");
}
function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

describe("image_source_picker", () => {
    afterEach(() => { vi.useRealTimers(); });
    beforeEach(() => {
        document.body.replaceChildren();
        vi.clearAllMocks();
        endpointRouter.mockReset();
        endpointRouter.mockImplementation(async (routeName) => {
            if (routeName === "imageSourcePickerProviders") return providerResponse();
            if (routeName === "imageSourcePickerResolve") return { selection };
            return imageResponse();
        });
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
        URL.createObjectURL = vi.fn(() => "blob:preview");
        URL.revokeObjectURL = vi.fn();
    });

    test.each([["fi-FI", "Kuvasivun osoite"], ["en-US", "Image page URL"]])(
        "passes reviewed copy to the shared missing-key fallback (%s)", (language, expected) => {
            const translator = vi.fn((key, { fallback } = {}) => fallback || key.replaceAll("_", " "));
            expect(getImageSourcePickerText("image_source_url", "", {
                getTranslation: translator, getLanguage: () => language,
            })).toBe(expected);
            expect(translator).toHaveBeenCalledWith("image_source_url", { fallback: expected });
            expect(getImageSourcePickerText("image_source_url", "", {
                getTranslation: () => "Site-authored label", getLanguage: () => language,
            })).toBe("Site-authored label");
        },
    );

    test("builds deterministic bilingual provider credits", () => {
        expect(buildCaptionMap(selection)).toEqual({
            fi: "Kuva: Example Author / Pexels.",
            en: "Photo: Example Author / Pexels.",
        });
    });

    test("parses a server-selected filename without trusting the source URL", () => {
        expect(parseFilename(imageResponse("safe-name.webp"), selection)).toBe("safe-name.webp");
    });

    test("previews and returns one local file for the active add-row draft", async () => {
        endpointRouter.mockImplementation(async (routeName, options = {}) => {
            if (routeName === "imageSourcePickerProviders") {
                return { providers: [{ key: "pexels", name: "Pexels", configured: true }] };
            }
            if (routeName === "imageSourcePickerResolve") {
                return { selection };
            }
            if (routeName === "imageSourcePickerFile") {
                return imageResponse(options.body_data?.purpose === "select" ? "selected.jpg" : "preview.jpg");
            }
            throw new Error(`unexpected route ${routeName}`);
        });
        const onSelect = vi.fn();
        openImageSourcePicker({ onSelect, endpointRouter });

        const input = document.querySelector('[data-testid="image-source-picker-url"]');
        input.value = selection.source_page_url;
        input.closest("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

        await vi.waitFor(() => {
            expect(document.querySelector('[data-testid="image-source-picker-preview"]')?.src).toContain("blob:preview");
        });
        const creditLink = document.querySelector('a[href="https://www.pexels.com/photo/example-123/"]');
        expect(creditLink?.textContent).toBe("See original page");
        document.querySelector('[data-testid="image-source-picker-select"]').click();

        await vi.waitFor(() => expect(onSelect).toHaveBeenCalledOnce());
        const picked = onSelect.mock.calls[0][0];
        expect(picked.file).toBeInstanceOf(File);
        expect(picked.file.name).toBe("selected.jpg");
        expect(picked.file.type).toBe("image/jpeg");
        expect(picked.selection.provider).toBe("pexels");
        expect(picked.captions.fi).toContain("Example Author");
    });
    test.each([
        ["fi", "Liitä ja esikatsele", "Esikatsele"],
        ["en", "Paste & preview", "Preview"],
    ])("reads the clipboard only on the empty-field action (%s)", async (language, pasteLabel, previewLabel) => {
        const readText = vi.fn(async () => "  " + selection.source_page_url + "  ");
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText } });
        openImageSourcePicker({ endpointRouter, getLanguage: () => language });
        const button = document.querySelector('[data-testid="image-source-picker-preview-button"]');
        expect(button.textContent).toBe(pasteLabel);
        expect(readText).not.toHaveBeenCalled();
        button.click();
        await vi.waitFor(() => expect(document.querySelector('[data-testid="image-source-picker-select"]').disabled).toBe(false));
        expect(readText).toHaveBeenCalledOnce();
        expect(sourceInput().value).toBe(selection.source_page_url);
        expect(button.textContent).toBe(previewLabel);
        expect(endpointRouter).toHaveBeenCalledWith("imageSourcePickerResolve", expect.objectContaining({
            suppressErrorToast: true, body_data: { source_url: selection.source_page_url },
        }));
    });

    test.each([
        ["fi", "Leikepöytää ei voitu lukea."],
        ["en", "The clipboard could not be read."],
    ])("explains clipboard denial without requesting a provider (%s)", async (language, expected) => {
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
            readText: vi.fn(async () => { throw new Error("Permission denied"); }),
        } });
        openImageSourcePicker({ endpointRouter, getLanguage: () => language });
        document.querySelector('[data-testid="image-source-picker-preview-button"]').click();
        await vi.waitFor(() => expect(statusText()).toContain(expected));
        expect(showErrorToast).toHaveBeenCalledOnce();
        expect(resolveCalls()).toHaveLength(0);
        expect(document.querySelector('[data-testid="image-source-picker-preview-button"]').disabled).toBe(false);
    });

    test.each([undefined, { readText: async () => "" }])("handles unavailable or empty clipboard", async (clipboard) => {
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
        openImageSourcePicker({ endpointRouter });
        document.querySelector('[data-testid="image-source-picker-preview-button"]').click();
        await vi.waitFor(() => expect(showErrorToast).toHaveBeenCalledOnce());
        expect(statusText()).toMatch(/clipboard/i);
        expect(resolveCalls()).toHaveLength(0);
    });

    test.each([
        ["fi", "Kuvan esikatselu epäonnistui."],
        ["en", "The image preview failed."],
    ])("reports a manually requested failure in the component language (%s)", async (language, expected) => {
        endpointRouter.mockImplementation(async (routeName) => {
            if (routeName === "imageSourcePickerProviders") return { providers: [] };
            throw new Error('Virhe pyynnössä (imageSourcePickerResolve): {"error":{"code":"image_download_failed","message":"Internal provider detail"}}');
        });
        openImageSourcePicker({ endpointRouter, getLanguage: () => language });
        typeSource("https://example.com/photo/123");
        document.querySelector('[data-testid="image-source-picker-preview-button"]').click();
        await vi.waitFor(() => expect(statusText()).toContain(expected));
        expect(statusText()).not.toMatch(/imageSourcePickerResolve|Internal provider detail/);
        expect(showErrorToast).toHaveBeenCalledOnce();
        expect(sourceInput().value).toBe("https://example.com/photo/123");
    });

    test("validates malformed manually entered URLs with visible feedback", async () => {
        openImageSourcePicker({ endpointRouter });
        typeSource("not a URL");
        document.querySelector('[data-testid="image-source-picker-preview-button"]').click();
        await vi.waitFor(() => expect(statusText()).toContain("HTTPS"));
        expect(resolveCalls()).toHaveLength(0);
        expect(showErrorToast).toHaveBeenCalledOnce();
    });

    test("debounces known provider URLs and keeps failed automatic attempts quiet", async () => {
        vi.useFakeTimers();
        endpointRouter.mockImplementation(async (routeName) => {
            if (routeName === "imageSourcePickerProviders") return providerResponse();
            throw new Error("Provider unavailable");
        });
        openImageSourcePicker({ endpointRouter });
        await vi.advanceTimersByTimeAsync(0);
        typeSource(selection.source_page_url);
        await vi.advanceTimersByTimeAsync(350);
        typeSource(selection.source_page_url + "?edited=1");
        await vi.advanceTimersByTimeAsync(499);
        expect(resolveCalls()).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(1);
        expect(resolveCalls()).toHaveLength(1);
        expect(statusText()).toBe("");
        expect(showErrorToast).not.toHaveBeenCalled();
        document.querySelector('[data-testid="image-source-picker-preview-button"]').click();
        await vi.advanceTimersByTimeAsync(0);
        expect(resolveCalls()).toHaveLength(2);
        expect(statusText()).toContain("preview failed");
        expect(showErrorToast).toHaveBeenCalledOnce();
    });

    test.each([
        "https://www.pexels.com.evil.example/photo/example-123/",
        "https://example.com/?source=pexels.com",
        "http://www.pexels.com/photo/example-123/",
        "https://name:pass@www.pexels.com/photo/example-123/",
        "https://www.pexels.com:8443/photo/example-123/",
        "javascript:alert(1)",
    ])("does not automatically resolve an unknown or unsafe provider URL: %s", async (url) => {
        vi.useFakeTimers();
        openImageSourcePicker({ endpointRouter });
        await vi.advanceTimersByTimeAsync(0);
        typeSource(url);
        await vi.advanceTimersByTimeAsync(1000);
        expect(resolveCalls()).toHaveLength(0);
        expect(showErrorToast).not.toHaveBeenCalled();
    });

    test("shows a successful automatic preview without importing it", async () => {
        vi.useFakeTimers();
        const onSelect = vi.fn();
        openImageSourcePicker({ endpointRouter, onSelect });
        await vi.advanceTimersByTimeAsync(0);
        typeSource(selection.source_page_url);
        await vi.advanceTimersByTimeAsync(500);
        expect(document.querySelector('[data-testid="image-source-picker-select"]').disabled).toBe(false);
        expect(statusText()).toBe("Image is ready to use.");
        expect(onSelect).not.toHaveBeenCalled();
        expect(endpointRouter.mock.calls.some(([route, options]) => route === "imageSourcePickerFile"
            && options.body_data.purpose === "select")).toBe(false);
    });

    test("cancels the pending automatic attempt when Preview is explicitly requested", async () => {
        vi.useFakeTimers();
        openImageSourcePicker({ endpointRouter });
        await vi.advanceTimersByTimeAsync(0);
        typeSource(selection.source_page_url);
        document.querySelector('[data-testid="image-source-picker-preview-button"]').click();
        await vi.advanceTimersByTimeAsync(1000);
        expect(resolveCalls()).toHaveLength(1);
    });

    test("late provider discovery does not duplicate an explicit preview", async () => {
        vi.useFakeTimers();
        const providers = deferred();
        endpointRouter.mockImplementation(async (routeName) => {
            if (routeName === "imageSourcePickerProviders") return providers.promise;
            if (routeName === "imageSourcePickerResolve") return { selection };
            return imageResponse();
        });
        openImageSourcePicker({ endpointRouter });
        typeSource(selection.source_page_url);
        document.querySelector('[data-testid="image-source-picker-preview-button"]').click();
        await vi.advanceTimersByTimeAsync(0);
        providers.resolve(providerResponse());
        await vi.advanceTimersByTimeAsync(1000);
        expect(resolveCalls()).toHaveLength(1);
    });

    test("ignores an older resolve after the source URL changes", async () => {
        const old = deferred();
        const newerUrl = "https://www.pexels.com/photo/newer-456/";
        endpointRouter.mockImplementation(async (routeName, options) => {
            if (routeName === "imageSourcePickerProviders") return providerResponse();
            if (routeName === "imageSourcePickerResolve") {
                return options.body_data.source_url === selection.source_page_url ? old.promise
                    : { selection: { ...selection, provider_asset_id: "456", image: { alt_text: "New image" } } };
            }
            return imageResponse();
        });
        const onSelect = vi.fn();
        openImageSourcePicker({ endpointRouter, onSelect });
        typeSource(selection.source_page_url);
        document.querySelector('[data-testid="image-source-picker-preview-button"]').click();
        typeSource(newerUrl);
        document.querySelector('[data-testid="image-source-picker-preview-button"]').click();
        await vi.waitFor(() => expect(document.querySelector('[data-testid="image-source-picker-preview"]').alt).toBe("New image"));
        old.resolve({ selection });
        await Promise.resolve();
        await Promise.resolve();
        expect(endpointRouter.mock.calls.filter(([route, options]) => route === "imageSourcePickerFile"
            && options.body_data.source_url === selection.source_page_url)).toHaveLength(0);
        document.querySelector('[data-testid="image-source-picker-select"]').click();
        await vi.waitFor(() => expect(onSelect).toHaveBeenCalledOnce());
        expect(onSelect.mock.calls[0][0].selection.provider_asset_id).toBe("456");
    });

    test("revokes the previous preview and disables selection when the URL is edited", async () => {
        openImageSourcePicker({ endpointRouter });
        typeSource(selection.source_page_url);
        document.querySelector('[data-testid="image-source-picker-preview-button"]').click();
        await vi.waitFor(() => expect(document.querySelector('[data-testid="image-source-picker-select"]').disabled).toBe(false));
        typeSource("https://example.com/a");
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
        expect(document.querySelector('[data-testid="image-source-picker-select"]').disabled).toBe(true);
        expect(document.querySelector('[data-testid="image-source-picker-preview"]').hasAttribute("src")).toBe(false);
    });

    test("closing the modal cancels pending debounce work", async () => {
        vi.useFakeTimers();
        const picker = openImageSourcePicker({ endpointRouter });
        await vi.advanceTimersByTimeAsync(0);
        typeSource(selection.source_page_url);
        picker.hide();
        await vi.advanceTimersByTimeAsync(1000);
        expect(resolveCalls()).toHaveLength(0);
        expect(showErrorToast).not.toHaveBeenCalled();
    });

    test("does not attach a late preview blob after the modal closes", async () => {
        const blob = deferred();
        endpointRouter.mockImplementation(async (routeName) => {
            if (routeName === "imageSourcePickerProviders") return providerResponse();
            if (routeName === "imageSourcePickerResolve") return { selection };
            return { ...imageResponse(), blob: () => blob.promise };
        });
        const picker = openImageSourcePicker({ endpointRouter });
        typeSource(selection.source_page_url);
        document.querySelector('[data-testid="image-source-picker-preview-button"]').click();
        await vi.waitFor(() => expect(endpointRouter).toHaveBeenCalledWith("imageSourcePickerFile", expect.any(Object)));
        picker.hide();
        blob.resolve(new Blob(["late"], { type: "image/jpeg" }));
        await Promise.resolve();
        await Promise.resolve();
        expect(URL.createObjectURL).not.toHaveBeenCalled();
        expect(showErrorToast).not.toHaveBeenCalled();
    });

    test("does not replace newly typed text with a delayed clipboard read", async () => {
        const clipboard = deferred();
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText: () => clipboard.promise } });
        openImageSourcePicker({ endpointRouter });
        document.querySelector('[data-testid="image-source-picker-preview-button"]').click();
        typeSource("https://example.com/typed");
        clipboard.resolve(selection.source_page_url);
        await Promise.resolve();
        await Promise.resolve();
        expect(sourceInput().value).toBe("https://example.com/typed");
        expect(resolveCalls()).toHaveLength(0);
    });

});
