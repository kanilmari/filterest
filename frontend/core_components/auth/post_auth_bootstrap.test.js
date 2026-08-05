// post_auth_bootstrap.test.js
// Verifies rerunnable post-login SPA bootstrap behavior without a full page reload.
// Bridges mocked auth/bootstrap dependencies with DOM shell setup and tab rendering expectations.
// Exists to prevent duplicate nav shell nodes and broken post-auth bootstrap sequencing.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

const setAuthModesMock = vi.fn();
const hasRoutePermissionMock = vi.fn();
const getButtonStateMock = vi.fn();
const updateOidsMock = vi.fn();
const loadTablesMock = vi.fn();
const initTabsMock = vi.fn();
const enableTabDragAndDropMock = vi.fn();
const initializeTreeCallAdminMock = vi.fn();
const refreshDatasetAliasRegistryMock = vi.fn();
const clearPermissionCacheMock = vi.fn();

async function loadModule() {
    vi.resetModules();
    vi.doMock("../admin_tools/auth_mode_handler.js", () => ({
        setAuthModes: setAuthModesMock,
        hasRoutePermission: hasRoutePermissionMock,
        getButtonState: getButtonStateMock,
    }));
    vi.doMock("../admin_tools/main/oid_updater.js", () => ({
        update_oids_and_table_names: updateOidsMock,
    }));
    vi.doMock("../admin_tools/main/table_loader_handler.js", () => ({
        load_tables: loadTablesMock,
    }));
    vi.doMock("../navigation/main_tabs/main_tab_printer.js", () => ({
        initTabs: initTabsMock,
    }));
    vi.doMock("../navigation/main_tabs/tab_reorder_handler.js", () => ({
        enableTabDragAndDrop: enableTabDragAndDropMock,
    }));
    vi.doMock("../vanilla_tree/van_tr_components/admin_tree_builder.js", () => ({
        initializeTreeCallAdmin: initializeTreeCallAdminMock,
    }));
    vi.doMock("../navigation/nav_engine/dataset_aliases.js", () => ({
        refreshDatasetAliasRegistry: refreshDatasetAliasRegistryMock,
    }));
    vi.doMock("../route_permission_checker.js", () => ({
        clearPermissionCache: clearPermissionCacheMock,
    }));
    return import("./post_auth_bootstrap.js");
}

