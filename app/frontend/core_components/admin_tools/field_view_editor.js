// field_view_editor.js
// Renders the dataset-level editor for global field order and UI visibility.
// Bridges the filterbar Tools section, card-visibility API, and shared modal shell.
// Exists so admins can manage article/detail order without changing database columns.

import {
    fetchCardVisibility,
    saveCardVisibility,
} from "../endpoints/stable_endpoint_router.js";
import {
    createModal,
    hideModal,
    showModal,
} from "../../reusable_components/modal/modal_builder.js";
import {
    showSuccessToast,
    showWarningToast,
} from "../../reusable_components/notifications/toast_notification_printer.js";
import { refreshTableUnified } from "../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js";
import {
    getUnifiedTableState,
    setUnifiedTableState,
} from "../state_stores/table_state_store.js";
import {
    getOpenedFilters,
    saveOpenedFilters,
} from "../filterbar/filterbar_engine/filterbar_state_saver.js";
import { getLanguageWithBrowserFallback } from "../state_stores/lang_preference_reader.js";
import {
    hiddenFieldNameSet,
    moveFieldBefore,
    moveFieldByOffset,
    normalizeFieldViewColumns,
} from "./field_view_editor_helpers.js";

const FIELD_VIEW_TEXT = Object.freeze({
    en: Object.freeze({
        button: "Edit fields view",
        title: "Edit fields view",
        description: "Drag fields into the shared order. Hidden fields disappear from ordinary content views and forms for every user.",
        field: "Field",
        hide: "Hide everywhere",
        save: "Save changes",
        cancel: "Cancel",
        loading: "Loading fields…",
        loadError: "Fields could not be loaded.",
        saved: "Field order and visibility saved",
        moveUp: "Move up",
        moveDown: "Move down",
        drag: "Drag to reorder",
        lockedPrimary: "Required for row links and actions",
        lockedOwner: "Required for row ownership rules",
        lockedRequired: "Required when adding content",
        lockedGeneric: "Required by application operations",
    }),
    fi: Object.freeze({
        button: "Muokkaa kenttänäkymää",
        title: "Muokkaa kenttänäkymää",
        description: "Vedä kentät yhteiseen järjestykseen. Piilotetut kentät poistuvat tavallisista sisältönäkymistä ja lomakkeista kaikilta käyttäjiltä.",
        field: "Kenttä",
        hide: "Piilota kaikkialta",
        save: "Tallenna muutokset",
        cancel: "Peruuta",
        loading: "Ladataan kenttiä…",
        loadError: "Kenttiä ei voitu ladata.",
        saved: "Kenttien järjestys ja näkyvyys tallennettu",
        moveUp: "Siirrä ylös",
        moveDown: "Siirrä alas",
        drag: "Vedä järjestääksesi",
        lockedPrimary: "Tarvitaan rivien linkkeihin ja toimintoihin",
        lockedOwner: "Tarvitaan rivien omistajuussääntöihin",
        lockedRequired: "Pakollinen sisältöä lisättäessä",
        lockedGeneric: "Sovelluksen toiminnot tarvitsevat kenttää",
    }),
});

function uiText() {
    return getLanguageWithBrowserFallback() === "fi"
        ? FIELD_VIEW_TEXT.fi
        : FIELD_VIEW_TEXT.en;
}

function resolveLockText(reason, text) {
    switch (String(reason || "")) {
    case "primary_key":
        return text.lockedPrimary;
    case "row_owner":
        return text.lockedOwner;
    case "required_input":
        return text.lockedRequired;
    default:
        return text.lockedGeneric;
    }
}

function clearHiddenFieldState(tableName, columns) {
    const hiddenNames = hiddenFieldNameSet(columns);
    if (hiddenNames.size === 0) return;

    const state = getUnifiedTableState(tableName);
    let changed = false;
    if (hiddenNames.has(state?.sort?.column)) {
        state.sort = { column: null, direction: null };
        changed = true;
    }
    if (state?.filters && typeof state.filters === "object") {
        const nextFilters = {};
        for (const [key, value] of Object.entries(state.filters)) {
            const baseKey = key.endsWith("_from")
                ? key.slice(0, -"_from".length)
                : key.endsWith("_to")
                    ? key.slice(0, -"_to".length)
                    : key;
            if (hiddenNames.has(baseKey)) {
                changed = true;
                continue;
            }
            nextFilters[key] = value;
        }
        state.filters = nextFilters;
    }
    if (changed) {
        state.offset = 0;
        setUnifiedTableState(tableName, state);
    }

    const openedFilters = getOpenedFilters(tableName);
    const visibleOpenedFilters = openedFilters.filter(
        (columnName) => !hiddenNames.has(columnName)
    );
    if (visibleOpenedFilters.length !== openedFilters.length) {
        saveOpenedFilters(tableName, visibleOpenedFilters);
    }
}

function buildLoadingState(text) {
    const loading = document.createElement("p");
    loading.className = "field-view-editor__status";
    loading.dataset.testid = "field-view-loading";
    loading.textContent = text.loading;
    return loading;
}

