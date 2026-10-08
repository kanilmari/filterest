// filter_column_builder.js
// Renders dataset filter and sort controls and keeps them in sync with unified table state and URL params.
// Bridges filter inputs and table refresh logic so filters stay consistent in all views.
// Exists to isolate filter and sort rendering logic while keeping streamed search results aligned with active constraints.

import { setColumnVisibility, getHiddenColumns, applyColumnVisibility } from "./column_visibility_handler.js";
import { getUnifiedTableState, setUnifiedTableState, refreshTableUnified } from "../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js";
import { resetOffset } from "../../infinite_scroll/infinite_scroll_handler.js";
import { create_collapsible_section } from "../../../reusable_components/collapsible_section/collapsible_section_builder.js";
import { getParams, setParams, updateURL } from "../../navigation/nav_engine/query_params.js";
import { always_show_column_sort_buttons } from "../../../ui_config.js";
import {
    ongoingSearchResults,
    rerenderCachedSearchResults,
} from "../text_search/create_text_search_panel.js";
import { renderActiveFilters } from "./active_filter_tag_printer.js";
import { getTranslationForKey } from "../../lang/translation_handler.js";
import {
    determineColumnCategory,
    buildTestIdSegment,
    categorizeColumns,
    orderFilterColumns,
    shouldHideRedundantGeneratedForeignDisplayColumn,
} from "./filter_column_builder_helpers.js";
import {
    FILTER_DISPLAY_MODES, FILTER_DISPLAY_MODE_PRESENTATION, getColumnFilterBaseId,
    setActiveFilterDisplayMode, resolveFilterDisplayModes, setSavedFilterDisplayMode,
    createColumnFilterInput, mapForeignFilterOptions,
} from "./filter_column_input_builder.js";

const IS_DEV_MODE = document.querySelector('meta[name="app-env"]')?.content === 'dev';
/**
 * Build the shared show/hide checkbox used by filter rows.
 *
 * @param {string} tableName
 * @param {string} column
 * @param {string} safeTableName
 * @param {string} safeColumnName
 * @returns {HTMLInputElement}
 */
function createColumnVisibilityToggle(tableName, column, safeTableName, safeColumnName) {
    const visibilityToggle = document.createElement("input");
    visibilityToggle.type = "checkbox";
    visibilityToggle.classList.add("column-visibility-toggle");
    visibilityToggle.dataset.testid = `column-visibility-toggle-${safeTableName}-${safeColumnName}`;
    visibilityToggle.title =
        getTranslationForKey("show_hide_column") || "Näytä/piilota sarake";
    visibilityToggle.checked = !getHiddenColumns(tableName)[column];
    visibilityToggle.addEventListener("change", (event) => {
        setColumnVisibility(tableName, column, event.target.checked);
        applyColumnVisibility(tableName);
    });
    return visibilityToggle;
}

/**
 * Build the shared sort button used by legacy and favefox filter rows.
 *
 * @param {string} tableName
 * @param {string} column
 * @returns {HTMLButtonElement}
 */
