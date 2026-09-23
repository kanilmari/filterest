// main_tab_printer_browser_tab_title.test.js
// Verifies that opening a main navigation tab asks the browser tab owner to retitle.
// Bridges the tab bar's own "this tab is now open" moment with document.title.
// Exists because the site root reopens a tab without navigating, so the navigation
// pipeline's own retitle stage never runs for it.
// It lives beside main_tab_printer.test.js because that file is already at the
// 700-line limit; both cover the same module.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";
import { handle_all_navigation } from "../nav_engine/navigation_handler.js";
import { updateBrowserTabTitle } from "../nav_engine/browser_tab_title_writer.js";
import { applyMainTabActiveState } from "./main_tab_active_state.js";

vi.mock("../nav_engine/navigation_handler.js", () => ({
    handle_all_navigation: vi.fn().mockResolvedValue({ abort: false }),
}));

vi.mock("../nav_engine/browser_tab_title_writer.js", () => ({
    updateBrowserTabTitle: vi.fn().mockResolvedValue(true),
}));

vi.mock("./main_tab_active_state.js", () => ({
    applyMainTabActiveState: vi.fn(),
    clearMainTabActiveState: vi.fn(),
    refreshMainTabPresentation: vi.fn(),
}));

vi.mock("../admin_and_user_tools/custom_view_reader.js", () => ({ custom_views: {} }));
vi.mock("../../dev_tools/function_counter.js", () => ({ count_this_function: vi.fn() }));
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
    endpoint_router: vi.fn().mockResolvedValue({ datasets: [], tab_order: null }),
}));
vi.mock("../nav_engine/query_params.js", () => ({
    useStorageParams: vi.fn(),
    useUrlParams: vi.fn(),
}));
vi.mock("../../filterbar/filterbar_engine/filterbar_visibility_handler.js", () => ({
    resolveFilterBarElement: vi.fn(() => null),
}));

describe("openNavTab", () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="navbar"></div><div id="navmenu"></div>';
        vi.mocked(handle_all_navigation).mockClear().mockResolvedValue({ abort: false });
        vi.mocked(updateBrowserTabTitle).mockClear();
        vi.mocked(applyMainTabActiveState).mockClear();
    });

    test("asks the browser tab owner to retitle for the tab that just opened", async () => {
        const { openNavTab } = await import("./main_tab_printer.js");

        await openNavTab("app_service_catalog");

        expect(handle_all_navigation).toHaveBeenCalled();
        expect(updateBrowserTabTitle)
            .toHaveBeenCalledWith({ dataset: "app_service_catalog" });
    });

    test("retitles a restored tab that opens without navigating", async () => {
        // The site root reopens a tab with skipNavigation, so the navigation pipeline
        // never runs and this is the only boundary that knows the tab has settled.
        const { openNavTab } = await import("./main_tab_printer.js");

        await openNavTab("dev_agent_tasks", { skipNavigation: true });

        expect(handle_all_navigation).not.toHaveBeenCalled();
        expect(updateBrowserTabTitle)
            .toHaveBeenCalledWith({ dataset: "dev_agent_tasks" });
    });

    test("leaves an aborted navigation with the title it already had", async () => {
        vi.mocked(handle_all_navigation).mockResolvedValue({ abort: true });
        const { openNavTab } = await import("./main_tab_printer.js");

        await openNavTab("app_service_catalog");

        expect(updateBrowserTabTitle).not.toHaveBeenCalled();
    });
});
