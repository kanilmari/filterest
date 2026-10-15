// dataset_view_printer.js
// Renders dataset views across table, card, tree, and settings layouts.
// Bridges filter and search controls, view selection, and dataset rendering components.
// Exists to keep dataset screen assembly in one place while delegating each concrete view to its own module.

import { requireArticleViewAccess } from './card_view/article_view_access.js';
import { createDatasetViewElement } from './dataset_view_renderer.js';
import { datasetAppearanceState } from './dataset_appearance_state.js';
import { appendLoadedDatasetRows, clearLoadedDatasetRows, rememberLoadedDatasetRows } from "./dataset_loaded_rows.js";
import { encodeCssUrlValue, resolveDatasetMediaDisplayPath } from "./storage_media_urls.js";
import { resolveVisibleDatasetMediaPath } from "./dataset_media_visibility_resolver.js";

import { shouldPreserveCardReturnHost } from "../navigation/nav_engine/card_article_return_state.js";
import { saveColumnWidths } from "./table_view/table_structure_builder.js";
import { disposeCardResources, notifyCardsMounted } from './card_view/card_resource_lifecycle.js';
import { showDatasetResultBuildFailure } from './dataset_result_build_failure.js';
// import { applySavedColumnVisibility } from '../general_tables/gt_toolbar/column_visibility_dropdown.js';
import {
    initializeInfiniteScroll,
    seedInfiniteScrollRowCount,
    disconnectInfiniteScroll,
} from "../infinite_scroll/infinite_scroll_handler.js";
import {
    create_filter_bar,
} from "../filterbar/filter_bar_builder.js";

import { setResultsCount } from "../../reusable_components/results_count/results_count_printer.js";
import { renderActiveFilters } from "../filterbar/filter_list/active_filter_tag_printer.js";
import { renderRowGroupFacets } from "../filterbar/filter_list/row_group_facet_printer.js";
import { applyViewStyling } from "./view_selector_printer.js";
import { dataset_supports_map_view } from "./map_view/map_view_printer.js";
import { hasRoutePermission } from "../route_permission_checker.js";
import { getDefaultViewSync } from "../config_fetcher.js";
import { resolveDatasetDefaultView } from "./dataset_default_view.js";
import { show_search_and_filter_button } from "../../ui_config.js";
import { getAllSpecs } from "../state_stores/table_specs_reader.js";
import { getChosenDatasetView, setChosenDatasetView } from "../state_stores/dataset_view_choice_saver.js";
import {
    getDatasetViewContainerId,
    getDatasetViewDefinition,
    getDatasetViewPermissionRoute,
    getDatasetViewScrollDirection,
    isRenderableDatasetView,
    RENDERABLE_DATASET_VIEW_DEFINITIONS,
    resolveDatasetViewSelectionTarget,
} from "./dataset_view_registry.js";
import { datasetSupportsTreeView } from "./dataset_tree_availability_checker.js";
import { datasetSupportsChartView } from "./price_chart_view/price_chart_data_reader.js";
import { createChartUnavailableNotice } from "./price_chart_view/chart_unavailable_notice.js";

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

