// register_shell_entry.test.js
// Verifies the guest-shell register entry helper rewrites URL state and opens the register view inside the SPA.
// Bridges register-entry query handling, history cleanup, and tab navigation with lightweight mocks.
// Exists to keep the new `/register` shell handoff stable without broad auth E2E dependence.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

const openNavTabMock = vi.fn().mockResolvedValue(undefined);

async function loadModule() {
    vi.resetModules();
    vi.doMock("../navigation/main_tabs/main_tab_printer.js", () => ({
        openNavTab: openNavTabMock,
    }));
    return import("./register_shell_entry.js");
}

describe("register_shell_entry", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        history.replaceState({}, "", "/");
    });

    test("buildRegisterEntryPath creates the SPA guest-shell path", async () => {
        const mod = await loadModule();

        expect(mod.buildRegisterEntryPath()).toBe("/?register-entry=1");
    });

    test("handleRegisterShellEntry cleans the URL and opens the register tab", async () => {
        history.replaceState({}, "", "/?register-entry=1#join");
        const mod = await loadModule();

        const handled = await mod.handleRegisterShellEntry();

        expect(handled).toBe(true);
        expect(openNavTabMock).toHaveBeenCalledWith("register");
        expect(window.location.pathname).toBe("/");
        expect(window.location.search).toBe("");
        expect(window.location.hash).toBe("#join");
    });

    test("navigateToRegisterEntry rewrites history without forcing a hard navigation", async () => {
        const mod = await loadModule();

        mod.navigateToRegisterEntry();

        expect(window.location.pathname).toBe("/");
        expect(window.location.search).toBe("?register-entry=1");
    });
});
