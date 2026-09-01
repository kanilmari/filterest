// Verifies typed persistence, placement, emphasis, and rich-content toast options.
// Bridges the shared notification API with independent screen-position containers.
// Exists so persistent update notices do not change transient toast defaults.
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { showToast } from "./toast_notification_printer.js";

beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    vi.stubGlobal("requestAnimationFrame", (callback) => callback());
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe("showToast", () => {
    test("keeps the existing bottom-right auto-close defaults", () => {
        const toast = showToast({ message: "Saved", level: "success" });
        const container = toast.element.parentElement;

        expect(container?.id).toBe("toast-notification-container");
        expect(container?.dataset.toastPosition).toBe("bottom-right");
        expect(toast.element.dataset.toastVariant).toBe("default");
        expect(toast.element.textContent).toContain("Saved");

        vi.advanceTimersByTime(5000);
        expect(toast.element.getAttribute("aria-hidden")).toBe("true");
        vi.advanceTimersByTime(300);
        expect(document.body.contains(toast.element)).toBe(false);
    });

    test("supports a persistent emphasized top-center notice", () => {
        const toast = showToast({
            message: "Update scheduled",
            level: "warning",
            autoClose: false,
            position: "top-center",
            variant: "attention",
            dismissOnClick: false,
            dismissLabel: "Sulje",
        });

        expect(toast.element.parentElement?.dataset.toastPosition).toBe("top-center");
        expect(toast.element.dataset.toastVariant).toBe("attention");
        expect(toast.element.querySelector(".toast-notification-close")?.getAttribute("aria-label")).toBe("Sulje");
        vi.advanceTimersByTime(60000);
        expect(document.body.contains(toast.element)).toBe(true);

        toast.element.click();
        expect(document.body.contains(toast.element)).toBe(true);
        toast.element.querySelector(".toast-notification-close")?.click();
        vi.advanceTimersByTime(300);
        expect(document.body.contains(toast.element)).toBe(false);
    });

    test("keeps differently positioned notification stacks independent", () => {
        showToast({ message: "ordinary" });
        showToast({ message: "important", position: "top-center", autoClose: false });

        expect(document.querySelectorAll("[data-testid='toast-container']")).toHaveLength(2);
        expect(document.querySelectorAll("[data-toast-position='bottom-right'] [data-testid='toast']")).toHaveLength(1);
        expect(document.querySelectorAll("[data-toast-position='top-center'] [data-testid='toast']")).toHaveLength(1);
    });

    test("renders caller-owned rich content and offers immediate caller dismissal", () => {
        const content = document.createElement("section");
        content.innerHTML = "<strong>Update</strong><button type='button'>Details</button>";
        const toast = showToast({
            content,
            autoClose: false,
            dismissOnClick: false,
        });

        expect(toast.element.querySelector("section strong")?.textContent).toBe("Update");
        toast.element.querySelector("section button")?.click();
        expect(document.body.contains(toast.element)).toBe(true);

        toast.dismiss({ immediate: true });
        expect(document.body.contains(toast.element)).toBe(false);
    });

    test.each([
        [{ level: "critical" }, "level"],
        [{ position: "middle" }, "position"],
        [{ variant: "loud" }, "variant"],
        [{ duration: -1 }, "duration"],
        [{ dismissLabel: " " }, "dismiss label"],
    ])("rejects an unsupported typed option %#j", (options, expected) => {
        expect(() => showToast(options)).toThrow(expected);
    });
});
