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

        const modalResult = openImageModal("/storage/104/example.jpg");

        const overlay = document.querySelector("#custom_modal_overlay");
        const modal = document.querySelector("#custom_modal");
        const image = modal.querySelector("img");
        const closeButton = modal.querySelector(".modal_close_button");
        const topControls = modal.querySelector(".image_modal_top_controls");

        expect(modal.classList.contains("image_modal")).toBe(true);
        expect(overlay.classList.contains("modal_overlay_blur")).toBe(true);
        expect(overlay.classList.contains("image-modal-controls-active")).toBe(true);
        expect(image.getAttribute("src")).toBe("/storage/104/example.jpg");
        expect(closeButton).not.toBeNull();
        expect(topControls?.lastElementChild).toBe(closeButton);
        expect(modalResult.close).toEqual(expect.any(Function));

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

        closeButton.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
        vi.advanceTimersByTime(2400);
        expect(overlay.classList.contains("image-modal-controls-active")).toBe(true);

        closeButton.dispatchEvent(new PointerEvent("pointerout", {
            bubbles: true,
            relatedTarget: overlay,
        }));
        vi.advanceTimersByTime(1200);
        expect(overlay.classList.contains("image-modal-controls-active")).toBe(false);

        closeButton.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        expect(overlay.classList.contains("image-modal-controls-active")).toBe(true);

        modalResult.close();
        expect(overlay.style.display).toBe("none");
    });

    test("fades the article cue with the controls and hides it after scrolling", async () => {
        const { openImageModalContent } = await import("./card_image_modal.js");
        const content = document.createElement("div");
        content.className = "image_first_view";
        const hint = document.createElement("button");
        hint.className = "row_article_image_first_scroll_hint";
        content.appendChild(hint);

        openImageModalContent({
            contentElement: content,
            classNames: ["image_first_view_modal"],
        });

        const overlay = document.querySelector("#custom_modal_overlay");
        const scrollContainer = document.querySelector(
            ".image_modal.image_first_view_modal .modal_body",
        );
        vi.advanceTimersByTime(1200);
        expect(overlay.classList.contains("image-modal-controls-active")).toBe(false);

        hint.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
        vi.advanceTimersByTime(2400);
        expect(overlay.classList.contains("image-modal-controls-active")).toBe(true);

        scrollContainer.scrollTop = 71;
        scrollContainer.dispatchEvent(new Event("scroll"));
        expect(overlay.classList.contains("image-modal-content-scrolled")).toBe(true);

        scrollContainer.scrollTop = 70;
        scrollContainer.dispatchEvent(new Event("scroll"));
        expect(overlay.classList.contains("image-modal-content-scrolled")).toBe(false);
    });

    test("places record navigation beside Close outside the scrolling image content", async () => {
        const { openImageModalContent } = await import("./card_image_modal.js");
        const content = document.createElement("div");
        content.className = "image_first_view";
        const stage = document.createElement("div");
        stage.className = "row_article_image_first_stage";
        content.appendChild(stage);

        const navigation = document.createElement("nav");
        navigation.className = "row_article_row_navigation";
        openImageModalContent({
            contentElement: content,
            classNames: ["image_first_view_modal"],
            topControlElements: [navigation],
        });

        const modal = document.querySelector("#custom_modal");
        const topControls = modal.querySelector(
            ":scope > .modal_header > .image_modal_top_controls",
        );
        const closeButton = modal.querySelector(".modal_close_button");

        expect(Array.from(topControls.children)).toEqual([navigation, closeButton]);
        expect(navigation.nextElementSibling).toBe(closeButton);
        expect(navigation.closest(".modal_body")).toBeNull();
        expect(navigation.closest(".image_first_view")).toBeNull();
        expect(stage.querySelector(".row_article_row_navigation")).toBeNull();
    });
});
