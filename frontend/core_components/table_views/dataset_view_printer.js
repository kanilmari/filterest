// dataset_view_printer.js
// Renders dataset views across table, card, tree, and settings layouts.
// Bridges filter and search controls, view selection, and dataset rendering components.
// Exists to keep dataset screen assembly in one place while delegating each concrete view to its own module.

import { create_table_element, saveColumnWidths } from "./table_view/table_structure_builder.js";
import { create_card_view } from "./card_view/card_view_printer.js";
// import { applySavedColumnVisibility } from '../general_tables/gt_toolbar/column_visibility_dropdown.js';
import {
    initializeInfiniteScroll,
    seedInfiniteScrollRowCount,
} from "../infinite_scroll/infinite_scroll_handler.js";
import {
    create_filter_bar,
} from "../filterbar/filter_bar_builder.js";

import { setResultsCount } from "../../reusable_components/results_count/results_count_printer.js";
import { renderActiveFilters } from "../filterbar/filter_list/active_filter_tag_printer.js";
import { create_tree_view } from "./tree_view/tree_view_printer.js";
import { TableComponent } from "./table_component_builder.js";
import { applyViewStyling } from "./view_selector_printer.js";
import { create_settings_view } from "./settings_view/settings_view_printer.js";
import { create_product_card_view } from "./product_card_view/product_card_view_printer.js";
import { create_calendar_view } from "./calendar_view/calendar_view_printer.js";
import { create_map_view, dataset_supports_map_view } from "./map_view/map_view_printer.js";
import { create_price_chart_view } from "./price_chart_view/price_chart_view_printer.js";
import { create_cloud_management_view } from "./cloud_management_view/cloud_management_view_printer.js";
import { hasRoutePermission } from "../route_permission_checker.js";
import { getDefaultViewSync } from "../config_fetcher.js";
import { show_search_and_filter_button } from "../../ui_config.js";
import { getAllSpecs } from "../state_stores/table_specs_reader.js";
import {
    getDatasetViewContainerId,
    getDatasetViewDefinition,
    getDatasetViewPermissionRoute,
    getDatasetViewScrollDirection,
    isRenderableDatasetView,
    RENDERABLE_DATASET_VIEW_DEFINITIONS,
    resolveDatasetViewSelectionTarget,
} from "./dataset_view_registry.js";

function isFilterbarVisible(tableName) {
    // Check unified panel
    const panel = document.getElementById(`${tableName}_filterBar_panel`);
    if (panel) {
        return !panel.classList.contains("filterbar-panel--hidden");
    }
    // Fallback: check old-style filterbar
    const filterBar = document.getElementById(`${tableName}_filterBar`);
    return Boolean(filterBar) && !filterBar.classList.contains("hidden");
}

function syncFilterBarVisibilityState(tableName) {
    const isVisible = isFilterbarVisible(tableName);
    const menuButton = document.getElementById("showMenuButton");
    if (menuButton) {
        menuButton.classList.toggle("filterbar-overlap", !isVisible);
    }
    const searchButton = document.querySelector(
        `#${tableName}_card_top_controls .card_search_filter_button`
    );
    if (searchButton) {
        searchButton.classList.toggle("filterbar-visible", isVisible);
    }
}

function toggleDatasetSearchAndFilter(tableName) {
    const tableParts = document.getElementById(
        `${tableName}_tab_parts_container`
    );
    if (!tableParts) return;

    const unifiedToggle = tableParts.querySelector(".filterbar-fixed-toggle");
    if (unifiedToggle instanceof HTMLElement) {
        unifiedToggle.click();
        return;
    }

    const legacyFilterBar = document.getElementById(`${tableName}_filterBar`);
    const legacyShowButton = tableParts.querySelector(".show_filter_bar_button");
    const legacyHideButton = legacyFilterBar?.querySelector(
        ".hide_filter_bar_button"
    );

    if (!legacyFilterBar) return;

    const isHidden = legacyFilterBar.classList.contains("hidden");
    if (isHidden && legacyShowButton instanceof HTMLElement) {
        legacyShowButton.click();
        return;
    }

    if (!isHidden && legacyHideButton instanceof HTMLElement) {
        legacyHideButton.click();
    }
}

