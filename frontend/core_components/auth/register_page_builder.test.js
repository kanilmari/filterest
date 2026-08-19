// register_page_builder.test.js
// Verifies registration factor inputs follow the explicit sign-in verification choice.
// Bridges the server-rendered registration form with the shared direct/SPA initializer.
// Exists to prevent hidden PIN fields from becoming required or duplicate listeners from accumulating.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

const translatePageMock = vi.fn().mockResolvedValue(undefined);
const preferredLanguageMock = vi.fn(() => "fi");

function renderRegistrationForm() {
    document.body.innerHTML = `
        <form data-testid="register-form">
            <label><input type="radio" name="verification_method" value="none">None</label>
            <label><input type="radio" name="verification_method" value="fixed_pin" checked>PIN</label>
            <label><input type="radio" name="verification_method" value="email">Email</label>
            <div data-register-verification-fields="fixed_pin" hidden>
                <input id="fixed-pin">
                <input id="fixed-pin-confirmation">
            </div>
        </form>`;
}

async function loadModule() {
    vi.resetModules();
    vi.doMock("../lang/translation_handler.js", () => ({
        translatePage: translatePageMock,
    }));
    vi.doMock("../state_stores/lang_preference_reader.js", () => ({
        getPreferredAvailableLanguage: preferredLanguageMock,
    }));
    return import("./register_page_builder.js");
}

describe("initializeRegistrationVerificationFields", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        renderRegistrationForm();
    });

    test("starts with fixed PIN visible and required", async () => {
        await loadModule();

        const fields = document.querySelector('[data-register-verification-fields="fixed_pin"]');
        expect(fields.hidden).toBe(false);
        expect(document.getElementById("fixed-pin").required).toBe(true);
        expect(document.getElementById("fixed-pin-confirmation").disabled).toBe(false);
        expect(preferredLanguageMock).toHaveBeenCalledWith(["en", "fi"]);
        expect(translatePageMock).toHaveBeenCalledWith("fi");
    });

    test("password-only selection disables and hides PIN inputs", async () => {
        await loadModule();
        const noneRadio = document.querySelector('input[value="none"]');
        noneRadio.checked = true;
        noneRadio.dispatchEvent(new Event("change", { bubbles: true }));

        const fields = document.querySelector('[data-register-verification-fields="fixed_pin"]');
        expect(fields.hidden).toBe(true);
        expect(fields.hasAttribute("inert")).toBe(true);
        expect(document.getElementById("fixed-pin").required).toBe(false);
        expect(document.getElementById("fixed-pin").disabled).toBe(true);
    });

    test("initializer is idempotent for an already mounted form", async () => {
        const fixedRadio = document.querySelector('input[value="fixed_pin"]');
        const listenerSpy = vi.spyOn(fixedRadio, "addEventListener");
        const mod = await loadModule();

        mod.initializeRegistrationVerificationFields(document);
        mod.initializeRegistrationVerificationFields(document.querySelector("form"));

        expect(listenerSpy).toHaveBeenCalledTimes(1);
    });
});
