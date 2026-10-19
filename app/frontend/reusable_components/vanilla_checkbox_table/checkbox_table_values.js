// checkbox_table_values.js
// Normalizes table values and preserves the version-1 storage/payload contract.
// Shared by the legacy renderer and opt-in settings-table helpers.

export const STORAGE_VERSION = 1;

export function deepClone(value) {
    if (typeof structuredClone === "function") {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}

export function toTextValue(value) {
    if (value === null || value === undefined) return "";
    return String(value);
}

export function isEqualValue(left, right) {
    return Object.is(left, right);
}

export function normalizeColumns(columns) {
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
                rowToggle: column.rowToggle || null,
                isCellSupported: typeof column.isCellSupported === "function" ? column.isCellSupported : null,
                isCellDisabled: typeof column.isCellDisabled === "function" ? column.isCellDisabled : null,
            };
        });
}

export function normalizeCheckboxState(value) {
    if (value === "ambiguous") return "ambiguous";
    if (value === "checked") return "checked";
    if (value === "unchecked") return "unchecked";
    return value ? "checked" : "unchecked";
}

export function appendRenderableContent(parentNode, content) {
    if (content === null || content === undefined) {
        return;
    }
    if (content instanceof Node) {
        parentNode.appendChild(content);
        return;
    }
    parentNode.textContent = String(content);
}

export function toRenderableNode(content, fallbackClassName = "") {
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

export function safeParseStorage(rawValue) {
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

export function toRowIdentifier(row, rowIdKey) {
    const candidate = row?.[rowIdKey];
    if (candidate === null || candidate === undefined) return "";
    return String(candidate);
}

export function restoreDraftRows(baseRows, persistedRows, rowIdKey) {
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

export function resolveReadonlyText(value, row, column) {
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

export function buildChangedCells(baseRows, draftRows, columns, rowIdKey, { editableOnly = false } = {}) {
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
        columns.filter(column => !column.rowToggle && (!editableOnly || column.editable)).forEach((column) => {
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