const DATASET_VIEW_RENDERERS = {
    table: {
        create: (table_name, columns, data, data_types) => {
            const tableElement = create_table_element(
                columns,
                data,
                table_name,
                data_types
            );
            // applySavedColumnVisibility(tableElement);
            return tableElement;
        },
    },
    card: {
        create: async (table_name, columns, data) => {
            //   console.log('view_dataset.js: card create kutsuu create_card_view');
            return await create_card_view(columns, data, table_name);
            // Note: create_card_view does not (yet) accept a data_types argument;
            // it reads data types from localStorage.
        },
    },
    product_card: {
        create: (table_name, columns, data, data_types) => {
            return create_product_card_view(table_name, columns, data, data_types);
        },
    },
    calendar: {
        create: (table_name, columns, data, data_types) => {
            return create_calendar_view(table_name, columns, data, data_types);
        },
    },
    map: {
        create: (table_name, columns, data, data_types) => {
            return create_map_view(table_name, columns, data, data_types);
        },
    },
    price_chart: {
        create: (table_name, columns, data, data_types) => {
            return create_price_chart_view(table_name, columns, data, data_types);
        },
    },
    tree: {
        create: async (table_name, columns, data, data_types) => {
            //   console.log('view_dataset.js: tree create kutsuu create_tree_view');
            return await create_tree_view(table_name, columns, data, data_types);
        },
    },
    normal: {
        create: (table_name, columns, data, data_types) => {
            const headers = columns.map((c) => ({ label: c, key: c }));
            const tableComp = new TableComponent({
                data,
                headers,
                table_name: table_name, // ★ passed to component
                initialView: "normal",
                dataTypes: data_types,
            });
            return tableComp.getElement();
        },
    },

    /* ---------- TRANSPOSED VIEW --------------------------------- */
    transposed: {
        create: (table_name, columns, data, data_types) => {
            const headers = columns.map((c) => ({ label: c, key: c }));
            const tableComp = new TableComponent({
                data,
                headers,
                table_name: table_name, // ★
                initialView: "transposed",
                dataTypes: data_types,
            });
            return tableComp.getElement();
        },
    },

    /* ---------- TICKET VIEW ------------------------------------- */
    ticket: {
        create: (table_name, columns, data, data_types) => {
            const headers = columns.map((c) => ({ label: c, key: c }));
            const tableComp = new TableComponent({
                data,
                headers,
                table_name: table_name, // ★
                initialView: "ticket",
                dataTypes: data_types,
            });
            return tableComp.getElement();
        },
    },

    /* ---------- SETTINGS-VIEW ----------------------------------- */
    settings: {
        create: (table_name, columns, data, data_types) => {
            return create_settings_view(table_name, columns, data, data_types);
        },
    },
    cloud_management: {
        create: (table_name, columns, data, data_types) => {
            return create_cloud_management_view(table_name, columns, data, data_types);
        },
    },
};

function createDatasetViewElement(viewDefinition, tableName, columns, data, dataTypes) {
    const renderer = DATASET_VIEW_RENDERERS[viewDefinition?.rendererKey];
    if (!renderer?.create) {
        console.warn(`Unknown view: ${viewDefinition?.viewKey}`);
        return null;
    }
    return renderer.create(tableName, columns, data, dataTypes);
}

function resolveFallbackViewForUnavailableView(datasetName, tableSpecs, globalDefault, unavailableView) {
    const defaultViewName = tableSpecs[datasetName]?.default_view_name;
    const fallbackCandidates = [defaultViewName, globalDefault, "card", "table"];
    const fallbackView = fallbackCandidates.find((candidate) => (
        candidate
        && candidate !== unavailableView
        && isRenderableDatasetView(candidate)
    ));
    return fallbackView || "card";
}

function resolvePermittedView(viewKey, globalDefault) {
    if (viewKey !== globalDefault) {
        const route = getDatasetViewPermissionRoute(viewKey);
        if (route && !hasRoutePermission(route)) {
            return globalDefault;
        }
    }
    return viewKey;
}

/**
 * Resolves the saved view while migrating dedicated cloud datasets to their DB default.
 *
 * @param {string} datasetName - Dataset currently being rendered.
 * @param {Object<string, object>} tableSpecs - Navigation metadata keyed by dataset.
 * @param {string} globalDefault - Global fallback view key.
 * @returns {string}
 */
function resolveStoredViewForDatasetDefault(datasetName, tableSpecs, globalDefault) {
    const defaultViewName = tableSpecs[datasetName]?.default_view_name;
    const viewStorageKey = `${datasetName}_view`;
    const defaultSeenStorageKey = `${datasetName}_default_view_seen`;
    const storedView = localStorage.getItem(viewStorageKey);
    const seenDefaultView = localStorage.getItem(defaultSeenStorageKey);

    if (defaultViewName === "cloud_management" && seenDefaultView !== defaultViewName) {
        localStorage.setItem(viewStorageKey, defaultViewName);
        localStorage.setItem(defaultSeenStorageKey, defaultViewName);
        return defaultViewName;
    }

    if (defaultViewName && !seenDefaultView) {
        localStorage.setItem(defaultSeenStorageKey, defaultViewName);
    }

    if (storedView) {
        return storedView;
    }

    const resolvedView = defaultViewName || globalDefault;
    localStorage.setItem(viewStorageKey, resolvedView);
    return resolvedView;
}

