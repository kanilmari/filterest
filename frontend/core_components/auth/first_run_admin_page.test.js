// @vitest-environment jsdom
// Verifies First Run method fields integrate with the reusable section navigator.

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("./auth_preference_controls.js", () => ({}));

function renderPage() {
    document.body.innerHTML = `
        <form id="first-run-admin-form" data-form-section-navigator data-initial-section="settings">
            <section data-form-section data-section-key="settings" data-section-label="Settings">
                <label><input type="radio" name="verification_method" value="none" checked>None</label>
                <label><input type="radio" name="verification_method" value="fixed_pin">PIN</label>
                <label><input type="radio" name="verification_method" value="totp">TOTP</label>
                <div data-verification-fields="fixed_pin" hidden><input id="pin"></div>
                <div data-verification-fields="totp" hidden><input id="totp"></div>
            </section>
            <section data-form-section data-section-key="credentials" data-section-label="Administrator">
                <input id="username" value="owner">
            </section>
        </form>`;
}

describe("initializeFirstRunAdminPage", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    test("starts from settings with optional factor inputs disabled", async () => {
        renderPage();
        const { initializeFirstRunAdminPage } = await import("./first_run_admin_page.js");
        initializeFirstRunAdminPage(document);

        expect(document.querySelector('[data-section-key="settings"]').hidden).toBe(false);
        expect(document.getElementById("pin").disabled).toBe(true);
        expect(document.getElementById("totp").required).toBe(false);
    });

    test("shows and requires only the selected method fields", async () => {
        renderPage();
        const { initializeFirstRunAdminPage } = await import("./first_run_admin_page.js");
        initializeFirstRunAdminPage(document);
        const pinRadio = document.querySelector('input[value="fixed_pin"]');
        pinRadio.checked = true;
        pinRadio.dispatchEvent(new Event("change", { bubbles: true }));

        expect(document.querySelector('[data-verification-fields="fixed_pin"]').hidden).toBe(false);
        expect(document.getElementById("pin").required).toBe(true);
        expect(document.getElementById("totp").disabled).toBe(true);
    });
});