function createSortButton(tableName, column) {
    const sortButton = document.createElement("button");
    sortButton.classList.add("sort_button", "fw-btn");
    sortButton.setAttribute("data-sort-state", "none");
    sortButton.textContent = "\u21C5";

    if (!always_show_column_sort_buttons) {
        sortButton.classList.add("sort_button_fade_until_hover");
    }

    const currentState = getUnifiedTableState(tableName);
    if (currentState.sort?.column === column && currentState.sort?.direction) {
        const isAsc = currentState.sort.direction.toLowerCase() === "asc";
        sortButton.setAttribute("data-sort-state", isAsc ? "asc" : "desc");
        sortButton.textContent = isAsc ? "\u25B2" : "\u25BC";
    }

    sortButton.addEventListener("click", () => {
        const root =
            sortButton.closest(".favefox-filterbar") ||
            sortButton.closest(".combined-filter-sort-container") ||
            document;
        root.querySelectorAll("button[data-sort-state]").forEach((button) => {
            if (button !== sortButton) {
                button.setAttribute("data-sort-state", "none");
                button.textContent = "\u21C5";
            }
        });

        const currentSortState = sortButton.getAttribute("data-sort-state");
        const nextSortState =
            currentSortState === "none"
                ? "asc"
                : currentSortState === "asc"
                ? "desc"
                : "none";
        sortButton.setAttribute("data-sort-state", nextSortState);
        sortButton.textContent =
            nextSortState === "asc"
                ? "\u25B2"
                : nextSortState === "desc"
                ? "\u25BC"
                : "\u21C5";

        const state = getUnifiedTableState(tableName);
        if (!state.sort) state.sort = { column: null, direction: null };

        if (nextSortState === "none") {
            state.sort.column = null;
            state.sort.direction = null;
        } else {
            state.sort.column = column;
            state.sort.direction = nextSortState === "asc" ? "ASC" : "DESC";
        }

        setUnifiedTableState(tableName, state);
        refreshTableUnified(tableName, { skipUrlParams: true });
    });

    return sortButton;
}

function createFilterDisplayModeControls(tableName, column, colType, filterElement) {
    const modes = resolveFilterDisplayModes(colType);
    if (modes.length <= 1) {
        return null;
    }

    const safeColumnName = buildTestIdSegment(column);
    const controls = document.createElement("div");
    controls.classList.add("filter-display-mode-controls");
    controls.setAttribute("role", "group");
    controls.setAttribute(
        "aria-label",
        getTranslationForKey("filter_display_mode") || "Filter display mode"
    );

    const activateMode = (mode, { persist = true, clearInactiveFilters = true } = {}) => {
        setActiveFilterDisplayMode(filterElement, mode);
        controls.querySelectorAll("button[data-filter-display-mode]").forEach((button) => {
            const isActive = button.dataset.filterDisplayMode === mode;
            button.classList.toggle("is-active", isActive);
            button.setAttribute("aria-pressed", String(isActive));
        });
        if (persist) {
            setSavedFilterDisplayMode(tableName, column, mode);
        }
        if (clearInactiveFilters) {
            const baseId = getColumnFilterBaseId(tableName, column);
            const keysToClear = mode === FILTER_DISPLAY_MODES.RANGE
                ? [baseId]
                : [`${baseId}_from`, `${baseId}_to`];
            clearFilterKeysAndRefresh(tableName, keysToClear);
        }
    };

    modes.forEach((mode) => {
        const presentation = FILTER_DISPLAY_MODE_PRESENTATION[mode];
        const button = document.createElement("button");
        button.type = "button";
        button.classList.add("filter-display-mode-button", "fw-btn");
        button.dataset.filterDisplayMode = mode;
        button.dataset.testid = `filter-display-mode-${safeColumnName}-${mode}`;
        button.textContent = presentation.symbol;
        button.title = getTranslationForKey(presentation.langKey, {
            fallback: presentation.fallback,
        });
        button.setAttribute("aria-label", button.title);
        button.dataset.titleLangKey = presentation.langKey;
        button.dataset.titleLangKeyFallback = presentation.fallback;
        button.dataset.ariaLabelLangKey = presentation.langKey;
        button.dataset.ariaLabelLangKeyFallback = presentation.fallback;
        button.addEventListener("click", (event) => {
            event.stopPropagation();
            activateMode(mode);
        });
        controls.appendChild(button);
    });

    activateMode(filterElement.dataset.filterDisplayMode, {
        persist: false,
        clearInactiveFilters: false,
    });
    return controls;
}

/**
 * Promote the filter's native label into the shared row header next to sorting.
 *
 * @param {HTMLDivElement} filterElement
 * @param {HTMLButtonElement} sortButton
 */
function attachFilterFieldHeader(filterElement, sortButton) {
    const label = filterElement.querySelector("label");
    const header = document.createElement("div");
    header.classList.add("filter-field-header");
    if (label) {
        header.appendChild(label);
    }
    header.appendChild(sortButton);
    if (label) {
        filterElement.prepend(header);
    } else {
        filterElement.insertBefore(header, filterElement.firstChild);
    }
}

