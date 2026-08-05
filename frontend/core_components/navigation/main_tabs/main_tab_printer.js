// main_tab_printer.js
// Generates and manages the main navigation tabs for the application.
// Bridges navigation events, permission checks, and dataset state to render the top tab bar.
// Exists to centralise tab rendering so every navigation event updates the tab bar through a single entry point.

import { handle_all_navigation } from "../nav_engine/navigation_handler.js";
import { custom_views } from "../admin_and_user_tools/custom_view_reader.js";
import { count_this_function } from "../../dev_tools/function_counter.js";
import { handleLoginShellEntry } from "../../auth/login_shell_entry.js";
import { requestLoginRedirect } from "../../auth/login_redirect_handler.js";
import {
    navigateToPostLogoutPath,
    performSpaLogoutReset,
} from "../../auth/logout_shell_reset.js";
import { getButtonState, setAuthModes } from "../../admin_tools/auth_mode_handler.js";
import {
    applyPermission,
    hasDatasetPermission,
    primeMultipleDatasetPermissions,
} from "../../route_permission_checker.js";
import { getSelectedDataset, clearSelectedDataset } from "../../state_stores/dataset_selection_saver.js";
import { endpoint_router } from "../../endpoints/endpoint_router.js";
import {
    canReadDatasetFromRegistry,
    primeDatasetAccessRegistry,
} from "../nav_engine/dataset_access_registry.js";
import { useStorageParams, useUrlParams } from "../nav_engine/query_params.js";
import { getTabIconPath } from "./tab_icon_library.js";
import { buildTabOutlinePresentation } from "./tab_presentation_builder.js";
import {
    applyMainTabActiveState,
    refreshMainTabPresentation,
} from "./main_tab_active_state.js";
import { NAVBAR_VISIBILITY_CHANGED_EVENT } from "../menu_button/navbar_visibility_handler.js";
import { resolveFilterBarElement } from "../../filterbar/filterbar_engine/filterbar_visibility_handler.js";

/** User friendly tabs **/
// Imports and SVG paths defined already...

// Staattiset välilehdet (login, register, logout, user, users)
const staticTabsData = [
    {
        userContent: true,
        id: "user",
        text: "Account",
        langKey: "account",
        svgPath: getTabIconPath("person"),
        route: "/user",
    },
    {
        userContent: true,
        id: "system_users",
        text: "Users",
        langKey: "users",
        svgPath: getTabIconPath("group_filled"),
    },
    {
        nonUserContent: true,
        id: "register",
        text: "Register",
        langKey: "register",
        svgPath: getTabIconPath("group"),
        route: "/register_ndYOyXV0INOK3F",
    },
    {
        nonUserContent: true,
        id: "login",
        text: "Login",
        langKey: "login",
        svgPath: getTabIconPath("login"),
        route: "/login",
    },
    {
        userContent: true,
        id: "logout",
        text: "Logout",
        langKey: "logout",
        svgPath: getTabIconPath("logout"),
        alwaysNarrowButton: true,
        route: "/ui-logout",
    },
];

const STATIC_TAB_PREFIX = "static:";
const STATIC_TAB_IDS = new Set(staticTabsData.map((tab) => tab.id));
const AUTH_ACTION_TAB_IDS = new Set(["login", "logout", "user"]);
const MULTILINE_TAB_TEXT_CLASS = "tab_button_text--multiline";
let _tabTextLayoutFrame = 0;
let _tabTextObserver = null;
let _observedTabContainer = null;

function getTabOrderIdentifier(tabId) {
    return STATIC_TAB_IDS.has(tabId)
        ? `${STATIC_TAB_PREFIX}${tabId}`
        : tabId;
}

/**
 * Hakee projektin taulut API:sta ja järjestää ne:
 * 1. Jos tab_order_json sisältää static:* entryjä: järjestää kaikki tabit (data + static)
 * 2. Jos tab_order_json on vanhassa muodossa: järjestää data-tabit, static-tabit fallbackiin
 * 3. Muuten fallback: Main-taulu → system_users → About-taulu → muut aakkosjärjestyksessä + static-tabit
 */
