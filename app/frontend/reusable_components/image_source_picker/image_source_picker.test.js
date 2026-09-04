// image_source_picker.test.js
// Verifies the stacked picker flow from provider URL to a local add-row File.
// Bridges endpoint responses, same-origin previews, credits, and the selection callback.
// Exists to keep credentials out of the browser contract and selections scoped to the active draft.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../core_components/endpoints/endpoint_router.js", () => ({
    endpoint_router: vi.fn(),
}));

vi.mock("../../core_components/lang/translation_handler.js", () => ({
    getTranslationForKey: vi.fn(() => ""),
}));

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

import { endpoint_router } from "../../core_components/endpoints/endpoint_router.js";
import { buildCaptionMap, openImageSourcePicker, parseFilename } from "./image_source_picker.js";

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

describe("image_source_picker", () => {
    beforeEach(() => {
        document.body.replaceChildren();
        vi.clearAllMocks();
        URL.createObjectURL = vi.fn(() => "blob:preview");
        URL.revokeObjectURL = vi.fn();
    });

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
        endpoint_router.mockImplementation(async (routeName, options = {}) => {
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
        openImageSourcePicker({ onSelect });

        const input = document.querySelector('[data-testid="image-source-picker-url"]');
        input.value = selection.source_page_url;
        input.closest("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

        await vi.waitFor(() => {
            expect(document.querySelector('[data-testid="image-source-picker-preview"]')?.src).toContain("blob:preview");
        });
        document.querySelector('[data-testid="image-source-picker-select"]').click();

        await vi.waitFor(() => expect(onSelect).toHaveBeenCalledOnce());
        const picked = onSelect.mock.calls[0][0];
        expect(picked.file).toBeInstanceOf(File);
        expect(picked.file.name).toBe("selected.jpg");
        expect(picked.file.type).toBe("image/jpeg");
        expect(picked.selection.provider).toBe("pexels");
        expect(picked.captions.fi).toContain("Example Author");
    });
});