function resolveFallbackViewForUnavailableView(datasetName, tableSpecs, globalDefault, unavailableView, columns, dataTypes) {
    const defaultViewName = tableSpecs[datasetName]?.default_view_name;
    const fallbackCandidates = [defaultViewName, globalDefault, "card", "table",
        ...(unavailableView === "price_chart" ? ["normal", "transposed", "article_view", "product_card"] : [])];
    const fallbackView = fallbackCandidates.find((candidate) => (
        candidate
        && candidate !== unavailableView
        && isRenderableDatasetView(candidate)
        && (candidate !== "price_chart" || datasetSupportsChartView(columns, dataTypes))
        && (candidate !== "tree" || datasetSupportsTreeView(datasetName, columns, dataTypes))
        && (!getDatasetViewPermissionRoute(candidate) || hasRoutePermission(getDatasetViewPermissionRoute(candidate)))
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
 * Resolves the view to draw: the one this tab chose earlier in this visit,
 * otherwise the dataset's default. A fresh page has no chosen view, because
 * page load forgets the views of earlier visits (load_tables in
 * table_loader_handler.js), so the dataset default always wins there --
 * including a cloud-management default, which once needed its own migration
 * here. Another tab's choice is never read: each tab keeps its own.
 *
 * @param {string} datasetName - Dataset currently being rendered.
 * @param {string} datasetDefault - The dataset's renderable default view.
 * @returns {string}
 */
function resolveStoredViewForDatasetDefault(datasetName, datasetDefault) {
    return getChosenDatasetView(datasetName) || datasetDefault;
}

function resolveRenderableView(datasetName, currentView, columns, data, dataTypes, hasGeo, tableSpecs, globalDefault) {
    const selectedView = resolveDatasetViewSelectionTarget(currentView);
    const renderableView = isRenderableDatasetView(selectedView)
        ? selectedView
        : resolveFallbackViewForUnavailableView(datasetName, tableSpecs, globalDefault, currentView, columns, dataTypes);

    if (renderableView === "price_chart" && !datasetSupportsChartView(columns, dataTypes)) {
        return resolveFallbackViewForUnavailableView(datasetName, tableSpecs, globalDefault, renderableView, columns, dataTypes);
    }

    if (
        renderableView === "map"
        && !dataset_supports_map_view(columns, data, dataTypes, hasGeo)
    ) {
        return resolveFallbackViewForUnavailableView(datasetName, tableSpecs, globalDefault, renderableView, columns, dataTypes);
    }
    if (
        renderableView === "tree"
        && !datasetSupportsTreeView(datasetName, columns, dataTypes)
    ) {
        return resolveFallbackViewForUnavailableView(datasetName, tableSpecs, globalDefault, renderableView, columns, dataTypes);
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
    contentArea.dataset.tableName = tableName;

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
    tableMeta = null,
    datasetPresentation = null,
    rowGroupFacets = null,
    { preserveCardReturn = null, loadedRows = null, rowGroupFacetContext = {},
        datasetAppearance = null, appearanceToken = null, isCurrent = () => true,
        chartRequested = false, effectiveSort = null } = {}
) {
    const token = appearanceToken || loadedRows?.appearanceToken || datasetAppearanceState.capture(dataset_name);
    const canCommit = () => isCurrent() && datasetAppearanceState.isCurrent(token);
    if (!canCommit()) return null;
    // Retained rows carry old projections; the UID owner's current snapshot wins.
    if (!loadedRows && datasetAppearance != null
        && !datasetAppearanceState.accept(dataset_name, datasetAppearance, { token, isCurrent: canCommit })) return null;
    let pendingView = null;
    let pendingBuild = null;
    let replacementContainer = null;
    try {
        const tableSpecs = getAllSpecs();
        // Read metadata belongs to every dataset reader. The admin navigation
        // tree may not exist or may still be loading on a fresh browser.
        if (tableMeta && Object.hasOwn(tableMeta, "default_view_name")) {
            tableSpecs[dataset_name] = {
                ...tableSpecs[dataset_name],
                default_view_name: tableMeta.default_view_name,
            };
        }
        const datasetName = dataset_name;
        const table_uid = datasetAppearance?.dataset_uid || tableSpecs[dataset_name]?.table_uid || dataset_name;
        const globalDefault = getDefaultViewSync();
        const datasetDefault = resolveDatasetDefaultView(datasetName, { tableMeta, tableSpecs, globalDefault });
        let defaultView = resolveRenderableView(
            datasetName, datasetDefault, columns, data, data_types, hasGeo, tableSpecs, globalDefault
        );
        if (defaultView === 'article_view' && !hasRoutePermission('/ui/view/article_view')) {
            defaultView = resolveFallbackViewForUnavailableView(datasetName, tableSpecs, globalDefault, 'article_view', columns, data_types);
        }
        let current_view = resolveStoredViewForDatasetDefault(datasetName, defaultView);
        if (current_view === 'article_view' && !requireArticleViewAccess()) {
            current_view = defaultView;
        }
        // A fallback projection refetch keeps the original request only for
        // this explanation. Permission denial is never a dataset-fit failure.
        const chartUnavailable = (chartRequested || resolveDatasetViewSelectionTarget(current_view) === "price_chart")
            && hasRoutePermission(getDatasetViewPermissionRoute("price_chart"))
            && !datasetSupportsChartView(columns, data_types);
        current_view = resolvePermittedView(current_view, defaultView);
        current_view = resolveRenderableView(
            datasetName,
            current_view,
            columns,
            data,
            data_types,
            hasGeo,
            tableSpecs,
            defaultView
        );
        current_view = resolvePermittedView(current_view, defaultView);
        setChosenDatasetView(datasetName, current_view);

        applyViewStyling(dataset_name);

        const main_table_container_id = `${dataset_name}_container`;
        let main_table_container = document.getElementById(
            main_table_container_id
        );
        // A reused name starts a new surface; the old node's UID cannot change.
        if (main_table_container?.dataset.datasetAppearanceUid
            && main_table_container.dataset.datasetAppearanceUid !== String(table_uid)) {
            disposeCardResources(main_table_container);
            main_table_container.remove();
            main_table_container = null;
        }
        if (!main_table_container) {
            main_table_container = document.createElement("div");
            main_table_container.id = main_table_container_id;
            main_table_container.classList.add("content_div");
            document
                .getElementById("tabs_container")
                .appendChild(main_table_container);
        }

        datasetAppearanceState.bind(main_table_container, dataset_name, Number.isInteger(Number(table_uid)) ? table_uid : null);

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

        const { contentArea, contentBody } = ensureContentArea(
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

        localStorage.setItem(`${dataset_name}_columns`, JSON.stringify(columns));
        localStorage.setItem(
            `${dataset_name}_dataTypes`,
            JSON.stringify(data_types)
        );
        localStorage.setItem(
            `${dataset_name}_tableMeta`,
            JSON.stringify(tableMeta || {
                card_details_layout: "conditional_multiline",
                card_style_variant: null,
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

        // Retain the shared controls through a full redraw. The category printer
        // owns its disclosure/query state on this host, including during search.
        const retainedTopControls = document.getElementById(`${dataset_name}_card_top_controls`);

        let currentViewElement;
        let currentViewElementPromise = null;
        const currentViewDefinition = getDatasetViewDefinition(current_view);
        replacementContainer = viewContainers[current_view];
        if (currentViewDefinition?.rendererKey) {
            currentViewElementPromise = Promise.resolve(createDatasetViewElement(
                currentViewDefinition,
                dataset_name,
                columns,
                data,
                data_types,
                { isCurrent: canCommit, ...(effectiveSort ? { effectiveSort } : {}) }
            ));
            pendingBuild = currentViewElementPromise;
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

        const filterBar = create_filter_bar(
            dataset_name,
            table_uid,
            columns,
            data_types,
            rowCount,
            hasGeo,
            current_view
        );
		const scrollableContainer = viewContainers[current_view];
        replacementContainer = scrollableContainer;
		const resultsSurface = document.createElement("div");
		resultsSurface.classList.add("dataset-results-surface");
		const datasetSpec = getAllSpecs()[dataset_name] || {};
		const authoritativeBackgroundPath = datasetPresentation?.background_image_path;
		const configuredBackgroundPath = typeof authoritativeBackgroundPath === "string"
			? authoritativeBackgroundPath
			: datasetSpec.dataset_background_image_path;
		// A response path (including an empty one) owns its visibility as well.
		const backgroundImageHidden = typeof authoritativeBackgroundPath === "string"
			? datasetPresentation.background_image_hidden
			: datasetSpec.dataset_background_image_hidden;
		const backgroundImagePath = resolveVisibleDatasetMediaPath(
			configuredBackgroundPath, backgroundImageHidden);
		contentArea.classList.toggle(
			"tab-content-area--has-dataset-background",
			Boolean(backgroundImagePath)
		);
		if (backgroundImagePath) {
			contentArea.style.setProperty(
				"--dataset-background-image",
				encodeCssUrlValue(resolveDatasetMediaDisplayPath(backgroundImagePath))
			);
		} else {
			contentArea.style.removeProperty("--dataset-background-image");
		}
        if (currentViewElementPromise) {
            currentViewElement = await currentViewElementPromise;
            pendingBuild = null;
            pendingView = currentViewElement;
            if (!canCommit()) return null;
            datasetAppearanceState.paint(dataset_name);
            if (chartUnavailable) resultsSurface.appendChild(
                createChartUnavailableNotice(dataset_name, current_view, columns, data_types)
            );
            resultsSurface.appendChild(currentViewElement);
            viewContainers[current_view].style.display = "block";
        }
        // Card builders await metadata and per-row content. Keep the committed
        // listing (and its category controls) visible until the replacement is
        // complete and current, then swap once without an empty intermediate frame.
        if (!canCommit()) return null;
        const focusedTopControl = retainedTopControls?.contains(document.activeElement)
            ? document.activeElement : null;
        // A retained dataset tab/article return keeps its mounted host. A fresh
        // dataset or view surface starts at the origin; refreshing the same
        // surface keeps its viewport. Decide from the last populated commit,
        // not the chosen view of a pending (possibly abandoned) build.
        const startsNewSurface = tab_parts_container.dataset.view !== current_view
            || !scrollableContainer.querySelector(':scope > .dataset-results-surface');
        for (const container of Object.values(viewContainers)) {
            if (container === scrollableContainer || (current_view === "article_view"
                && shouldPreserveCardReturnHost(dataset_name, preserveCardReturn, container))) continue;
            clearLoadedDatasetRows(container);
            disposeCardResources(container);
            container.replaceChildren();
        }
        clearLoadedDatasetRows(scrollableContainer);
        disposeCardResources(scrollableContainer);
        scrollableContainer.replaceChildren(resultsSurface);
        tab_parts_container.setAttribute("data-view", current_view);
        pendingView = null;
        // syncDatasetSearchVisibility(dataset_name); // REMOVED: No longer needed as we have a single filter bar
        // Place topControls inside the scrollable_content container,
        // right after the hero and before the actual view element.
        // This ensures active filter tags (and results count) appear
        // between the hero bar and the table/card headers — not inside them.
        let topControls = retainedTopControls || document.getElementById(
            `${dataset_name}_card_top_controls`
        );
        if (!topControls) {
            topControls = document.createElement("div");
            topControls.id = `${dataset_name}_card_top_controls`;
            topControls.classList.add("card_top_controls");
        }
        // Always ensure it's at the right position: after hero, before view element
        resultsSurface.insertBefore(topControls, currentViewElement);
        notifyCardsMounted(resultsSurface);

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

        // Build count mirrors before filling them. The inline hero intentionally
        // has no primary count element, so filling first left the new mirror empty
        // until infinite scroll happened to update it later.
        // Categories precede the shared selected tags and their result count.
        renderRowGroupFacets(dataset_name, rowGroupFacets, rowGroupFacetContext);
        renderActiveFilters(dataset_name);
        setResultsCount(dataset_name, rowCount);
        datasetAppearanceState.paint(dataset_name);
        // The persistent filterbar owns the scrolling hero and sentinel. Restore
        // them now, rather than on its observer's next frame: a phone's fresh
        // load must reset the complete layout, not an interim hero-less surface.
        filterBar?.__syncActiveView?.();
        if (startsNewSurface) {
            // The single populated swap no longer collapses the old scroll range.
            scrollableContainer.scrollTop = 0;
            scrollableContainer.scrollLeft = 0;
        }
        if (focusedTopControl?.isConnected && document.activeElement === document.body) {
            focusedTopControl.focus({ preventScroll: true });
        }
        rememberLoadedDatasetRows(scrollableContainer, dataset_name, {
            data, columns, types: data_types, row_count: rowCount, has_geo: hasGeo,
            table_meta: tableMeta, dataset_presentation: datasetPresentation,
            effective_sort: effectiveSort,
            dataset_appearance: datasetAppearance,
            row_group_facets: rowGroupFacets,
        }, loadedRows?.projectionView || current_view, token);
        if (loadedRows) {
            appendLoadedDatasetRows(scrollableContainer, dataset_name, [], loadedRows.offset);
        }
        seedInfiniteScrollRowCount(dataset_name, rowCount);
        syncFilterBarVisibilityState(dataset_name);
        initializeInfiniteScroll(
            dataset_name,
            getDatasetViewScrollDirection(current_view)
        );

        // refreshTopBanner();

        // Return the active view container
        return viewContainers[current_view];
    } catch (error) {
        if (!canCommit()) return null;
        console.warn(`Error creating table ${dataset_name}:`, error);
        disconnectInfiniteScroll(dataset_name);
        showDatasetResultBuildFailure(dataset_name, replacementContainer, error);
        return null;
    } finally {
        if (pendingView) disposeCardResources(pendingView);
        // Assembly of another part of the view can fail while cards are still
        // awaiting metadata. The eventual detached result remains ours to release.
        if (pendingBuild) disposeCardResources(await pendingBuild.catch(() => null));
    }
}
