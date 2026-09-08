// sort_dropdown_builder.js
// Builds the filterbar sorting dropdown and wires it to unified table state.
// Bridges sortable column metadata with URL params, table refreshes, and dropdown UI behavior.
// Exists to keep sort-control construction separate from broader filterbar layout assembly.

import { createVanillaDropdown } from "../../../reusable_components/vanilla_dropdown/vanilla_dropdown_builder.js";
import {
    getUnifiedTableState,
    setUnifiedTableState,
    refreshTableUnified,
} from "../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js";
import { getParams, setParams, updateURL } from "../../navigation/nav_engine/query_params.js";
import {
    emitDatasetSortSelection,
    getDatasetSortSelection,
    subscribeDatasetSortSelection,
} from "./sort_sync_state.js";
import {
    filterSortableColumns,
    buildSortOptions,
    normalizeSortSelection,
    NEWEST_SORT_VALUE,
} from "./sort_dropdown_builder_helpers.js";
import {
    hasCachedSearchResults,
    sortCachedSearchResults,
} from "../text_search/dataset_search_executor.js";
import {
    applyDatasetSortDefault,
    createDatasetSortDefaultAction,
} from "./dataset_sort_default_controller.js";

export function createSortDropdown(tableName, columns, dataTypes) {
    const wrapper = document.createElement("div");
    wrapper.classList.add("sort-dropdown-wrapper");

    const label = document.createElement("div");
    label.dataset.langKey = "sort_by";
    label.textContent = "Sort by";
    wrapper.appendChild(label);

    const dropdownContainer = document.createElement("div");
    dropdownContainer.dataset.testid = 'sort-dropdown';
    wrapper.appendChild(dropdownContainer);

    const sortableColumns = filterSortableColumns(columns, dataTypes);
    const options = buildSortOptions(sortableColumns, columns);
    const contextualOptions = () => options.filter((option) =>
        option.value !== "" || String(getParams(tableName).search || "").trim()
    );
    const availableValues = new Set(options.map((option) => option.value));
    const representableValues = new Set(availableValues);
    columns.forEach((column) => {
        representableValues.add(`${column}:ASC`);
        representableValues.add(`${column}:DESC`);
    });

    const currentSelection = getDatasetSortSelection(tableName);
    const normalizedSelection = normalizeSortSelection(currentSelection, representableValues);
    if (normalizedSelection !== currentSelection) {
        const st = getUnifiedTableState(tableName);
        const params = getParams(tableName);
        const [column, direction] = normalizedSelection.split(":");
        st.sort = { column, direction };
        params.sort_column = column;
        params.sort_order = direction;
        setUnifiedTableState(tableName, st);
        setParams(tableName, params);
        updateURL(tableName, params, undefined, { replace: true });
        emitDatasetSortSelection(tableName, normalizedSelection);
        queueMicrotask(() => {
            void refreshTableUnified(tableName, { skipUrlParams: true });
        });
    }

    async function applySortSelection(value) {
        if (!value && !String(getParams(tableName).search || "").trim()) value = NEWEST_SORT_VALUE;
        const st = getUnifiedTableState(tableName);
        if (!st.sort) st.sort = { column: null, direction: null };
        const params = getParams(tableName);

        if (!value) {
            if (st.sort.column && st.sort.direction) st.lastNonSearchSort = { ...st.sort };
            st.sort.column = null;
            st.sort.direction = null;
            delete params.sort_column;
            delete params.sort_order;
        } else {
            const [col, dir] = value.split(":");
            st.sort.column = col;
            st.sort.direction = dir;
            params.sort_column = col;
            params.sort_order = dir;
            st.lastNonSearchSort = { ...st.sort };
        }

        st.sortSelectionExplicit = true;
        setUnifiedTableState(tableName, st);
        setParams(tableName, params);
        updateURL(tableName, params, undefined, { replace: true });
        emitDatasetSortSelection(tableName, value || "");

        if (String(params.search || "").trim() && hasCachedSearchResults(tableName)) {
            await sortCachedSearchResults(tableName, {
                sortColumn: st.sort.column,
                sortOrder: st.sort.direction,
            });
            return;
        }

        await refreshTableUnified(tableName, { skipUrlParams: true });
    }

    let dropdown;
    dropdown = createVanillaDropdown({
        containerElement: dropdownContainer,
        options: contextualOptions(),
        placeholder: "Select...",
        showClearButton: false,
        useSearch: false,
        menuMaxWidth: 300,
        renderOptionTrailingAction: (option, { close }) =>
            option.transient === true ? null : createDatasetSortDefaultAction(tableName, option, {
                selectOption: async (value) => {
                    dropdown.setValue(value, false);
                    await applySortSelection(value);
                },
                closeDropdown: close,
            }),
        onChange: applySortSelection,
    });

    const inputEl = dropdownContainer.querySelector(".vdw-dropdown-input");
    if (inputEl) inputEl.dataset.langKey = "sort_select_placeholder";

    const ensureSelectedOptionExists = (value) => {
        if (!value || availableValues.has(value) || !representableValues.has(value)) return;
        const [column, direction] = value.split(":");
        options.push({
            value,
            label: `${column} ${direction === "DESC" ? "↓" : "↑"}`,
            langKey: `${column}_${direction.toLowerCase()}`,
            transient: true,
        });
        availableValues.add(value);
        dropdown.setOptions(contextualOptions());
    };

    const unsubscribeSortSelection = subscribeDatasetSortSelection(tableName, (value) => {
        ensureSelectedOptionExists(value);
        dropdown.setOptions(contextualOptions());
        dropdown.setValue(value || "");
    });

    void applyDatasetSortDefault(
        tableName,
        dropdown,
        availableValues
    );

    wrapper.destroy = () => {
        unsubscribeSortSelection();
        dropdown.destroy?.();
    };

    return wrapper;
}
