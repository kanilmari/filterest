// main_dataset_tabs.js
// Owns the existing project-tab ordering and its accepted dataset-only projection.
// Connects one metadata-backed navigation list to the navbar, hero and supplemental search.
// Invalidates subscribers with the shared access generation; auth fallback buttons never grant access.

import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { getTabIconPath } from "./tab_icon_library.js";
import { getMainTabLangKey } from "./main_tab_lang_keys.js";
import {
    beginDatasetAccessRefresh, getDatasetAccessResponseGeneration,
    isCurrentDatasetAccessRefresh, primeDatasetAccessRegistry,
    subscribeDatasetAccessRegistry,
} from "../nav_engine/dataset_access_registry.js";

export const staticTabsData = [
    {
        userContent: true,
        id: "user",
        text: "Account",
        langKey: getMainTabLangKey("user"),
        svgPath: getTabIconPath("person"),
        route: "/user",
    },
    {
        userContent: true,
        id: "system_users",
        text: "Users",
        langKey: getMainTabLangKey("system_users"),
        iconKey: "group_center_filled",
    },
    {
        nonUserContent: true,
        id: "register",
        text: "Register",
        langKey: getMainTabLangKey("register"),
        svgPath: getTabIconPath("group"),
        route: "/register_ndYOyXV0INOK3F",
    },
    {
        nonUserContent: true,
        id: "login",
        text: "Login",
        langKey: getMainTabLangKey("login"),
        svgPath: getTabIconPath("login"),
        route: "/login",
    },
    {
        userContent: true,
        id: "logout",
        text: "Logout",
        langKey: getMainTabLangKey("logout"),
        svgPath: getTabIconPath("logout"),
        alwaysNarrowButton: true,
        route: "/ui-logout",
    },
];

const STATIC_TAB_PREFIX = "static:";
const STATIC_TAB_IDS = new Set(staticTabsData.map((tab) => tab.id));
export const AUTH_ACTION_TAB_IDS = new Set(["login", "logout", "user"]);
function getTabOrderIdentifier(tabId) {
    return STATIC_TAB_IDS.has(tabId)
        ? `${STATIC_TAB_PREFIX}${tabId}`
        : tabId;
}

/**
 * Hakee projektin taulut API:sta ja järjestää ne:
 * 1. Jos tab_order_json sisältää static:* entryjä: järjestää kaikki tabit (data + static)
 * 2. Jos tab_order_json on vanhassa muodossa: järjestää data-tabit, static-tabit fallbackiin
 * 3. Muuten fallback: Main-taulu → system_users → muut aakkosjärjestyksessä + static-tabit
 * 4. system_about on kirjautuneen käyttäjän viimeinen sisältövälilehti riippumatta tallennetusta järjestyksestä.
 */
