// logout_shell_reset.test.js
// Verifies logout shell reset behavior before the browser follows the server redirect.
// Bridges mocked logout responses, storage cleanup, and DOM teardown expectations.
// Exists to keep logout cleanup stable while backend config owns the post-logout target.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

const endpointRouterMock = vi.fn();
const destroyChatMock = vi.fn();
const publishAuthLogoutMock = vi.fn();

async function loadModule() {
    vi.resetModules();
    vi.doMock("../endpoints/endpoint_router.js", () => ({
        endpoint_router: endpointRouterMock,
    }));
    vi.doMock("../ai_features/table_chat/table_chat_printer.js", () => ({
        destroy_chat: destroyChatMock,
    }));
    vi.doMock("./auth_broadcast.js", () => ({
        publishAuthLogout: publishAuthLogoutMock,
    }));
    return import("./logout_shell_reset.js");
}

describe("performSpaLogoutReset", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        sessionStorage.clear();
        document.body.innerHTML = `
            <div id="navbar">
                <section id="navbarAdminToolsSection">
                    <div id="navbarAdminToolsContent">
                        <div id="navContainer"><button>nav</button></div>
                        <div id="nav_tree"><button>tree</button></div>
                    </div>
                </section>
                <div class="navtabs_relative">
                    <div id="navmenu">
                        <button class="navtablinks active" data-id="app_service_catalog" data-testid="tab-app_service_catalog">Service catalog</button>
                        <button class="navtablinks" data-id="logout" data-testid="tab-logout">Logout</button>
                    </div>
                </div>
            </div>
            <div id="tabs_container">
                <div id="demo_container" class="content_div"></div>
            </div>
        `;
        history.replaceState({}, "", "/app_service_catalog?foo=1");
        localStorage.setItem("button_state", "logout");
        sessionStorage.setItem("selected_dataset", "app_service_catalog");
        const container = document.getElementById("demo_container");
        container.__cleanupListeners = vi.fn();
        globalThis.caches = {
            keys: vi.fn().mockResolvedValue(["a", "b"]),
            delete: vi.fn().mockResolvedValue(true),
        };
    });

    test("follows the server /login post-logout redirect when login-to-browse is enabled", async () => {
        endpointRouterMock.mockResolvedValue({
            url: `${window.location.origin}/login`,
        });
        const mod = await loadModule();

        const result = await mod.performSpaLogoutReset();

        expect(result).toEqual({ postLogoutPath: "/login" });
        expect(endpointRouterMock).toHaveBeenCalledWith("logout", {
            returnResponse: true,
            suppressAuthRedirect: true,
        });
        expect(destroyChatMock).toHaveBeenCalledWith("app_service_catalog");
        expect(document.getElementById("navContainer")).toBeNull();
        expect(document.getElementById("nav_tree")).toBeNull();
        expect(document.getElementById("navbarAdminToolsSection")).toBeNull();
        expect(document.querySelector("#tabs_container > .content_div")).toBeNull();
        expect(document.getElementById("navmenu")?.children).toHaveLength(0);
        expect(localStorage.getItem("button_state")).toBe("login");
        expect(sessionStorage.length).toBe(0);
        expect(globalThis.caches.keys).toHaveBeenCalledTimes(1);
        expect(globalThis.caches.delete).toHaveBeenCalledTimes(2);
        expect(window.location.pathname).toBe("/login");
        expect(window.location.search).toBe("");
        expect(publishAuthLogoutMock).toHaveBeenCalledWith({
            reason: "logout",
            postLogoutPath: "/login",
        });
    });

    test("follows the server root post-logout redirect when anonymous browsing is allowed", async () => {
        document.querySelector('[data-testid="tab-app_service_catalog"]')?.classList.remove("active");
        document.querySelector('[data-testid="tab-logout"]')?.classList.add("active");
        endpointRouterMock.mockResolvedValue({
            url: `${window.location.origin}/`,
        });
        const mod = await loadModule();

        const result = await mod.performSpaLogoutReset();

        expect(result).toEqual({ postLogoutPath: "/" });
        expect(localStorage.getItem("button_state")).toBe("login");
        expect(sessionStorage.getItem("selected_dataset")).toBeNull();
    });

    test("navigates to the resolved post-logout path through an injectable location object", async () => {
        const mod = await loadModule();
        const locationObject = { assign: vi.fn() };

        expect(mod.navigateToPostLogoutPath("/login", locationObject)).toBe(true);
        expect(locationObject.assign).toHaveBeenCalledWith("/login");
        expect(mod.navigateToPostLogoutPath("", locationObject)).toBe(false);
        expect(locationObject.assign).toHaveBeenCalledTimes(1);
    });
});
