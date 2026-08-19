// @vitest-environment jsdom
// card_image_modal.test.js
// Verifies that the shared card image preview uses edge-free media and transient controls.
// Bridges the card image opener with the reusable modal DOM contract.
// Exists to prevent image outlines and permanently opaque controls from returning.

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../icons/icon_loader.js", () => ({
    setElementSvgContent: vi.fn(),
}));

describe("card image modal", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        document.head.innerHTML = '<meta name="app-env" content="prod">';
        vi.useFakeTimers();
    });

    test("shows controls on pointer movement and fades them after inactivity", async () => {
        const { openImageModal } = await import("./card_image_modal.js");

        openImageModal("/storage/104/example.jpg");

        const overlay = document.querySelector("#custom_modal_overlay");
        const modal = document.querySelector("#custom_modal");
        const image = modal.querySelector("img");
        const closeButton = modal.querySelector(".modal_close_button");

        expect(modal.classList.contains("image_modal")).toBe(true);
        expect(overlay.classList.contains("modal_overlay_blur")).toBe(true);
        expect(overlay.classList.contains("image-modal-controls-active")).toBe(true);
        expect(image.getAttribute("src")).toBe("/storage/104/example.jpg");
        expect(closeButton).not.toBeNull();

        vi.advanceTimersByTime(1200);
        expect(overlay.classList.contains("image-modal-controls-active")).toBe(false);

        overlay.dispatchEvent(new PointerEvent("pointermove"));
        expect(overlay.classList.contains("image-modal-controls-active")).toBe(true);

        overlay.dispatchEvent(new PointerEvent("pointerleave"));
        vi.advanceTimersByTime(1199);
        expect(overlay.classList.contains("image-modal-controls-active")).toBe(true);

        vi.advanceTimersByTime(1);
        expect(overlay.classList.contains("image-modal-controls-active")).toBe(false);

        overlay.dispatchEvent(new PointerEvent("pointermove"));
        vi.advanceTimersByTime(1200);
        expect(overlay.classList.contains("image-modal-controls-active")).toBe(false);

        closeButton.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        expect(overlay.classList.contains("image-modal-controls-active")).toBe(true);
    });
});