function createFilterRowContainer(safeTableName, safeColumnName) {
    const row = document.createElement("div");
    row.classList.add("row-container");
    row.dataset.testid = `column-filter-row-${safeTableName}-${safeColumnName}`;
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = ".5rem";
    return row;
}

/**
 * Build the shared filter controls so legacy and favefox layouts can compose
 * them without mutating each other's DOM after render.
 *
 * @param {string} tableName
 * @param {string} column
 * @param {*} colType
 * @param {{showVisibilityToggle?: boolean, includeFieldHeader?: boolean, includeFieldLabel?: boolean}} [options]
 * @returns {{safeTableName: string, safeColumnName: string, visibilityToggle: HTMLInputElement|null, filterElement: HTMLDivElement, sortButton: HTMLButtonElement, displayModeControls: HTMLDivElement|null}}
 */
function buildFilterControlParts(
    tableName,
    column,
    colType,
    {
        showVisibilityToggle = true,
        includeFieldHeader = true,
        includeFieldLabel = true,
    } = {}
) {
    const safeTableName = buildTestIdSegment(tableName);
    const safeColumnName = buildTestIdSegment(column);
    const visibilityToggle = showVisibilityToggle
        ? createColumnVisibilityToggle(
            tableName,
            column,
            safeTableName,
            safeColumnName
        )
        : null;

    const sortButton = createSortButton(tableName, column);
    const filterElement = createFilterElement(tableName, column, colType);
    const displayModeControls = createFilterDisplayModeControls(
        tableName,
        column,
        colType,
        filterElement
    );

    if (!includeFieldLabel) {
        filterElement.querySelector("label")?.remove();
    }

    if (includeFieldHeader) {
        attachFilterFieldHeader(filterElement, sortButton);
    }

    return {
        safeTableName,
        safeColumnName,
        visibilityToggle,
        filterElement,
        sortButton,
        displayModeControls,
    };
}

/**
 * Assemble the shared filter controls into the standard legacy row shell.
 *
 * @param {string} tableName
 * @param {string} column
 * @param {*} colType
 * @param {{showVisibilityToggle?: boolean, includeFieldHeader?: boolean, includeFieldLabel?: boolean}} [options]
 * @returns {{row: HTMLDivElement, safeTableName: string, safeColumnName: string, visibilityToggle: HTMLInputElement|null, filterElement: HTMLDivElement, sortButton: HTMLButtonElement}}
 */
function buildFilterRowParts(tableName, column, colType, options = {}) {
    const parts = buildFilterControlParts(tableName, column, colType, options);
    const row = createFilterRowContainer(parts.safeTableName, parts.safeColumnName);

    if (parts.visibilityToggle) {
        row.appendChild(parts.visibilityToggle);
    }
    row.appendChild(parts.filterElement);

    return { row, ...parts };
}

/**
 * Build and append one complete legacy filter row into the destination container.
 *
 * @param {HTMLElement} container
 * @param {string} tableName
 * @param {string} column
 * @param {*} colType
 * @param {boolean} [showVisibilityToggle]
 * @returns {HTMLDivElement}
 */
function createRowForColumn(
    container,
    tableName,
    column,
    colType,
    showVisibilityToggle = true
) {
    const { row } = buildFilterRowParts(tableName, column, colType, {
        showVisibilityToggle,
        includeFieldHeader: true,
        includeFieldLabel: true,
    });
    container.appendChild(row);
    return row;
}


/** Builds column inputs with the existing state/URL refresh boundary injected. */
function createFilterElement(tableName, column, colType) {
    return createColumnFilterInput(tableName, column, colType, { updateFilterAndRefresh });
}

/**
 * Luo "suodata & järjestä"-paneelin collapsible-kääreineen.
 * Tekstisuodattimet + additional_id piilotetaan oletuksena “Näytä enemmän”-napin taakse.
 */