export async function openFieldViewEditor(tableName) {
    const text = uiText();
    const shell = document.createElement("section");
    shell.className = "field-view-editor";
    shell.dataset.testid = "field-view-editor";

    const description = document.createElement("p");
    description.className = "field-view-editor__description";
    description.textContent = text.description;
    const content = document.createElement("div");
    content.className = "field-view-editor__content";
    content.appendChild(buildLoadingState(text));
    shell.append(description, content);

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "fw-btn fw-btn--ghost";
    cancelButton.textContent = text.cancel;
    cancelButton.addEventListener("click", hideModal);

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "fw-btn fw-btn--primary";
    saveButton.dataset.testid = "field-view-save";
    saveButton.textContent = text.save;
    saveButton.disabled = true;

    createModal({
        titlePlainText: text.title,
        contentElements: [shell],
        footerElements: [cancelButton, saveButton],
        width: "min(760px, 94vw)",
        maxWidth: "94vw",
        maxHeight: "88vh",
    });
    showModal();

    let columns = [];
    let draggedColumnUID = null;

    function renderRows() {
        content.replaceChildren();
        const header = document.createElement("div");
        header.className = "field-view-editor__header";
        const fieldHeading = document.createElement("span");
        fieldHeading.textContent = text.field;
        const hideHeading = document.createElement("span");
        hideHeading.textContent = text.hide;
        header.append(fieldHeading, hideHeading);

        const list = document.createElement("ol");
        list.className = "field-view-editor__list";
        list.dataset.testid = "field-view-list";

        columns.forEach((column, index) => {
            const row = document.createElement("li");
            row.className = "field-view-editor__row";
            row.draggable = true;
            row.dataset.columnUid = String(column.column_uid);

            const dragHandle = document.createElement("span");
            dragHandle.className = "field-view-editor__drag-handle";
            dragHandle.setAttribute("aria-hidden", "true");
            dragHandle.title = text.drag;
            dragHandle.textContent = "☷";

            const name = document.createElement("span");
            name.className = "field-view-editor__field-name";
            name.textContent = column.column_name;

            const controls = document.createElement("span");
            controls.className = "field-view-editor__move-controls";
            const up = document.createElement("button");
            up.type = "button";
            up.className = "fw-btn field-view-editor__move";
            up.setAttribute("aria-label", `${text.moveUp}: ${column.column_name}`);
            up.textContent = "↑";
            up.disabled = index === 0;
            up.addEventListener("click", () => {
                columns = moveFieldByOffset(columns, column.column_uid, -1);
                renderRows();
            });
            const down = document.createElement("button");
            down.type = "button";
            down.className = "fw-btn field-view-editor__move";
            down.setAttribute("aria-label", `${text.moveDown}: ${column.column_name}`);
            down.textContent = "↓";
            down.disabled = index === columns.length - 1;
            down.addEventListener("click", () => {
                columns = moveFieldByOffset(columns, column.column_uid, 1);
                renderRows();
            });
            controls.append(up, down);

            const visibility = document.createElement("label");
            visibility.className = "field-view-editor__visibility";
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = Boolean(column.hide_everywhere);
            checkbox.disabled = Boolean(column.hide_everywhere_locked);
            checkbox.dataset.testid = "field-view-hide-everywhere";
            checkbox.addEventListener("change", () => {
                column.hide_everywhere = checkbox.checked;
                saveButton.disabled = false;
            });
            const checkboxText = document.createElement("span");
            checkboxText.textContent = text.hide;
            visibility.append(checkbox, checkboxText);
            if (column.hide_everywhere_locked) {
                const reason = document.createElement("small");
                reason.className = "field-view-editor__lock-reason";
                reason.textContent = resolveLockText(
                    column.hide_everywhere_lock_reason,
                    text
                );
                visibility.appendChild(reason);
            }

            row.append(dragHandle, name, controls, visibility);
            row.addEventListener("dragstart", (event) => {
                draggedColumnUID = Number(column.column_uid);
                row.classList.add("is-dragging");
                event.dataTransfer?.setData("text/plain", String(column.column_uid));
                if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
            });
            row.addEventListener("dragover", (event) => {
                event.preventDefault();
                if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
            });
            row.addEventListener("drop", (event) => {
                event.preventDefault();
                const movedUID = draggedColumnUID
                    ?? Number(event.dataTransfer?.getData("text/plain"));
                columns = moveFieldBefore(columns, movedUID, column.column_uid);
                draggedColumnUID = null;
                saveButton.disabled = false;
                renderRows();
            });
            row.addEventListener("dragend", () => {
                draggedColumnUID = null;
                row.classList.remove("is-dragging");
            });
            list.appendChild(row);
        });

        content.append(header, list);
    }

    try {
        const response = await fetchCardVisibility(tableName);
        columns = normalizeFieldViewColumns(response?.columns || response || []);
        renderRows();
        saveButton.disabled = false;
    } catch (error) {
        console.warn("Field view editor load failed:", error);
        content.replaceChildren();
        const failure = document.createElement("p");
        failure.className = "field-view-editor__status field-view-editor__status--error";
        failure.textContent = text.loadError;
        content.appendChild(failure);
        return;
    }

    saveButton.addEventListener("click", async () => {
        saveButton.disabled = true;
        try {
            const orderedColumns = normalizeFieldViewColumns(columns);
            const response = await saveCardVisibility({
                table_name: tableName,
                columns: orderedColumns,
            });
            clearHiddenFieldState(tableName, orderedColumns);
            localStorage.removeItem(`${tableName}_dataTypes`);
            localStorage.removeItem(`${tableName}_tableMeta`);
            hideModal();
            await refreshTableUnified(tableName, { skipUrlParams: true });
            showSuccessToast(response?.message || text.saved);
        } catch (error) {
            console.warn("Field view editor save failed:", error);
            showWarningToast(error?.message || text.loadError);
            saveButton.disabled = false;
        }
    });
}

export function createFieldViewEditorButton(tableName) {
    const text = uiText();
    const button = document.createElement("button");
    button.type = "button";
    button.className = "fw-btn field-view-editor-button";
    button.dataset.testid = "btn-edit-fields-view";
    button.textContent = text.button;
    button.addEventListener("click", () => {
        void openFieldViewEditor(tableName);
    });
    return button;
}
