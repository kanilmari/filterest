// login_page_shell_builder.test.js
// Verifies the standalone login shell tab behavior without booting the full auth flow.
// Bridges the standalone Login/Tour chrome and the DOM panels it controls in jsdom.
// Exists to keep forced-login page switching stable while the modal login path
// continues to use the shared login template fragment.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test } from "vitest";
import { initializeStandaloneLoginShell, resolveStandaloneAuthTab } from "./login_page_shell_builder.js";

function renderStandaloneShell() {
    document.body.dataset.loginPageMode = "standalone";
    document.body.innerHTML = `
        <div class="auth-page-tablist">
            <button
                type="button"
                class="auth-page-tab"
                id="auth-tab-login"
                aria-selected="false"
                data-auth-tab-target="login">Login</button>
            <button
                type="button"
                class="auth-page-tab"
                id="auth-tab-tour"
                aria-selected="false"
                data-auth-tab-target="tour">Tour</button>
        </div>
        <section data-auth-tab-panel="login">Login panel</section>
        <section data-auth-tab-panel="tour">Tour panel</section>
    `;
}

describe("login_page_shell_builder", () => {
    beforeEach(() => {
        history.replaceState({}, "", "/login");
        document.body.innerHTML = "";
        delete document.body.dataset.loginPageMode;
    });

    test("defaults to the login panel when no tour hash is present", () => {
        renderStandaloneShell();

        initializeStandaloneLoginShell();

        expect(document.querySelector("#auth-tab-login")?.getAttribute("aria-selected")).toBe("true");
        expect(document.querySelector("#auth-tab-tour")?.getAttribute("aria-selected")).toBe("false");
        expect(document.querySelector('[data-auth-tab-panel="login"]')?.hidden).toBe(false);
        expect(document.querySelector('[data-auth-tab-panel="tour"]')?.hidden).toBe(true);
    });

    test("honors the tour hash on initial load", () => {
        renderStandaloneShell();
        history.replaceState({}, "", "/login#tour");

        initializeStandaloneLoginShell();

        expect(document.querySelector("#auth-tab-login")?.getAttribute("aria-selected")).toBe("false");
        expect(document.querySelector("#auth-tab-tour")?.getAttribute("aria-selected")).toBe("true");
        expect(document.querySelector('[data-auth-tab-panel="login"]')?.hidden).toBe(true);
        expect(document.querySelector('[data-auth-tab-panel="tour"]')?.hidden).toBe(false);
    });

    test("updates the visible panel and hash when switching tabs", () => {
        renderStandaloneShell();
        initializeStandaloneLoginShell();

        document.querySelector("#auth-tab-tour")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(window.location.hash).toBe("#tour");
        expect(document.querySelector("#auth-tab-login")?.getAttribute("aria-selected")).toBe("false");
        expect(document.querySelector("#auth-tab-tour")?.getAttribute("aria-selected")).toBe("true");
        expect(document.querySelector('[data-auth-tab-panel="login"]')?.hidden).toBe(true);
        expect(document.querySelector('[data-auth-tab-panel="tour"]')?.hidden).toBe(false);
    });

    test("normalizes unknown hashes back to the login tab", () => {
        expect(resolveStandaloneAuthTab("#unknown")).toBe("login");
    });
});