function buildFilterSection(
    tableName,
    columns,
    dataTypes,
    showVisibilityToggle
) {
    const filterableColumns = columns.filter(
        (column) => !shouldHideRedundantGeneratedForeignDisplayColumn(column, columns, dataTypes)
    );
    const categorized = categorizeColumns(filterableColumns, dataTypes);
    const { main: orderedMainFilters, hidden: hiddenColumns } = orderFilterColumns(categorized);

    const mainFilterContainer = document.createElement("div");
    mainFilterContainer.classList.add("combined-filter-sort-container");

    orderedMainFilters.forEach((col) => {
        createRowForColumn(
            mainFilterContainer,
            tableName,
            col,
            dataTypes[col],
            showVisibilityToggle
        );
    });

    if (hiddenColumns.length) {
        const additionalWrapper = document.createElement("div");
        additionalWrapper.style.display = "none";

        const additionalContainer = document.createElement("div");
        additionalContainer.classList.add("combined-filter-sort-container");

        hiddenColumns.forEach((col) => {
            createRowForColumn(
                additionalContainer,
                tableName,
                col,
                dataTypes[col],
                showVisibilityToggle
            );
        });

        additionalWrapper.appendChild(additionalContainer);

        const moreBtn = document.createElement("button");
        moreBtn.classList.add("fw-btn");
        moreBtn.dataset.langKey = "show_more";
        moreBtn.textContent = getTranslationForKey('show_more') || "Enemmän";
        moreBtn.addEventListener("click", () => {
            const isHidden = additionalWrapper.style.display === "none";
            additionalWrapper.style.display = isHidden ? "block" : "none";
            moreBtn.setAttribute(
                "data-lang-key",
                isHidden ? "show_less" : "show_more"
            );
            moreBtn.textContent = isHidden ? (getTranslationForKey('show_less') || "Vähemmän") : (getTranslationForKey('show_more') || "Enemmän");
        });

        mainFilterContainer.appendChild(moreBtn);
        mainFilterContainer.appendChild(additionalWrapper);
    }

    window.addEventListener('dataset-query-params-changed', (e) => {
        if (e.detail.dataset !== tableName) return;
        const params = getParams(tableName);
        const { sort_column: _sort_column, sort_order: _sort_order, offset: _offset, ...filters } = params;
        setUnifiedTableState(tableName, { filters });
        const container = document.getElementById(
            `${tableName}_tab_parts_container`
        );
        if (container) {
            container
                .querySelectorAll(
                    '.combined-filter-sort-container input, .combined-filter-sort-container select, .combined-filter-sort-container .msd-dropdown'
                )
                .forEach((el) => {
                    if (el.__dropdown && typeof el.__dropdown.setValue === 'function') {
                        const includeValue = filters[el.id] ?? '';
                        const excludeValue = filters[`${el.id}_exclude`] ?? '';
                        el.__dropdown.setValue({
                            includeValues: includeValue ? includeValue.split(",") : [],
                            excludeValues: excludeValue ? excludeValue.split(",") : [],
                        }, false);
                    } else {
                        const filterKey = el.dataset.filterKey || el.id;
                        el.value = filters[filterKey] ?? '';
                    }
                });
        }
        refreshTableUnified(tableName);
    });

    /* --- wrapataan collapsible-komponenttiin ------------------- */
    return create_collapsible_section(
        "sort_and_filter",
        mainFilterContainer,
        true
    );
}

