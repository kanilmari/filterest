// filterbar_content_builder.js
// Assembles shared search, tools and filter sections.
// Connects the shared dataset filterbar to its existing component builders.
// Keeps one implementation and a bounded lifetime for each mounted surface.

import { createDatasetSearchPanel, tableMetaCache } from "./text_search/create_text_search_panel.js";
import { createSortDropdown } from "./top_row_buttons/sort_dropdown_builder.js";
import { buildTopRow, clearAllFilters } from "./top_row_buttons/top_row_builder.js";
import { getAllSpecs } from "../state_stores/table_specs_reader.js";
import { setResultsCount } from "../../reusable_components/results_count/results_count_printer.js";
import { buildColumnViewPresetSelector } from "./filter_list/column_view_preset_builder.js";
import { build_favefox_style_filter_bar_from_columns } from "./filter_list/favefox_style_filters_container/accordion_filter_builder.js";
import { buildFilterbarDisclosureSection } from "./filterbar_section_heading_builder.js";
import { FAVEFOX_FILTER_LAYOUT_MODE, show_filterbar_search_overview_section } from "../../ui_config.js";
import { executeDatasetSurfaceFilterbarProvider } from "./dataset_surface_provider/filterbar_provider_executor.js";

export function buildTextSearchFilterSection(tableName, {
    placeholder = undefined,
    showLocationCheckbox = false,
    columns = [],
    dataTypes = {},
    allowPersistentDefault = true,
    sortOptions = {},
} = {}) {
    const row = document.createElement("div");
    row.classList.add("row-container", "filterbar-text-search-row");

    const searchPanel = createDatasetSearchPanel(tableName, {
        variant: "filter-stack",
        panelClasses: [
            "dataset-search-panel",
            "dataset-search-panel--filter-stack",
        ],
        placeholder,
        searchComponentOptions: {
            showLocationCheckbox,
        },
    });
    row.appendChild(searchPanel.element);

    const searchControls = document.createElement("div");
    searchControls.classList.add(
        "dataset-filter-primary-actions",
        "dataset-filter-primary-actions--query",
        "dataset-filter-row-spread",
        "filterbar-text-search-controls"
    );
    const sortDropdown = createSortDropdown(tableName, columns, dataTypes, { ...sortOptions, allowPersistentDefault });
    const resetSearchBtn = document.createElement("button");
    resetSearchBtn.classList.add("reset-search-button", "fw-btn");
    resetSearchBtn.dataset.testid = "btn-reset-search-filter-stack";
    resetSearchBtn.dataset.langKey = "reset_search";
    resetSearchBtn.textContent = "Reset search";
    resetSearchBtn.addEventListener("click", () => clearAllFilters(tableName, row));
    searchControls.append(sortDropdown, resetSearchBtn);
    row.appendChild(searchControls);

    return {
        key: "text_search",
        title: "Tekstihaku",
        content: row,
        destroy: () => {
            searchPanel.destroy?.();
            sortDropdown.destroy?.();
        },
    };
}

/**
 * Populate a filterbar content container with search, top-row, and filter controls.
 * Between dataset metadata, filter/search sub-builders, and the mounted filterbar shell.
 * Exists so the outer filterbar builder can reuse one assembly path for multiple panel modes.
 */