async function fetchProjectTabs({ suppressAuthRedirect = false, preloadedContentTablesResponse = null } = {}) {
    try {
        const response = preloadedContentTablesResponse
            || await endpoint_router('fetchContentTables', { suppressAuthRedirect });
        primeDatasetAccessRegistry(response);
        const datasets = response.datasets || [];
        const tabOrder = response.tab_order || null; // Array from system_table_folders.tab_order_json

        // Show only tables that live directly under the active project root.
        // Tables inside project subfolders still belong to the project, but they
        // no longer appear in the main SVG tab row.
        const projectTables = datasets.filter((t) =>
            t.is_top_level_in_current_project ||
            t.dataset_name === 'system_users'
        );

        // Selects the dataset tab icon from DB metadata, with stable fallbacks
        // for the few built-in table roles that are still allowed in main tabs.
        const getDatasetTabIconKey = (table) => {
            return table.icon_key || (table.is_main_table ? 'building' : table.is_about_table ? 'help' : undefined);
        };

        // Helper: build tab object from dataset
        const buildTabObj = (table) => {
            // system_users gets special treatment (langKey, userContent flag)
            if (table.dataset_name === 'system_users') {
                return {
                    userContent: true,
                    id: 'system_users',
                    text: 'Users',
                    langKey: 'users',
                    svgPath: getTabIconPath(table.icon_key || 'group_filled'),
                };
            }
            return {
                id: table.dataset_name,
                text: formatTableName(table.dataset_name),
                langKey: table.dataset_name,
                svgPath: getTabIconPath(getDatasetTabIconKey(table)),
                isProjectTable: true,
                dataset: table.dataset_name,
                route: '/api/get-results',
            };
        };

        const staticTabsWithoutUsers = staticTabsData.filter((t) => t.id !== 'system_users');

        const getDefaultProjectTabs = () => {
            const mainTable = projectTables.find((t) => t.is_main_table === true);
            const aboutTable = projectTables.find((t) => t.is_about_table === true);
            const systemUsers = projectTables.find((t) => t.dataset_name === 'system_users');

            const otherTables = projectTables.filter((t) =>
                t.is_main_table !== true &&
                t.is_about_table !== true &&
                t.dataset_name !== 'system_users'
            ).sort((a, b) => a.dataset_name.localeCompare(b.dataset_name));

            const orderedTabs = [];
            if (mainTable) orderedTabs.push(buildTabObj(mainTable));
            if (systemUsers) orderedTabs.push(buildTabObj(systemUsers));
            if (aboutTable) orderedTabs.push(buildTabObj(aboutTable));
            for (const table of otherTables) orderedTabs.push(buildTabObj(table));

            return orderedTabs;
        };

        // If we have a saved tab order, use it
        if (tabOrder && Array.isArray(tabOrder) && tabOrder.length > 0) {
            const normalizedOrderEntries = tabOrder
                .map((item) => {
                    const sortOrder = item?.sort_order;
                    if (typeof sortOrder !== 'number' || Number.isNaN(sortOrder)) {
                        return null;
                    }

                    if (typeof item?.tab_id === 'string' && item.tab_id.length > 0) {
                        return { tabId: item.tab_id, sortOrder };
                    }
                    if (typeof item?.dataset_name === 'string' && item.dataset_name.length > 0) {
                        return { tabId: item.dataset_name, sortOrder };
                    }
                    return null;
                })
                .filter(Boolean);

            const hasUnifiedStaticEntries = normalizedOrderEntries.some(
                (entry) => entry.tabId.startsWith(STATIC_TAB_PREFIX)
            );

            // New format: order all tabs (project + static) using tab_id
            if (hasUnifiedStaticEntries) {
                const defaultProjectTabs = getDefaultProjectTabs();
                const allTabs = [...defaultProjectTabs, ...staticTabsWithoutUsers];

                const orderMap = new Map();
                normalizedOrderEntries.forEach((entry) => {
                    if (!orderMap.has(entry.tabId)) {
                        orderMap.set(entry.tabId, entry.sortOrder);
                    }
                });

                const fallbackIndexMap = new Map();
                allTabs.forEach((tab, index) => {
                    fallbackIndexMap.set(tab.id, index);
                });

                const getSortOrderForTab = (tab) => {
                    const preferredId = getTabOrderIdentifier(tab.id);
                    if (orderMap.has(preferredId)) {
                        return orderMap.get(preferredId);
                    }

                    // Backward compatibility: tolerate mixed payloads where static IDs are not prefixed
                    const plainId = tab.id;
                    if (orderMap.has(plainId)) {
                        return orderMap.get(plainId);
                    }

                    const prefixedId = `${STATIC_TAB_PREFIX}${tab.id}`;
                    if (orderMap.has(prefixedId)) {
                        return orderMap.get(prefixedId);
                    }

                    return Number.POSITIVE_INFINITY;
                };

                const sortedTabs = [...allTabs].sort((a, b) => {
                    const orderA = getSortOrderForTab(a);
                    const orderB = getSortOrderForTab(b);

                    if (orderA !== orderB) return orderA - orderB;

                    const fallbackA = fallbackIndexMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
                    const fallbackB = fallbackIndexMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
                    if (fallbackA !== fallbackB) return fallbackA - fallbackB;

                    return a.id.localeCompare(b.id);
                });

                return sortedTabs;
            }

            // Legacy format: order only project/data tabs, keep static tabs in default position.
            const legacyOrderMap = new Map();
            normalizedOrderEntries.forEach((entry) => {
                if (!entry.tabId.startsWith(STATIC_TAB_PREFIX)) {
                    legacyOrderMap.set(entry.tabId, entry.sortOrder);
                }
            });

            // Sort project tables: those in orderMap by sort_order, others at the end alphabetically
            const sorted = [...projectTables].sort((a, b) => {
                const orderA = legacyOrderMap.has(a.dataset_name) ? legacyOrderMap.get(a.dataset_name) : 99999;
                const orderB = legacyOrderMap.has(b.dataset_name) ? legacyOrderMap.get(b.dataset_name) : 99999;
                if (orderA !== orderB) return orderA - orderB;
                return a.dataset_name.localeCompare(b.dataset_name);
            });

            return [...sorted.map(buildTabObj), ...staticTabsWithoutUsers];
        }

        // Fallback: original hardcoded ordering + static tabs in their default position
        return [...getDefaultProjectTabs(), ...staticTabsWithoutUsers];
    } catch (err) {
        console.warn("fetchProjectTabs error:", err);
        // Always return static tabs so the user can at least see login/logout/account
        return staticTabsData;
    }
}

