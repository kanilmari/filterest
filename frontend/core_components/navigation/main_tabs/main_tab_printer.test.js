// main_tab_printer.test.js
// Verifies the main tab renderer creates stable inline SVG icons for nav tabs.
// Bridges fetched tab metadata with the rendered tab shell in a jsdom runtime.
// Exists to prevent regressions where nav-tab icons silently disappear after rerenders.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";
import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { getButtonState, setAuthModes } from "../../admin_tools/auth_mode_handler.js";
import { handleLoginShellEntry } from "../../auth/login_shell_entry.js";
import { requestLoginRedirect } from "../../auth/login_redirect_handler.js";
import {
    navigateToPostLogoutPath,
    performSpaLogoutReset,
} from "../../auth/logout_shell_reset.js";
import { handle_all_navigation } from "../nav_engine/navigation_handler.js";
import {
    hasDatasetPermission,
    primeMultipleDatasetPermissions,
} from "../../route_permission_checker.js";
import { getSelectedDataset } from "../../state_stores/dataset_selection_saver.js";

vi.mock("../nav_engine/navigation_handler.js", () => ({
    handle_all_navigation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../admin_and_user_tools/custom_view_reader.js", () => ({
    custom_views: {},
}));

vi.mock("../../dev_tools/function_counter.js", () => ({
    count_this_function: vi.fn(),
}));

vi.mock("../../../ui_config.js", () => ({
    NAVBAR_WIDTH_THRESHOLD: 1850,
    NAVTAB_BUTTON_BREAKPOINT_PX: 768,
}));

vi.mock("../../auth/login_shell_entry.js", () => ({
    handleLoginShellEntry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../auth/login_redirect_handler.js", () => ({
    requestLoginRedirect: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../auth/logout_shell_reset.js", () => ({
    navigateToPostLogoutPath: vi.fn(() => false),
    performSpaLogoutReset: vi.fn().mockResolvedValue({ postLogoutPath: "/" }),
}));

