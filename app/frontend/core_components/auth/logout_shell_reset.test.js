// logout_shell_reset.test.js
// Verifies logout shell reset behavior before the browser follows the server redirect.
// Bridges mocked logout responses, storage cleanup, and DOM teardown expectations.
// Exists to keep logout cleanup stable while backend config owns the post-logout target.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

const endpointRouterMock = vi.fn();
const destroyChatMock = vi.fn();
const publishAuthLogoutMock = vi.fn();
const stopAdminUpdateNoticeSubscriberMock = vi.fn();
const ensureCsrfTokenMock = vi.fn();

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
        subscribeToAuthBroadcast: vi.fn(() => () => {}),
        publishAuthInvalidation: vi.fn(),
    }));
    vi.doMock("../admin_tools/admin_update_notice_subscriber.js", () => ({
        stopAdminUpdateNoticeSubscriber: stopAdminUpdateNoticeSubscriberMock,
    }));
    vi.doMock("../pipeline/api_pipeline.js", () => ({
        ensureCsrfToken: ensureCsrfTokenMock,
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
        localStorage.setItem("theme", "dark");
        localStorage.setItem("filterest_public_presentation_v1", "public-site-only");
        localStorage.setItem("chosen_language", "fi");
        localStorage.setItem("navVisibleWide", "false");
        localStorage.setItem("navVisibleNarrow", "true");
        localStorage.setItem("app_service_catalog_hide_columns", JSON.stringify({ id: true }));
        localStorage.setItem("app_service_catalog_sorting_and_filtering_specs", JSON.stringify({
            filters: { internal_notes: "restricted search" },
        }));
        sessionStorage.setItem("selected_dataset", "app_service_catalog");
        document.cookie = "sibling_instance_cookie=preserve-me;path=/";
        const container = document.getElementById("demo_container");
        container.__cleanupListeners = vi.fn();
        globalThis.caches = {
            keys: vi.fn().mockResolvedValue(["a", "b"]),
            delete: vi.fn().mockResolvedValue(true),
        };
    });

    test('clears UID appearance before browser-storage failure and rejects the pending private response', async () => {
        const { clearClientAuthArtifacts } = await loadModule();
        const { datasetAppearanceState } = await import('../table_views/dataset_appearance_state.js');
        const { DEFAULT_DATASET_APPEARANCE } = await import('../../shared/dataset_appearance/validator.js');
        const snapshot = { dataset_uid: 77, schema_version: 1, effective: DEFAULT_DATASET_APPEARANCE,
            overrides: {}, version: '1', shared_version: 'site-1' };
        datasetAppearanceState.accept('private', snapshot);
        const surface = document.createElement('section');
        datasetAppearanceState.bind(surface, 'private');
        const pending = datasetAppearanceState.capture('private');
        const storageRead = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
        try { await expect(clearClientAuthArtifacts()).rejects.toThrow('blocked'); }
        finally { storageRead.mockRestore(); }
        expect(surface.dataset.datasetAppearanceUid).toBeUndefined();
        expect(datasetAppearanceState.accept('private', snapshot, { token: pending })).toBe(false);
    });

    test("follows the server /login post-logout redirect when login-to-browse is enabled", async () => {
        endpointRouterMock.mockResolvedValue({
            url: `${window.location.origin}/login`,
        });
        const mod = await loadModule();

        const result = await mod.performSpaLogoutReset();

        expect(result).toEqual({ postLogoutPath: "/login" });
        expect(localStorage.getItem("filterest_public_presentation_v1")).toBe("public-site-only");
        // Signing out is a POST, so another site cannot cause one by sending the
        // browser to a link. The method is pinned here because a quiet return to a
        // plain read would put that back without anything else noticing.
        expect(endpointRouterMock).toHaveBeenCalledWith("logout", {
            method: "POST",
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
        expect(localStorage.getItem("theme")).toBe("dark");
        expect(localStorage.getItem("chosen_language")).toBe("fi");
        expect(localStorage.getItem("navVisibleWide")).toBe("false");
        expect(localStorage.getItem("navVisibleNarrow")).toBe("true");
        expect(localStorage.getItem("app_service_catalog_hide_columns")).toBeNull();
        expect(localStorage.getItem("app_service_catalog_sorting_and_filtering_specs")).toBeNull();
        expect(sessionStorage.length).toBe(0);
        expect(globalThis.caches.keys).toHaveBeenCalledTimes(1);
        expect(globalThis.caches.delete).toHaveBeenCalledTimes(2);
        expect(document.cookie).toContain("sibling_instance_cookie=preserve-me");
        expect(window.location.pathname).toBe("/login");
        expect(window.location.search).toBe("");
        expect(publishAuthLogoutMock).toHaveBeenCalledWith({
            reason: "logout",
            postLogoutPath: "/login",
        });
        expect(stopAdminUpdateNoticeSubscriberMock).toHaveBeenCalledTimes(1);
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

    // (d) of the WL137 review: on a public site a sign-out in another tab resets
    // this page in place (auth_broadcast_sync.js runs applyLoggedOutShellReset).
    // The page's own copy of each dataset's address parameters, the view kept
    // only in its memory included, must not outlive that session: after an
    // in-page sign-in, the next navigation sees only the new session's values.
    test("a sign-out forgets the page's own dataset parameters, so the next navigation starts clean", async () => {
        const mod = await loadModule();
        const query = await import("../navigation/nav_engine/query_params.js");
        query.setParams("app_service_catalog", { search: "restricted search", view: "article_view" });
        expect(query.getParams("app_service_catalog")).toEqual({ search: "restricted search", view: "article_view" });

        await mod.applyLoggedOutShellReset({ postLogoutPath: "/" });

        localStorage.setItem("dataset_query_params", JSON.stringify({
            app_service_catalog: { search: "new session" },
        }));
        query.useStorageParams(); // a navigation reads the shared parameters again
        expect(query.getParams("app_service_catalog")).toEqual({ search: "new session" });
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

// The whole-page sign-out, used when the in-page one could not finish. It exists
// to actually sign the person out, so it must either do that or say it could not.
describe("navigateToSignOut", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.replaceChildren();
    });

    test("posts the sign-out with the token the server will demand", async () => {
        ensureCsrfTokenMock.mockResolvedValue("a-real-token");
        const mod = await loadModule();
        const submitted = [];
        HTMLFormElement.prototype.submit = function submitStub() {
            submitted.push(this);
        };

        expect(await mod.navigateToSignOut()).toBe(true);
        expect(submitted).toHaveLength(1);
        expect(submitted[0].method.toUpperCase()).toBe("POST");
        expect(submitted[0].getAttribute("action")).toBe("/api/logout");
        expect(submitted[0].querySelector('input[name="csrf_token"]').value).toBe("a-real-token");
    });

    test("refreshes a stale token once before giving up", async () => {
        ensureCsrfTokenMock
            .mockResolvedValueOnce("")
            .mockResolvedValueOnce("a-refreshed-token");
        const mod = await loadModule();
        const submitted = [];
        HTMLFormElement.prototype.submit = function submitStub() {
            submitted.push(this);
        };

        expect(await mod.navigateToSignOut()).toBe(true);
        expect(ensureCsrfTokenMock).toHaveBeenLastCalledWith({ forceRefresh: true });
        expect(submitted[0].querySelector('input[name="csrf_token"]').value).toBe("a-refreshed-token");
    });

    // Without a token nothing can reach the server, so nothing signs the person
    // out. It must not navigate anyway: their sign-in is intact, so the login page
    // would send them straight back to the site and they would have watched a
    // sign-out that did nothing at all.
    test("reports failure instead of pretending, when no token can be had", async () => {
        ensureCsrfTokenMock.mockResolvedValue("");
        const mod = await loadModule();
        const assign = vi.fn();
        const submitted = [];
        HTMLFormElement.prototype.submit = function submitStub() {
            submitted.push(this);
        };
        vi.spyOn(window, "location", "get").mockReturnValue({ assign, origin: window.origin });

        expect(await mod.navigateToSignOut()).toBe(false);
        expect(submitted).toHaveLength(0);
        expect(assign).not.toHaveBeenCalled();
    });
});
