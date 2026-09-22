// dataset_column_table.js
// The one table of columns both dataset forms show: a header row that names
// each field once, and one row per column.
// Bridges the creation page and the Manage table dialog with the shared type
// catalogue, the card roles and one set of language keys.
// Exists so a column is drawn by one renderer, and its state — new or existing,
// untouched or changed — is held by the row rather than by two row builders.
import { setDatasetFormText } from "./dataset_form_text.js";
import { getCardRoleOptions, isValidCardRole } from "../../table_views/card_view/card_role_catalog.js";
import {
    COLUMN_TYPE_PARAMETER,
    DEFAULT_NUMERIC_PRECISION,
    DEFAULT_NUMERIC_SCALE,
    composeColumnTypeDefinition,
    findDatasetColumnType,
    getColumnTypeParameter,
    getDatasetColumnTypeOptions,
} from "./dataset_column_type_catalog.js";

// One key per field, in both modes.
const HEADER_KEYS = Object.freeze({
    name: "column_name",
    type: "data_type",
    parameters: "dataset_column_type_parameters",
    role: "card_role",
    multilingual: "manage_table_column_multilingual",
    actions: "actions",
});
const PARAMETER_KEYS = Object.freeze({
    length: "length",
    precision: "dataset_column_type_precision",
    scale: "dataset_column_type_scale",
});

let tableSequence = 0;
let rowSequence = 0;

/**
 * Build the column table for one dataset form.
 *
 * @param {object} options
 * @param {"create"|"edit"} options.mode - "create" describes a dataset that does
 *   not exist yet; "edit" also shows the columns a dataset already has, offers
 *   stored role variants, and a multilingual choice for each column being added
 * @param {() => boolean} [options.multilingualDefault] - the dataset's current
 *   default for a new text column (edit mode)
 * @returns {object} the table's element and the operations its form needs
 */