vi.mock("../../admin_tools/auth_mode_handler.js", () => ({
    getButtonState: vi.fn(() => "logout"),
    setAuthModes: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../route_permission_checker.js", () => ({
    applyPermission: vi.fn(),
    hasDatasetPermission: vi.fn().mockResolvedValue(true),
    primeMultipleDatasetPermissions: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("../../state_stores/dataset_selection_saver.js", () => ({
    getSelectedDataset: vi.fn(() => null),
    clearSelectedDataset: vi.fn(),
}));

vi.mock("../../endpoints/endpoint_router.js", () => ({
    endpoint_router: vi.fn(async (routeName) => {
        if (routeName === "fetchContentTables") {
            return {
                datasets: [
                    {
                        dataset_name: "app_service_catalog",
                        is_in_current_project: true,
                        is_top_level_in_current_project: true,
                        icon_key: "shopping_cart",
                    },
                    {
                        dataset_name: "app_service_catalog_helpers",
                        is_in_current_project: true,
                        is_top_level_in_current_project: false,
                        icon_key: "build",
                    },
                    {
                        dataset_name: "dev_agent_tasks",
                        is_in_current_project: false,
                        is_top_level_in_current_project: false,
                        icon_key: "shopping_cart",
                    },
                    {
                        dataset_name: "system_about",
                        is_in_current_project: false,
                        is_top_level_in_current_project: false,
                        is_about_table: true,
                        icon_key: "help",
                    },
                ],
                tab_order: null,
            };
        }

        if (routeName === "fetchUserProfile") {
            return { username: "alice" };
        }

        return {};
    }),
}));

vi.mock("../nav_engine/query_params.js", () => ({
    useStorageParams: vi.fn(),
    useUrlParams: vi.fn(),
}));

vi.mock("../../filterbar/filterbar_engine/filterbar_visibility_handler.js", () => ({
    resolveFilterBarElement: vi.fn(() => null),
}));

describe("initTabs", () => {
    beforeEach(() => {
        Object.defineProperty(window, "innerWidth", {
            configurable: true,
            value: 1024,
        });
        localStorage.clear();
        document.body.innerHTML = `
            <div id="navbarAuthActions" class="navbar-auth-actions"></div>
            <div id="navbar" style="--navtab-presentation-transition-duration: 0ms;"></div>
            <div id="tabs_container"></div>
            <div id="navmenu" class="navtabs"></div>
        `;
        vi.mocked(getButtonState).mockReturnValue("logout");
        vi.mocked(endpoint_router).mockClear();
        vi.mocked(requestLoginRedirect).mockClear();
        vi.mocked(navigateToPostLogoutPath).mockReset().mockReturnValue(false);
        vi.mocked(performSpaLogoutReset).mockReset().mockResolvedValue({ postLogoutPath: "/" });
        vi.mocked(setAuthModes).mockClear();
        vi.mocked(handleLoginShellEntry).mockClear();
        vi.mocked(handle_all_navigation).mockClear();
        vi.mocked(hasDatasetPermission).mockClear();
        vi.mocked(primeMultipleDatasetPermissions).mockClear();
        vi.mocked(getSelectedDataset).mockReturnValue(null);
    });

    test("renders nav tab icons as inline svg elements", async () => {
        const { initTabs } = await import("./main_tab_printer.js");

        await initTabs();

        const datasetIcon = document.querySelector(
            '.navtablinks[data-id="app_service_catalog"] .navtab_icon'
        );
        const accountIcon = document.querySelector(
            '.navbar-auth-action[data-id="user"] .navbar-auth-action-icon'
        );

        expect(datasetIcon).not.toBeNull();
        expect(datasetIcon.tagName.toLowerCase()).toBe("svg");
        expect(datasetIcon.querySelector("path")).not.toBeNull();
        expect(accountIcon).not.toBeNull();
        expect(accountIcon.tagName.toLowerCase()).toBe("svg");
        expect(accountIcon.querySelector("path")).not.toBeNull();
        expect(document.querySelector('.navtablinks[data-id="user"]')).toBeNull();
        expect(document.querySelector('.navtablinks[data-id="logout"]')).toBeNull();
        expect(
            document.querySelector('.navtablinks[data-id="app_service_catalog_helpers"]')
        ).toBeNull();
        expect(hasDatasetPermission).not.toHaveBeenCalled();
        expect(primeMultipleDatasetPermissions).not.toHaveBeenCalled();
    });

    test("does not force development task tabs into the current project tabs", async () => {
        const { initTabs } = await import("./main_tab_printer.js");

        await initTabs();

        expect(document.querySelector('.navtablinks[data-id="dev_agent_tasks"]')).toBeNull();
    });

    test("uses the filled users icon for the system users tab fallback", async () => {
        const { getTabIconPath } = await import("./tab_icon_library.js");
        const { initTabs } = await import("./main_tab_printer.js");
        const preloadedContentTablesResponse = {
            datasets: [
                {
                    dataset_name: "system_users",
                    is_in_current_project: true,
                    is_top_level_in_current_project: true,
                },
            ],
            tab_order: null,
        };

        await initTabs({ preloadedContentTablesResponse });

        const usersIconPath = document.querySelector(
            '.navtablinks[data-id="system_users"] .navtab_icon path'
        );
        expect(usersIconPath?.getAttribute("d")).toBe(getTabIconPath("group_filled"));
    });

    test("does not fetch user profile while guest tabs are rendering", async () => {
        vi.mocked(getButtonState).mockReturnValue("login");

        const { initTabs } = await import("./main_tab_printer.js");
        await initTabs();

        expect(endpoint_router).not.toHaveBeenCalledWith("fetchUserProfile");
        expect(document.querySelector('.navtablinks[data-id="login"]')).toBeNull();
        expect(document.querySelector('.navbar-auth-action[data-id="login"]')).not.toBeNull();
        expect(
            document.getElementById("navbarAuthActions")?.classList.contains(
                "navbar-auth-actions--solo"
            )
        ).toBe(true);
        expect(document.querySelector('.navtablinks[data-id="system_about"]')).toBeNull();
    });

    test("preserves explicit login-entry URL instead of auto-opening a public content tab", async () => {
        vi.mocked(getButtonState).mockReturnValue("login");
        history.replaceState({}, "", "/?login-entry=1");

        const { initTabs } = await import("./main_tab_printer.js");
        await initTabs();

        expect(handle_all_navigation).not.toHaveBeenCalled();
        expect(window.location.search).toBe("?login-entry=1");
        expect(document.querySelector('.navtablinks[data-id="system_about"]')).toBeNull();
    });

    test("routes login tab through centralized auth redirect handling", async () => {
        const { openNavTab } = await import("./main_tab_printer.js");

        await openNavTab("login");

        expect(requestLoginRedirect).toHaveBeenCalledWith({ userInitiated: true });
    });

    test("routes logout through the server-selected post-logout path", async () => {
        vi.mocked(performSpaLogoutReset).mockResolvedValue({ postLogoutPath: "/login" });
        vi.mocked(navigateToPostLogoutPath).mockReturnValue(true);
        const { openNavTab } = await import("./main_tab_printer.js");

        await openNavTab("logout");

        expect(performSpaLogoutReset).toHaveBeenCalledTimes(1);
        expect(navigateToPostLogoutPath).toHaveBeenCalledWith("/login");
        expect(setAuthModes).not.toHaveBeenCalled();
        expect(handleLoginShellEntry).not.toHaveBeenCalled();
    });

    test("forwards forceReload to the navigation handler for authenticated rerenders", async () => {
        const { openNavTab } = await import("./main_tab_printer.js");

        await openNavTab("app_service_catalog", { forceReload: true });

        expect(handle_all_navigation).toHaveBeenCalledWith(
            "app_service_catalog",
            expect.anything(),
            { skipUrlUpdate: false, forceReload: true }
        );
    });

    test("opens content tabs on mouse down and suppresses the following click", async () => {
        const { initTabs } = await import("./main_tab_printer.js");

        await initTabs();
        vi.mocked(handle_all_navigation).mockClear();

        const tabButton = document.querySelector('.navtablinks[data-id="app_service_catalog"]');
        expect(tabButton).not.toBeNull();

        tabButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
        expect(handle_all_navigation).toHaveBeenCalledTimes(1);
        expect(handle_all_navigation).toHaveBeenLastCalledWith(
            "app_service_catalog",
            expect.anything(),
            { skipUrlUpdate: false, forceReload: false }
        );

        tabButton.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
        expect(handle_all_navigation).toHaveBeenCalledTimes(1);

        tabButton.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
        expect(handle_all_navigation).toHaveBeenCalledTimes(2);
    });

    test("uses button tabs on wide grid-like views even with physical navbar space", async () => {
        Object.defineProperty(window, "innerWidth", {
            configurable: true,
            value: 1920,
        });
        localStorage.setItem("app_service_catalog_view", "table");
        const { initTabs, openNavTab } = await import("./main_tab_printer.js");

        await initTabs();
        await openNavTab("app_service_catalog");

        const container = document.querySelector(".navtabs");
        const activeTab = document.querySelector(
            '.navtablinks[data-id="app_service_catalog"]'
        );
        const outlinePath = activeTab?.querySelector(".svg-container .navtab-stroke-path");

        expect(container?.style.right).toBe("0px");
        expect(activeTab?.dataset.tabPresentation).toBe("button-active");
        expect(outlinePath?.getAttribute("d")).toContain("A 0 0");
        expect(outlinePath?.getAttribute("fill")).toBe("none");
        expect(outlinePath?.getAttribute("stroke-width")).toBe("2");
        expect(outlinePath?.getAttribute("vector-effect")).toBe("non-scaling-stroke");
        expect(outlinePath?.closest("svg")?.getAttribute("preserveAspectRatio")).toBe("none");
    });

    test("uses right-opening tabs for card view when the desktop navbar has physical space", async () => {
        Object.defineProperty(window, "innerWidth", {
            configurable: true,
            value: 1920,
        });
        localStorage.setItem("app_service_catalog_view", "card");
        const { initTabs, openNavTab } = await import("./main_tab_printer.js");

        await initTabs();
        await openNavTab("app_service_catalog");

        const container = document.querySelector(".navtabs");
        const activeTab = document.querySelector(
            '.navtablinks[data-id="app_service_catalog"]'
        );
        const outlinePath = activeTab?.querySelector(".svg-container .navtab-stroke-path");

        expect(container?.style.right).toBe("-2px");
        expect(activeTab?.dataset.tabPresentation).toBe("tab-active");
        expect(outlinePath?.getAttribute("d")?.startsWith("M 300 1")).toBe(true);
        expect(outlinePath?.getAttribute("stroke-width")).toBe("2");
    });

    test("uses button tabs for card view when the navbar is in overlay layout", async () => {
        Object.defineProperty(window, "innerWidth", {
            configurable: true,
            value: 1024,
        });
        localStorage.setItem("app_service_catalog_view", "card");
        const { initTabs, openNavTab } = await import("./main_tab_printer.js");

        await initTabs();
        await openNavTab("app_service_catalog");

        const container = document.querySelector(".navtabs");
        const activeTab = document.querySelector(
            '.navtablinks[data-id="app_service_catalog"]'
        );
        const outlinePath = activeTab?.querySelector(".svg-container .navtab-stroke-path");

        expect(container?.style.right).toBe("0px");
        expect(activeTab?.dataset.tabPresentation).toBe("button-active");
        expect(outlinePath?.getAttribute("d")).toContain("A 0 0");
        expect(outlinePath?.getAttribute("fill")).toBe("none");
        expect(outlinePath?.getAttribute("stroke-width")).toBe("2");
    });

    test("recalculates tab shape when a hidden desktop navbar becomes visible", async () => {
        Object.defineProperty(window, "innerWidth", {
            configurable: true,
            value: 1920,
        });
        document.getElementById("tabs_container")?.classList.add("navbar_hidden");
        localStorage.setItem("app_service_catalog_view", "card");
        const { initTabs, openNavTab } = await import("./main_tab_printer.js");

        await initTabs();
        await openNavTab("app_service_catalog");

        const activeTab = document.querySelector(
            '.navtablinks[data-id="app_service_catalog"]'
        );
        const outlinePath = activeTab?.querySelector(".svg-container .navtab-stroke-path");

        expect(activeTab?.dataset.tabPresentation).toBe("button-active");
        expect(outlinePath?.getAttribute("stroke-width")).toBe("2");

        vi.mocked(getSelectedDataset).mockReturnValue("app_service_catalog");
        document.getElementById("tabs_container")?.classList.remove("navbar_hidden");
        window.dispatchEvent(new Event("navbar-visibility-changed"));

        expect(activeTab?.dataset.tabPresentation).toBe("tab-active");
        expect(outlinePath?.getAttribute("d")?.startsWith("M 300 1")).toBe(true);
        expect(outlinePath?.getAttribute("stroke-width")).toBe("2");
    });

    test("uses full-width button tabs on narrow screens", async () => {
        Object.defineProperty(window, "innerWidth", {
            configurable: true,
            value: 640,
        });
        localStorage.setItem("app_service_catalog_view", "card");
        const { initTabs, openNavTab } = await import("./main_tab_printer.js");

        await initTabs();
        await openNavTab("app_service_catalog");

        const container = document.querySelector(".navtabs");
        const activeTab = document.querySelector(
            '.navtablinks[data-id="app_service_catalog"]'
        );
        const outlinePath = activeTab?.querySelector(".svg-container .navtab-stroke-path");

        expect(container?.style.right).toBe("0px");
        expect(activeTab?.dataset.tabPresentation).toBe("button-active");
        expect(outlinePath?.getAttribute("d")).toContain("A 0 0");
        expect(outlinePath?.getAttribute("fill")).toBe("none");
        expect(outlinePath?.getAttribute("stroke-width")).toBe("2");
    });

    test("reuses preloaded content-table data when initTabs gets it from bootstrap", async () => {
        const { initTabs } = await import("./main_tab_printer.js");
        const preloadedContentTablesResponse = {
            datasets: [
                {
                    dataset_name: "app_service_catalog",
                    is_in_current_project: true,
                    is_top_level_in_current_project: true,
                    icon_key: "shopping_cart",
                },
            ],
            tab_order: null,
        };

        await initTabs({ preloadedContentTablesResponse });

        expect(endpoint_router).not.toHaveBeenCalledWith("fetchContentTables", expect.anything());
        expect(document.querySelector('.navtablinks[data-id="app_service_catalog"]')).not.toBeNull();
    });
});
