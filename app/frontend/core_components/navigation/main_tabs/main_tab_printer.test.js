// main_tab_printer.test.js
// Verifies dataset metadata, auth actions, bootstrap data, and tab navigation.
// Between fetched tab metadata and the rendered tab shell in a jsdom runtime.
// Keeps independent module mocks and shared setup for each topical suite.
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
import { resetMainTabPrinterTestState } from "./main_tab_printer_test_helpers.js";

// The retitle boundary is verified in main_tab_printer_browser_tab_title.test.js.
vi.mock("../nav_engine/browser_tab_title_writer.js", () => ({ updateBrowserTabTitle: vi.fn() }));

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
    beforeEach(resetMainTabPrinterTestState);

    test("renders dataset metadata as symbol masks and auth controls as inline SVG", async () => {
        const { initTabs } = await import("./main_tab_printer.js");

        await initTabs();

        const datasetIcon = document.querySelector(
            '.navtablinks[data-id="app_service_catalog"] .navtab_icon'
        );
        const accountIcon = document.querySelector(
            '.navbar-auth-action[data-id="user"] .navbar-auth-action-icon'
        );

        expect(datasetIcon).not.toBeNull();
        expect(datasetIcon.tagName.toLowerCase()).toBe("span");
        expect(datasetIcon.dataset.symbolKey).toBe("shopping_cart");
        expect(datasetIcon.style.getPropertyValue("--metadata-symbol-url"))
            .toContain("/symbol-assets/shopping_cart.svg");
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

    test("pins system about last for authenticated users even outside the project", async () => {
        const { initTabs } = await import("./main_tab_printer.js");

        await initTabs({
            preloadedContentTablesResponse: {
                datasets: [
                    {
                        dataset_name: "system_about",
                        is_in_current_project: false,
                        is_top_level_in_current_project: false,
                        is_about_table: true,
                        icon_key: "help",
                    },
                    {
                        dataset_name: "travel_info",
                        is_top_level_in_current_project: true,
                    },
                    {
                        dataset_name: "travel_deals",
                        is_top_level_in_current_project: true,
                    },
                ],
                tab_order: [
                    { tab_id: "system_about", sort_order: 1 },
                    { tab_id: "travel_deals", sort_order: 2 },
                    { tab_id: "travel_info", sort_order: 3 },
                    { tab_id: "static:user", sort_order: 4 },
                ],
            },
        });

        const renderedIds = Array.from(document.querySelectorAll(".navtablinks"))
            .map((tab) => tab.dataset.id);
        expect(renderedIds).toEqual([
            "travel_deals",
            "travel_info",
            "system_about",
        ]);
    });

    test("uses the filled-center group icon for the system users tab fallback", async () => {
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

        const usersIcon = document.querySelector(
            '.navtablinks[data-id="system_users"] .navtab_icon'
        );
        expect(usersIcon?.dataset.symbolKey).toBe("group_center_filled");
        expect(usersIcon?.style.getPropertyValue("--metadata-symbol-url"))
            .toContain("/symbol-assets/group_center_filled.svg");
    });

    test("renders travel dataset icon metadata with exact translation keys", async () => {
        const { initTabs } = await import("./main_tab_printer.js");
        const preloadedContentTablesResponse = {
            datasets: [
                {
                    dataset_name: "travel_info",
                    is_top_level_in_current_project: true,
                    icon_key: "map",
                },
                {
                    dataset_name: "travel_deals",
                    is_top_level_in_current_project: true,
                    icon_key: "payments",
                },
            ],
            tab_order: null,
        };

        await initTabs({ preloadedContentTablesResponse });

        const infoTab = document.querySelector('.navtablinks[data-id="travel_info"]');
        const dealsTab = document.querySelector('.navtablinks[data-id="travel_deals"]');
        expect(infoTab?.dataset.langKey).toBe("travel_info");
        expect(dealsTab?.dataset.langKey).toBe("travel_deals");
        expect(infoTab?.querySelector(".navtab_icon")?.dataset.symbolKey).toBe("map");
        expect(dealsTab?.querySelector(".navtab_icon")?.dataset.symbolKey).toBe("payments");
    });

    test("gives a dataset saved without an icon the table icon instead of an empty path", async () => {
        const { initTabs } = await import("./main_tab_printer.js");
        const preloadedContentTablesResponse = {
            datasets: [
                { dataset_name: "travel_deals", is_top_level_in_current_project: true },
            ],
            tab_order: null,
        };

        await initTabs({ preloadedContentTablesResponse });

        const dealsTab = document.querySelector('.navtablinks[data-id="travel_deals"]');
        expect(dealsTab?.querySelector(".navtab_icon")?.dataset.symbolKey).toBe("table");
        expect(dealsTab?.querySelector('path[d="undefined"]')).toBeNull();
    });

    test("renders system users once when it is also marked as the main table", async () => {
        const { initTabs } = await import("./main_tab_printer.js");
        const preloadedContentTablesResponse = {
            datasets: [
                {
                    dataset_name: "system_users",
                    is_main_table: true,
                    is_in_current_project: true,
                    is_top_level_in_current_project: true,
                },
            ],
            tab_order: [
                { tab_id: "static:system_users", sort_order: 1 },
            ],
        };

        await initTabs({ preloadedContentTablesResponse });

        expect(document.querySelectorAll('.navtablinks[data-id="system_users"]')).toHaveLength(1);
    });

    test("renders a legacy-ordered dataset once when the API payload contains it twice", async () => {
        const { initTabs } = await import("./main_tab_printer.js");
        const preloadedContentTablesResponse = {
            datasets: [
                {
                    dataset_name: "system_users",
                    is_in_current_project: true,
                    is_top_level_in_current_project: true,
                },
                {
                    dataset_name: "system_users",
                    is_in_current_project: true,
                    is_top_level_in_current_project: true,
                },
            ],
            tab_order: [
                { dataset_name: "system_users", sort_order: 1 },
            ],
        };

        await initTabs({ preloadedContentTablesResponse });

        expect(document.querySelectorAll('.navtablinks[data-id="system_users"]')).toHaveLength(1);
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
        expect(document.querySelector('.navtablinks[data-id="system_about"]')).not.toBeNull();
    });

    test("preserves explicit login-entry URL instead of auto-opening a public content tab", async () => {
        vi.mocked(getButtonState).mockReturnValue("login");
        history.replaceState({}, "", "/?login-entry=1");

        const { initTabs } = await import("./main_tab_printer.js");
        await initTabs();

        expect(handle_all_navigation).not.toHaveBeenCalled();
        expect(window.location.search).toBe("?login-entry=1");
        expect(document.querySelector('.navtablinks[data-id="system_about"]')).not.toBeNull();
    });

    test.each([true, false])("renders guest About only when present in the catalogue (%s), and never Users", async (includesAbout) => {
        vi.mocked(getButtonState).mockReturnValue("login");
        const { initTabs } = await import("./main_tab_printer.js");
        await initTabs({ preloadedContentTablesResponse: {
            datasets: [
                { dataset_name: "app_service_catalog", is_top_level_in_current_project: true },
                { dataset_name: "system_users", can_read_rows: true },
                ...(includesAbout ? [{ dataset_name: "system_about", can_read_rows: true }] : []),
            ],
        } });
        expect(document.querySelectorAll('[data-testid="tab-system_about"]')).toHaveLength(includesAbout ? 1 : 0);
        expect(document.querySelector('[data-testid="tab-system_users"]')).toBeNull();
        expect(endpoint_router).not.toHaveBeenCalledWith("fetchContentTables", expect.anything());
        expect(primeMultipleDatasetPermissions).not.toHaveBeenCalled();
    });

    test.each(['light', 'dark'])("hides visitor login in %s theme while preserving content and signed-in controls", async (theme) => {
        document.documentElement.dataset.theme = theme;
        localStorage.setItem('show_login_button', 'false');
        localStorage.setItem('registration_enabled', 'false');
        vi.mocked(getButtonState).mockReturnValue('login');
        const { initTabs } = await import('./main_tab_printer.js');
        await initTabs();
        expect(document.querySelector('[data-testid="navbar-auth-login"]')).toBeNull();
        expect(document.querySelector('[data-testid="tab-register"]')).toBeNull();
        expect(document.getElementById('navbarAuthActions').hidden).toBe(true);
        expect(document.querySelector('.navtablinks[data-id="app_service_catalog"]')).not.toBeNull();
        vi.mocked(getButtonState).mockReturnValue('logout');
        await initTabs();
        expect(document.querySelector('[data-testid="navbar-auth-logout"]')).not.toBeNull();
        expect(document.querySelector('[data-testid="navbar-auth-user"]')).not.toBeNull();
        expect(document.getElementById('navbarAuthActions').hidden).toBe(false);
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

    test.each(['Home', 'dataset'])('draggable tabs preserve %s through reorder and exact restoration', async surface => {
        const { initTabs } = await import('./main_tab_printer.js');
        const { enableTabDragAndDrop } = await import('./tab_reorder_handler.js');
        await initTabs({ preloadedContentTablesResponse: {
            datasets: ['alpha', 'beta', 'gamma'].map(dataset_name => ({
                dataset_name, is_top_level_in_current_project: true,
            })), tab_order: null,
        } });
        const container = document.getElementById('navmenu');
        const originalNodes = [...container.children];
        const [source, successor, target] = originalNodes;
        const activeId = container.querySelector('.active')?.dataset.id;
        const home = document.createElement('div');
        home.className = 'front-page-top-row';
        home.innerHTML = '<button id="showMenuButton">Menu</button><nav><button>Alpha</button><button>Beta</button></nav>';
        if (surface === 'Home') document.getElementById('tabs_container').append(home);
        enableTabDragAndDrop();
        vi.mocked(handle_all_navigation).mockClear();
        vi.mocked(endpoint_router).mockClear();
        for (const button of originalNodes) {
            button.getBoundingClientRect = () => ({
                left: 0, top: [...container.children].indexOf(button) * 56,
                width: 300, height: 56,
            });
        }
        function dragBeforeOrAfter(destination, fraction) {
            // Native dragging starts with the same press as an ordinary click.
            source.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
            expect(handle_all_navigation).not.toHaveBeenCalled();
            expect(container.querySelector('.active')?.dataset.id).toBe(activeId);
            if (surface === 'Home') expect(home.querySelector('#showMenuButton').isConnected).toBe(true);
            for (const type of ['dragstart', 'dragover', 'drop', 'dragend']) {
                const event = new Event(type, { bubbles: true, cancelable: true });
                Object.defineProperty(event, 'clientY', {
                    value: destination.getBoundingClientRect().top + 56 * fraction,
                });
                source.dispatchEvent(event);
            }
        }
        dragBeforeOrAfter(target, 0.75);
        expect([...container.children]).toEqual([successor, target, source]);
        dragBeforeOrAfter(successor, 0.25);
        expect([...container.children]).toEqual(originalNodes);
        expect(endpoint_router).toHaveBeenCalledTimes(2);
        expect(endpoint_router).toHaveBeenLastCalledWith('updateTabOrder', {
            method: 'POST', body_data: { tab_order: originalNodes.map((button, index) => ({
                tab_id: button.dataset.id, sort_order: index + 1,
            })) },
        });
        expect(handle_all_navigation).not.toHaveBeenCalled();
        source.click();
        expect(handle_all_navigation).not.toHaveBeenCalled();
        await new Promise(resolve => setTimeout(resolve, 0));
        source.click();
        expect(handle_all_navigation).toHaveBeenCalledExactlyOnceWith(
            source.dataset.id, expect.anything(), { skipUrlUpdate: false, forceReload: false },
        );
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

    test("reuses preloaded content-table data for guest public browse", async () => {
        vi.mocked(getButtonState).mockReturnValue("login");
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

    test("ignores an older tab request that finishes after a newer render", async () => {
        let resolveOlderRequest;
        vi.mocked(endpoint_router).mockImplementationOnce(() => new Promise((resolve) => {
            resolveOlderRequest = resolve;
        }));
        const { initTabs } = await import("./main_tab_printer.js");

        const olderRender = initTabs();
        await Promise.resolve();
        const newerRender = initTabs({
            preloadedContentTablesResponse: {
                datasets: [
                    {
                        dataset_name: "travel_deals",
                        is_in_current_project: true,
                        is_top_level_in_current_project: true,
                    },
                    {
                        dataset_name: "system_users",
                        is_in_current_project: true,
                        is_top_level_in_current_project: true,
                    },
                ],
                tab_order: null,
            },
        });
        await newerRender;

        resolveOlderRequest({
            datasets: [
                {
                    dataset_name: "system_users",
                    is_in_current_project: true,
                    is_top_level_in_current_project: true,
                },
            ],
            tab_order: null,
        });
        await olderRender;

        expect(document.querySelectorAll('.navtablinks[data-id="travel_deals"]')).toHaveLength(1);
        expect(document.querySelectorAll('.navtablinks[data-id="system_users"]')).toHaveLength(1);
    });

    test("aborted query navigation preserves active tab presentation", async () => {
        const { initTabs, openNavTab } = await import("./main_tab_printer.js");
        await initTabs();
        await openNavTab("app_service_catalog");
        const activeBefore = document.querySelector(".navtablinks.active");
        vi.mocked(handle_all_navigation).mockResolvedValueOnce({ abort: true, reason: "dirty_check_failed" });
        const result = await openNavTab("system_about", { forceReload: true, replacementParams: { search: "new" } });
        expect(result.abort).toBe(true);
        expect(document.querySelector(".navtablinks.active")).toBe(activeBefore);
        expect(handle_all_navigation).toHaveBeenLastCalledWith("system_about", expect.anything(), {
            skipUrlUpdate: false, forceReload: true, replacementParams: { search: "new" },
        });
    });
});
