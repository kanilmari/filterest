// vanilla_checkbox_table.js
// Builds a reusable editable table for runtime-defined rows and columns.
// Bridges generic data models, edit/save/cancel controls, and localStorage draft persistence.
// Exists to centralize checkbox-matrix style UI behavior without coupling to any feature endpoint.

import { STORAGE_VERSION, deepClone, toTextValue, isEqualValue, normalizeColumns,
    normalizeCheckboxState, appendRenderableContent, toRenderableNode, safeParseStorage,
    toRowIdentifier, restoreDraftRows, resolveReadonlyText, buildChangedCells } from "./checkbox_table_values.js";
import { createCheckboxTableFeatures } from "./checkbox_table_features.js";
import { createCheckboxTableDraft } from "./checkbox_table_draft.js";

/**
 * Creates a reusable editable checkbox table instance.
 *
 * @param {Object} options See README.md for the legacy and opt-in contracts.
 */
export function createVanillaCheckboxTable(options) {
    const {
        containerElement,
        rowIdKey = "id",
        onSave = null,
        onDirtyChange = null,
        onEditModeChange = null,
        storageKey = "",
        persistDraftToLocalStorage = true,
        editLabel = "Edit",
        saveLabel = "Save",
        cancelLabel = "Cancel",
        dirtyLabel = "Unsaved changes",
        cleanLabel = "",
        showCellEditButtonOnHover = false,
        renderCellEditButton = null,
        rowClassName = null,
    } = options || {};

    if (!(containerElement instanceof HTMLElement)) {
        throw new Error("createVanillaCheckboxTable requires a valid containerElement.");
    }

    let columns = normalizeColumns(options?.columns || []);
    let baseRows = deepClone(Array.isArray(options?.rows) ? options.rows : []);
    let draftRows = deepClone(baseRows);
    let isEditMode = Boolean(options?.startInEditMode);
    let isDirty = false;
    let isSaving = false;

    const rootElement = document.createElement("div");
    rootElement.classList.add("vct-root");

    const toolbarElement = document.createElement("div");
    toolbarElement.classList.add("vct-toolbar");

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.classList.add("vct-btn", "vct-btn-edit");
    editButton.textContent = editLabel;

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.classList.add("vct-btn", "vct-btn-save");
    saveButton.textContent = saveLabel;

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.classList.add("vct-btn", "vct-btn-cancel");
    cancelButton.textContent = cancelLabel;

    const statusElement = document.createElement("span");
    statusElement.classList.add("vct-status");

    toolbarElement.appendChild(editButton);
    toolbarElement.appendChild(saveButton);
    toolbarElement.appendChild(cancelButton);
    toolbarElement.appendChild(statusElement);

    const tableWrapperElement = document.createElement("div");
    tableWrapperElement.classList.add("vct-table-wrapper");

    const tableElement = document.createElement("table");
    tableElement.classList.add("vct-table");
    const tableHeadElement = document.createElement("thead");
    const tableBodyElement = document.createElement("tbody");
    tableElement.appendChild(tableHeadElement);
    tableElement.appendChild(tableBodyElement);

    rootElement.appendChild(toolbarElement);
    tableWrapperElement.appendChild(tableElement);
    rootElement.appendChild(tableWrapperElement);
    containerElement.replaceChildren(rootElement);

    const state = {
        get rows() { return draftRows; }, set rows(value) { draftRows = value; },
        get base() { return baseRows; }, set base(value) { baseRows = value; },
        get columns() { return columns; },
        get editing() { return isEditMode; }, set editing(value) { isEditMode = value; },
        get saving() { return isSaving; },
        frozen: () => draft.frozen(),
        changed: () => buildChangedCells(baseRows, draftRows, columns, rowIdKey,
            { editableOnly: features.enabled || draft.enabled || draft.verified }),
        render: () => render(), recompute: () => recomputeDirtyState(),
        disabled: (row, index, column) => resolveCellDisabledState(row, index, column),
    };
    const features = createCheckboxTableFeatures(options, state, rootElement, tableElement);
    const draft = createCheckboxTableDraft(options, state, features);

    function emitDirtyChange() {
        if (typeof onDirtyChange === "function") {
            onDirtyChange(isDirty);
        }
    }

    function emitEditModeChange() {
        if (typeof onEditModeChange === "function") {
            onEditModeChange(isEditMode);
        }
    }

    function clearPersistedDraft() {
        if (!storageKey) return;
        try {
            localStorage.removeItem(storageKey);
        } catch {
            // LocalStorage can fail in private mode or blocked contexts.
        }
    }

    function persistDraftIfNeeded() {
        if (!storageKey || !persistDraftToLocalStorage || draft.preserve()) return;
        if (!isDirty && !isEditMode) {
            clearPersistedDraft();
            return;
        }

        const payload = draft.enabled ? draft.payload() : {
            version: STORAGE_VERSION,
            editMode: isEditMode,
            draftRows: draftRows,
        };
        try {
            localStorage.setItem(storageKey, JSON.stringify(payload));
        } catch {
            // Ignore storage quota errors for UI continuity.
        }
    }

    function recomputeDirtyState() {
        const changedCells = state.changed();
        const nextDirty = changedCells.length > 0 || features.orderChanged() || draft.metadataChanged();
        const dirtyChanged = nextDirty !== isDirty;
        isDirty = nextDirty;
        if (dirtyChanged) {
            emitDirtyChange();
        }
        persistDraftIfNeeded();
        syncToolbar();
    }

    function syncToolbar() {
        editButton.style.display = isEditMode ? "none" : "";
        saveButton.style.display = isEditMode ? "" : "none";
        cancelButton.style.display = isEditMode ? "" : "none";
        saveButton.disabled = isSaving || !isDirty || draft.blocked();
        cancelButton.disabled = isSaving;
        statusElement.textContent = isDirty ? dirtyLabel : cleanLabel;
        statusElement.dataset.state = isDirty ? "dirty" : "clean";
        statusElement.style.visibility = statusElement.textContent ? "visible" : "hidden";
    }

    function setEditMode(nextMode) {
        const normalized = Boolean(nextMode);
        if (normalized === isEditMode) return;
        isEditMode = normalized;
        persistDraftIfNeeded();
        emitEditModeChange();
        renderTableHead();
        renderTableBody();
        syncToolbar();
    }

    function handleCellInputChange(rowIndex, columnKey, nextValue) {
        if (draft.frozen() || !draftRows[rowIndex]) return;
        draftRows[rowIndex][columnKey] = nextValue;
        recomputeDirtyState();
        renderTableHead();
        features.refreshToggles();
    }

    function setColumnValues(columnKey, nextValue, { rowFilter = null } = {}) {
        if (draft.frozen()) return;
        draftRows.forEach((row, rowIndex) => {
            if (typeof rowFilter === "function" && !rowFilter(row, rowIndex)) {
                return;
            }
            const column = columns.find(item => item.key === columnKey);
            if (features.enabled && (!column || column.rowToggle || !features.writable(row, column))) return;
            draftRows[rowIndex][columnKey] = nextValue;
        });
        recomputeDirtyState();
        renderTableBody();
        renderTableHead();
    }

    function buildRendererApi() {
        return {
            getRows({ draft = false } = {}) {
                return deepClone(draft ? draftRows : baseRows);
            },
            isEditMode,
            isDirty,
            setColumnValues,
        };
    }

    function resolveCellDisabledState(row, rowIndex, column) {
        return column.isCellDisabled
            ? Boolean(column.isCellDisabled({
                value: row[column.key],
                row,
                column,
                rowIndex,
                isEditMode,
            }))
            : false;
    }

    function createReadonlyCellContent(row, rowIndex, column) {
        if (!features.supported(row, column)) return features.unsupported(row, column);
        if (column.rowToggle) return features.toggle(row, column);
        const value = row[column.key];
        if (column.renderReadOnlyCell) {
            const customContent = column.renderReadOnlyCell({
                value,
                row,
                column,
                rowIndex,
            });
            if (customContent !== null && customContent !== undefined) {
                return toRenderableNode(customContent);
            }
        }
        if (column.type === "checkbox") {
            const icon = document.createElement("span");
            icon.classList.add("vct-checkbox-indicator");
            const checkboxState = normalizeCheckboxState(value);
            icon.dataset.checked = checkboxState === "checked" ? "true" : "false";
            icon.dataset.state = checkboxState;
            if (checkboxState === "checked") {
                icon.textContent = "✓";
            } else if (checkboxState === "ambiguous") {
                icon.textContent = "~";
            } else {
                icon.textContent = "✕";
            }
            return icon;
        }

        const textNode = document.createElement("span");
        textNode.classList.add("vct-cell-text");
        textNode.textContent = resolveReadonlyText(value, row, column);
        return textNode;
    }

    function createCellEditButton(row, rowIndex, column) {
        const button = document.createElement("button");
        button.type = "button";
        button.classList.add("vct-cell-edit-button");
        button.setAttribute("aria-label", editLabel);
        button.title = editLabel;

        const customButtonContent = typeof renderCellEditButton === "function"
            ? renderCellEditButton({ row, column, rowIndex })
            : null;

        if (customButtonContent !== null && customButtonContent !== undefined) {
            button.appendChild(toRenderableNode(customButtonContent, "vct-cell-edit-glyph"));
        } else {
            const glyph = document.createElement("span");
            glyph.classList.add("vct-cell-edit-glyph");
            glyph.textContent = "✎";
            button.appendChild(glyph);
        }

        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            setEditMode(true);
        });

        return button;
    }

    function createReadonlyCellNode(row, rowIndex, column) {
        const contentNode = createReadonlyCellContent(row, rowIndex, column);
        const showInlineEditButton = showCellEditButtonOnHover &&
            !isEditMode &&
            features.supported(row, column) &&
            column.editable &&
            !resolveCellDisabledState(row, rowIndex, column);

        if (!showInlineEditButton) {
            return contentNode;
        }

        const shell = document.createElement("div");
        shell.classList.add("vct-readonly-cell-shell");

        const contentWrapper = document.createElement("div");
        contentWrapper.classList.add("vct-readonly-cell-content");
        contentWrapper.appendChild(contentNode);

        shell.appendChild(contentWrapper);
        shell.appendChild(createCellEditButton(row, rowIndex, column));

        return shell;
    }

    function createEditableCellContent(row, rowIndex, column) {
        if (!features.supported(row, column)) return features.unsupported(row, column);
        if (column.rowToggle) return features.toggle(row, column);
        if (!column.editable) {
            return createReadonlyCellNode(row, rowIndex, column);
        }

        // Resolve identity at activation: moving an existing DOM row must not stale its inputs.
        const rowId = toRowIdentifier(row, rowIdKey);
        const updateValue = nextValue => handleCellInputChange(
            options.reorder ? draftRows.findIndex(item => toRowIdentifier(item, rowIdKey) === rowId) : rowIndex, column.key, nextValue);
        const currentValue = row[column.key];
        const isDisabled = resolveCellDisabledState(row, rowIndex, column);

        if (column.renderEditableCell) {
            const customContent = column.renderEditableCell({
                value: currentValue,
                row,
                column,
                rowIndex,
                updateValue(nextValue) {
                    if (!features.enabled || features.writable(draftRows.find(item => toRowIdentifier(item, rowIdKey) === rowId), column)) updateValue(nextValue);
                },
                isDisabled,
            });
            if (customContent !== null && customContent !== undefined) {
                return toRenderableNode(customContent);
            }
        }

        if (column.type === "checkbox") {
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.classList.add("vct-input-checkbox");
            const checkboxState = normalizeCheckboxState(currentValue);
            checkbox.checked = checkboxState === "checked";
            checkbox.indeterminate = checkboxState === "ambiguous";
            if (checkboxState === "ambiguous") {
                checkbox.classList.add("vct-input-checkbox-ambiguous");
            }
            checkbox.disabled = isDisabled;
            checkbox.addEventListener("change", () => {
                checkbox.indeterminate = false;
                checkbox.classList.remove("vct-input-checkbox-ambiguous");
                updateValue(checkbox.checked);
            });
            return checkbox;
        }

        if (column.type === "select") {
            const select = document.createElement("select");
            select.classList.add("vct-input-select");

            const emptyOption = document.createElement("option");
            emptyOption.value = "";
            emptyOption.textContent = "-";
            select.appendChild(emptyOption);

            column.options.forEach((option) => {
                const optionNode = document.createElement("option");
                optionNode.value = toTextValue(option.value);
                optionNode.textContent = option.label;
                if (isEqualValue(option.value, currentValue)) {
                    optionNode.selected = true;
                }
                select.appendChild(optionNode);
            });

            if (currentValue === null || currentValue === undefined || currentValue === "") {
                select.value = "";
            }
            select.disabled = isDisabled;

            select.addEventListener("change", () => {
                if (select.value === "") {
                    updateValue(null);
                    return;
                }
                const matchingOption = column.options.find((option) => toTextValue(option.value) === select.value);
                const normalizedValue = matchingOption ? matchingOption.value : select.value;
                updateValue(normalizedValue);
            });
            return select;
        }

        const textInput = document.createElement("input");
        textInput.type = "text";
        textInput.classList.add("vct-input-text");
        textInput.value = toTextValue(currentValue);
        textInput.disabled = isDisabled;
        textInput.addEventListener("input", () => {
            updateValue(textInput.value);
        });
        return textInput;
    }

    function renderTableHead() {
        tableHeadElement.replaceChildren();
        const headerRow = document.createElement("tr");
        const rendererApi = buildRendererApi();
        columns.forEach((column) => {
            const th = document.createElement("th");
            th.classList.add("vct-header-cell");
            if (column.className) th.classList.add(column.className);
            if (column.width) th.style.width = column.width;
            if (column.minWidth) th.style.minWidth = column.minWidth;
            if (column.maxWidth) th.style.maxWidth = column.maxWidth;
            if (column.renderHeaderCell) {
                appendRenderableContent(th, column.renderHeaderCell({
                    column,
                    ...rendererApi,
                }));
            } else {
                th.textContent = toTextValue(column.label || column.key);
            }
            headerRow.appendChild(th);
        });
        tableHeadElement.appendChild(headerRow);
        features.decorateHead();
    }

    function renderTableBody() {
        features.clearGroups();
        tableBodyElement.replaceChildren();
        draftRows.forEach((row, rowIndex) => {
            const tr = document.createElement("tr");
            tr.classList.add("vct-row");
            tr.dataset.rowId = toRowIdentifier(row, rowIdKey);
            if (typeof rowClassName === "function") {
                const customClasses = rowClassName(row, rowIndex);
                const normalizedClasses = Array.isArray(customClasses)
                    ? customClasses
                    : [customClasses];
                normalizedClasses
                    .filter((classNameValue) => typeof classNameValue === "string" && classNameValue.trim() !== "")
                    .forEach((classNameValue) => tr.classList.add(classNameValue));
            }

            columns.forEach((column) => {
                const td = document.createElement(options.rowHeaderKey === column.key ? "th" : "td");
                td.classList.add("vct-cell");
                td.classList.add(`vct-cell-${column.type}`);
                if (column.className) td.classList.add(column.className);
                if (column.width) td.style.width = column.width;
                if (column.minWidth) td.style.minWidth = column.minWidth;
                if (column.maxWidth) td.style.maxWidth = column.maxWidth;
                const contentNode = isEditMode
                    ? createEditableCellContent(row, rowIndex, column)
                    : createReadonlyCellNode(row, rowIndex, column);
                td.appendChild(contentNode);
                features.decorateCell(td, row, column);
                tr.appendChild(td);
            });

            features.appendRow(tr, row, tableBodyElement);
        });
        features.finishBody();
        draft.freezeControls();
    }

    function render() {
        renderTableHead();
        renderTableBody();
        syncToolbar();
    }

    function restorePersistedStateIfAvailable() {
        if (!storageKey || !persistDraftToLocalStorage) return;
        if (draft.enabled) { draft.restore(localStorage.getItem(storageKey)); return; }
        const persisted = safeParseStorage(localStorage.getItem(storageKey));
        if (!persisted) return;
        draftRows = restoreDraftRows(baseRows, persisted.draftRows, rowIdKey);
        isEditMode = Boolean(persisted.editMode);
        recomputeDirtyState();
    }

    async function saveChanges() {
        if (isSaving || !isDirty || draft.blocked()) return false;
        isSaving = true;
        syncToolbar();
        const generation = draft.generation();
        draft.freezeControls();
        try {
            const payload = draft.verified ? draft.changeSet() : {
                rows: deepClone(draftRows),
                changedCells: state.changed(),
            };
            const submitted = draft.verified ? deepClone(payload) : payload;
            if (typeof onSave === "function") {
                const result = await onSave(payload);
                if (draft.verified) {
                    if (!draft.current(generation)) return false;
                    draft.adopt(result, submitted);
                }
            }
            if (draft.verified && typeof onSave !== "function") draft.adopt(undefined, payload);
            if (!draft.verified) { baseRows = deepClone(draftRows); draft.acceptMetadata(); }
            isDirty = false;
            emitDirtyChange();
            clearPersistedDraft();
            setEditMode(false);
            renderTableBody();
            syncToolbar();
            return true;
        } catch (error) {
            if (draft.current(generation)) draft.saveFailed(error);
            throw error;
        } finally {
            isSaving = false;
            draft.freezeControls();
            syncToolbar();
        }
    }

    function cancelChanges() {
        if (draft.verified && isSaving) return;
        draft.cancel();
        if (draft.enabled) clearPersistedDraft();
        if (!isDirty) {
            setEditMode(false);
            draft.freezeControls();
            return;
        }
        draftRows = deepClone(baseRows);
        isDirty = false;
        emitDirtyChange();
        clearPersistedDraft();
        setEditMode(false);
        renderTableBody();
        syncToolbar();
    }

    function setRows(nextRows, { resetDraft = true, ...snapshot } = {}) {
        draft.fresh(snapshot);
        const normalizedRows = deepClone(Array.isArray(nextRows) ? nextRows : []);
        baseRows = normalizedRows;
        if (resetDraft) {
            draftRows = deepClone(normalizedRows);
            isDirty = false;
            emitDirtyChange();
            clearPersistedDraft();
        } else {
            draftRows = deepClone(normalizedRows);
            recomputeDirtyState();
        }
        render();
    }

    function setColumns(nextColumns) {
        columns = normalizeColumns(nextColumns || []);
        recomputeDirtyState();
        render();
    }

    editButton.addEventListener("click", () => {
        setEditMode(true);
    });
    saveButton.addEventListener("click", () => {
        void saveChanges();
    });
    cancelButton.addEventListener("click", () => {
        cancelChanges();
    });

    restorePersistedStateIfAvailable();
    render();
    recomputeDirtyState();

    return {
        moveRow: features.moveRow,
        setRowFilter: features.setRowFilter,
        getChangeSet: draft.changeSet,
        setDraftMetadata: draft.setMetadata,
        getRecoveryState: draft.recoveryState,
        reconcileDraft: draft.reconcile,
        getElement() {
            return rootElement;
        },
        getRows({ draft = false } = {}) {
            return deepClone(draft ? draftRows : baseRows);
        },
        isDirty() {
            return isDirty;
        },
        isEditMode() {
            return isEditMode;
        },
        setRows,
        setColumns,
        enterEditMode() {
            setEditMode(true);
        },
        exitEditMode() {
            setEditMode(false);
        },
        saveChanges,
        cancelChanges,
        clearPersistedDraft,
        setColumnValues,
        rerender() {
            render();
        },
        destroy() {
            draft.dispose();
            if (!draft.enabled) clearPersistedDraft();
            containerElement.replaceChildren();
        },
    };
}
