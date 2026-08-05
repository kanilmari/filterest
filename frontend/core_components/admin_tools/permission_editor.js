// permission_editor.js
// Coordinates the admin permission editor UI and save workflow.
// Bridges permission data fetching, tree selection, and reusable checkbox-table rendering into one controller.
// Exists to keep permission-editor orchestration separate from permission persistence and shared table behavior.

import { loadManagementView } from "../../reusable_components/dom_container_builder.js";
import {
    fetch_all_functions,
    fetch_user_groups,
} from "./permission_checker.js";
import {
    savePermissionRowsForMultipleTables,
    savePermissionRowsTableless,
} from "./permission_granter.js";
import { endpoint_router } from "../endpoints/endpoint_router.js";
import { functionAccessMiddleware } from "../function_access_checker.js";
import {
    table_icon_svg,
    ui_icon_svg,
    global_icon_svg,
    edit_icon_svg,
    ensurePermissionIconsLoaded,
} from "./permission_icons.js";
import { showInfoToast, showSuccessToast } from "../../reusable_components/notifications/toast_notification_printer.js";
import { showConfirmModal } from "../../reusable_components/modal/confirm_modal_builder.js";
import { renderTableSelectorTree } from "../vanilla_tree/van_tr_components/admin_tree_builder.js";
import { extractSelectedTableNames } from "./tree_selection_helpers.js";
import { computeMultipleTableState } from "./permission_checker_helpers.js";
import { createVanillaCheckboxTable } from "../../reusable_components/vanilla_checkbox_table/vanilla_checkbox_table.js";

const SEARCH_KEY = "permissions_search_term";
const FILTER_ENDPOINT_KEY = "permissions_filter_endpoint";

export async function load_permissions() {
    return loadManagementView(
        "permissions_container",
        generate_permissions_form
    );
}

function formatFunctionName(functionName) {
    let cleanedName = functionName.replace(/Handler/g, "");
    cleanedName = cleanedName.replace(/([A-Z])/g, " $1");
    cleanedName = cleanedName.replace(/_/g, " ");
    cleanedName = cleanedName.replace(/\./, ": ");
    return cleanedName.charAt(0).toUpperCase() + cleanedName.slice(1);
}

function createSvgNode(svgString, wrapperClassName = "") {
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svgString, "image/svg+xml");
    const wrapper = document.createElement("span");
    if (wrapperClassName) {
        wrapper.classList.add(wrapperClassName);
    }
    wrapper.appendChild(svgDoc.documentElement);
    return wrapper;
}

function createPermissionIconNode(functionItem) {
    let svgString = global_icon_svg;
    if (functionItem.ui_only) {
        svgString = ui_icon_svg;
    } else if (functionItem.specific_table_related) {
        svgString = table_icon_svg;
    }
    return createSvgNode(svgString, "permission-type-icon");
}

function createFunctionInfoCell(row) {
    const wrapper = document.createElement("div");
    wrapper.classList.add("mp-function-info-cell");

    const iconNode = createPermissionIconNode({
        ui_only: row.uiOnly,
        specific_table_related: row.tableRelated,
    });
    wrapper.appendChild(iconNode);

    const textWrapper = document.createElement("div");
    textWrapper.classList.add("mp-function-info-text");

    const nameDiv = document.createElement("div");
    nameDiv.classList.add("mp-function-name");
    nameDiv.textContent = row.functionLabel;

    const routeDiv = document.createElement("div");
    routeDiv.classList.add("mp-function-route");
    routeDiv.textContent = row.route;

    textWrapper.appendChild(nameDiv);
    textWrapper.appendChild(routeDiv);
    wrapper.appendChild(textWrapper);

    return wrapper;
}

