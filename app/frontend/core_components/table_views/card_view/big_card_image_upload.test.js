/* @vitest-environment jsdom */
// big_card_image_upload.test.js
// Verifies click and drag-and-drop activation for the article image upload surface.
// Bridges browser input events with the shared upload callback so media files do not navigate away.
// Exists to keep Easelect and generated Filterest article uploads on one regression-tested path.

import { beforeEach, describe, expect, test, vi } from "vitest";

import { createImageUploadPlaceholder } from "./big_card_image_upload.js";

beforeEach(() => {
    document.body.replaceChildren();
});

describe("createImageUploadPlaceholder", () => {
    test("activates the native file input exactly once when the upload surface is clicked", () => {
        const placeholder = createImageUploadPlaceholder({
            size: "small",
            onFileSelected: vi.fn(),
        });
        const input = placeholder.querySelector('input[type="file"]');
        const inputClickSpy = vi.spyOn(input, "click");
        document.body.appendChild(placeholder);

        placeholder.click();

        expect(inputClickSpy).toHaveBeenCalledTimes(1);
    });

    test("accepts dropped images without letting the drop navigate the page", () => {
        const onFilesSelected = vi.fn();
        const documentDropListener = vi.fn();
        const placeholder = createImageUploadPlaceholder({
            size: "small",
            multiple: true,
            onFilesSelected,
        });
        const imageFile = new File(["image"], "diagram.png", { type: "image/png" });
        const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
        Object.defineProperty(dropEvent, "dataTransfer", {
            configurable: true,
            value: { files: [imageFile], dropEffect: "none" },
        });
        document.addEventListener("drop", documentDropListener);
        document.body.appendChild(placeholder);

        const dispatchResult = placeholder.dispatchEvent(dropEvent);

        expect(dispatchResult).toBe(false);
        expect(dropEvent.defaultPrevented).toBe(true);
        expect(documentDropListener).not.toHaveBeenCalled();
        expect(onFilesSelected).toHaveBeenCalledOnce();
        expect(onFilesSelected).toHaveBeenCalledWith([imageFile]);
    });

    test("marks drag-over as a copy upload and contains the browser event", () => {
        const documentDragoverListener = vi.fn();
        const placeholder = createImageUploadPlaceholder({
            size: "small",
            onFileSelected: vi.fn(),
        });
        const dragoverEvent = new Event("dragover", { bubbles: true, cancelable: true });
        const dataTransfer = { files: [], dropEffect: "none" };
        Object.defineProperty(dragoverEvent, "dataTransfer", {
            configurable: true,
            value: dataTransfer,
        });
        document.addEventListener("dragover", documentDragoverListener);
        document.body.appendChild(placeholder);

        const dispatchResult = placeholder.dispatchEvent(dragoverEvent);

        expect(dispatchResult).toBe(false);
        expect(dragoverEvent.defaultPrevented).toBe(true);
        expect(documentDragoverListener).not.toHaveBeenCalled();
        expect(dataTransfer.dropEffect).toBe("copy");
        expect(placeholder.classList.contains("drag_over")).toBe(true);
    });
});