function clearFilterKeysAndRefresh(tableName, filterKeys = []) {
    const keysToClear = filterKeys.filter(Boolean);
    if (!keysToClear.length) return;

    const state = getUnifiedTableState(tableName);
    if (!state.filters) state.filters = {};
    const params = getParams(tableName);
    let changed = false;

    keysToClear.forEach((key) => {
        const excludeKey = `${key}_exclude`;
        if (Object.prototype.hasOwnProperty.call(state.filters, key)) {
            delete state.filters[key];
            changed = true;
        }
        if (Object.prototype.hasOwnProperty.call(state.filters, excludeKey)) {
            delete state.filters[excludeKey];
            changed = true;
        }
        if (Object.prototype.hasOwnProperty.call(params, key)) {
            delete params[key];
            changed = true;
        }
        if (Object.prototype.hasOwnProperty.call(params, excludeKey)) {
            delete params[excludeKey];
            changed = true;
        }
    });

    if (!changed) return;

    setUnifiedTableState(tableName, state);
    resetOffset(tableName);
    setParams(tableName, params);
    updateURL(tableName, params, undefined, { replace: true });
    const searchCache = ongoingSearchResults[tableName];
    if (params.search && searchCache) {
        searchCache.filters = { ...(state.filters || {}) };
        rerenderCachedSearchResults(tableName).then(() => {
            renderActiveFilters(tableName);
        });
    } else {
        refreshTableUnified(tableName, { skipUrlParams: true });
    }
}

/**
 * Persist one filter change, sync URL params, and refresh the active dataset view.
 *
 * @param {string} tableName
 * @param {string} colKey
 * @param {string} value
 * @param {{filterMode?: 'include'|'exclude', dropdownState?: {includeValues?: string[], excludeValues?: string[]}|null}} [options]
 */
async function updateFilterAndRefresh(tableName, colKey, value, { filterMode = 'include', dropdownState = null } = {}) {
    if (IS_DEV_MODE) console.log("%cupdateFilterAndRefresh", "color:#2196F3;font-weight:bold;", {
        tableName,
        colKey,
        value,
        filterMode,
        dropdownState,
    });

    const state = getUnifiedTableState(tableName);
    if (!state.filters) state.filters = {};
    const excludeKey = `${colKey}_exclude`;

    if (dropdownState) {
        const includeValue = (dropdownState.includeValues || []).join(',');
        const excludeValue = (dropdownState.excludeValues || []).join(',');

        delete state.filters[colKey];
        delete state.filters[excludeKey];
        if (includeValue !== '') state.filters[colKey] = includeValue;
        if (excludeValue !== '') state.filters[excludeKey] = excludeValue;
    } else {
        const targetKey = filterMode === 'exclude' ? excludeKey : colKey;
        const oppositeKey = filterMode === 'exclude' ? colKey : excludeKey;
        delete state.filters[oppositeKey];
        if (value === "") delete state.filters[targetKey];
        else state.filters[targetKey] = value;
    }

    setUnifiedTableState(tableName, state);
    resetOffset(tableName);

    const params = getParams(tableName);
    const hadPreviousFilter = (params[colKey] ?? "") !== "" || (params[excludeKey] ?? "") !== "";
    let hasNextFilter = value !== "";
    delete params[colKey];
    delete params[excludeKey];
    if (dropdownState) {
        const includeValue = (dropdownState.includeValues || []).join(',');
        const excludeValue = (dropdownState.excludeValues || []).join(',');
        if (includeValue !== '') params[colKey] = includeValue;
        if (excludeValue !== '') params[excludeKey] = excludeValue;
        hasNextFilter = includeValue !== '' || excludeValue !== '';
    } else {
        const targetKey = filterMode === 'exclude' ? excludeKey : colKey;
        if (value !== "") {
            params[targetKey] = value;
        }
    }
    setParams(tableName, params);
    const shouldReplace = !(
        (!hadPreviousFilter && hasNextFilter) ||
        (hadPreviousFilter && !hasNextFilter)
    );
    updateURL(tableName, params, undefined, { replace: shouldReplace });

    const searchCache = ongoingSearchResults[tableName];
    if (params.search && searchCache) {
        searchCache.filters = { ...(state.filters || {}) };
        await rerenderCachedSearchResults(tableName);
        renderActiveFilters(tableName);
    } else {
        refreshTableUnified(tableName, { skipUrlParams: true });
    }
}

export {
    determineColumnCategory,
    buildFilterControlParts,
    buildFilterRowParts,
    createRowForColumn,
    buildFilterSection,
    createFilterElement,
    mapForeignFilterOptions,
};