function buildGroupHeaderCell(columnLabel, { column, getRows, isEditMode, setColumnValues, canBulkEdit }) {
    const headerWrapper = document.createElement("div");
    headerWrapper.classList.add("mp-group-header-cell");

    const titleSpan = document.createElement("span");
    titleSpan.classList.add("mp-group-header-title");
    const parts = String(columnLabel).split(/([._-])/);
    parts.forEach((part) => {
        titleSpan.appendChild(document.createTextNode(part));
        if (/^[._-]$/.test(part)) {
            titleSpan.appendChild(document.createElement("wbr"));
        }
    });
    headerWrapper.appendChild(titleSpan);

    const bulkCheckbox = document.createElement("input");
    bulkCheckbox.type = "checkbox";
    bulkCheckbox.classList.add("mp-select-all");
    bulkCheckbox.style.display = isEditMode ? "" : "none";

    const draftRows = getRows({ draft: true });
    const editableRows = draftRows.filter((row, rowIndex) => canBulkEdit(row, rowIndex));
    const checkedCount = editableRows.filter((row) => row[column.key] === true || row[column.key] === "checked").length;

    if (editableRows.length === 0) {
        bulkCheckbox.disabled = true;
    } else if (checkedCount === editableRows.length) {
        bulkCheckbox.checked = true;
    } else if (checkedCount > 0) {
        bulkCheckbox.indeterminate = true;
    }

    bulkCheckbox.addEventListener("change", () => {
        bulkCheckbox.indeterminate = false;
        setColumnValues(column.key, bulkCheckbox.checked, {
            rowFilter: (row, rowIndex) => canBulkEdit(row, rowIndex),
        });
    });

    headerWrapper.appendChild(bulkCheckbox);
    return headerWrapper;
}

function buildPermissionRows(functions, userGroupList, permissionsData, {
    selectedTableNames,
    tableRelated,
}) {
    return functions
        .filter((functionItem) => functionItem.specific_table_related === tableRelated)
        .map((functionItem) => {
            const row = {
                functionId: functionItem.id,
                functionName: functionItem.name,
                functionLabel: formatFunctionName(functionItem.name),
                route: functionItem.url_route_endpoint,
                uiOnly: functionItem.ui_only,
                tableRelated: functionItem.specific_table_related,
                searchText: `${functionItem.name} ${functionItem.url_route_endpoint}`.toLowerCase(),
            };

            userGroupList.forEach((groupItem) => {
                const columnKey = `group_${groupItem.id}`;
                if (!tableRelated) {
                    row[columnKey] = permissionsData.some((permissionItem) =>
                        permissionItem.target_dataset_name === "" &&
                        permissionItem.function_id === functionItem.id &&
                        permissionItem.user_group_id === groupItem.id
                    );
                    return;
                }

                if (selectedTableNames.length === 0) {
                    row[columnKey] = false;
                } else if (selectedTableNames.length === 1) {
                    row[columnKey] = permissionsData.some((permissionItem) =>
                        permissionItem.target_dataset_name === selectedTableNames[0] &&
                        permissionItem.function_id === functionItem.id &&
                        permissionItem.user_group_id === groupItem.id
                    );
                } else {
                    row[columnKey] = computeMultipleTableState(
                        permissionsData,
                        selectedTableNames,
                        functionItem.id,
                        groupItem.id
                    );
                }
            });

            return row;
        });
}

function matchesRowFilters(row, { searchTerm, endpointFilter }) {
    const normalizedSearch = String(searchTerm || "").trim().toLowerCase();
    if (normalizedSearch && !row.searchText.includes(normalizedSearch)) {
        return false;
    }

    if (endpointFilter === "ui") {
        return row.uiOnly === true;
    }

    return row.uiOnly !== true;
}

