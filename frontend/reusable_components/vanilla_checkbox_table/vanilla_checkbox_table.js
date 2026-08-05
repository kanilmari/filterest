// vanilla_checkbox_table.js
// Builds a reusable editable table for runtime-defined rows and columns.
// Bridges generic data models, edit/save/cancel controls, and localStorage draft persistence.
// Exists to centralize checkbox-matrix style UI behavior without coupling to any feature endpoint.

/**
 * @typedef {Object} VanillaCheckboxTableColumn
 * @property {string} key
 * @property {string} [label]
 * @property {'checkbox'|'text'|'select'|'static'} [type]
 * @property {boolean} [editable]
 * @property {Array<{value: string|number|boolean, label: string}>} [options]
 * @property {string} [className]
 * @property {string} [width]
 * @property {string} [minWidth]
 * @property {string} [maxWidth]
 * @property {(value: any, row: Record<string, any>, column: VanillaCheckboxTableColumn) => string} [formatReadOnly]
 * @property {(context: { column: VanillaCheckboxTableColumn, getRows: ({draft}: {draft?: boolean}) => Array<Record<string, any>>, isEditMode: boolean, isDirty: boolean, setColumnValues: (columnKey: string, nextValue: any, options?: { rowFilter?: (row: Record<string, any>, rowIndex: number) => boolean }) => void }) => HTMLElement|string|null} [renderHeaderCell]
 * @property {(context: { value: any, row: Record<string, any>, column: VanillaCheckboxTableColumn, rowIndex: number }) => HTMLElement|string|null} [renderReadOnlyCell]
 * @property {(context: { value: any, row: Record<string, any>, column: VanillaCheckboxTableColumn, rowIndex: number, updateValue: (nextValue: any) => void, isDisabled: boolean }) => HTMLElement|string|null} [renderEditableCell]
 * @property {(context: { value: any, row: Record<string, any>, column: VanillaCheckboxTableColumn, rowIndex: number, isEditMode: boolean }) => boolean} [isCellDisabled]
 */

/**
 * @typedef {Object} VanillaCheckboxTableOptions
 * @property {HTMLElement} containerElement
 * @property {VanillaCheckboxTableColumn[]} columns
 * @property {Array<Record<string, any>>} rows
 * @property {string} [rowIdKey='id']
 * @property {string} [storageKey]
 * @property {boolean} [persistDraftToLocalStorage=true]
 * @property {boolean} [startInEditMode=false]
 * @property {(payload: {
 *   rows: Array<Record<string, any>>,
 *   changedCells: Array<{rowId: string, columnKey: string, previousValue: any, nextValue: any}>
 * }) => Promise<any>|any} [onSave]
 * @property {(dirty: boolean) => void} [onDirtyChange]
 * @property {(isEditMode: boolean) => void} [onEditModeChange]
 * @property {string} [editLabel='Edit']
 * @property {string} [saveLabel='Save']
 * @property {string} [cancelLabel='Cancel']
 * @property {string} [dirtyLabel='Unsaved changes']
 * @property {string} [cleanLabel='']
 * @property {boolean} [showCellEditButtonOnHover=false]
 * @property {(context: { row: Record<string, any>, column: VanillaCheckboxTableColumn, rowIndex: number }) => HTMLElement|string|null} [renderCellEditButton]
 * @property {(row: Record<string, any>, rowIndex: number) => string|string[]|null} [rowClassName]
 */

const STORAGE_VERSION = 1;