function buildStandardFilterbarContent(container, {
    tableName,
    tableUID,
    columns,
    dataTypes,
    rowCount,
    hasGeo,
    currentView,
    variant = "filterbar",
    includeOverviewSearch = show_filterbar_search_overview_section,
}) {
    const destroyCallbacks = [];
    const tableSpecs = getAllSpecs();
    const tableSpec = tableSpecs[tableName] || {};

    // Metadata from server
    // Note: fetchTableMeta is async and usually called before this or independently.
    // Here we just cache what we got.
    const meta = { rowCount, hasGeo };
    tableMetaCache[tableName] = meta;

    let searchPanel = null;
    if (includeOverviewSearch) {
        /* ---------- Search Panel ----------------------------------- */
        const searchPanelOptions = {
            variant,
            placeholder: tableSpec.search_placeholder || undefined,
        };

        searchPanel = createDatasetSearchPanel(tableName, searchPanelOptions);
        destroyCallbacks.push(() => searchPanel.destroy?.());

        /* ---------- Results Count (above search) ------------------- */
        let resultsCountEl = document.getElementById(`${tableName}_results_count`);
        if (!resultsCountEl) {
            resultsCountEl = document.createElement("div");
            resultsCountEl.id = `${tableName}_results_count`;
            resultsCountEl.classList.add("results_count");
        }
        resultsCountEl.classList.add("filterbar_results_count");
        container.appendChild(resultsCountEl);
        setResultsCount(tableName, rowCount);

        container.appendChild(searchPanel.element);
    }

    /* ---------- TopRow ---------------------------------------- */
    const topRow = buildTopRow(
        tableUID,
        tableName,
        currentView,
        columns,
        dataTypes,
        container
    );
    destroyCallbacks.push(() => topRow.destroy?.());
    container.appendChild(topRow);

    /* ---------- Filters ------------------------------------- */
    const hideFieldsOnCards =
        localStorage.getItem("hide_fields_on_cards") === "true";
    const showVisibilityToggle = !(currentView === "card" && hideFieldsOnCards);

    const visibleColumns = columns.filter(
        (col) =>
            !(
                dataTypes[col]?.hide_in_filter_panel ||
                dataTypes[col]?.hide_everywhere
            )
    );
    /* ---------- Column View Presets ----------------------------- */
    const columnPresetRow = buildColumnViewPresetSelector(tableName, visibleColumns, currentView);
    destroyCallbacks.push(() => columnPresetRow.destroy?.());
    container.appendChild(columnPresetRow);

    const textSearchFilterSection = buildTextSearchFilterSection(tableName, {
        placeholder: tableSpec.search_placeholder || undefined,
        showLocationCheckbox: hasGeo,
        columns,
        dataTypes,
    });
    destroyCallbacks.push(() => textSearchFilterSection.destroy?.());

    const secondaryFilterBar = build_favefox_style_filter_bar_from_columns(
        tableName,
        visibleColumns,
        dataTypes,
        showVisibilityToggle,
        {
            layoutMode: FAVEFOX_FILTER_LAYOUT_MODE,
            prependSections: [textSearchFilterSection],
        }
    );
    const secondaryFilterContent = document.createElement("div");
    while (secondaryFilterBar.firstChild) {
        secondaryFilterContent.appendChild(secondaryFilterBar.firstChild);
    }
    const filtersSection = buildFilterbarDisclosureSection({
        iconPath: "/frontend/icons/general/filter-list-icon.svg",
        iconClassName: "filterbar-section-heading-icon--filters",
        langKey: "filterbar_filter_results",
        fallbackText: "Filter results",
        contentElement: secondaryFilterContent,
        sectionElement: secondaryFilterBar,
        sectionClassNames: ["filterbar-filters-section"],
        contentClassNames: ["favefox-filterbar-disclosure-content"],
        startOpen: false,
    });
    secondaryFilterBar.dataset.filterbarSectionKey = "filters";
    container.appendChild(secondaryFilterBar);

    return {
        searchPanel,
        filtersSection,
        destroy() {
            destroyCallbacks.forEach((callback) => {
                try {
                    callback();
                } catch (err) {
                    console.warn("filter_bar_builder: destroy callback failed", err);
                }
            });
        },
    };
}

/**
 * Populate a filterbar through the explicitly selected dataset-surface provider.
 * Between server-owned surface capability metadata and the standard filterbar builder.
 * Exists so specialized providers can replace or reduce content without host-side view checks.
 */
export function createFilterBarContent(container, filterbarOptions) {
    return executeDatasetSurfaceFilterbarProvider({
        container,
        filterbarOptions,
        standardContentBuilder: buildStandardFilterbarContent,
    });
}