function resolveRenderableView(datasetName, currentView, columns, data, dataTypes, hasGeo, tableSpecs, globalDefault) {
    const selectedView = resolveDatasetViewSelectionTarget(currentView);
    const renderableView = isRenderableDatasetView(selectedView)
        ? selectedView
        : resolveFallbackViewForUnavailableView(datasetName, tableSpecs, globalDefault, currentView);

    if (
        renderableView === "map"
        && !dataset_supports_map_view(columns, data, dataTypes, hasGeo)
    ) {
        return resolveFallbackViewForUnavailableView(datasetName, tableSpecs, globalDefault, renderableView);
    }
    return renderableView;
}



function ensureContentArea(tabPartsContainer, tableName) {
    let contentArea = tabPartsContainer.querySelector(".tab-content-area");
    if (!contentArea) {
        contentArea = document.createElement("div");
        contentArea.classList.add("tab-content-area");
        contentArea.dataset.tableName = tableName;
        tabPartsContainer.insertBefore(contentArea, tabPartsContainer.firstChild);
    } else if (contentArea.parentElement !== tabPartsContainer) {
        tabPartsContainer.insertBefore(contentArea, tabPartsContainer.firstChild);
    }

    let contentBody = contentArea.querySelector(".tab-content-body");
    if (!contentBody) {
        contentBody = document.createElement("div");
        contentBody.classList.add("tab-content-body");
        contentArea.appendChild(contentBody);
    }

    return { contentArea, contentBody };
}







