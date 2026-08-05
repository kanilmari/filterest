// login_shell_entry.test.js
// Verifies the guest-shell login entry helper opens only explicit login-entry URLs.
// Bridges backend /login redirects and the in-shell login modal policy.
// Exists to keep direct login routes usable without reviving automatic auth-failure modals.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

const showLoginModalMock = vi.fn().mockResolvedValue(undefined);

async function loadModule() {
    vi.resetModules();
    vi.doMock("./login_modal_printer.js", () => ({
        showLoginModal: showLoginModalMock,
    }));
    return import("./login_shell_entry.js");
}

describe("login_shell_entry", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        history.replaceState({}, "", "/");
        localStorage.clear();
    });

    test("buildLoginEntryPath encodes redirect targets safely", async () => {
        const mod = await loadModule();

        expect(mod.buildLoginEntryPath()).toBe("/?login-entry=1");
        expect(mod.buildLoginEntryPath("/app_service_catalog?foo=1&bar=2"))
            .toBe("/?login-entry=1&redirect=%2Fapp_service_catalog%3Ffoo%3D1%26bar%3D2");
    });

    test("handleLoginShellEntry opens the login modal for an explicit login-entry URL", async () => {
        history.replaceState({}, "", "/?login-entry=1&redirect=%2Fapp_service_catalog%3Ffoo%3D1#section");
        const mod = await loadModule();

        const handled = await mod.handleLoginShellEntry();

        expect(handled).toBe(true);
        expect(showLoginModalMock).toHaveBeenCalledWith("/app_service_catalog?foo=1");
        expect(window.location.pathname).toBe("/");
        expect(window.location.search).toBe("?login-entry=1&redirect=%2Fapp_service_catalog%3Ffoo%3D1");
        expect(window.location.hash).toBe("#section");
    });

    test("shouldAutoOpenForcedLoginModal is true only for the explicit query marker", async () => {
        const mod = await loadModule();

        expect(mod.shouldAutoOpenForcedLoginModal()).toBe(false);
        history.replaceState({}, "", "/?login-entry=1");
        expect(mod.shouldAutoOpenForcedLoginModal()).toBe(true);
    });

    test("clearLoginEntryQueryFromUrl removes login-entry once auth succeeds", async () => {
        history.replaceState({}, "", "/?login-entry=1&redirect=%2Freports#section");
        const mod = await loadModule();

        const changed = mod.clearLoginEntryQueryFromUrl();

        expect(changed).toBe(true);
        expect(window.location.pathname).toBe("/");
        expect(window.location.search).toBe("");
        expect(window.location.hash).toBe("#section");
    });

    test("does not open the login modal for forced-login guest shells without a login-entry query", async () => {
        localStorage.setItem("login_required_for_browse", "true");
        localStorage.setItem("button_state", "login");
        history.replaceState({}, "", "/");
        const mod = await loadModule();

        const handled = await mod.handleLoginShellEntry();

        expect(handled).toBe(false);
        expect(showLoginModalMock).not.toHaveBeenCalled();
        expect(window.location.pathname).toBe("/");
        expect(window.location.search).toBe("");
    });

    test("does not open the modal on dataset paths in forced-login guest shells", async () => {
        localStorage.setItem("login_required_for_browse", "true");
        localStorage.setItem("button_state", "login");
        history.replaceState({}, "", "/service_catalog?search=matrix#card");
        const mod = await loadModule();

        const handled = await mod.handleLoginShellEntry();

        expect(handled).toBe(false);
        expect(showLoginModalMock).not.toHaveBeenCalled();
    });

    test("does not open the modal on the standalone /login route without the query marker", async () => {
        localStorage.setItem("login_required_for_browse", "true");
        localStorage.setItem("button_state", "login");
        history.replaceState({}, "", "/login");
        const mod = await loadModule();

        const handled = await mod.handleLoginShellEntry();

        expect(handled).toBe(false);
        expect(showLoginModalMock).not.toHaveBeenCalled();
    });

    test("navigateToLoginEntry rewrites history without forcing a hard navigation", async () => {
        const mod = await loadModule();

        mod.navigateToLoginEntry("/reports?view=compact");

        expect(window.location.pathname).toBe("/");
        expect(window.location.search).toBe("?login-entry=1&redirect=%2Freports%3Fview%3Dcompact");
    });
});
