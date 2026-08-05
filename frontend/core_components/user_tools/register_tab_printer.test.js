// register_tab_printer.test.js
// Verifies the SPA register tab fetches the real server-rendered form fragment and handles submit outcomes in place.
// Bridges register fragment fetches, validation rerenders, and post-success login handoff with lightweight mocks.
// Exists to keep the guest-shell register entry stable without depending only on broad end-to-end coverage.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

const translatePageMock = vi.fn().mockResolvedValue(undefined);
const handleLoginShellEntryMock = vi.fn().mockResolvedValue(true);
const navigateToLoginEntryMock = vi.fn();

const baseFormHtml = `
<!DOCTYPE html>
<html>
  <body>
    <form method="POST" action="/api/register_ndYOyXV0INOK3F?fragment=1" class="auth-form" data-testid="register-form">
      <h2 data-lang-key="register"></h2>
      <input type="text" name="username" data-testid="register-username" />
      <input type="password" name="password" data-testid="register-password" />
      <input type="email" name="email" data-testid="register-email" />
      <input type="text" name="full_name" data-testid="register-full-name" />
      <input type="hidden" name="csrf_token" value="csrf-1" />
      <input type="submit" value="Register" data-testid="register-submit" />
    </form>
  </body>
</html>`;

async function loadModule() {
    vi.resetModules();
    vi.doMock("../lang/translation_handler.js", () => ({
        translatePage: translatePageMock,
    }));
    vi.doMock("../state_stores/lang_preference_reader.js", () => ({
        getLanguageWithBrowserFallback: () => "fi",
    }));
    vi.doMock("../auth/login_shell_entry.js", () => ({
        handleLoginShellEntry: handleLoginShellEntryMock,
        navigateToLoginEntry: navigateToLoginEntryMock,
    }));
    return import("./register_tab_printer.js");
}

describe("generate_register_view", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = `<div id="container"></div>`;
        global.fetch = vi.fn();
    });

    test("renders the fetched register fragment into the SPA container", async () => {
        global.fetch.mockResolvedValueOnce({
            ok: true,
            text: vi.fn().mockResolvedValue(baseFormHtml),
        });
        const mod = await loadModule();
        const container = document.getElementById("container");

        await mod.generate_register_view(container);

        expect(global.fetch).toHaveBeenCalledWith("/register_ndYOyXV0INOK3F?fragment=1", {
            credentials: "include",
            headers: { Accept: "text/html" },
        });
        expect(container.querySelector('[data-testid="register-form"]')).not.toBeNull();
        expect(translatePageMock).toHaveBeenCalledWith("fi");
    });

    test("successful submit hands off to the SPA login entry instead of hard navigation", async () => {
        global.fetch
            .mockResolvedValueOnce({
                ok: true,
                text: vi.fn().mockResolvedValue(baseFormHtml),
            })
            .mockResolvedValueOnce({
                redirected: true,
                url: `${window.location.origin}/?login-entry=1`,
            });
        const mod = await loadModule();
        const container = document.getElementById("container");

        await mod.generate_register_view(container);
        const form = container.querySelector('[data-testid="register-form"]');
        form.querySelector('[data-testid="register-username"]').value = "demo";
        form.querySelector('[data-testid="register-password"]').value = "secret";
        form.querySelector('[data-testid="register-email"]').value = "demo@example.com";
        form.querySelector('[data-testid="register-full-name"]').value = "Demo User";

        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await Promise.resolve();
        await Promise.resolve();

        expect(navigateToLoginEntryMock).toHaveBeenCalledTimes(1);
        expect(handleLoginShellEntryMock).toHaveBeenCalledTimes(1);
    });

    test("validation rerender replaces the form in place", async () => {
        const errorHtml = baseFormHtml.replace(
            "</form>",
            '<p class="error" data-lang-key="username_exists"></p></form>'
        );
        global.fetch
            .mockResolvedValueOnce({
                ok: true,
                text: vi.fn().mockResolvedValue(baseFormHtml),
            })
            .mockResolvedValueOnce({
                redirected: false,
                url: `${window.location.origin}/api/register_ndYOyXV0INOK3F?fragment=1`,
                text: vi.fn().mockResolvedValue(errorHtml),
            });
        const mod = await loadModule();
        const container = document.getElementById("container");

        await mod.generate_register_view(container);
        const form = container.querySelector('[data-testid="register-form"]');
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await Promise.resolve();
        await Promise.resolve();

        expect(container.querySelector('.error[data-lang-key="username_exists"]')).not.toBeNull();
        expect(navigateToLoginEntryMock).not.toHaveBeenCalled();
    });
});