function deepClone(value) {
    if (typeof structuredClone === "function") {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}

function toTextValue(value) {
    if (value === null || value === undefined) return "";
    return String(value);
}

function isEqualValue(left, right) {
    return Object.is(left, right);
}

function normalizeColumns(columns) {
    if (!Array.isArray(columns)) return [];
    return columns
        .filter((column) => column && typeof column.key === "string" && column.key.trim() !== "")
        .map((column) => {
            const normalizedType = String(column.type || "checkbox").toLowerCase();
            return {
                key: column.key,
                label: column.label || column.key,
                type: normalizedType,
                editable: column.editable !== false && normalizedType !== "static",
                options: Array.isArray(column.options) ? column.options : [],
                className: column.className || "",
                width: typeof column.width === "string" ? column.width : "",
                minWidth: typeof column.minWidth === "string" ? column.minWidth : "",
                maxWidth: typeof column.maxWidth === "string" ? column.maxWidth : "",
                formatReadOnly: typeof column.formatReadOnly === "function" ? column.formatReadOnly : null,
                renderHeaderCell: typeof column.renderHeaderCell === "function" ? column.renderHeaderCell : null,
                renderReadOnlyCell: typeof column.renderReadOnlyCell === "function" ? column.renderReadOnlyCell : null,
                renderEditableCell: typeof column.renderEditableCell === "function" ? column.renderEditableCell : null,
                isCellDisabled: typeof column.isCellDisabled === "function" ? column.isCellDisabled : null,
            };
        });
}

function normalizeCheckboxState(value) {
    if (value === "ambiguous") return "ambiguous";
    if (value === "checked") return "checked";
    if (value === "unchecked") return "unchecked";
    return value ? "checked" : "unchecked";
}

function appendRenderableContent(parentNode, content) {
    if (content === null || content === undefined) {
        return;
    }
    if (content instanceof Node) {
        parentNode.appendChild(content);
        return;
    }
    parentNode.textContent = String(content);
}

function toRenderableNode(content, fallbackClassName = "") {
    if (content instanceof Node) {
        return content;
    }

    const wrapper = document.createElement("span");
    if (fallbackClassName) {
        wrapper.classList.add(fallbackClassName);
    }
    wrapper.textContent = String(content ?? "");
    return wrapper;
}

function safeParseStorage(rawValue) {
    if (!rawValue) return null;
    try {
        const parsed = JSON.parse(rawValue);
        if (!parsed || typeof parsed !== "object") return null;
        if (Number(parsed.version) !== STORAGE_VERSION) return null;
        return parsed;
    } catch {
        return null;
    }
}

function toRowIdentifier(row, rowIdKey) {
    const candidate = row?.[rowIdKey];
    if (candidate === null || candidate === undefined) return "";
    return String(candidate);
}

function restoreDraftRows(baseRows, persistedRows, rowIdKey) {
    if (!Array.isArray(persistedRows) || persistedRows.length === 0) {
        return deepClone(baseRows);
    }

    const persistedById = new Map();
    persistedRows.forEach((row) => {
        const rowId = toRowIdentifier(row, rowIdKey);
        if (!rowId) return;
        persistedById.set(rowId, row);
    });

    return baseRows.map((baseRow) => {
        const rowId = toRowIdentifier(baseRow, rowIdKey);
        if (!rowId || !persistedById.has(rowId)) {
            return deepClone(baseRow);
        }
        return {
            ...deepClone(baseRow),
            ...deepClone(persistedById.get(rowId)),
        };
    });
}

function resolveReadonlyText(value, row, column) {
    if (column.formatReadOnly) {
        return toTextValue(column.formatReadOnly(value, row, column));
    }
    if (column.type === "checkbox") {
        return value ? "Yes" : "No";
    }
    if (column.type === "select") {
        const matchingOption = column.options.find((option) => isEqualValue(option.value, value));
        return matchingOption ? toTextValue(matchingOption.label) : toTextValue(value);
    }
    return toTextValue(value);
}

function buildChangedCells(baseRows, draftRows, columns, rowIdKey) {
    const changedCells = [];
    const baseById = new Map();
    baseRows.forEach((row) => {
        const rowId = toRowIdentifier(row, rowIdKey);
        if (rowId) {
            baseById.set(rowId, row);
        }
    });

    draftRows.forEach((draftRow) => {
        const rowId = toRowIdentifier(draftRow, rowIdKey);
        if (!rowId) return;
        const baseRow = baseById.get(rowId);
        if (!baseRow) return;
        columns.forEach((column) => {
            const previousValue = baseRow[column.key];
            const nextValue = draftRow[column.key];
            if (!isEqualValue(previousValue, nextValue)) {
                changedCells.push({
                    rowId,
                    columnKey: column.key,
                    previousValue,
                    nextValue,
                });
            }
        });
    });

    return changedCells;
}

/**
 * Creates a reusable editable checkbox table instance.
 *
 * @param {VanillaCheckboxTableOptions} options
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
        if (!storageKey || !persistDraftToLocalStorage) return;
        if (!isDirty && !isEditMode) {
            clearPersistedDraft();
            return;
        }

        const payload = {
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
        const changedCells = buildChangedCells(baseRows, draftRows, columns, rowIdKey);
        const nextDirty = changedCells.length > 0;
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
        saveButton.disabled = isSaving || !isDirty;
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
        if (!draftRows[rowIndex]) return;
        draftRows[rowIndex][columnKey] = nextValue;
        recomputeDirtyState();
        renderTableHead();
    }

    function setColumnValues(columnKey, nextValue, { rowFilter = null } = {}) {
        draftRows.forEach((row, rowIndex) => {
            if (typeof rowFilter === "function" && !rowFilter(row, rowIndex)) {
                return;
            }
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
        if (!column.editable) {
            return createReadonlyCellNode(row, rowIndex, column);
        }

        const currentValue = row[column.key];
        const isDisabled = resolveCellDisabledState(row, rowIndex, column);

        if (column.renderEditableCell) {
            const customContent = column.renderEditableCell({
                value: currentValue,
                row,
                column,
                rowIndex,
                updateValue(nextValue) {
                    handleCellInputChange(rowIndex, column.key, nextValue);
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
                handleCellInputChange(rowIndex, column.key, checkbox.checked);
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
                    handleCellInputChange(rowIndex, column.key, null);
                    return;
                }
                const matchingOption = column.options.find((option) => toTextValue(option.value) === select.value);
                const normalizedValue = matchingOption ? matchingOption.value : select.value;
                handleCellInputChange(rowIndex, column.key, normalizedValue);
            });
            return select;
        }

        const textInput = document.createElement("input");
        textInput.type = "text";
        textInput.classList.add("vct-input-text");
        textInput.value = toTextValue(currentValue);
        textInput.disabled = isDisabled;
        textInput.addEventListener("input", () => {
            handleCellInputChange(rowIndex, column.key, textInput.value);
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
    }

    function renderTableBody() {
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
                const td = document.createElement("td");
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
                tr.appendChild(td);
            });

            tableBodyElement.appendChild(tr);
        });
    }

    function render() {
        renderTableHead();
        renderTableBody();
        syncToolbar();
    }

    function restorePersistedStateIfAvailable() {
        if (!storageKey || !persistDraftToLocalStorage) return;
        const persisted = safeParseStorage(localStorage.getItem(storageKey));
        if (!persisted) return;
        draftRows = restoreDraftRows(baseRows, persisted.draftRows, rowIdKey);
        isEditMode = Boolean(persisted.editMode);
        recomputeDirtyState();
    }

    async function saveChanges() {
        if (isSaving || !isDirty) return false;
        isSaving = true;
        syncToolbar();
        try {
            const payload = {
                rows: deepClone(draftRows),
                changedCells: buildChangedCells(baseRows, draftRows, columns, rowIdKey),
            };
            if (typeof onSave === "function") {
                await onSave(payload);
            }
            baseRows = deepClone(draftRows);
            isDirty = false;
            emitDirtyChange();
            clearPersistedDraft();
            setEditMode(false);
            renderTableBody();
            syncToolbar();
            return true;
        } finally {
            isSaving = false;
            syncToolbar();
        }
    }

    function cancelChanges() {
        if (!isDirty) {
            setEditMode(false);
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

    function setRows(nextRows, { resetDraft = true } = {}) {
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
            clearPersistedDraft();
            containerElement.replaceChildren();
        },
    };
}
