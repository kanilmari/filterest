// post_auth_bootstrap.js
// Rebuilds the authenticated SPA shell after login without reloading the page.
// Bridges auth mode refresh, nav shell setup, dataset loading, and tab rendering for post-auth transitions.
// Exists to share one rerunnable, idempotent post-login bootstrap between main.js and modal login flows.

import {
    setAuthModes,
    hasRoutePermission,
    getButtonState,
} from "../admin_tools/auth_mode_handler.js";
import { update_oids_and_table_names } from "../admin_tools/main/oid_updater.js";
import { load_tables } from "../admin_tools/main/table_loader_handler.js";
import { initTabs } from "../navigation/main_tabs/main_tab_printer.js";
import { enableTabDragAndDrop } from "../navigation/main_tabs/tab_reorder_handler.js";
import { initializeTreeCallAdmin } from "../vanilla_tree/van_tr_components/admin_tree_builder.js";
import { refreshDatasetAliasRegistry } from "../navigation/nav_engine/dataset_aliases.js";
import { clearPermissionCache } from "../route_permission_checker.js";
import {
    NAVBAR_ADMIN_TOOLS_SECTION_ID,
    ensureNavbarAdminToolsSection,
} from "../navigation/database_tree/navbar_admin_tools_section.js";

/**
 * Ensures post-login nav containers exist exactly once before admin nav builders run.
 */
function ensureNavShellElements() {
    const navbar = document.getElementById("navbar");
    const tabsWrap = navbar?.querySelector(".navtabs_relative");
    if (!navbar || !tabsWrap) {
        return;
    }

    const canShowNavContainer = hasRoutePermission("/ui/nav_container");
    const canShowNavTree = hasRoutePermission("/ui/nav_tree");
    const adminToolsContent = canShowNavContainer || canShowNavTree
        ? ensureNavbarAdminToolsSection(navbar, tabsWrap)
        : null;

    let navContainer = document.getElementById("navContainer");
    if (canShowNavContainer && adminToolsContent) {
        if (!navContainer) {
            navContainer = document.createElement("div");
            navContainer.id = "navContainer";
        }
        adminToolsContent.appendChild(navContainer);
    }

    let navTree = document.getElementById("nav_tree");
    if (canShowNavTree && adminToolsContent) {
        if (!navTree) {
            navTree = document.createElement("div");
            navTree.id = "nav_tree";
        }
        adminToolsContent.appendChild(navTree);
    }

    if (!adminToolsContent) {
        document.getElementById(NAVBAR_ADMIN_TOOLS_SECTION_ID)?.remove();
    }
}

function isLoggedInFromAuthMode() {
    try {
        return getButtonState() === "logout";
    } catch {
        return false;
    }
}

/**
 * Reads the current browse policy from auth-mode storage after setAuthModes hydrates it.
 */
function canBrowseWithoutLoginFromAuthMode() {
    try {
        return localStorage.getItem("login_required_for_browse") === "false";
    } catch {
        return false;
    }
}

/**
 * Detects auth-only routes that should show the login/register surface instead of datasets.
 */
function isExplicitAuthEntryRoute() {
    const currentPath = window.location?.pathname || "";
    if (currentPath === "/login" || currentPath === "/register") {
        return true;
    }

    const params = new URLSearchParams(window.location?.search || "");
    return params.get("login-entry") === "1" || params.get("register-entry") === "1";
}

function destroyMountedFilterbars() {
    document.querySelectorAll('.filterbar-panel').forEach((panelElement) => {
        if (typeof panelElement.destroy === 'function') {
            panelElement.destroy();
            return;
        }
        panelElement.remove();
    });
}

/**
 * Replays the authenticated shell bootstrap after login without re-running global page startup.
 */
export async function runPostAuthBootstrap({ refreshAuthModes = true } = {}) {
    if (refreshAuthModes) {
        await setAuthModes();
    }

    ensureNavShellElements();

    let dataLoaded = false;
    let contentTablesResponse = null;
    let treeInitPromise = null;
    let treeInitStarted = false;
    const isLoggedIn = isLoggedInFromAuthMode();
    const shouldLoadPublicBrowseData = !isLoggedIn
        && canBrowseWithoutLoginFromAuthMode()
        && !isExplicitAuthEntryRoute();

    if (isLoggedIn) {
        clearPermissionCache();
        try {
            await refreshDatasetAliasRegistry();
        } catch (error) {
            console.warn("Post-auth alias refresh failed", error);
        }

        destroyMountedFilterbars();
        if (hasRoutePermission("/ui/nav_tree")) {
            treeInitStarted = true;
            treeInitPromise = initializeTreeCallAdmin();
        }
        contentTablesResponse = await load_tables({ forceReload: true });
        dataLoaded = true;
    } else if (shouldLoadPublicBrowseData) {
        destroyMountedFilterbars();
        contentTablesResponse = await load_tables({ forceReload: true });
        dataLoaded = true;
    }

    const initTabsOptions = { dataAlreadyLoaded: dataLoaded };
    if (contentTablesResponse) {
        initTabsOptions.preloadedContentTablesResponse = contentTablesResponse;
    }
    await initTabs(initTabsOptions);

    if (isLoggedInFromAuthMode()) {
        if (hasRoutePermission("/api/update-oids")) {
            void update_oids_and_table_names();
        }
        if (treeInitStarted) {
            void treeInitPromise;
        } else if (hasRoutePermission("/ui/nav_tree")) {
            void initializeTreeCallAdmin();
        }
    }

    if (hasRoutePermission("/api/update-tab-order")) {
        enableTabDragAndDrop();
    }

    return { dataLoaded };
}