export function createDatasetColumnTable({ mode = "create", multilingualDefault = () => false } = {}) {
    const editing = mode === "edit";
    const idPrefix = `dataset-column-table-${++tableSequence}`;
    const headerId = (field) => `${idPrefix}-${field}`;
    const fields = ["name", "type", "parameters", "role", ...(editing ? ["multilingual"] : []), "actions"];
    const typeOptions = getDatasetColumnTypeOptions(editing ? "edit" : "create");
    const roleOptions = getCardRoleOptions({ includeLegacyVariants: editing });
    const rowHandles = new WeakMap();

    const table = document.createElement("div");
    table.className = `dataset-column-table${editing ? " dataset-column-table--multilingual" : ""}`;
    table.setAttribute("role", "table");
    table.dataset.testid = "dataset-column-table";

    // The header row is the only place the field names are shown while the
    // table is wide; every control is named by its column's header cell.
    const header = document.createElement("div");
    header.className = "dataset-column-table__header";
    header.setAttribute("role", "row");
    for (const field of fields) {
        const cell = setDatasetFormText(document.createElement("div"), HEADER_KEYS[field]);
        cell.id = headerId(field);
        cell.setAttribute("role", "columnheader");
        cell.className = `dataset-column-table__heading dataset-column-table__cell--${field}`;
        header.appendChild(cell);
    }
    table.appendChild(header);

    const addButton = setDatasetFormText(document.createElement("button"), "add_column");
    addButton.type = "button";
    addButton.dataset.testid = "dataset-column-add";
    addButton.classList.add("modal-button", "secondary", "saturate_on_hover");
    addButton.addEventListener("click", () => addColumn());

    const element = document.createElement("div");
    element.className = "dataset-column-table-block";
    element.append(table, addButton);

    /**
     * One cell. A control is named by its column's header cell; the field's
     * name reappears beside it only when the table is stacked on a narrow screen.
     */
    function createCell(field, control = null) {
        const cell = document.createElement("div");
        cell.setAttribute("role", "cell");
        cell.className = `dataset-column-table__cell dataset-column-table__cell--${field}`;
        if (!control) return { cell, wrapper: cell };
        const wrapper = document.createElement("label");
        wrapper.className = "dataset-column-table__field";
        const stackedLabel = setDatasetFormText(document.createElement("span"), HEADER_KEYS[field]);
        stackedLabel.className = "dataset-column-table__cell-label";
        stackedLabel.setAttribute("aria-hidden", "true");
        control.setAttribute("aria-labelledby", headerId(field));
        wrapper.append(stackedLabel, control);
        cell.appendChild(wrapper);
        return { cell, wrapper };
    }

    function createParameter(name, key, attributes) {
        const label = document.createElement("label");
        label.className = `dataset-column-table__parameter dataset-column-table__parameter--${name}`;
        const input = Object.assign(document.createElement("input"), { type: "number", name, ...attributes });
        label.append(setDatasetFormText(document.createElement("span"), key), input);
        return { label, input };
    }

    /**
     * Add one column row.
     *
     * @param {object} [column]
     * @param {boolean} [column.existing] - the dataset already holds this column
     * @param {string} [column.name]
     * @param {string} [column.dataType] - a stored type outside the catalogue stays selected
     * @param {number|string} [column.length]
     * @param {string} [column.role] - a stored role, variants included
     * @returns {object} the row's handle
     */
    function addColumn({ existing = false, name = "", dataType = "", length = "", role = "details" } = {}) {
        const row = document.createElement("div");
        row.className = "dataset-column-table__row";
        row.setAttribute("role", "row");

        const nameInput = Object.assign(document.createElement("input"), { type: "text", name: "column_name", value: name || "" });
        nameInput.id = `${idPrefix}-column-${++rowSequence}`;

        const typeSelect = document.createElement("select");
        typeSelect.name = "data_type";
        typeSelect.appendChild(setDatasetFormText(Object.assign(document.createElement("option"), { value: "" }), "select_data_type"));
        const knownType = findDatasetColumnType(dataType)?.value || "";
        for (const entry of typeOptions) {
            typeSelect.appendChild(setDatasetFormText(Object.assign(document.createElement("option"), { value: entry.value }), entry.labelKey));
        }
        // A stored type outside the catalogue stays selected, so an unrelated
        // Save cannot reinterpret the column's schema.
        const storedType = String(dataType || "").toUpperCase();
        if (storedType && !knownType) {
            typeSelect.appendChild(Object.assign(document.createElement("option"), { value: storedType, textContent: storedType }));
        }
        typeSelect.value = knownType || storedType;

        const lengthField = createParameter("length", PARAMETER_KEYS.length, { min: "1", value: length || "" });
        const precisionField = createParameter("precision", PARAMETER_KEYS.precision, { min: "1", max: "1000" });
        const scaleField = createParameter("scale", PARAMETER_KEYS.scale, { min: "0" });
        const parameters = document.createElement("div");
        parameters.className = "dataset-column-table__parameters";
        parameters.append(lengthField.label, precisionField.label, scaleField.label);

        const roleSelect = document.createElement("select");
        roleSelect.name = "card_role";
        for (const { value, labelKey } of roleOptions) {
            roleSelect.appendChild(setDatasetFormText(Object.assign(document.createElement("option"), { value }), labelKey));
        }
        const storedRole = String(role || "details");
        roleSelect.value = isValidCardRole(storedRole) ? storedRole : "details";
        if (roleSelect.value !== storedRole) roleSelect.value = "details";
        let savedRole = roleSelect.value;

        // Removal names the column it removes, as its value reads now.
        const removeButton = setDatasetFormText(document.createElement("button"), "delete");
        removeButton.type = "button";
        removeButton.id = `${nameInput.id}-remove`;
        removeButton.className = "dataset-column-table__remove dataset-form-button";
        removeButton.setAttribute("aria-labelledby", `${removeButton.id} ${nameInput.id}`);
        removeButton.addEventListener("click", () => row.remove());

        const cells = [
            createCell("name", nameInput),
            createCell("type", typeSelect),
            createCell("parameters"),
            createCell("role", roleSelect),
        ];
        cells[2].cell.append(parameters);

        // A column being added may be multilingual; the choice follows the
        // dataset's default until the person sets it for this column.
        let multilingualInput = null;
        if (editing) {
            if (!existing) {
                multilingualInput = Object.assign(document.createElement("input"), { type: "checkbox", name: "is_multilingual" });
                multilingualInput.checked = multilingualDefault() === true;
                multilingualInput.addEventListener("change", () => { multilingualInput.dataset.multilingualOverride = "true"; });
            }
            const multilingualCell = createCell("multilingual", multilingualInput);
            if (multilingualInput) multilingualCell.wrapper.classList.add("dataset-column-table__multilingual");
            cells.push(multilingualCell);
        }
        const actionsCell = createCell("actions");
        actionsCell.cell.appendChild(removeButton);
        cells.push(actionsCell);
        row.append(...cells.map(({ cell }) => cell));

        // Only the parameters the chosen type uses are shown. An untouched
        // decimal column keeps its stored precision: its fields stay empty
        // until the person picks a type, which is what tells a Save that
        // nothing about the type changed.
        const showParameter = ({ label, input }, visible) => {
            label.style.display = visible ? "" : "none";
            label.setAttribute("aria-hidden", String(!visible));
            input.tabIndex = visible ? 0 : -1;
            if (!visible) input.value = "";
        };
        const syncType = ({ prefill = false } = {}) => {
            const parameter = getColumnTypeParameter(typeSelect.value);
            const usesLength = parameter === COLUMN_TYPE_PARAMETER.LENGTH;
            const usesPrecision = parameter === COLUMN_TYPE_PARAMETER.PRECISION;
            showParameter(lengthField, usesLength);
            // Creation requires a length for limited text; editing keeps its
            // existing leniency until the two are reconciled deliberately.
            lengthField.input.required = !editing && usesLength;
            showParameter(precisionField, usesPrecision);
            showParameter(scaleField, usesPrecision);
            if (prefill && usesPrecision && !precisionField.input.value) {
                precisionField.input.value = String(DEFAULT_NUMERIC_PRECISION);
                scaleField.input.value = String(DEFAULT_NUMERIC_SCALE);
            }
            if (multilingualInput) {
                const textColumn = ["TEXT", "VARCHAR"].includes(typeSelect.value);
                multilingualInput.parentElement.style.display = textColumn ? "" : "none";
                multilingualInput.disabled = !textColumn;
            }
        };
        typeSelect.addEventListener("change", () => syncType({ prefill: true }));
        syncType();

        let originalName = existing ? String(name) : null;
        const snapshot = () => JSON.stringify([
            nameInput.value.trim(), typeSelect.value, lengthField.input.value, precisionField.input.value,
            scaleField.input.value, roleSelect.value, multilingualInput?.checked ?? null,
        ]);
        let baseline = snapshot();
        let lastRead = baseline;
        // The row's state is part of the page, where tests and styles can read it.
        const showState = () => {
            row.dataset.rowState = originalName === null ? "new" : "existing";
            row.dataset.rowChanged = String(snapshot() !== baseline);
        };
        row.addEventListener("input", showState);
        row.addEventListener("change", showState);

        const handle = {
            element: row,
            /** New or existing, and untouched or changed since it was last saved. */
            state: () => ({ existing: originalName !== null, changed: snapshot() !== baseline }),
            /**
             * The column as the row describes it now. A decimal type travels
             * complete only when its numbers were filled in.
             */
            read: () => {
                lastRead = snapshot();
                const usesPrecision = getColumnTypeParameter(typeSelect.value) === COLUMN_TYPE_PARAMETER.PRECISION
                    && String(precisionField.input.value).trim() !== "";
                return {
                    existing: originalName !== null,
                    originalName,
                    name: nameInput.value.trim(),
                    dataType: usesPrecision
                        ? composeColumnTypeDefinition(typeSelect.value, {
                            precision: precisionField.input.value, scale: scaleField.input.value,
                        })
                        : typeSelect.value,
                    length: lengthField.input.value ? parseInt(lengthField.input.value, 10) : null,
                    isMultilingual: multilingualInput?.checked,
                    role: roleSelect.value,
                    roleChanged: roleSelect.value !== savedRole,
                };
            },
            /**
             * The server now holds this column under this name: the row becomes
             * an existing one, measured from what was sent, and no longer offers
             * the choice only a column being added has.
             */
            markSaved: (savedName) => {
                originalName = String(savedName);
                nameInput.dataset.originalName = originalName;
                baseline = lastRead;
                multilingualInput?.parentElement.remove();
                multilingualInput = null;
                showState();
            },
            /** The server now holds this role for the column. */
            acceptRole: (acceptedRole) => {
                savedRole = acceptedRole;
                showState();
            },
            /** The dataset's default changed; a column the person set keeps its choice. */
            followMultilingualDefault: (checked) => {
                if (multilingualInput && multilingualInput.dataset.multilingualOverride !== "true") {
                    multilingualInput.checked = checked;
                }
            },
        };
        if (existing) nameInput.dataset.originalName = originalName;
        rowHandles.set(row, handle);
        table.appendChild(row);
        showState();
        return handle;
    }

    const rows = () => [...table.children].map((row) => rowHandles.get(row)).filter(Boolean);

    return {
        /** The table and its "Add column" button. */
        element,
        table,
        addColumn,
        /** Every column row, in the order shown. */
        rows,
        /** Remove every column row, for a form that starts over. */
        clear: () => rows().forEach(({ element: row }) => row.remove()),
        /** The column names the form currently shows, including ones about to be added. */
        columnNames: () => rows().map((row) => row.element.querySelector('[name="column_name"]').value.trim()).filter(Boolean),
        /** Let every column being added follow a new dataset default. */
        setMultilingualDefault: (checked) => rows().forEach((row) => row.followMultilingualDefault(checked)),
    };
}