/**
 * Muuntaa taulun nimen käyttäjäystävälliseen muotoon.
 * Esim. "app_service_catalog" -> "Service Catalog"
 */
function formatTableName(tableName) {
    // Poista app_ tai system_ prefix
    let name = tableName.replace(/^(app_|system_|dev_)/, '');
    // Korvaa alaviivat välilyönneillä ja kapitalisoi sanat
    return name
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function syncNavTabTextLineClasses(container = document.getElementById("navmenu")) {
    if (!(container instanceof HTMLElement)) {
        return;
    }

    const textNodes = container.querySelectorAll(".tab_button_text");
    textNodes.forEach((textNode) => {
        if (!(textNode instanceof HTMLElement)) {
            return;
        }

        // Measure with the base font size first so the multiline class is stable.
        textNode.classList.remove(MULTILINE_TAB_TEXT_CLASS);

        const computed = window.getComputedStyle(textNode);
        const fontSize = Number.parseFloat(computed.fontSize) || 16;
        const lineHeightValue = Number.parseFloat(computed.lineHeight);
        const lineHeight = Number.isFinite(lineHeightValue)
            ? lineHeightValue
            : fontSize * 1.2;
        const lineCount = Math.round(textNode.scrollHeight / lineHeight);

        textNode.classList.toggle(MULTILINE_TAB_TEXT_CLASS, lineCount > 1);
    });
}

function scheduleNavTabTextLineClassSync(container = document.getElementById("navmenu")) {
    if (_tabTextLayoutFrame) {
        cancelAnimationFrame(_tabTextLayoutFrame);
    }

    _tabTextLayoutFrame = requestAnimationFrame(() => {
        _tabTextLayoutFrame = 0;
        syncNavTabTextLineClasses(container);
    });
}

function ensureNavTabTextLayoutObserver(container) {
    if (!(container instanceof HTMLElement)) {
        return;
    }

    if (_observedTabContainer === container && _tabTextObserver) {
        return;
    }

    if (_tabTextObserver) {
        _tabTextObserver.disconnect();
    }

    _observedTabContainer = container;
    _tabTextObserver = new MutationObserver(() => {
        scheduleNavTabTextLineClassSync(container);
    });
    _tabTextObserver.observe(container, {
        childList: true,
        characterData: true,
        subtree: true,
    });
}

function hasExplicitAuthShellEntry() {
    const params = new URLSearchParams(window.location.search);
    return params.get("login-entry") === "1" || params.get("register-entry") === "1";
}

export async function initTabs({ dataAlreadyLoaded = false, preloadedContentTablesResponse = null } = {}) {
    const container = document.getElementById("navmenu");

    // Tarkistetaan löytyikö container
    if (!container) {
        console.warn("container not found 🤔");
        return;
    }

    container.replaceChildren();
    ensureNavTabTextLayoutObserver(container);

    // Determine auth state: "login" means user is NOT logged in
    let isLoggedIn = false;
    try {
        isLoggedIn = getButtonState() === 'logout';
    } catch (_) { /* not set yet — treat as not logged in */ }
    renderNavbarAuthActions({ isLoggedIn });

    // For guests: try fetching datasets (works when login_to_browse=false and guest
    // has permissions). suppressAuthRedirect prevents navigating away on 401/403 —
    // the catch block falls back to static tabs instead.
    const allTabs = isLoggedIn
        ? await fetchProjectTabs({ preloadedContentTablesResponse })
        : await fetchProjectTabs({ suppressAuthRedirect: true });

    const datasetPermissionFallbackRequests = allTabs
        .filter((tabData) => tabData.dataset && tabData.route)
        .filter((tabData) => canReadDatasetFromRegistry(tabData.dataset) === null)
        .map((tabData) => ({
            dataset: tabData.dataset,
            routes: [tabData.route],
        }));
    const datasetPermissionFallbackPromise = datasetPermissionFallbackRequests.length > 0
        ? primeMultipleDatasetPermissions(datasetPermissionFallbackRequests)
        : Promise.resolve(new Map());

    allTabs.forEach((tabData) => {
        if (AUTH_ACTION_TAB_IDS.has(tabData.id)) return;

        // Filter by auth state: nonUserContent tabs only for anon, userContent only for logged-in
        if (tabData.nonUserContent && isLoggedIn) return;
        if (tabData.userContent && !isLoggedIn) return;

        // Hide register tab when registration is disabled in system_config
        if (tabData.id === 'register') {
            const regEnabled = localStorage.getItem('registration_enabled');
            if (regEnabled !== 'true') return;
        }

        const tabButton = document.createElement("button");
        tabButton.classList.add("navtablinks");
        tabButton.setAttribute("data-id", tabData.id);
        tabButton.dataset.testid = `tab-${tabData.id}`;
        if (tabData.langKey) {
            tabButton.dataset.langKey = tabData.langKey;
        }
        attachFastTabOpenHandlers(tabButton, tabData.id);

        createSVGTabButton(tabButton, tabData.text, tabData.svgPath);
        /* Skip permission checks for public-facing tabs (login, register) —
           anonymous users have no cached permissions so applyPermission
           would incorrectly hide them.
           Also skip for core auth-UI tabs (logout, user/account) — these are
           not data-access endpoints; visibility is already controlled by
           userContent: true (only shown when logged in). Every logged-in user
           must be able to log out and access their account regardless of role. */
        if (tabData.nonUserContent) {
            // Always visible for non-logged-in users; no permission gate needed
        } else if (tabData.id === 'logout' || tabData.id === 'user') {
            // Auth-UI tabs: visible to all logged-in users, no permission gate needed
        } else if (tabData.dataset && tabData.route) {
            const canReadDataset = canReadDatasetFromRegistry(tabData.dataset);
            if (canReadDataset === false) {
                tabButton.style.display = 'none';
            } else if (canReadDataset === true) {
                // /api/datasets already confirmed the dataset is readable.
            } else {
                tabButton.style.display = 'none';
                datasetPermissionFallbackPromise.then(() =>
                    hasDatasetPermission(tabData.route, tabData.dataset)
                ).then((allowed) => {
                    if (allowed) tabButton.style.display = '';
                });
            }
        } else if (tabData.route) {
            applyPermission(tabButton, tabData.route);
        }
        container.appendChild(tabButton);
    });

    scheduleNavTabTextLineClassSync(container);

    if (!isLoggedIn && hasExplicitAuthShellEntry()) {
        return;
    }

    // Determine which tab to auto-open.
    // Key invariant: skipNavigation is ONLY used when dataAlreadyLoaded is true
    // (i.e. load_tables() already rendered content). This prevents the empty-page
    // bug where stale sessionStorage caused skipNavigation on a page with no content.
    const selectedDataset = getSelectedDataset();
    const matchingTab = selectedDataset
        ? container.querySelector(`.navtablinks[data-id="${selectedDataset}"]`)
        : null;

    if (matchingTab) {
        // Tab exists in the current bar — navigate only if data wasn't loaded yet
        openNavTab(selectedDataset, { skipNavigation: dataAlreadyLoaded });
    } else {
        // load_tables() can preload datasets or custom views that are not present
        // in the top tab bar. Preserve that selection instead of clearing storage
        // or highlighting an unrelated first tab.
        if (selectedDataset && dataAlreadyLoaded) {
            return;
        }

        // No matching tab — clear stale selection that survived from a previous session
        if (selectedDataset) {
            clearSelectedDataset();
        }

        const firstTab = container.querySelector(".navtablinks");
        if (firstTab?.dataset?.id) {
            // For guests: try to open the first content tab. If none exist,
            // leave the shell as-is; login must only open from an explicit
            // user action on the login button.
            if (!isLoggedIn) {
                const contentTab = container.querySelector(
                    '.navtablinks:not([data-id="login"]):not([data-id="register"])'
                );
                if (contentTab?.dataset?.id) {
                    openNavTab(contentTab.dataset.id);
                }
            } else {
                // Logged-in but stored dataset gone — navigate to load content
                openNavTab(firstTab.dataset.id, { skipNavigation: dataAlreadyLoaded });
            }
        }
    }
}

function renderNavbarAuthActions({ isLoggedIn }) {
    const container = document.getElementById("navbarAuthActions");
    if (!(container instanceof HTMLElement)) {
        return;
    }

    container.replaceChildren();

    const actions = isLoggedIn
        ? [
            {
                id: "user",
                text: "Account",
                langKey: "account",
                iconPath: getTabIconPath("person"),
            },
            {
                id: "logout",
                text: "Logout",
                langKey: "logout",
                iconPath: getTabIconPath("logout"),
            },
        ]
        : [
            {
                id: "login",
                text: "Login",
                langKey: "login",
                iconPath: getTabIconPath("login"),
            },
        ];

    container.classList.toggle("navbar-auth-actions--solo", actions.length === 1);

    actions.forEach((action) => {
        container.appendChild(createNavbarAuthActionButton(action));
    });
}

function createNavbarAuthActionButton({ id, text, langKey, iconPath }) {
    const button = document.createElement("button");
    button.type = "button";
    button.classList.add("navbar-auth-action");
    button.setAttribute("data-id", id);
    button.setAttribute("aria-label", text);
    button.dataset.testid = `navbar-auth-${id}`;
    button.addEventListener("click", () => {
        void openNavTab(id);
    });

    button.appendChild(createNavbarAuthActionIcon(iconPath));

    const textSpan = document.createElement("span");
    textSpan.classList.add("navbar-auth-action-text");
    textSpan.textContent = text;
    if (langKey) {
        textSpan.dataset.langKey = langKey;
    }
    button.appendChild(textSpan);

    return button;
}

function attachFastTabOpenHandlers(button, tabId) {
    let suppressClickAfterMouseDown = false;

    button.addEventListener("mousedown", (event) => {
        if (event.defaultPrevented || event.button !== 0) {
            return;
        }
        suppressClickAfterMouseDown = true;
        void openNavTab(tabId);
    });

    button.addEventListener("mouseleave", () => {
        suppressClickAfterMouseDown = false;
    });

    button.addEventListener("click", (event) => {
        if (suppressClickAfterMouseDown) {
            suppressClickAfterMouseDown = false;
            event.preventDefault();
            return;
        }
        void openNavTab(tabId);
    });
}

function createNavbarAuthActionIcon(iconPathD) {
    const svgNS = "http://www.w3.org/2000/svg";
    const icon = document.createElementNS(svgNS, "svg");
    icon.classList.add("navbar-auth-action-icon");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("width", "24");
    icon.setAttribute("height", "24");
    icon.setAttribute("viewBox", "0 -960 960 960");

    const iconPath = document.createElementNS(svgNS, "path");
    iconPath.setAttribute("d", iconPathD);
    icon.appendChild(iconPath);

    return icon;
}

function createSVGTabButton(tabElement, buttonText, iconPathD) {
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    const initialOutlinePresentation = buildTabOutlinePresentation({
        isNarrow: false,
        isNavbarOverlay: true,
        isActive: false,
    });
    svg.setAttribute("width", String(initialOutlinePresentation.width));
    svg.setAttribute("height", String(initialOutlinePresentation.height));
    svg.setAttribute("viewBox", initialOutlinePresentation.viewBox);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.classList.add("svg-container");
    svg.setAttribute("aria-hidden", "true");

    const outlinePath = document.createElementNS(svgNS, "path");
    outlinePath.classList.add("navtab-stroke-path");
    outlinePath.setAttribute("d", initialOutlinePresentation.pathD);
    outlinePath.setAttribute("stroke", "var(--border_color)");
    outlinePath.setAttribute("stroke-width", initialOutlinePresentation.strokeWidth);
    outlinePath.setAttribute("vector-effect", "non-scaling-stroke");
    outlinePath.setAttribute("fill", initialOutlinePresentation.fill);
    svg.appendChild(outlinePath);

    tabElement.appendChild(svg);

    // Keep nav icons as inline SVG instead of CSS masks.
    // The mask-based version intermittently lost icons during long SPA sessions,
    // while hard reload restored them. Inline SVG keeps the icon tied to the tab DOM.
    const icon = document.createElementNS(svgNS, "svg");
    icon.classList.add("navtab_icon");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("width", "26");
    icon.setAttribute("height", "26");
    icon.setAttribute("viewBox", "0 -960 960 960");
    const iconPath = document.createElementNS(svgNS, "path");
    iconPath.setAttribute("d", iconPathD);
    icon.appendChild(iconPath);
    tabElement.appendChild(icon);

    const textSpan = document.createElement("span");
    textSpan.classList.add("tab_button_text");
    textSpan.innerText = buttonText;
    tabElement.appendChild(textSpan);

    tabElement.dataset.tabPresentation = initialOutlinePresentation.state;
}

/**
 * Avaa nav-välilehden ja päivittää ulkoasun.
 * @param {string}  tableName                 – taulun / näkymän nimi
 * @param {Object}  [options]
 * @param {boolean} [options.skipNavigation]  – ohita varsinainen navigointi
 * @param {boolean} [options.forceReload]     – pakota näkymän sisältö renderöitymään uudelleen
 */
export async function openNavTab(tableName, options = {}) {
    count_this_function("openNavTab");

    const { skipNavigation = false, skipUrlUpdate = false, forceReload = false } = options;

    /* --- Special handling: login opens modal, logout does full cleanup --- */
    if (tableName === 'login' && !skipNavigation) {
        await requestLoginRedirect({ userInitiated: true });
        return;
    }
    if (tableName === 'logout' && !skipNavigation) {
        try {
            const logoutResult = await performSpaLogoutReset();
            if (navigateToPostLogoutPath(logoutResult?.postLogoutPath)) {
                return;
            }
            await setAuthModes();
            await initTabs({ dataAlreadyLoaded: false });
            await handleLoginShellEntry();
        } catch (err) {
            console.warn("SPA logout reset failed, falling back to full navigation:", err);
            window.location.assign("/api/logout");
        }
        return;
    }

    /* 1) Varsinainen navigaatio taulun/välinäkymän sisään ---------------- */
    if (!skipNavigation) {
        useStorageParams();
        await handle_all_navigation(tableName, custom_views, { skipUrlUpdate, forceReload });
        useUrlParams();
    }

    /* 2) Päivitetään SVG-tabien aktiivisuus ja visuaalinen tila ---------- */
    applyMainTabActiveState(tableName, { viewDatasetName: tableName });
    scheduleNavTabTextLineClassSync();
    focusPrimaryDatasetSearch(tableName);
}

export async function updateTabPathsForView(datasetName) {
    refreshMainTabPresentation(datasetName);
    scheduleNavTabTextLineClassSync();
}

function focusPrimaryDatasetSearch(datasetName) {
    requestAnimationFrame(() => {
        const filterBar = resolveFilterBarElement(datasetName);
        if (!filterBar) {
            return;
        }

        const tablePartsContainer = document.getElementById(
            `${datasetName}_tab_parts_container`
        );
        if (!tablePartsContainer) {
            return;
        }

        const searchInput = tablePartsContainer.querySelector(
            ".dataset-search-input[data-dataset-search-variant='filterbar']"
        );
        if (!(searchInput instanceof HTMLElement)) {
            return;
        }

        try {
            searchInput.focus({ preventScroll: true });
        } catch (_err) {
            searchInput.focus();
        }
    });
}

// Päivitä välilehdet ruudun koon muuttuessa (debounced 150ms)
let _tabsResizeTimer = null;
window.addEventListener("resize", () => {
    clearTimeout(_tabsResizeTimer);
    _tabsResizeTimer = setTimeout(() => {
        const selectedTable = getSelectedDataset();
        if (selectedTable) {
            updateTabPathsForView(selectedTable);
        }
    }, 150);
});

window.addEventListener(NAVBAR_VISIBILITY_CHANGED_EVENT, () => {
    const selectedTable = getSelectedDataset();
    if (selectedTable) {
        updateTabPathsForView(selectedTable);
    }
});
