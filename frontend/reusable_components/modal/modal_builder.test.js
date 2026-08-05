// modal_builder.test.js
// Verifies shared modal accessibility semantics and focus lifecycle behavior.
// Bridges modal creation/show/hide calls with jsdom assertions for dialog roles and focus restore.
// Exists to keep cross-app modal accessibility fixes from regressing in login and admin flows.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../icons/icon_loader.js", () => ({
    setElementSvgContent: vi.fn(async (element) => {
        element.innerHTML = "<svg aria-hidden='true'></svg>";
    }),
}));

import { createModal, showModal, hideModal } from "./modal_builder.js";

describe("modal_builder accessibility", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        vi.useFakeTimers();
    });

    test("creates an accessible dialog and restores focus to the opener", () => {
        const triggerButton = document.createElement("button");
        triggerButton.textContent = "Open";
        document.body.appendChild(triggerButton);
        triggerButton.focus();

        const nameInput = document.createElement("input");
        nameInput.type = "text";

        const { modal, modal_overlay } = createModal({
            titlePlainText: "Edit row",
            contentElements: [nameInput],
        });

        showModal();
        vi.runAllTimers();

        expect(modal.getAttribute("role")).toBe("dialog");
        expect(modal.getAttribute("aria-modal")).toBe("true");
        expect(modal.getAttribute("aria-labelledby")).toBe("custom_modal_title");
        expect(modal.getAttribute("aria-describedby")).toBe("custom_modal_body");
        expect(modal_overlay.getAttribute("aria-hidden")).toBe("false");
        expect(document.activeElement).toBe(nameInput);

        hideModal();
        vi.runAllTimers();

        expect(modal_overlay.getAttribute("aria-hidden")).toBe("true");
        expect(document.activeElement).toBe(triggerButton);
    });

    test("uses the first nested heading as the dialog label when the header title is skipped", () => {
        const form = document.createElement("form");
        const nestedHeading = document.createElement("h2");
        nestedHeading.textContent = "Login";
        form.appendChild(nestedHeading);

        const { modal } = createModal({
            titleDataLangKey: "login",
            skipModalTitle: true,
            contentElements: [form],
        });

        const closeButton = modal.querySelector(".modal_close_button");

        expect(nestedHeading.id).toBe("custom_modal_title");
        expect(modal.getAttribute("aria-labelledby")).toBe("custom_modal_title");
        expect(closeButton.textContent).toContain("Close");
    });

    test("adds hover expansion class to modal action buttons", () => {
        const footerActions = document.createElement("div");
        footerActions.classList.add("form-actions");

        const cancelButton = document.createElement("button");
        cancelButton.classList.add("cancel-button");
        const submitButton = document.createElement("button");
        submitButton.classList.add("submit-button");
        const dangerButton = document.createElement("button");
        dangerButton.classList.add("danger-button");
        footerActions.append(cancelButton, submitButton, dangerButton);

        const bodyButton = document.createElement("button");
        bodyButton.classList.add("modal-button", "primary");

        createModal({
            titlePlainText: "Confirm action",
            contentElements: [bodyButton],
            footerElements: [footerActions],
        });

        expect(cancelButton.classList.contains("saturate_on_hover")).toBe(true);
        expect(submitButton.classList.contains("saturate_on_hover")).toBe(true);
        expect(dangerButton.classList.contains("saturate_on_hover")).toBe(true);
        expect(bodyButton.classList.contains("saturate_on_hover")).toBe(true);
    });

    test("cycles Tab and Shift+Tab inside the open modal", () => {
        const firstButton = document.createElement("button");
        firstButton.type = "button";
        firstButton.textContent = "First";

        const lastButton = document.createElement("button");
        lastButton.type = "button";
        lastButton.textContent = "Last";

        createModal({
            titlePlainText: "Confirm action",
            contentElements: [firstButton, lastButton],
        });
        const closeButton = document.querySelector(".modal_close_button");

        showModal();
        vi.runAllTimers();

        lastButton.focus();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
        expect(document.activeElement).toBe(closeButton);

        closeButton.focus();
        document.dispatchEvent(new KeyboardEvent("keydown", {
            key: "Tab",
            shiftKey: true,
            bubbles: true,
        }));
        expect(document.activeElement).toBe(lastButton);
    });

    test("skips hidden controls when choosing the initial modal focus target", () => {
        const hiddenUsernameInput = document.createElement("input");
        hiddenUsernameInput.type = "text";
        hiddenUsernameInput.style.display = "none";

        const otpInput = document.createElement("input");
        otpInput.type = "text";
        otpInput.id = "otp";

        createModal({
            titlePlainText: "Verify login",
            contentElements: [hiddenUsernameInput, otpInput],
        });

        showModal();
        vi.runAllTimers();

        expect(document.activeElement).toBe(otpInput);
    });
});
