// field_view_editor_helpers.js
// Provides pure ordering and visibility helpers for the global field-view editor.
// Bridges drag/drop positions with the ordered card-visibility API payload.
// Exists so global field ordering stays deterministic and independently testable.

function readColumnUID(column) {
    const uid = Number(column?.column_uid);
    return Number.isInteger(uid) && uid > 0 ? uid : null;
}

export function normalizeFieldViewColumns(columns) {
    if (!Array.isArray(columns)) return [];
    return columns
        .filter((column) => readColumnUID(column) !== null)
        .map((column, index) => ({
            ...column,
            co_number: index + 1,
            hide_everywhere: Boolean(column.hide_everywhere),
            hide_everywhere_locked: Boolean(column.hide_everywhere_locked),
            hide_everywhere_lock_reason: String(
                column.hide_everywhere_lock_reason || ""
            ),
        }));
}

export function moveFieldBefore(columns, movedColumnUID, targetColumnUID) {
    const normalized = normalizeFieldViewColumns(columns);
    const movedUID = Number(movedColumnUID);
    const targetUID = Number(targetColumnUID);
    const movedIndex = normalized.findIndex(
        (column) => readColumnUID(column) === movedUID
    );
    const targetIndex = normalized.findIndex(
        (column) => readColumnUID(column) === targetUID
    );
    if (movedIndex < 0 || targetIndex < 0 || movedIndex === targetIndex) {
        return normalized;
    }

    const nextColumns = [...normalized];
    const [movedColumn] = nextColumns.splice(movedIndex, 1);
    const insertionIndex = nextColumns.findIndex(
        (column) => readColumnUID(column) === targetUID
    );
    nextColumns.splice(insertionIndex, 0, movedColumn);
    return normalizeFieldViewColumns(nextColumns);
}

export function moveFieldByOffset(columns, columnUID, offset) {
    const normalized = normalizeFieldViewColumns(columns);
    const sourceIndex = normalized.findIndex(
        (column) => readColumnUID(column) === Number(columnUID)
    );
    const targetIndex = sourceIndex + Number(offset);
    if (
        sourceIndex < 0
        || !Number.isInteger(targetIndex)
        || targetIndex < 0
        || targetIndex >= normalized.length
    ) {
        return normalized;
    }

    const nextColumns = [...normalized];
    const [movedColumn] = nextColumns.splice(sourceIndex, 1);
    nextColumns.splice(targetIndex, 0, movedColumn);
    return normalizeFieldViewColumns(nextColumns);
}

export function hiddenFieldNameSet(columns) {
    return new Set(
        normalizeFieldViewColumns(columns)
            .filter((column) => column.hide_everywhere)
            .map((column) => String(column.column_name || "").trim())
            .filter(Boolean)
    );
}
