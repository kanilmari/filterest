// top_row_builder.js
// Builds the filter bar's top-row action controls for dataset views.
// Bridges add-row, sorting, permissions, and URL/filter state controls into one toolbar area.
// Exists to keep the filter bar's primary actions assembled consistently across datasets.

import { createAddRowButton } from "../../general_tables/gt_toolbar/toolbar_button_creator.js";
import { appendAdminFeatures } from "../../admin_tools/admin_button_builder.js";
import {
    datasetSearchLocationState,
    datasetSearchState,
} from "../text_search/create_text_search_panel.js";
import { createSortDropdown } from "./sort_dropdown_builder.js";
import { emitDatasetSortSelection } from "./sort_sync_state.js";
import {
    setUnifiedTableState,
    refreshTableUnified,
} from "../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js";
import {
    setParams,
    updateURL,
} from "../../navigation/nav_engine/query_params.js";
import { clearOpenedFilters } from "../filterbar_engine/filterbar_state_saver.js";
import { hasDatasetPermission } from "../../route_permission_checker.js";
import { buildFilterbarDisclosureSection } from "../filterbar_section_heading_builder.js";
import { show_filterbar_search_basic_controls_section } from "../../../ui_config.js";

export function clearAllFilters(tableName, filterBar) {
    setUnifiedTableState(tableName, {
        sort: { column: null, direction: null },
        filters: {},
        offset: 0,
    });
    clearOpenedFilters(tableName);
    datasetSearchState.set(tableName, "", "clear-all-filters");
    datasetSearchLocationState.set(tableName, false, "clear-all-filters");
    localStorage.removeItem(`int_search_draft_${tableName}`);
    localStorage.setItem(`int_search_use_location_${tableName}`, "false");
    setParams(tableName, {});
    updateURL(tableName, {});
    emitDatasetSortSelection(tableName, "");
    filterBar.querySelectorAll("input, select").forEach((el) => {
        if (el.type === "checkbox" || el.type === "radio") {
            el.checked = false;
        } else {
            el.value = "";
        }
    });
    refreshTableUnified(tableName, { skipUrlParams: true });
}

/* ===========================================================
 *  UI‑rakentajat pieninä funktioina
 * =========================================================*/

/**
 * Luo tai hakee table-kohtaisen pääcontainerin.
 */
export function ensureTableContainers(tableName) {
    let tablePartsContainer = document.getElementById(
        `${tableName}_tab_parts_container`
    );
    if (!tablePartsContainer) {
        tablePartsContainer = document.createElement("div");
        tablePartsContainer.id = `${tableName}_tab_parts_container`;
        document.body.appendChild(tablePartsContainer);
    }
    return tablePartsContainer;
}

/**
 * Luo top_row‑elementin, joka sisältää:
 *  1) peruskäyttäjän napit
 *  2) (valinnaisesti) admin-napit ja näkymävalitsimen
 */
export function buildTopRow(
    tableUID,
    tableName,
    currentView,
    columns,
    dataTypes,
    filterBar
) {
    const existing = document.getElementById(`${tableUID}_filterBar_top_row`);
    if (existing) return existing; // luotu jo aiemmin

    const topRow = document.createElement("div");
    topRow.id = `${tableUID}_filterBar_top_row`;
    topRow.classList.add("dataset-filter-top-grid");

    let sortDropdown = null;
    let sortSearchRow = null;
    if (show_filterbar_search_basic_controls_section) {
        /* ---------- Rivi 1: Sort by (left) + Reset search (right) ---------- */
        const sortSearchContent = document.createElement("div");
        sortSearchContent.classList.add("dataset-filter-primary-actions");
        sortSearchContent.classList.add("dataset-filter-primary-actions--query");
        sortSearchContent.classList.add("dataset-filter-row-spread");

        const resetSearchBtn = document.createElement("button");
        resetSearchBtn.classList.add("reset-search-button");
        resetSearchBtn.classList.add("fw-btn");
        resetSearchBtn.dataset.testid = "btn-reset-search";
        resetSearchBtn.dataset.langKey = "reset_search";
        resetSearchBtn.textContent = "Reset search";
        resetSearchBtn.addEventListener("click", () =>
            clearAllFilters(tableName, filterBar)
        );

        sortDropdown = createSortDropdown(tableName, columns, dataTypes);

        sortSearchContent.appendChild(sortDropdown);
        sortSearchContent.appendChild(resetSearchBtn);
        sortSearchRow = buildFilterbarDisclosureSection({
            iconPath: "/frontend/icons/general/dataset-search-icon.svg",
            iconClassName: "filterbar-section-heading-icon--search-controls",
            langKey: "search_and_basic_controls",
            fallbackText: "Haku ja perustoiminnot",
            contentElement: sortSearchContent,
            sectionClassNames: ["dataset-filter-query-section"],
            startOpen: false,
        });
        sortSearchRow.dataset.filterbarSectionKey = "search_controls";
        topRow.appendChild(sortSearchRow);
    }

    /* ---------- Rivi 2: Add + Delete + Manage table ---------- */
    const actionContent = document.createElement("div");
    actionContent.classList.add(
        "dataset-filter-primary-actions",
        "dataset-filter-primary-actions--tools"
    );
    const actionRow = buildFilterbarDisclosureSection({
        iconPath: "/frontend/icons/general/table-tools-icon.svg",
        iconClassName: "filterbar-section-heading-icon--tools",
        langKey: "tools",
        fallbackText: "Työkalut",
        contentElement: actionContent,
        sectionClassNames: ["dataset-filter-tools-section"],
        startOpen: false,
    });
    actionRow.dataset.filterbarSectionKey = "tools";

    const addBtn = createAddRowButton(tableUID, tableName);
    actionContent.appendChild(addBtn);

    const adminButtonsContainer = document.createElement("div");
    adminButtonsContainer.classList.add("dataset-filter-management-buttons");
    actionContent.appendChild(adminButtonsContainer);

    topRow.appendChild(actionRow);

    /* ---------- Rivi 3: Näkymävalitsin ---------- */
    const viewContent = document.createElement("div");
    viewContent.classList.add("dataset-filter-secondary-row");

    const viewSelectorContainer = document.createElement("div");
    viewContent.appendChild(viewSelectorContainer);
    const viewRow = buildFilterbarDisclosureSection({
        iconPath: "/frontend/icons/general/view-palette-icon.svg",
        iconClassName: "view-selector-heading-icon",
        langKey: "views_and_presentations",
        fallbackText: "Näkymät ja esitystavat",
        contentElement: viewContent,
        sectionClassNames: ["dataset-filter-views-section"],
        startOpen: false,
    });
    viewRow.dataset.filterbarSectionKey = "views";
    topRow.appendChild(viewRow);

    // Run permission checks and then hide empty rows
    Promise.all([
        hasDatasetPermission("/api/add-row-multipart", tableName).then(allowed => {
            if (!allowed) addBtn.remove();
        }),
        appendAdminFeatures(
            tableName,
            adminButtonsContainer,
            viewSelectorContainer,
            currentView
        ),
    ]).then(() => {
        // Hide actionRow if no visible interactive elements remain
        const actionChildren = actionContent.querySelectorAll("button, a, select, input");
        if (actionChildren.length === 0) actionRow.style.display = "none";

        // Hide viewRow if view selector has no content
        if (viewSelectorContainer.children.length === 0) {
            viewRow.style.display = "none";
        }
    });

    topRow.destroy = () => {
        sortDropdown?.destroy?.();
        sortSearchRow?.destroy?.();
        actionRow.destroy?.();
        viewRow.destroy?.();
    };

    return topRow;
}
