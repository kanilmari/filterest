// vanilla_checkbox_table.test.js
// Verifies reusable editable checkbox-table behavior in a jsdom runtime.
// Bridges runtime column/row definitions with edit/save/cancel and localStorage draft state.
// Exists to keep the new shared checkbox-table library stable for future integrations.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";
import { createVanillaCheckboxTable } from "./vanilla_checkbox_table.js";
import legacyDOM from "./checkbox_table_legacy_dom.json";

function sampleColumns() {
    return [
        { key: "row_name", label: "Row", type: "static", editable: false },
        { key: "enabled", label: "Enabled", type: "checkbox" },
        {
            key: "mode",
            label: "Mode",
            type: "select",
            options: [
                { value: "details", label: "Details" },
                { value: "header", label: "Header" },
            ],
        },
    ];
}

function sampleRows() {
    return [
        { id: "row-1", row_name: "title", enabled: true, mode: "details" },
        { id: "row-2", row_name: "summary", enabled: false, mode: "header" },
    ];
}

describe("createVanillaCheckboxTable", () => {
    beforeEach(() => {
        localStorage.clear();
        document.body.innerHTML = "";
    });

    test("default readonly and editing markup is byte-identical to the original component", () => {
        const table = createVanillaCheckboxTable({ containerElement: document.body, columns: sampleColumns(), rows: sampleRows() });
        expect(table.getElement().outerHTML).toBe(legacyDOM.readonly);
        table.enterEditMode();
        expect(table.getElement().outerHTML).toBe(legacyDOM.editing);
    });

    test("renders runtime rows and columns in readonly mode", () => {
        const container = document.createElement("div");
        document.body.appendChild(container);

        createVanillaCheckboxTable({
            containerElement: container,
            columns: sampleColumns(),
            rows: sampleRows(),
        });

        const headers = container.querySelectorAll(".vct-header-cell");
        const rowNodes = container.querySelectorAll(".vct-row");
        const readonlyIcons = container.querySelectorAll(".vct-checkbox-indicator");
        expect(headers).toHaveLength(3);
        expect(rowNodes).toHaveLength(2);
        expect(readonlyIcons).toHaveLength(2);
        expect(readonlyIcons[0].textContent).toBe("✓");
        expect(readonlyIcons[1].textContent).toBe("✕");
        expect(readonlyIcons[0].closest(".vct-cell-checkbox")).not.toBeNull();
    });

    test("tracks dirty state and persists draft to localStorage in edit mode", () => {
        const container = document.createElement("div");
        document.body.appendChild(container);

        const table = createVanillaCheckboxTable({
            containerElement: container,
            columns: sampleColumns(),
            rows: sampleRows(),
            storageKey: "vct-draft-test",
            startInEditMode: true,
        });

        const firstCheckbox = container.querySelector(".vct-input-checkbox");
        expect(firstCheckbox).not.toBeNull();
        firstCheckbox.checked = false;
        firstCheckbox.dispatchEvent(new Event("change", { bubbles: true }));

        expect(table.isDirty()).toBe(true);
        const persisted = JSON.parse(localStorage.getItem("vct-draft-test"));
        expect(persisted.version).toBe(1);
        expect(persisted.editMode).toBe(true);
        expect(persisted.draftRows[0].enabled).toBe(false);
    });

    test("cancel reverts draft, exits edit mode, and clears persisted draft", () => {
        const container = document.createElement("div");
        document.body.appendChild(container);

        const table = createVanillaCheckboxTable({
            containerElement: container,
            columns: sampleColumns(),
            rows: sampleRows(),
            storageKey: "vct-cancel-test",
            startInEditMode: true,
        });

        const firstCheckbox = container.querySelector(".vct-input-checkbox");
        firstCheckbox.checked = false;
        firstCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
        expect(table.isDirty()).toBe(true);

        table.cancelChanges();
        expect(table.isDirty()).toBe(false);
        expect(table.isEditMode()).toBe(false);
        expect(table.getRows()[0].enabled).toBe(true);
        expect(localStorage.getItem("vct-cancel-test")).toBeNull();
    });

    test("cancel is available immediately in edit mode and exits without requiring dirty state", () => {
        const container = document.createElement("div");
        document.body.appendChild(container);

        const table = createVanillaCheckboxTable({
            containerElement: container,
            columns: sampleColumns(),
            rows: sampleRows(),
        });

        const editButton = container.querySelector(".vct-btn-edit");
        expect(editButton).not.toBeNull();
        editButton.click();

        const cancelButton = container.querySelector(".vct-btn-cancel");
        expect(cancelButton).not.toBeNull();
        expect(cancelButton.disabled).toBe(false);

        cancelButton.click();
        expect(table.isEditMode()).toBe(false);
    });

    test("applies configured column widths to header and body cells", () => {
        const container = document.createElement("div");
        document.body.appendChild(container);

        createVanillaCheckboxTable({
            containerElement: container,
            columns: [
                { key: "row_name", label: "Very long header label", type: "static", editable: false, width: "6rem", minWidth: "6rem", maxWidth: "6rem" },
                { key: "enabled", label: "Enabled", type: "checkbox", width: "5rem", minWidth: "5rem", maxWidth: "5rem" },
            ],
            rows: [{ id: "row-1", row_name: "title", enabled: true }],
        });

        const headerCells = container.querySelectorAll(".vct-header-cell");
        const bodyCells = container.querySelectorAll(".vct-row .vct-cell");
        expect(headerCells[0].style.width).toBe("6rem");
        expect(headerCells[0].style.maxWidth).toBe("6rem");
        expect(bodyCells[1].style.width).toBe("5rem");
        expect(bodyCells[1].style.maxWidth).toBe("5rem");
    });

    test("supports tri-state checkbox values plus custom header rendering and bulk updates", () => {
        const container = document.createElement("div");
        document.body.appendChild(container);

        const table = createVanillaCheckboxTable({
            containerElement: container,
            rowIdKey: "functionId",
            columns: [
                { key: "name", label: "Name", type: "static", editable: false },
                {
                    key: "group_10",
                    label: "Admins",
                    type: "checkbox",
                    renderHeaderCell: ({ column, setColumnValues }) => {
                        const button = document.createElement("button");
                        button.type = "button";
                        button.textContent = column.label;
                        button.addEventListener("click", () => {
                            setColumnValues(column.key, true);
                        });
                        return button;
                    },
                },
            ],
            rows: [
                { functionId: 1, name: "update_row", group_10: "ambiguous" },
            ],
        });

        const readonlyIndicator = container.querySelector(".vct-checkbox-indicator");
        expect(readonlyIndicator.dataset.state).toBe("ambiguous");
        expect(readonlyIndicator.textContent).toBe("~");

        table.enterEditMode();
        const checkbox = container.querySelector(".vct-input-checkbox");
        expect(checkbox.indeterminate).toBe(true);

        table.exitEditMode();
        container.querySelector(".vct-header-cell button").click();
        expect(table.getRows({ draft: true })[0].group_10).toBe(true);
    });

    test("renders cell-level edit buttons inside readonly editable cells and clicking one enters edit mode", () => {
        const container = document.createElement("div");
        document.body.appendChild(container);

        const table = createVanillaCheckboxTable({
            containerElement: container,
            columns: sampleColumns(),
            rows: sampleRows(),
            showCellEditButtonOnHover: true,
        });

        const readonlyEditButton = container.querySelector(".vct-row .vct-cell-checkbox .vct-cell-edit-button");
        expect(readonlyEditButton).not.toBeNull();
        expect(readonlyEditButton.closest(".vct-cell")).not.toBeNull();
        expect(readonlyEditButton.closest(".vct-toolbar")).toBeNull();
        expect(readonlyEditButton.closest(".vct-readonly-cell-shell")).not.toBeNull();

        readonlyEditButton.click();

        expect(table.isEditMode()).toBe(true);
        expect(container.querySelector(".vct-input-checkbox")).not.toBeNull();
    });

    test("appends custom readonly nodes directly without wrapping them in an inline span", () => {
        const container = document.createElement("div");
        document.body.appendChild(container);

        createVanillaCheckboxTable({
            containerElement: container,
            columns: [
                {
                    key: "label",
                    label: "Label",
                    type: "static",
                    editable: false,
                    renderReadOnlyCell: () => {
                        const customNode = document.createElement("div");
                        customNode.classList.add("custom-readonly-node");
                        customNode.textContent = "Custom";
                        return customNode;
                    },
                },
            ],
            rows: [{ id: "row-1", label: "ignored" }],
        });

        const cell = container.querySelector(".vct-row .vct-cell");
        const customNode = container.querySelector(".custom-readonly-node");
        expect(customNode).not.toBeNull();
        expect(cell.firstElementChild).toBe(customNode);
    });

    test("save calls onSave with changedCells and commits draft as base", async () => {
        const onSave = vi.fn().mockResolvedValue(undefined);
        const container = document.createElement("div");
        document.body.appendChild(container);

        const table = createVanillaCheckboxTable({
            containerElement: container,
            columns: sampleColumns(),
            rows: sampleRows(),
            onSave,
            startInEditMode: true,
        });

        const select = container.querySelector(".vct-input-select");
        select.value = "header";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        expect(table.isDirty()).toBe(true);

        await table.saveChanges();

        expect(onSave).toHaveBeenCalledTimes(1);
        const payload = onSave.mock.calls[0][0];
        expect(payload.changedCells).toEqual([
            {
                rowId: "row-1",
                columnKey: "mode",
                previousValue: "details",
                nextValue: "header",
            },
        ]);
        expect(table.isDirty()).toBe(false);
        expect(table.isEditMode()).toBe(false);
        expect(table.getRows()[0].mode).toBe("header");
    });

    test("restores persisted draft rows and edit mode from localStorage", () => {
        const persisted = {
            version: 1,
            editMode: true,
            draftRows: [
                { id: "row-1", row_name: "title", enabled: false, mode: "details" },
                { id: "row-2", row_name: "summary", enabled: false, mode: "header" },
            ],
        };
        localStorage.setItem("vct-restore-test", JSON.stringify(persisted));

        const container = document.createElement("div");
        document.body.appendChild(container);

        const table = createVanillaCheckboxTable({
            containerElement: container,
            columns: sampleColumns(),
            rows: sampleRows(),
            storageKey: "vct-restore-test",
        });

        expect(table.isEditMode()).toBe(true);
        expect(table.isDirty()).toBe(true);
        expect(table.getRows({ draft: true })[0].enabled).toBe(false);
    });
    test("pins legacy DOM, native tab sequence, copy, payload and rejected/recovered saves", async () => {
        const container = document.body.appendChild(document.createElement("div"));
        const onSave = vi.fn().mockRejectedValueOnce(new Error("refused")).mockResolvedValue(null);
        localStorage.setItem("legacy", JSON.stringify({ version: 1, editMode: true,
            draftRows: [{ ...sampleRows()[0], enabled: false }, sampleRows()[1]] }));
        const table = createVanillaCheckboxTable({ containerElement: container, columns: sampleColumns(),
            rows: sampleRows(), storageKey: "legacy", onSave });
        expect([...container.firstChild.children].map(node => node.className)).toEqual(["vct-toolbar", "vct-table-wrapper"]);
        expect(container.querySelector("table").innerHTML).not.toMatch(/scope=|aria-label=|rowgroup/);
        expect([...container.querySelectorAll(".vct-toolbar button")].map(node => node.textContent)).toEqual(["Edit", "Save", "Cancel"]);
        expect([...container.querySelectorAll("button, input, select")].map(node => [node.tagName, node.tabIndex]))
            .toEqual([["BUTTON", 0], ["BUTTON", 0], ["BUTTON", 0], ["INPUT", 0], ["SELECT", 0], ["INPUT", 0], ["SELECT", 0]]);
        await expect(table.saveChanges()).rejects.toThrow("refused");
        expect(table.isDirty()).toBe(true);
        expect(localStorage.getItem("legacy")).not.toBeNull();
        await expect(table.saveChanges()).resolves.toBe(true);
        expect(onSave).toHaveBeenLastCalledWith({ rows: [{ ...sampleRows()[0], enabled: false }, sampleRows()[1]],
            changedCells: [{ rowId: "row-1", columnKey: "enabled", previousValue: true, nextValue: false }] });
        expect(localStorage.getItem("legacy")).toBeNull();
        table.enterEditMode();
        table.destroy();
        expect(localStorage.getItem("legacy")).toBeNull();
    });

    test("Cancel after legacy recovery restores baseline order and values", () => {
        localStorage.setItem("legacy-cancel", JSON.stringify({ version: 1, editMode: true,
            draftRows: [sampleRows()[1], { ...sampleRows()[0], enabled: false }] }));
        const table = createVanillaCheckboxTable({ containerElement: document.body, columns: sampleColumns(),
            rows: sampleRows(), storageKey: "legacy-cancel" });
        expect(table.getRows({ draft: true }).map(row => row.id)).toEqual(["row-1", "row-2"]);
        table.cancelChanges();
        expect(table.getRows({ draft: true })).toEqual(sampleRows());
        expect(localStorage.getItem("legacy-cancel")).toBeNull();
    });

});
