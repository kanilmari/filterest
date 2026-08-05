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
    subscribeDatasetSortSelection,
} from "./sort_sync_state.js";
import { filterSortableColumns, buildSortOptions } from "./sort_dropdown_builder_helpers.js";
import {
    hasCachedSearchResults,
    sortCachedSearchResults,
} from "../text_search/dataset_search_executor.js";

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
    const options = buildSortOptions(sortableColumns);

    const dropdown = createVanillaDropdown({
        containerElement: dropdownContainer,
        options,
        placeholder: "Select...",
        showClearButton: false,
        useSearch: false,
        onChange: (value) => {
            const st = getUnifiedTableState(tableName);
            if (!st.sort) st.sort = { column: null, direction: null };
            const params = getParams(tableName);

            if (!value) {
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
            }

            setUnifiedTableState(tableName, st);
            setParams(tableName, params);
            updateURL(tableName, params, undefined, { replace: true });
            emitDatasetSortSelection(tableName, value || "");

            if (String(params.search || "").trim() && hasCachedSearchResults(tableName)) {
                void sortCachedSearchResults(tableName, {
                    sortColumn: st.sort.column,
                    sortOrder: st.sort.direction,
                });
                return;
            }

            refreshTableUnified(tableName, { skipUrlParams: true });
        },
    });

    const inputEl = dropdownContainer.querySelector(".vdw-dropdown-input");
    if (inputEl) inputEl.dataset.langKey = "sort_select_placeholder";

    const unsubscribeSortSelection = subscribeDatasetSortSelection(tableName, (value) => {
        dropdown.setValue(value || "");
    });

    wrapper.destroy = () => {
        unsubscribeSortSelection();
        dropdown.destroy?.();
    };

    return wrapper;
}
