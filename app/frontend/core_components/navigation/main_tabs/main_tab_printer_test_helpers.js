// main_tab_printer_test_helpers.js
// Provides the shared viewport and mock-state reset for the tab printer tests.
// Between independently mocked test modules, browser storage, and the jsdom navigation shell.
// Keeps setup defined once while each test file owns its hoisted module mocks.

import { vi } from "vitest";
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

export function setViewportWidth(width) {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
}

export function resetMainTabPrinterTestState() {
    setViewportWidth(1024);
    localStorage.clear(); sessionStorage.clear();
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
}
