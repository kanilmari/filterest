// confirm_modal_builder.test.js
// Verifies shared confirm/input modal resolve behavior under jsdom.
// Bridges modal_builder chrome with higher-level confirm and text-entry flows.
// Exists so prompt-to-modal migrations keep keyboard and cancel behavior stable.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../icons/icon_loader.js", () => ({
    setElementSvgContent: vi.fn(async (element) => {
        element.innerHTML = "<svg aria-hidden='true'></svg>";
    }),
}));

import { showInputModal } from "./confirm_modal_builder.js";

describe("confirm_modal_builder input modal", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        vi.useFakeTimers();
    });

    test("resolves typed input when Enter is pressed", async () => {
        const resultPromise = showInputModal({
            titlePlainText: "Name field set",
            labelPlainText: "Name",
        });
        vi.runAllTimers();

        const input = document.querySelector('[data-testid="input-modal-input"]');
        expect(input).not.toBeNull();
        input.value = "Compact";
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

        await expect(resultPromise).resolves.toBe("Compact");
    });

    test("resolves null when canceled", async () => {
        const resultPromise = showInputModal({
            titlePlainText: "Name folder",
            labelPlainText: "Folder",
        });
        vi.runAllTimers();

        document.querySelector('[data-testid="input-modal-cancel-button"]').click();

        await expect(resultPromise).resolves.toBeNull();
    });
});