function buildPermissionColumns(userGroupList, {
    tableRelated,
    selectedTableNames,
}) {
    const columns = [
        {
            key: "functionLabel",
            label: "Funktio / Ryhmä",
            type: "static",
            editable: false,
            width: "20rem",
            minWidth: "20rem",
            renderReadOnlyCell: ({ row }) => createFunctionInfoCell(row),
        },
    ];

    userGroupList.forEach((groupItem) => {
        const columnKey = `group_${groupItem.id}`;
        columns.push({
            key: columnKey,
            label: groupItem.name,
            type: "checkbox",
            width: "7rem",
            minWidth: "7rem",
            maxWidth: "7rem",
            renderHeaderCell: ({ column, getRows, isEditMode, setColumnValues, isDirty }) =>
                buildGroupHeaderCell(groupItem.name, {
                    column,
                    getRows,
                    isEditMode,
                    isDirty,
                    setColumnValues,
                    canBulkEdit: () => !tableRelated || selectedTableNames.length > 0,
                }),
            isCellDisabled: () => tableRelated && selectedTableNames.length === 0,
        });
    });

    return columns;
}

function createSection(title, descriptionText) {
    const section = document.createElement("section");
    section.classList.add("mp-table-section");

    const header = document.createElement("div");
    header.classList.add("mp-table-section-header");

    const titleElement = document.createElement("h3");
    titleElement.classList.add("mp-table-section-title");
    titleElement.textContent = title;

    const description = document.createElement("div");
    description.classList.add("mp-table-section-description");
    description.textContent = descriptionText;

    const content = document.createElement("div");
    content.classList.add("mp-table-section-content");

    header.appendChild(titleElement);
    header.appendChild(description);
    section.appendChild(header);
    section.appendChild(content);

    return { section, description, content };
}