describe("runPostAuthBootstrap", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearPermissionCacheMock.mockReset();
        document.body.innerHTML = `
            <div id="navbar">
                <div class="navtabs_relative"></div>
            </div>
        `;
        window.history.replaceState({}, "", "/");
        localStorage.clear();
        getButtonStateMock.mockReturnValue("logout");
        hasRoutePermissionMock.mockImplementation((route) =>
            [
                "/ui/nav_container",
                "/ui/nav_tree",
                "/api/update-oids",
                "/api/update-tab-order",
            ].includes(route)
        );
    });

    test("reruns post-auth bootstrap without duplicating nav shell elements", async () => {
        const mod = await loadModule();

        await mod.runPostAuthBootstrap();
        await mod.runPostAuthBootstrap();

        expect(setAuthModesMock).toHaveBeenCalledTimes(2);
        expect(updateOidsMock).toHaveBeenCalledTimes(2);
        expect(initializeTreeCallAdminMock).toHaveBeenCalledTimes(2);
        expect(loadTablesMock).toHaveBeenCalledTimes(2);
        expect(refreshDatasetAliasRegistryMock).toHaveBeenCalledTimes(2);
        expect(clearPermissionCacheMock).toHaveBeenCalledTimes(2);
        expect(initTabsMock).toHaveBeenNthCalledWith(1, { dataAlreadyLoaded: true });
        expect(initTabsMock).toHaveBeenNthCalledWith(2, { dataAlreadyLoaded: true });
        expect(enableTabDragAndDropMock).toHaveBeenCalledTimes(2);
        expect(document.querySelectorAll("#navContainer")).toHaveLength(1);
        expect(document.querySelectorAll("#nav_tree")).toHaveLength(1);
        expect(Array.from(document.getElementById("navbar").children).map((el) => (
            el.id || el.className
        ))).toEqual(["navtabs_relative", "navbarAdminToolsSection"]);
        expect(Array.from(document.getElementById("navbarAdminToolsContent").children).map((el) => (
            el.id || el.className
        ))).toEqual(["navContainer", "nav_tree"]);
    });

    test("loads the default dataset for public guest browsing", async () => {
        getButtonStateMock.mockReturnValue("login");
        localStorage.setItem("login_required_for_browse", "false");
        const contentTablesResponse = { datasets: [{ table_name: "app_service_catalog" }] };
        loadTablesMock.mockResolvedValue(contentTablesResponse);
        const mod = await loadModule();

        const result = await mod.runPostAuthBootstrap();

        expect(result).toEqual({ dataLoaded: true });
        expect(loadTablesMock).toHaveBeenCalledWith({ forceReload: true });
        expect(refreshDatasetAliasRegistryMock).not.toHaveBeenCalled();
        expect(clearPermissionCacheMock).not.toHaveBeenCalled();
        expect(initTabsMock).toHaveBeenCalledWith({
            dataAlreadyLoaded: true,
            preloadedContentTablesResponse: contentTablesResponse,
        });
    });

    test("skips dataset bootstrap for forced-login guest users", async () => {
        getButtonStateMock.mockReturnValue("login");
        localStorage.setItem("login_required_for_browse", "true");
        const mod = await loadModule();

        const result = await mod.runPostAuthBootstrap();

        expect(result).toEqual({ dataLoaded: false });
        expect(loadTablesMock).not.toHaveBeenCalled();
        expect(initTabsMock).toHaveBeenCalledWith({ dataAlreadyLoaded: false });
    });

    test("keeps explicit login routes on the auth surface during public guest browsing", async () => {
        window.history.replaceState({}, "", "/?login-entry=1");
        getButtonStateMock.mockReturnValue("login");
        localStorage.setItem("login_required_for_browse", "false");
        const mod = await loadModule();

        const result = await mod.runPostAuthBootstrap();

        expect(result).toEqual({ dataLoaded: false });
        expect(loadTablesMock).not.toHaveBeenCalled();
        expect(initTabsMock).toHaveBeenCalledWith({ dataAlreadyLoaded: false });
    });

    test("awaits alias hydration before loading authenticated datasets", async () => {
        const callOrder = [];
        refreshDatasetAliasRegistryMock.mockImplementation(async () => {
            callOrder.push("refreshAliases");
        });
        initializeTreeCallAdminMock.mockImplementation(() => {
            callOrder.push("initializeTree");
        });
        loadTablesMock.mockImplementation(async () => {
            callOrder.push("loadTables");
        });
        const mod = await loadModule();

        await mod.runPostAuthBootstrap();

        expect(callOrder).toEqual(["refreshAliases", "initializeTree", "loadTables"]);
        expect(loadTablesMock).toHaveBeenCalledWith({ forceReload: true });
    });

    test("starts nav tree bootstrap without waiting for dataset loading to finish", async () => {
        const callOrder = [];
        let resolveTreeInit;
        const treeInitPromise = new Promise((resolve) => {
            resolveTreeInit = resolve;
        });

        initializeTreeCallAdminMock.mockImplementation(() => {
            callOrder.push("initializeTree");
            return treeInitPromise;
        });
        loadTablesMock.mockImplementation(async () => {
            callOrder.push("loadTables");
        });
        initTabsMock.mockImplementation(async () => {
            callOrder.push("initTabs");
        });

        const mod = await loadModule();
        await mod.runPostAuthBootstrap();

        expect(callOrder).toEqual(["initializeTree", "loadTables", "initTabs"]);
        resolveTreeInit();
    });

    test("destroys mounted filterbars before forcing an authenticated rerender", async () => {
        const destroyMock = vi.fn();
        const panel = document.createElement('div');
        panel.className = 'filterbar-panel';
        panel.destroy = destroyMock;
        document.body.appendChild(panel);
        const mod = await loadModule();

        await mod.runPostAuthBootstrap();

        expect(destroyMock).toHaveBeenCalledTimes(1);
    });
});
