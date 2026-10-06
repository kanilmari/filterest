// main_tab_printer_front_page.test.js
// Proves optional Home entry while retaining the existing first-tab and auth-entry behavior.
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

function setViewportWidth(width) {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
}

describe("initTabs", () => {
    beforeEach(() => {
        setViewportWidth(1024);
        history.replaceState({}, "", "/");
        localStorage.clear(); sessionStorage.clear();
        document.body.innerHTML = `
            <nav id="navbarFrontPage" hidden></nav>
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

    test('enabled root opens Home instead of auto-opening the first dataset', async () => {
        localStorage.setItem('separate_front_page', 'true');
        const { initTabs } = await import('./main_tab_printer.js');
        await initTabs();
        expect(handle_all_navigation).toHaveBeenCalledExactlyOnceWith('front_page', expect.anything(), {
            skipUrlUpdate: true, forceReload: false, isCurrentNavigation: expect.any(Function),
        });
        expect(document.getElementById('navbarFrontPage').hidden).toBe(false);
    });

    test('enabled root with preloaded Home does not navigate or fetch again', async () => {
        localStorage.setItem('separate_front_page', 'true');
        document.getElementById('tabs_container').innerHTML = '<div id="front_page_container">Loaded</div>';
        const { getSessionGeneration } = await import('../../auth/session_generation_store.js');
        document.getElementById('front_page_container').dataset.sessionGeneration = String(getSessionGeneration());
        const { initTabs } = await import('./main_tab_printer.js');
        await initTabs({ dataAlreadyLoaded: true });
        expect(handle_all_navigation).not.toHaveBeenCalled();
        expect(document.querySelector('#navbarFrontPage a').getAttribute('aria-current')).toBe('page');
    });

    test('Home setting preserves explicit login/register shell entries', async () => {
        localStorage.setItem('separate_front_page', 'true');
        vi.mocked(getButtonState).mockReturnValue('login');
        history.replaceState({}, '', '/?login-entry=1');
        const { initTabs } = await import('./main_tab_printer.js');
        await initTabs();
        expect(handle_all_navigation).not.toHaveBeenCalled();
    });

    test('Home setting off keeps the first-tab fallback and hides the static region', async () => {
        const { initTabs } = await import('./main_tab_printer.js');
        await initTabs();
        expect(handle_all_navigation).toHaveBeenCalledWith('app_service_catalog', expect.anything(), expect.anything());
        expect(document.getElementById('navbarFrontPage').hidden).toBe(true);
    });

});
