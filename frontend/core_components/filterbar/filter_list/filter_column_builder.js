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
import { fetchFilterOptions } from "../../endpoints/endpoint_data_fetcher.js";
import { getLanguageWithBrowserFallback } from "../../state_stores/lang_preference_reader.js";
import { resolveDatasetDisplayValue } from "../../table_views/dataset_value_localizer.js";
import {
    determineColumnCategory,
    buildTestIdSegment,
    categorizeColumns,
    orderFilterColumns,
    resolveFilterElementKind,
    areForeignFilterOptionValuesNumeric,
    shouldRetryForeignFilterOptionsWithSlug,
    shouldHideRedundantGeneratedForeignDisplayColumn,
} from "./filter_column_builder_helpers.js";

const IS_DEV_MODE = document.querySelector('meta[name="app-env"]')?.content === 'dev';
const FILTER_DISPLAY_MODES = Object.freeze({
    VALUE: "value",
    RANGE: "range",
    QUERY: "query",
});

function getFilterDisplayModeStorageKey(tableName) {
    return `${tableName}_filter_display_modes`;
}

function getSavedFilterDisplayModes(tableName) {
    try {
        return JSON.parse(localStorage.getItem(getFilterDisplayModeStorageKey(tableName)) || "{}") || {};
    } catch {
        return {};
    }
}

function setSavedFilterDisplayMode(tableName, column, mode) {
    const savedModes = getSavedFilterDisplayModes(tableName);
    savedModes[column] = mode;
    localStorage.setItem(getFilterDisplayModeStorageKey(tableName), JSON.stringify(savedModes));
}

function resolveSavedFilterDisplayMode(tableName, column, modes, fallbackMode) {
    const savedMode = getSavedFilterDisplayModes(tableName)[column];
    if (modes.includes(savedMode)) {
        return savedMode;
    }
    return fallbackMode;
}

function getColumnFilterBaseId(tableName, column) {
    return `${tableName}_${column}`;
}

function setActiveFilterDisplayMode(filterElement, mode) {
    filterElement.dataset.filterDisplayMode = mode;
    filterElement
        .querySelectorAll("[data-filter-display-pane]")
        .forEach((pane) => {
            pane.hidden = pane.dataset.filterDisplayPane !== mode;
        });
}

function resolveFilterDisplayModes(colType) {
    const filterElementKind = resolveFilterElementKind(colType);
    if (filterElementKind === "numeric_range" || filterElementKind === "date_range") {
        return [
            FILTER_DISPLAY_MODES.VALUE,
            FILTER_DISPLAY_MODES.RANGE,
            FILTER_DISPLAY_MODES.QUERY,
        ];
    }
    if (filterElementKind === "text_input") {
        return [FILTER_DISPLAY_MODES.QUERY];
    }
    return [FILTER_DISPLAY_MODES.VALUE];
}

/**
 * Normalize raw foreign-option payload into value/label pairs for dropdowns.
 *
 * @param {*} data
 * @returns {Array<{value: string, label: string}>}
 */
function mapForeignFilterOptions(data) {
    if (!Array.isArray(data)) {
        return [];
    }

    const chosenLanguage = getLanguageWithBrowserFallback();
    return data.map((item) => {
        const value = String(item.value);
        const rawLabel = item.label || value;
        return {
            value,
            label: resolveDatasetDisplayValue(rawLabel, null, chosenLanguage),
        };
    });
}

/**
 * Restore the saved include/exclude state for one multiselect filter.
 *
 * @param {Object<string, string>} savedFilters
 * @param {string} baseId
 * @returns {{includeValues: string[], excludeValues: string[]}}
 */
function getSavedDropdownFilterState(savedFilters, baseId) {
    return {
        includeValues: Object.prototype.hasOwnProperty.call(savedFilters, baseId)
            ? String(savedFilters[baseId] || '').split(',').map((value) => value.trim()).filter(Boolean)
            : [],
        excludeValues: Object.prototype.hasOwnProperty.call(savedFilters, `${baseId}_exclude`)
            ? String(savedFilters[`${baseId}_exclude`] || '').split(',').map((value) => value.trim()).filter(Boolean)
            : [],
    };
}

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
        const button = document.createElement("button");
        button.type = "button";
        button.classList.add("filter-display-mode-button", "fw-btn");
        button.dataset.filterDisplayMode = mode;
        button.dataset.testid = `filter-display-mode-${safeColumnName}-${mode}`;
        button.textContent = mode.charAt(0).toUpperCase();
        button.title = mode.charAt(0).toUpperCase() + mode.slice(1);
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


/**
 * Build the correct filter input UI for one dataset column.
 *
 * @param {string} tableName
 * @param {string} column
 * @param {*} colType
 * @returns {HTMLDivElement}
 */
