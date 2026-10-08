// filter_column_input_builder.js
// Builds dataset column inputs, including lazy multilingual include/exclude dropdowns.
// Connects raw option payloads to shared controls through an injected filter refresh callback.
// Keeps input construction independent of filter layout and retains state during language switching.

import { getUnifiedTableState } from "../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js";
import { getTranslationForKey } from "../../lang/translation_handler.js";
import { getLanguageWithBrowserFallback } from "../../state_stores/lang_preference_reader.js";
import { bindDatasetLanguageRenderer, resolveDatasetDisplayValue } from "../../table_views/dataset_value_localizer.js";
import { resolveFilterElementKind, loadForeignFilterOptions } from "./filter_column_builder_helpers.js";
import { applyNumberInputStep } from "../../general_tables/gt_1_row_crud/number_input_step_resolver.js";

const IS_DEV_MODE = document.querySelector('meta[name="app-env"]')?.content === 'dev';
export const FILTER_DISPLAY_MODES = Object.freeze({
    VALUE: "value",
    RANGE: "range",
    QUERY: "query",
});
export const FILTER_DISPLAY_MODE_PRESENTATION = Object.freeze({
    [FILTER_DISPLAY_MODES.VALUE]: Object.freeze({
        symbol: "=",
        langKey: "filter_mode_exact_value",
        fallback: "Exact value",
    }),
    [FILTER_DISPLAY_MODES.RANGE]: Object.freeze({
        symbol: "↔",
        langKey: "filter_mode_range",
        fallback: "Range",
    }),
    [FILTER_DISPLAY_MODES.QUERY]: Object.freeze({
        symbol: "ƒx",
        langKey: "filter_mode_condition_expression",
        fallback: "Condition or expression",
    }),
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

export function setSavedFilterDisplayMode(tableName, column, mode) {
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

export function getColumnFilterBaseId(tableName, column) {
    return `${tableName}_${column}`;
}

export function setActiveFilterDisplayMode(filterElement, mode) {
    filterElement.dataset.filterDisplayMode = mode;
    filterElement
        .querySelectorAll("[data-filter-display-pane]")
        .forEach((pane) => {
            pane.hidden = pane.dataset.filterDisplayPane !== mode;
        });
}

export function resolveFilterDisplayModes(colType) {
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
export function mapForeignFilterOptions(data, chosenLanguage = getLanguageWithBrowserFallback()) {
    if (!Array.isArray(data)) {
        return [];
    }

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
 * Build the correct filter input UI for one dataset column.
 *
 * @param {string} tableName
 * @param {string} column
 * @param {*} colType
 * @param {{updateFilterAndRefresh: function}} callbacks - Existing filter state/URL refresh boundary
 * @returns {HTMLDivElement}
 */
export function createColumnFilterInput(tableName, column, colType, { updateFilterAndRefresh }) {
    const container = document.createElement("div");
    container.classList.add("input-group");

    const { filters: savedFilters = {} } = getUnifiedTableState(tableName);

    const getSaved = (id) => (Object.prototype.hasOwnProperty.call(savedFilters, id) ? savedFilters[id] : "");

    const filterElementKind = resolveFilterElementKind(colType);
    if (filterElementKind === "numeric_range" || filterElementKind === "date_range") {
        const columnDataType = typeof colType === "object" && colType?.data_type
            ? colType.data_type
            : colType;
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
        if (filterElementKind === "numeric_range") {
            applyNumberInputStep(valueInput, columnDataType);
        }
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
            applyNumberInputStep(fromInput, columnDataType);
            applyNumberInputStep(toInput, columnDataType);
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

    if (filterElementKind === "foreign_key" || filterElementKind === "choice") {
        const baseId = `${tableName}_${column}`;
        const dropdownContainer = document.createElement("div");
        dropdownContainer.id = baseId;
        const savedDropdownState = getSavedDropdownFilterState(savedFilters, baseId);
        const hasSavedDropdownValues = (
            savedDropdownState.includeValues.length > 0 ||
            savedDropdownState.excludeValues.length > 0
        );

        let destroyed = false;
        let mountedDropdown = null;
        let rawOptions = [];
        let currentLanguage = getLanguageWithBrowserFallback();
        const refreshDropdownLanguage = language => {
            currentLanguage = language;
            if (!mountedDropdown || destroyed) return;
            mountedDropdown.setLabels(getDropdownLabels(column));
            mountedDropdown.setOptions(mapForeignFilterOptions(rawOptions, currentLanguage), {
                preserveSelected: true, preserveViewState: true,
            });
        };
        bindDatasetLanguageRenderer(dropdownContainer, refreshDropdownLanguage);
        container.destroy = () => {
            destroyed = true;
            mountedDropdown?.destroy();
            dropdownContainer.removeAttribute("data-dataset-language-renderer");
        };
        import("../../../reusable_components/multiselect_dropdown/multiselect_dropdown_builder.js")
            .then(({ createMultiselectDropdown }) => {
                if (destroyed) return;
                const dropdown = createMultiselectDropdown({
                    containerElement: dropdownContainer,
                    options: [],
                    ...getDropdownLabels(column),
                    useSearch: true,
                    initialState: savedDropdownState,
                    onChange: (nextDropdownState) => {
                        updateFilterAndRefresh(tableName, baseId, '', { dropdownState: nextDropdownState });
                    },
                });

                mountedDropdown = dropdown;
                refreshDropdownLanguage(currentLanguage);
                let optionsLoaded = false;
                let optionsPromise = null;

                const ensureForeignFilterOptions = async () => {
                    if (destroyed || optionsLoaded) {
                        return;
                    }
                    if (optionsPromise) {
                        await optionsPromise;
                        return;
                    }

                    optionsPromise = (async () => {
                        const data = await loadForeignFilterOptions(column, colType);
                        rawOptions = data;
                        const dropdownOptions = mapForeignFilterOptions(rawOptions, currentLanguage);

                        if (destroyed) return;
                        dropdown.setOptions(dropdownOptions, { preserveSelected: true, preserveViewState: true });
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

                if (hasSavedDropdownValues || filterElementKind === "choice") {
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

/** All visible dropdown copy uses the same language keys on mount and live refresh. */
function getDropdownLabels(column) {
    return {
        placeholder: getTranslationForKey('filter_value_placeholder', { fallback: `Filter ${column}...` }),
        searchPlaceholder: getTranslationForKey('search'),
        selectedCountLabel: getTranslationForKey('selected'),
        excludedCountLabel: getTranslationForKey('excluded'),
        noResultsLabel: getTranslationForKey('no_results'),
        clearLabel: getTranslationForKey('clear_selection'),
        excludeLabel: getTranslationForKey('exclude', { fallback: 'Exclude' }),
        resetLabel: getTranslationForKey('reset', { fallback: 'Reset', countUsage: false }),
        excludeTooltip: getTranslationForKey('exclude_filter_option', { fallback: 'Exclude this value from results', countUsage: false }),
        resetTooltip: getTranslationForKey('reset_filter_option', { fallback: 'Remove the excluded state for this value', countUsage: false }),
    };
}