export async function generate_table(
    dataset_name,
    columns,
    data,
    data_types,
    rowCount = null,
    hasGeo = false,
    tableMeta = null
) {
    try {
        const tableSpecs = getAllSpecs();
        const datasetName = dataset_name;
        const table_uid = tableSpecs[dataset_name]?.table_uid || dataset_name;
        const globalDefault = getDefaultViewSync();
        let current_view = resolveStoredViewForDatasetDefault(
            datasetName,
            tableSpecs,
            globalDefault
        );
        current_view = resolvePermittedView(current_view, globalDefault);
        current_view = resolveRenderableView(
            datasetName,
            current_view,
            columns,
            data,
            data_types,
            hasGeo,
            tableSpecs,
            globalDefault
        );
        current_view = resolvePermittedView(current_view, globalDefault);
        localStorage.setItem(`${datasetName}_view`, current_view);

        applyViewStyling(dataset_name);

        const main_table_container_id = `${dataset_name}_container`;
        let main_table_container = document.getElementById(
            main_table_container_id
        );
        if (!main_table_container) {
            main_table_container = document.createElement("div");
            main_table_container.id = main_table_container_id;
            main_table_container.classList.add("content_div");
            document
                .getElementById("tabs_container")
                .appendChild(main_table_container);
        }

        let tab_parts_container = document.getElementById(
            `${dataset_name}_tab_parts_container`
        );
        if (!tab_parts_container) {
            tab_parts_container = document.createElement("div");
            tab_parts_container.id = `${dataset_name}_tab_parts_container`;
            tab_parts_container.classList.add("tab_parts_container");
            main_table_container.appendChild(tab_parts_container);

            /* --- Table layout grid ---
             * tab_parts_container uses a CSS grid where the content area
             * occupies the left column and the dataset-filter-panel (with
             * search bar) forms the right side. */
        }

        const { contentBody } = ensureContentArea(
            tab_parts_container,
            dataset_name
        );
        // contentArea.style.setProperty("--content-top-banner-height", "0px");

        // REMOVED: ensureContentTopBanner and renderContentTopBannerSearch
        // The filter bar (create_filter_bar) now handles the search UI exclusively.
        // const contentTopBanner = ensureContentTopBanner(
        //     contentArea,
        //     contentBody,
        //     dataset_name
        // );
        // renderContentTopBannerSearch(
        //     dataset_name,
        //     contentTopBanner,
        //     columns,
        //     data_types,
        //     rowCount,
        //     hasGeo,
        //     current_view
        // );

        tab_parts_container.setAttribute("data-view", current_view);
        localStorage.setItem(`${dataset_name}_columns`, JSON.stringify(columns));
        localStorage.setItem(
            `${dataset_name}_dataTypes`,
            JSON.stringify(data_types)
        );
        localStorage.setItem(
            `${dataset_name}_tableMeta`,
            JSON.stringify(tableMeta || {
                card_details_layout: "conditional_multiline",
                card_style_variant: "standard",
            })
        );

        const viewContainers = {};
        for (const viewDefinition of RENDERABLE_DATASET_VIEW_DEFINITIONS) {
            const viewType = viewDefinition.viewKey;
            const containerId = getDatasetViewContainerId(viewType, dataset_name);
            let container = document.getElementById(containerId);
            if (!container) {
                container = document.createElement("div");
                container.id = containerId;
                container.classList.add("scrollable_content");
                contentBody.appendChild(container);
            } else if (container.parentElement !== contentBody) {
                contentBody.appendChild(container);
            }
            if (viewDefinition.contentPadding) {
                container.style.padding = viewDefinition.contentPadding;
            }
            viewContainers[viewType] = container;
        }

        // Save column widths before clearing, so the new table
        // starts with the same widths (prevents jarring layout shift)
        saveColumnWidths(dataset_name);

        for (const container of Object.values(viewContainers)) {
            container.replaceChildren();
        }

        let currentViewElement;
        let currentViewElementPromise = null;
        const currentViewDefinition = getDatasetViewDefinition(current_view);
        if (currentViewDefinition?.rendererKey) {
            currentViewElementPromise = Promise.resolve(createDatasetViewElement(
                currentViewDefinition,
                dataset_name,
                columns,
                data,
                data_types
            ));
        } else {
            console.warn(`Unknown view: ${current_view}`);
        }

        for (const viewType in viewContainers) {
            if (viewType !== current_view) {
                viewContainers[viewType].style.display = "none";
            }
        }

        // REMOVED: bindContentTopBanner
        // const refreshTopBanner = bindContentTopBanner(
        //     dataset_name,
        //     tab_parts_container,
        //     contentArea,
        //     contentTopBanner
        // );

        create_filter_bar(
            dataset_name,
            table_uid,
            columns,
            data_types,
            rowCount,
            hasGeo,
            current_view
        );
        if (currentViewElementPromise) {
            currentViewElement = await currentViewElementPromise;
            viewContainers[current_view].appendChild(currentViewElement);
            viewContainers[current_view].style.display = "block";
        }
        // syncDatasetSearchVisibility(dataset_name); // REMOVED: No longer needed as we have a single filter bar
        // Place topControls inside the scrollable_content container,
        // right after the hero and before the actual view element.
        // This ensures active filter tags (and results count) appear
        // between the hero bar and the table/card headers — not inside them.
        const scrollableContainer = viewContainers[current_view];

        let topControls = document.getElementById(
            `${dataset_name}_card_top_controls`
        );
        if (!topControls) {
            topControls = document.createElement("div");
            topControls.id = `${dataset_name}_card_top_controls`;
            topControls.classList.add("card_top_controls");
        }
        // Always ensure it's at the right position: after hero, before view element
        scrollableContainer.insertBefore(topControls, currentViewElement);

        let searchButton = topControls.querySelector(
            ".card_search_filter_button"
        );
        if (show_search_and_filter_button) {
            if (!searchButton) {
                searchButton = document.createElement("button");
                searchButton.type = "button";
                searchButton.classList.add("card_search_filter_button");
                // searchButton.dataset.langKey = `search_&_filter_${dataset_name}`;
                searchButton.dataset.langKey = `search_&_filter`;
                searchButton.textContent = "Search and filter";
                searchButton.addEventListener("click", () => {
                    toggleDatasetSearchAndFilter(dataset_name);
                });
                topControls.appendChild(searchButton);
            }
        } else if (searchButton) {
            searchButton.remove();
            searchButton = null;
        }

        // Results count is now rendered inside the filterbar (create_filter_bar.js)
        setResultsCount(dataset_name, rowCount);
        seedInfiniteScrollRowCount(dataset_name, rowCount);
        renderActiveFilters(dataset_name);
        syncFilterBarVisibilityState(dataset_name);
        initializeInfiniteScroll(
            dataset_name,
            getDatasetViewScrollDirection(current_view)
        );

        // refreshTopBanner();

        // Return the active view container
        return viewContainers[current_view];
    } catch (error) {
        console.warn(`Error creating table ${dataset_name}:`, error);
    }
}