export async function generate_permissions_form(permissions_container) {
    await ensurePermissionIconsLoaded();

    const [allFunctions, userGroupList] = await Promise.all([
        fetch_all_functions(),
        fetch_user_groups(),
    ]);

    const state = {
        searchTerm: localStorage.getItem(SEARCH_KEY) || "",
        endpointFilter: localStorage.getItem(FILTER_ENDPOINT_KEY) || "server",
        selectedTableNames: [],
        permissionsData: [],
        tablelessTable: null,
        scopedTable: null,
    };

    const listenerController = new AbortController();
    const listenerSignal = listenerController.signal;
    permissions_container.__cleanupListeners = () => {
        listenerController.abort();
        delete window.check_manage_permissions_dirty;
    };

    const root = document.createElement("div");
    root.classList.add("mp-manage-permissions-layout");

    const leftContainer = document.createElement("div");
    leftContainer.classList.add("mp-left-container");

    const treeContainer = document.createElement("div");
    treeContainer.classList.add("mp-table-selector-tree-container");
    const treeElement = document.createElement("div");
    treeElement.id = "table_selector_tree";
    treeContainer.appendChild(treeElement);
    leftContainer.appendChild(treeContainer);

    const searchContainer = document.createElement("div");
    searchContainer.classList.add("mp-search-container");

    const searchGroup = document.createElement("div");
    searchGroup.classList.add("mp-search-field-group");
    const searchLabel = document.createElement("label");
    searchLabel.textContent = "Hae funktioita:";
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.classList.add("mp-search-input");
    searchInput.value = state.searchTerm;
    searchGroup.appendChild(searchLabel);
    searchGroup.appendChild(searchInput);
    searchContainer.appendChild(searchGroup);

    const filterContainer = document.createElement("div");
    filterContainer.classList.add("mp-filter-checkboxes");

    const endpointGroup = document.createElement("div");
    endpointGroup.classList.add("mp-filter-section");
    const endpointTitle = document.createElement("div");
    endpointTitle.classList.add("mp-filter-section-title");
    endpointTitle.textContent = "Endpoint";
    endpointGroup.appendChild(endpointTitle);

    const serverCb = document.createElement("input");
    serverCb.type = "radio";
    serverCb.name = "permission_endpoint";
    serverCb.id = "endpoint_server";
    serverCb.checked = state.endpointFilter === "server";
    const serverLabel = document.createElement("label");
    serverLabel.textContent = "Server";
    serverLabel.htmlFor = "endpoint_server";

    const uiCb = document.createElement("input");
    uiCb.type = "radio";
    uiCb.name = "permission_endpoint";
    uiCb.id = "endpoint_ui";
    uiCb.checked = state.endpointFilter === "ui";
    const uiLabel = document.createElement("label");
    uiLabel.textContent = "UI";
    uiLabel.htmlFor = "endpoint_ui";

    endpointGroup.appendChild(serverCb);
    endpointGroup.appendChild(serverLabel);
    endpointGroup.appendChild(uiCb);
    endpointGroup.appendChild(uiLabel);
    filterContainer.appendChild(endpointGroup);
    searchContainer.appendChild(filterContainer);
    leftContainer.appendChild(searchContainer);

    const rightContainer = document.createElement("div");
    rightContainer.classList.add("mp-tables-column");

    const tablelessSection = createSection(
        "Yleiset oikeudet",
        "Table-independent permissions shared across the whole app."
    );
    const scopedSection = createSection(
        "Taulukohtaiset oikeudet",
        "Select one or more datasets from the tree to inspect table-specific permissions."
    );

    rightContainer.appendChild(scopedSection.section);
    rightContainer.appendChild(tablelessSection.section);

    root.appendChild(leftContainer);
    root.appendChild(rightContainer);
    permissions_container.appendChild(root);

    renderTableSelectorTree();

    async function refreshPermissionsData() {
        state.permissionsData = await endpoint_router("datasetPermissions");
    }

    function getTablelessRows() {
        return buildPermissionRows(allFunctions, userGroupList, state.permissionsData, {
            selectedTableNames: state.selectedTableNames,
            tableRelated: false,
        }).filter((row) => matchesRowFilters(row, state));
    }

    function getScopedRows() {
        return buildPermissionRows(allFunctions, userGroupList, state.permissionsData, {
            selectedTableNames: state.selectedTableNames,
            tableRelated: true,
        }).filter((row) => matchesRowFilters(row, state));
    }

    function getScopedStorageKey() {
        const scopeKey = state.selectedTableNames.length > 0
            ? state.selectedTableNames.slice().sort().join("__")
            : "none";
        return `permissions_table_scoped_${scopeKey}`;
    }

    async function syncTables({ recreateScoped = false } = {}) {
        const tablelessRows = getTablelessRows();
        const scopedRows = getScopedRows();

        if (!state.tablelessTable) {
            state.tablelessTable = createVanillaCheckboxTable({
                containerElement: tablelessSection.content,
                columns: buildPermissionColumns(userGroupList, {
                    tableRelated: false,
                    selectedTableNames: state.selectedTableNames,
                }),
                rows: tablelessRows,
                rowIdKey: "functionId",
                storageKey: "permissions_tableless",
                cleanLabel: "",
                showCellEditButtonOnHover: true,
                renderCellEditButton: () => createSvgNode(edit_icon_svg),
                onSave: async ({ changedCells }) => {
                    const response = await savePermissionRowsTableless({
                        changedCells,
                        existingPermissions: state.permissionsData,
                        functionAccessMiddleware,
                        endpoint_router,
                    });
                    await refreshPermissionsData();
                    showSuccessToast(response?.message || "Oikeudet tallennettu");
                },
                rowClassName: (row) => row.uiOnly ? "mp-ui-permission-row" : "mp-server-permission-row",
            });
        } else {
            state.tablelessTable.setColumns(buildPermissionColumns(userGroupList, {
                tableRelated: false,
                selectedTableNames: state.selectedTableNames,
            }));
            state.tablelessTable.setRows(tablelessRows);
        }

        scopedSection.description.textContent = state.selectedTableNames.length > 0
            ? `Selected datasets: ${state.selectedTableNames.join(", ")}`
            : "Select one or more datasets from the tree to inspect table-specific permissions.";

        if (!state.scopedTable || recreateScoped) {
            if (state.scopedTable) {
                state.scopedTable.destroy();
            }
            state.scopedTable = createVanillaCheckboxTable({
                containerElement: scopedSection.content,
                columns: buildPermissionColumns(userGroupList, {
                    tableRelated: true,
                    selectedTableNames: state.selectedTableNames,
                }),
                rows: scopedRows,
                rowIdKey: "functionId",
                storageKey: getScopedStorageKey(),
                cleanLabel: "",
                showCellEditButtonOnHover: true,
                renderCellEditButton: () => createSvgNode(edit_icon_svg),
                onSave: async ({ changedCells }) => {
                    if (state.selectedTableNames.length === 0) {
                        showInfoToast("Valitse ensin yksi tai useampi taulu");
                        return;
                    }
                    const response = await savePermissionRowsForMultipleTables({
                        changedCells,
                        targetTableNames: state.selectedTableNames,
                        functionAccessMiddleware,
                        endpoint_router,
                    });
                    await refreshPermissionsData();
                    showSuccessToast(response?.message || "Oikeudet tallennettu");
                },
                rowClassName: (row) => row.uiOnly ? "mp-ui-permission-row" : "mp-server-permission-row",
            });
            return;
        }

        state.scopedTable.setColumns(buildPermissionColumns(userGroupList, {
            tableRelated: true,
            selectedTableNames: state.selectedTableNames,
        }));
        state.scopedTable.setRows(scopedRows);
    }

    function getDirtyTables() {
        return [state.tablelessTable, state.scopedTable].filter(
            (tableInstance) => tableInstance && tableInstance.isDirty()
        );
    }

    async function handleUnsavedChanges() {
        const dirtyTables = getDirtyTables();
        if (dirtyTables.length === 0) {
            return true;
        }

        const shouldSave = await showConfirmModal({
            messagePlainText: "Tallennetaanko muutetut oikeudet?",
            messageLangKey: "confirm_save_permissions",
        });

        if (shouldSave) {
            for (const tableInstance of dirtyTables) {
                await tableInstance.saveChanges();
            }
            return true;
        }

        dirtyTables.forEach((tableInstance) => tableInstance.cancelChanges());
        return true;
    }

    async function applySearchAndFilterChanges(nextValues) {
        const isChanging =
            nextValues.searchTerm !== state.searchTerm ||
            nextValues.endpointFilter !== state.endpointFilter;
        if (!isChanging) {
            return;
        }
        await handleUnsavedChanges();
        state.searchTerm = nextValues.searchTerm;
        state.endpointFilter = nextValues.endpointFilter;
        localStorage.setItem(SEARCH_KEY, state.searchTerm);
        localStorage.setItem(FILTER_ENDPOINT_KEY, state.endpointFilter);
        await syncTables();
    }

    searchInput.addEventListener("input", async () => {
        await applySearchAndFilterChanges({
            searchTerm: searchInput.value,
            endpointFilter: state.endpointFilter,
        });
    });
    serverCb.addEventListener("change", async () => {
        if (!serverCb.checked) return;
        await applySearchAndFilterChanges({
            searchTerm: state.searchTerm,
            endpointFilter: "server",
        });
    });
    uiCb.addEventListener("change", async () => {
        if (!uiCb.checked) return;
        await applySearchAndFilterChanges({
            searchTerm: state.searchTerm,
            endpointFilter: "ui",
        });
    });

    document.addEventListener("checkboxSelectionChanged", async (event) => {
        const selectedCategories = event.detail.selectedCategories;
        const nextSelectedTableNames = extractSelectedTableNames(selectedCategories);
        const currentKey = state.selectedTableNames.slice().sort().join("|");
        const nextKey = nextSelectedTableNames.slice().sort().join("|");
        if (currentKey === nextKey) {
            return;
        }
        await handleUnsavedChanges();
        state.selectedTableNames = nextSelectedTableNames;
        await syncTables({ recreateScoped: true });
    }, { signal: listenerSignal });

    window.check_manage_permissions_dirty = handleUnsavedChanges;
    window.addEventListener("beforeunload", (event) => {
        if (getDirtyTables().length > 0) {
            event.preventDefault();
            event.returnValue = "";
        }
    }, { signal: listenerSignal });

    await refreshPermissionsData();
    await syncTables({ recreateScoped: true });
}