function createFilterElement(tableName, column, colType) {
    const container = document.createElement("div");
    container.classList.add("input-group");

    const { filters: savedFilters = {} } = getUnifiedTableState(tableName);

    const getSaved = (id) => (Object.prototype.hasOwnProperty.call(savedFilters, id) ? savedFilters[id] : "");

    const filterElementKind = resolveFilterElementKind(colType);
    if (filterElementKind === "numeric_range" || filterElementKind === "date_range") {
        const baseId = getColumnFilterBaseId(tableName, column);
        const modes = resolveFilterDisplayModes(colType);
        const savedModeFallback = getSaved(baseId)
            ? FILTER_DISPLAY_MODES.VALUE
            : FILTER_DISPLAY_MODES.RANGE;
        const initialMode = resolveSavedFilterDisplayMode(
            tableName,
            column,
            modes,
            savedModeFallback
        );
        container.classList.add("filter-input-group--with-display-modes");
        container.dataset.filterDisplayModes = modes.join(",");
        container.dataset.filterDisplayMode = initialMode;
        container.dataset.filterBaseId = baseId;

        const label = document.createElement("label");
        label.setAttribute("for", `${baseId}_from`);
        label.dataset.langKey = column;
        container.appendChild(label);

        const valuePane = document.createElement("div");
        valuePane.classList.add("filter-display-pane");
        valuePane.dataset.filterDisplayPane = FILTER_DISPLAY_MODES.VALUE;
        const valueInput = document.createElement("input");
        valueInput.id = `${baseId}_value`;
        valueInput.dataset.filterKey = baseId;
        valueInput.placeholder = "Value";
        valueInput.value = getSaved(baseId);
        valueInput.type = filterElementKind === "numeric_range" ? "number" : "date";
        let valueDebounceTimer = null;
        valueInput.addEventListener("input", () => {
            clearTimeout(valueDebounceTimer);
            valueDebounceTimer = setTimeout(() => {
                updateFilterAndRefresh(tableName, baseId, valueInput.value);
            }, 250);
        });
        valuePane.appendChild(valueInput);

        const fromInput = document.createElement("input");
        const toInput = document.createElement("input");

        if (filterElementKind === "numeric_range") {
            fromInput.type = "number";
            toInput.type = "number";
            fromInput.placeholder = "Min";
            toInput.placeholder = "Max";
        } else {
            fromInput.type = "date";
            toInput.type = "date";
            fromInput.title = "From";
            toInput.title = "To";
        }

        fromInput.id = `${baseId}_from`;
        toInput.id = `${baseId}_to`;

        fromInput.value = getSaved(fromInput.id);
        toInput.value = getSaved(toInput.id);

        const rangePane = document.createElement("div");
        rangePane.classList.add("filter-display-pane", "filter-display-pane--range");
        rangePane.dataset.filterDisplayPane = FILTER_DISPLAY_MODES.RANGE;

        let fromDebounceTimer = null;
        let toDebounceTimer = null;
        fromInput.addEventListener("input", () => {
            clearTimeout(fromDebounceTimer);
            fromDebounceTimer = setTimeout(() => {
                updateFilterAndRefresh(tableName, fromInput.id, fromInput.value);
            }, 250);
        });
        toInput.addEventListener("input", () => {
            clearTimeout(toDebounceTimer);
            toDebounceTimer = setTimeout(() => {
                updateFilterAndRefresh(tableName, toInput.id, toInput.value);
            }, 250);
        });

        rangePane.appendChild(fromInput);
        rangePane.appendChild(toInput);

        const queryPane = document.createElement("div");
        queryPane.classList.add("filter-display-pane");
        queryPane.dataset.filterDisplayPane = FILTER_DISPLAY_MODES.QUERY;
        const queryInput = document.createElement("input");
        queryInput.type = "text";
        queryInput.id = `${baseId}_query`;
        queryInput.dataset.filterKey = baseId;
        queryInput.placeholder = `Search for ${column}`;
        queryInput.dataset.langKey = `search_for_${column}`;
        queryInput.value = getSaved(baseId);
        let lastCommitted = queryInput.value;
        const commitQueryFilter = () => {
            if (queryInput.value === lastCommitted) return;
            lastCommitted = queryInput.value;
            updateFilterAndRefresh(tableName, baseId, queryInput.value);
        };
        queryInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") commitQueryFilter();
        });
        queryInput.addEventListener("change", commitQueryFilter);
        queryPane.appendChild(queryInput);

        container.appendChild(valuePane);
        container.appendChild(rangePane);
        container.appendChild(queryPane);
        setActiveFilterDisplayMode(container, initialMode);
        return container;
    }

    if (filterElementKind === "boolean_select") {
        const select = document.createElement("select");
        select.id = `${tableName}_${column}`;

        ["", "true", "false", "empty"].forEach((val) => {
            const opt = document.createElement("option");
            opt.value = val;
            opt.textContent =
                val === ""
                    ? "All"
                    : val === "empty"
                    ? "Empty"
                    : val.charAt(0).toUpperCase() + val.slice(1);
            select.appendChild(opt);
        });

        select.value = getSaved(select.id);

        select.addEventListener("input", () =>
            updateFilterAndRefresh(tableName, select.id, select.value)
        );

        const label = document.createElement("label");
        label.setAttribute("for", select.id);
        label.dataset.langKey = column;
        container.appendChild(label);
        container.appendChild(select);
        container.classList.add("single-input");
        return container;
    }

    if (filterElementKind === "foreign_key") {
        const baseId = `${tableName}_${column}`;
        const dropdownContainer = document.createElement("div");
        dropdownContainer.id = baseId;
        const savedDropdownState = getSavedDropdownFilterState(savedFilters, baseId);
        const hasSavedDropdownValues = (
            savedDropdownState.includeValues.length > 0 ||
            savedDropdownState.excludeValues.length > 0
        );

        import("../../../reusable_components/multiselect_dropdown/multiselect_dropdown_builder.js")
            .then(({ createMultiselectDropdown }) => {
                const dropdown = createMultiselectDropdown({
                    containerElement: dropdownContainer,
                    options: [],
                    placeholder: getTranslationForKey('filter_value_placeholder', {
                        fallback: `Filter ${column}...`,
                    }),
                    useSearch: true,
                    initialState: savedDropdownState,
                    excludeLabel: getTranslationForKey('exclude', { fallback: 'Exclude' }),
                    resetLabel: getTranslationForKey('reset', { fallback: 'Reset', countUsage: false }),
                    excludeTooltip: getTranslationForKey('exclude_filter_option', {
                        fallback: 'Exclude this value from results',
                        countUsage: false,
                    }),
                    resetTooltip: getTranslationForKey('reset_filter_option', {
                        fallback: 'Remove the excluded state for this value',
                        countUsage: false,
                    }),
                    onChange: (nextDropdownState) => {
                        updateFilterAndRefresh(tableName, baseId, '', { dropdownState: nextDropdownState });
                    },
                });

                const foreignTable = colType.foreign_table;
                const foreignValueColumn = colType.foreign_column || "id";
                let optionsLoaded = false;
                let optionsPromise = null;

                const ensureForeignFilterOptions = async () => {
                    if (optionsLoaded) {
                        return;
                    }
                    if (optionsPromise) {
                        await optionsPromise;
                        return;
                    }

                    optionsPromise = (async () => {
                        const data = await fetchFilterOptions({
                            dataset_name: foreignTable,
                            value_column: foreignValueColumn,
                        });
                        let dropdownOptions = mapForeignFilterOptions(data);

                        if (shouldRetryForeignFilterOptionsWithSlug(column, colType, dropdownOptions, foreignValueColumn)) {
                            try {
                                const slugData = await fetchFilterOptions({
                                    dataset_name: foreignTable,
                                    value_column: 'slug',
                                });
                                const slugOptions = mapForeignFilterOptions(slugData);
                                if (!areForeignFilterOptionValuesNumeric(slugOptions)) {
                                    dropdownOptions = slugOptions;
                                }
                            } catch (err) {
                                if (IS_DEV_MODE) {
                                    console.warn("Failed to fetch slug fallback filter options:", err);
                                }
                            }
                        }

                        dropdown.setOptions(dropdownOptions);
                        dropdown.setValue(savedDropdownState);
                        optionsLoaded = true;
                    })();

                    try {
                        await optionsPromise;
                    } catch (err) {
                        if (IS_DEV_MODE) {
                            console.warn("Failed to fetch filter options:", err);
                        }
                    } finally {
                        optionsPromise = null;
                    }
                };

                if (hasSavedDropdownValues) {
                    void ensureForeignFilterOptions();
                } else {
                    const lazyLoadOptions = () => {
                        void ensureForeignFilterOptions();
                    };
                    dropdownContainer.addEventListener("pointerdown", lazyLoadOptions, { once: true });
                    dropdownContainer.addEventListener("focusin", lazyLoadOptions, { once: true });
                }
            });

        const label = document.createElement("label");
        label.setAttribute("for", baseId);
        label.dataset.langKey = column;
        container.appendChild(label);
        container.appendChild(dropdownContainer);
        container.classList.add("single-input");
        return container;
    }

    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.placeholder = `Search for ${column}`;
    textInput.dataset.langKey = `search_for_${column}`;
    textInput.id = `${tableName}_${column}`;

    textInput.value = getSaved(textInput.id);

    // Commit text filters on Enter or blur without double-submitting the same value.
    let lastCommitted = textInput.value;
    const commitTextFilter = () => {
        if (textInput.value === lastCommitted) return;
        lastCommitted = textInput.value;
        updateFilterAndRefresh(tableName, textInput.id, textInput.value);
    };
    textInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") commitTextFilter();
    });
    textInput.addEventListener("change", commitTextFilter);

    const label = document.createElement("label");
    label.setAttribute("for", textInput.id);
    label.dataset.langKey = column;
    container.appendChild(label);
    container.appendChild(textInput);
    container.classList.add("single-input");
    return container;
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