export async function fetchProjectTabs({ suppressAuthRedirect = false, preloadedContentTablesResponse = null } = {}) {
    const knownGeneration = getDatasetAccessResponseGeneration(preloadedContentTablesResponse);
    const generation = knownGeneration ?? beginDatasetAccessRefresh();
    let contentTablesResponse = null;
    const result = (tabs) => ({ tabs, contentTablesResponse, generation });
    try {
        const response = preloadedContentTablesResponse
            || await endpoint_router('fetchContentTables', { suppressAuthRedirect });
        contentTablesResponse = response;
        const datasets = response.datasets || [];
        const tabOrder = response.tab_order || null; // Array from system_table_folders.tab_order_json

        // Show only tables that live directly under the active project root.
        // Tables inside project subfolders still belong to the project, but they
        // no longer appear in the main SVG tab row.
        const systemAboutTable = datasets.find(
            (table) => table.dataset_name === "system_about"
        );
        const projectTables = datasets.filter((t) =>
            t.is_top_level_in_current_project ||
            t.dataset_name === 'system_users' ||
            t === systemAboutTable
        );

        // Selects the dataset tab icon from DB metadata, with stable fallbacks
        // for the few built-in table roles that are still allowed in main tabs.
        const getDatasetTabIconKey = (table) => {
            return table.icon_key || (table.is_main_table ? 'building' : table.is_about_table ? 'help' : undefined);
        };

        // Helper: build tab object from dataset
        const buildTabObj = (table) => {
            const hasPresentationMedia = table.has_presentation_media === true;
            // system_users gets special treatment (langKey, userContent flag)
            if (table.dataset_name === 'system_users') {
                return {
                    userContent: true,
                    id: 'system_users',
                    text: 'Users',
                    langKey: getMainTabLangKey('system_users'),
                    iconKey: table.icon_key || 'group_center_filled',
                    hasPresentationMedia,
                };
            }
            if (table.dataset_name === "system_about") {
                return {
                    userContent: true,
                    id: "system_about",
                    text: "About",
                    langKey: getMainTabLangKey("system_about"),
                    iconKey: getDatasetTabIconKey(table) || "help",
                    isProjectTable: false,
                    dataset: "system_about",
                    route: "/api/get-results",
                    hasPresentationMedia,
                };
            }
            return {
                id: table.dataset_name,
                text: formatTableName(table.dataset_name),
                langKey: getMainTabLangKey(table.dataset_name),
                iconKey: getDatasetTabIconKey(table),
                isProjectTable: true,
                dataset: table.dataset_name,
                route: '/api/get-results',
                hasPresentationMedia,
            };
        };

        const staticTabsWithoutUsers = staticTabsData.filter((t) => t.id !== 'system_users');

        // About is a site-level destination rather than project content. Keep it
        // at the bottom even when an older saved tab order tries to place it
        // among application datasets.
        const placeSystemAboutLast = (tabs) => {
            const aboutTab = tabs.find((tab) => tab.id === "system_about");
            if (!aboutTab) return tabs;
            return [
                ...tabs.filter((tab) => tab.id !== "system_about"),
                aboutTab,
            ];
        };

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
            if (systemUsers && systemUsers !== mainTable) orderedTabs.push(buildTabObj(systemUsers));
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

                return result(placeSystemAboutLast(sortedTabs));
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

            return result(placeSystemAboutLast([
                ...sorted.map(buildTabObj),
                ...staticTabsWithoutUsers,
            ]));
        }

        // Fallback: original hardcoded ordering + static tabs in their default position
        return result(placeSystemAboutLast([
            ...getDefaultProjectTabs(),
            ...staticTabsWithoutUsers,
        ]));
    } catch (err) {
        console.warn("fetchProjectTabs error:", err);
        // Always return static tabs so the user can at least see login/logout/account
        return result(staticTabsData);
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


const EMPTY_TABS = Object.freeze([]);
let acceptedTabs = EMPTY_TABS;
let acceptedGeneration = null;
const subscribers = new Set();

function publish() {
    for (const subscriber of subscribers) subscriber(getMainDatasetTabs());
}

subscribeDatasetAccessRegistry(() => {
    acceptedTabs = EMPTY_TABS;
    acceptedGeneration = null;
    publish();
});

export function getMainDatasetTabs() {
    return isCurrentDatasetAccessRefresh(acceptedGeneration) ? acceptedTabs : EMPTY_TABS;
}

export function subscribeMainDatasetTabs(listener) {
    subscribers.add(listener);
    return () => subscribers.delete(listener);
}

/** Accept only the current metadata response and exactly the visible dataset tab order. */
export function acceptMainDatasetTabs(result, isLoggedIn) {
    if (!isCurrentDatasetAccessRefresh(result.generation)) return false;
    if (result.contentTablesResponse) {
        if (!primeDatasetAccessRegistry(result.contentTablesResponse, result.generation)) return false;
    }
    const readable = new Set((result.contentTablesResponse?.datasets || [])
        .filter(entry => entry.can_read_rows !== false).map(entry => entry.dataset_name));
    const seen = new Set();
    acceptedTabs = Object.freeze(result.tabs.filter(tab => {
        const dataset = tab.dataset || tab.id;
        if (!readable.has(dataset) || seen.has(dataset)) return false;
        if ((tab.userContent && !isLoggedIn) || (tab.nonUserContent && isLoggedIn)) return false;
        seen.add(dataset);
        return true;
    }).map(tab => Object.freeze({ ...tab, dataset: tab.dataset || tab.id })));
    acceptedGeneration = result.generation;
    publish();
    return true;
}
