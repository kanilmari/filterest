// @vitest-environment jsdom
// filter_column_builder.test.js
// Verifies the shared filter control builders compose the same controls for legacy and favefox rows.
// Bridges low-level row-part assembly and the persisted table state used by filter controls.
// Exists to lock in the refactor that moved shared filter control construction behind one API.

import { beforeEach, describe, expect, test, vi } from "vitest";
import {
    buildFilterControlParts,
    buildFilterRowParts,
    mapForeignFilterOptions,
    createFilterElement,
} from "./filter_column_builder.js";

describe("filter column row builders", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        localStorage.clear();
    });

    test("buildFilterControlParts returns shared controls without forcing the legacy field header", () => {
        const parts = buildFilterControlParts("users", "title", { data_type: "text" }, {
            showVisibilityToggle: true,
            includeFieldHeader: false,
            includeFieldLabel: false,
        });

        expect(parts.safeTableName).toBe("users");
        expect(parts.safeColumnName).toBe("title");
        expect(parts.visibilityToggle).not.toBeNull();
        expect(parts.visibilityToggle.classList.contains("column-visibility-toggle")).toBe(true);
        expect(parts.filterElement.querySelector("label")).toBeNull();
        expect(parts.filterElement.querySelector(".filter-field-header")).toBeNull();
        expect(parts.sortButton.getAttribute("data-sort-state")).toBe("none");
        expect(parts.displayModeControls).toBeNull();
    });

    test("buildFilterControlParts exposes value range and query display modes for numeric filters", () => {
        const parts = buildFilterControlParts("users", "id", { data_type: "integer" }, {
            showVisibilityToggle: true,
            includeFieldHeader: false,
            includeFieldLabel: false,
        });

        const modeButtons = parts.displayModeControls.querySelectorAll("button[data-filter-display-mode]");

        expect(parts.filterElement.dataset.filterDisplayModes).toBe("value,range,query");
        expect(parts.filterElement.dataset.filterDisplayMode).toBe("range");
        expect(parts.filterElement.querySelector("[data-filter-display-pane='range']").hidden).toBe(false);
        expect(parts.filterElement.querySelector("[data-filter-display-pane='value']").hidden).toBe(true);
        expect(parts.filterElement.querySelector("[data-filter-display-pane='query']").hidden).toBe(true);
        expect(modeButtons).toHaveLength(3);
        expect(Array.from(modeButtons).map((button) => button.dataset.filterDisplayMode)).toEqual([
            "value",
            "range",
            "query",
        ]);
        expect(Array.from(modeButtons).map((button) => button.textContent)).toEqual([
            "=",
            "↔",
            "ƒx",
        ]);
        expect(Array.from(modeButtons).map((button) => button.title)).toEqual([
            "Exact value",
            "Range",
            "Condition or expression",
        ]);
        expect(Array.from(modeButtons).map((button) => button.getAttribute("aria-label"))).toEqual([
            "Exact value",
            "Range",
            "Condition or expression",
        ]);
        expect(Array.from(modeButtons).map((button) => button.dataset.titleLangKey)).toEqual([
            "filter_mode_exact_value",
            "filter_mode_range",
            "filter_mode_condition_expression",
        ]);
        expect(Array.from(modeButtons).map((button) => button.dataset.titleLangKeyFallback)).toEqual([
            "Exact value",
            "Range",
            "Condition or expression",
        ]);
        expect(Array.from(modeButtons).map((button) => button.dataset.ariaLabelLangKeyFallback)).toEqual([
            "Exact value",
            "Range",
            "Condition or expression",
        ]);
        expect(parts.displayModeControls.querySelector(".sort_button")).toBeNull();
        expect(parts.sortButton.classList.contains("sort_button")).toBe(true);
    });

    test("buildFilterRowParts wraps shared controls in the standard legacy row shell", () => {
        const parts = buildFilterRowParts("users", "title", { data_type: "text" }, {
            showVisibilityToggle: true,
            includeFieldHeader: true,
            includeFieldLabel: true,
        });

        const header = parts.filterElement.querySelector(".filter-field-header");

        expect(parts.row.dataset.testid).toBe("column-filter-row-users-title");
        expect(parts.row.firstElementChild).toBe(parts.visibilityToggle);
        expect(parts.row.lastElementChild).toBe(parts.filterElement);
        expect(header).not.toBeNull();
        expect(header.querySelector("label")).not.toBeNull();
        expect(header.querySelector("button[data-sort-state]")).toBe(parts.sortButton);
    });

    test("localizes foreign filter labels without changing their option values", () => {
        localStorage.setItem("chosen_language", "fi");
        const ordinaryJson = JSON.stringify({ name: "raw", count: 2 });

        expect(mapForeignFilterOptions([
            { value: 7, label: JSON.stringify({ en: "Services", fi: "Palvelut" }) },
            { value: "raw-id", label: ordinaryJson },
        ])).toEqual([
            { value: "7", label: "Palvelut" },
            { value: "raw-id", label: ordinaryJson },
        ]);
    });
});


test('finite API choices use the existing multiselect include/exclude and shared refresh path', async () => {
    const { registerDatasetQueryAdapter } = await import('../dataset_surface_provider/dataset_query_adapter_registry.js');
    const { getParams } = await import('../../navigation/nav_engine/query_params.js');
    const refresh = vi.fn(async () => {});
    const release = registerDatasetQueryAdapter('choice_surface', { refresh });
    const element = createFilterElement('choice_surface', 'priority', { data_type: 'text', filter_options: [
        { value: 'high', label: 'Korkea' }, { value: 'low', label: 'Matala' },
    ] });
    document.body.append(element);
    try {
        const target = document.getElementById('choice_surface_priority');
        await vi.waitFor(() => expect(target.__dropdown?.getLabelsForValues(['high'])).toEqual(['Korkea']));
        target.__dropdown.setValue({ includeValues: ['high'], excludeValues: ['low'] }, true);
        await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
        expect(getParams('choice_surface')).toMatchObject({ choice_surface_priority: 'high', choice_surface_priority_exclude: 'low' });
        const portal = document.querySelector('.msd-dropdown-list');
        element.destroy();
        expect(target.__dropdown).toBeUndefined();
        expect(portal?.isConnected).toBe(false);
    } finally { release(); element.destroy?.(); element.remove(); }
});


test('destroy before the dropdown import resolves never mounts a detached portal', async () => {
    const before = document.querySelectorAll('.msd-dropdown-list').length;
    const element = createFilterElement('closed_surface', 'priority', { data_type: 'text', filter_options: [{ value: 'high', label: 'High' }] });
    const target = element.querySelector('#closed_surface_priority');
    element.destroy();
    await vi.dynamicImportSettled();
    expect(target.__dropdown).toBeUndefined();
    expect(document.querySelectorAll('.msd-dropdown-list')).toHaveLength(before);
});
