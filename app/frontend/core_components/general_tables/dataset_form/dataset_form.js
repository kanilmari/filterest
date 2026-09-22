// dataset_form.js
// The one dataset form, in two modes: creating a dataset on its own page, and
// editing one in the dataset's Manage table dialog.
// Bridges one set of setting controls and the shared column table with a
// persistence adapter (dataset_create_source.js or dataset_edit_source.js);
// the form itself never calls an endpoint.
// Exists so a dataset is described in one place. The legitimate differences
// between the modes are inputs: a new name, default columns, a new folder and
// several draft links when creating; rename and removal of columns, restoring
// a hidden dataset, dropping it and a partly saved retry when editing.
import { showSuccessToast, showWarningToast } from "../../../reusable_components/notifications/toast_notification_printer.js";
import { createDatasetColumnTable } from "./dataset_column_table.js";
import { createDatasetSymbolPicker } from "./dataset_symbol_picker.js";
import { createDatasetFolderPicker } from "./dataset_folder_picker.js";
import { createDatasetImageAttachmentControl } from "./dataset_image_attachments.js";
import { createDatasetDeletionProtectionControl } from "./dataset_deletion_protection.js";
import { createDatasetGroupReadControl } from "./dataset_group_read_access.js";
import { createDatasetForeignKeyPanel } from "./dataset_foreign_keys_panel.js";
import {
    datasetFormLabel, datasetFormText, observeDatasetFormLanguage, setDatasetFormText,
} from "./dataset_form_text.js";

function button(key, { type = "button", testid = "", className = "" } = {}) {
    const element = setDatasetFormText(document.createElement("button"), key);
    element.type = type;
    if (testid) element.dataset.testid = testid;
    if (className) element.className = className;
    return element;
}

function hint(key, testid = "") {
    const element = setDatasetFormText(document.createElement("p"), key);
    element.className = "dataset-form-hint";
    if (testid) element.dataset.testid = testid;
    return element;
}

/**
 * Build the dataset form.
 *
 * @param {object} options
 * @param {"create"|"edit"} options.mode
 * @param {object} options.source - the persistence adapter: its initial
 *   columns and default, its reads (load), and save(draft, controls)
 * @param {object} [options.host] - what surrounds the form: close() when an
 *   edit is saved or cancelled, afterSave(outcome) once the server holds a
 *   change, openDataset(name) behind a new dataset's "Open dataset"
 * @returns {{element: HTMLFormElement, ready: Promise<void>, dispose: () => void}}
 */
export function buildDatasetForm({ mode, source, host = {} }) {
    const creating = mode === "create";
    let disposed = false;

    const form = document.createElement("form");
    form.className = `dataset-form dataset-form--${creating ? "create" : "edit"}`;
    form.dataset.testid = "dataset-form";
    form.dataset.formMode = creating ? "create" : "edit";

    // --- The dataset itself ---
    const nameLabel = datasetFormLabel("table_name", "dataset-form-name");
    let nameInput = null;
    if (creating) {
        nameInput = Object.assign(document.createElement("input"), { type: "text", name: "dataset_name", required: true });
        nameInput.dataset.testid = "dataset-name-input";
        nameLabel.appendChild(nameInput);
        form.append(nameLabel, hint("create_dataset_route_hint", "dataset-route-hint"));
    } else {
        // Editing renames columns, never the dataset: its name is shown, not offered.
        const name = Object.assign(document.createElement("code"), { textContent: source.datasetName });
        name.className = "dataset-form-name-value";
        name.dataset.testid = "dataset-name";
        nameLabel.appendChild(name);
        form.appendChild(nameLabel);
    }

    const reads = source.load();

    // --- A hidden dataset can be restored (editing) ---
    let visibility = null;
    if (!creating) {
        const panel = document.createElement("section");
        panel.className = "dataset-form-visibility";
        panel.dataset.testid = "manage-table-visibility";
        const status = setDatasetFormText(document.createElement("p"), "manage_table_visibility_loading");
        status.setAttribute("role", "status");
        const restore = button("manage_table_restore", { testid: "manage-table-restore" });
        restore.hidden = true;
        panel.append(status, restore);
        form.appendChild(panel);
        visibility = { panel, status, restore };
    }

    // --- The dataset's settings: one set of controls in both modes ---
    const controls = {
        symbol: createDatasetSymbolPicker({ stored: reads.symbol }),
        folder: createDatasetFolderPicker({ allowNewFolder: creating, choices: reads.folderChoices }),
        images: createDatasetImageAttachmentControl({ stored: reads.images }),
        deletion: createDatasetDeletionProtectionControl({ stored: reads.preventDeletion }),
        readers: createDatasetGroupReadControl({ stored: reads.readers }),
    };

    const multilingualLabel = document.createElement("label");
    multilingualLabel.className = "dataset-form-option";
    const multilingualInput = Object.assign(document.createElement("input"), {
        type: "checkbox", name: "dataset_new_columns_multilingual", checked: source.multilingualDefault === true,
    });
    multilingualInput.dataset.testid = "dataset-multilingual-default";
    multilingualLabel.append(multilingualInput,
        setDatasetFormText(document.createElement("span"), "manage_table_multilingual_default"));

    const settings = document.createElement("section");
    settings.className = "dataset-form-settings dataset-form-section";
    settings.append(controls.images.element, controls.deletion.element, multilingualLabel);
    form.append(controls.symbol.element, controls.folder.element, settings, controls.readers.element);

    // --- The columns ---
    const columnTable = createDatasetColumnTable({
        mode: creating ? "create" : "edit",
        multilingualDefault: () => multilingualInput.checked,
    });
    multilingualInput.addEventListener("change", () => columnTable.setMultilingualDefault(multilingualInput.checked));
    const fillColumns = () => {
        columnTable.clear();
        for (const column of source.initialColumns) columnTable.addColumn(column);
    };
    fillColumns();
    form.append(hint("card_role_hint"), columnTable.element);

    // --- Links to other datasets: after the columns, because a link names a
    //     column of this dataset, including one this same save is about to add ---
    controls.links = createDatasetForeignKeyPanel({
        stored: reads.links,
        datasetNames: reads.datasetNames,
        readColumns: source.readColumns,
        columnNames: () => columnTable.columnNames(),
        multipleDrafts: creating,
    });
    form.appendChild(controls.links.element);

    // --- What a new dataset became (creating) ---
    const result = document.createElement("div");
    result.className = "dataset-form-result";
    result.dataset.testid = "dataset-form-result";
    result.setAttribute("role", "status");
    result.hidden = true;
    form.appendChild(result);

    // --- Actions ---
    const actions = document.createElement("div");
    actions.className = "form-actions dataset-form-actions";
    const submit = button(creating ? "create_table" : "manage_table_save", {
        type: "submit", testid: "dataset-form-submit", className: "submit-button modal-button primary saturate_on_hover",
    });
    let dropButton = null;
    if (!creating) {
        const cancel = button("manage_table_cancel", { testid: "dataset-form-cancel", className: "cancel-button" });
        cancel.addEventListener("click", () => host.close?.());
        // Removal is offered once the dataset's visibility is known.
        dropButton = button("manage_table_delete", { testid: "btn-delete-table", className: "danger-button" });
        dropButton.disabled = true;
        dropButton.addEventListener("click", () => source.drop?.());
        actions.append(cancel, dropButton);
    }
    actions.appendChild(submit);
    form.appendChild(actions);
    // The browser checks the required fields before the form is sent; its
    // reminder for a nameless new folder is refreshed in the current language.
    submit.addEventListener("click", () => controls.folder.syncValidity());

    const disposeLanguage = observeDatasetFormLanguage(form);

    // --- Visibility (editing) ---
    let visibilityRead = Promise.resolve();
    if (visibility) {
        const show = (uiHidden) => {
            if (disposed) return;
            visibility.panel.hidden = !uiHidden;
            visibility.restore.hidden = !uiHidden;
            if (uiHidden) setDatasetFormText(visibility.status, "manage_table_hidden");
            dropButton.disabled = false;
        };
        visibilityRead = Promise.resolve(reads.visibility)
            .then((answer) => show(answer.ui_hidden))
            .catch((error) => {
                if (!disposed) setDatasetFormText(visibility.status, "manage_table_visibility_failed");
                console.warn("Dataset visibility lookup failed:", error);
            });
        visibility.restore.addEventListener("click", async () => {
            if (visibility.restore.disabled) return;
            visibility.restore.disabled = true;
            try {
                const answer = await source.restore();
                if (disposed) return;
                show(answer.ui_hidden);
                showSuccessToast(datasetFormText("manage_table_restored"));
            } catch (error) {
                if (!disposed) setDatasetFormText(visibility.status, "manage_table_restore_failed");
                console.warn("Dataset restoration failed:", error);
            } finally {
                visibility.restore.disabled = false;
            }
        });
    }

    function readDraft() {
        return {
            name: creating ? nameInput.value : source.datasetName,
            columns: columnTable.rows().map((row) => ({ row, ...row.read() })),
            multilingualDefault: multilingualInput.checked,
            symbol: controls.symbol.value(),
            folder: controls.folder.value(),
            images: controls.images.value(),
            preventDeletion: controls.deletion.value(),
            readers: controls.readers.value(),
            links: controls.links.value(),
        };
    }

    /** Say where the new dataset went, whether the navigation lists it, and offer it. */
    function showCreated(dataset) {
        const folder = dataset.folderPath || dataset.folderId;
        const sentence = setDatasetFormText(document.createElement("p"), "dataset_created_in_folder",
            { dataset: dataset.name, folder });
        result.replaceChildren(sentence);
        if (!dataset.inSiteNavigation) {
            const warning = setDatasetFormText(document.createElement("p"), "dataset_created_outside_navigation");
            warning.className = "dataset-form-result-warning";
            result.appendChild(warning);
        }
        if (host.openDataset) {
            const open = button("dataset_open", { testid: "dataset-form-open-dataset", className: "dataset-form-button" });
            open.addEventListener("click", () => host.openDataset(dataset.name));
            result.appendChild(open);
        }
        result.hidden = false;
        showSuccessToast(datasetFormText("dataset_created_in_folder", { dataset: dataset.name, folder }));
    }

    /** The form starts over for the next new dataset; the result stays in view. */
    async function startOver() {
        form.reset();
        fillColumns();
        controls.links.accept();
        // The symbol control is not a native form control, so the form's own
        // reset does not reach it; the next dataset starts without a symbol.
        controls.symbol.reset();
        await controls.folder.reset(source.readFolderChoices());
    }

    async function applyCreated(outcome) {
        const failures = [];
        if (outcome.settings.symbol === "failed") {
            controls.symbol.reportFailure();
            // The dataset exists; only its symbol is missing, and the reason
            // stays beside the symbol control.
            failures.push("dataset_created_settings_need_attention");
        }
        if (outcome.settings.images === "failed") {
            controls.images.reportFailure();
            failures.push("table_created_image_setup_failed");
        }
        showCreated(outcome.dataset);
        failures.forEach((key) => showWarningToast(datasetFormText(key)));
        try {
            await host.afterSave?.(outcome);
        } catch (error) {
            console.warn("Refreshing the navigation after dataset creation failed:", error);
        }
        if (!disposed) await startOver();
        result.scrollIntoView?.({ block: "nearest" });
    }

    let saving = false;
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (saving || disposed) return;
        // A new folder asked for without a name keeps the form here, with the
        // reason beside the name; it may stay empty only while the person picks.
        const folderProblem = creating ? controls.folder.validate() : null;
        if (folderProblem) {
            showWarningToast(datasetFormText(folderProblem));
            return;
        }
        saving = true;
        submit.disabled = true;
        if (creating) result.hidden = true;
        try {
            const outcome = await source.save(readDraft(), controls);
            if (disposed) return;
            if (outcome.status === "invalid") {
                showWarningToast(datasetFormText(outcome.warningKey));
                if (outcome.field === "folder") controls.folder.validate();
                if (outcome.field === "name") nameInput?.focus();
            } else if (outcome.status === "failed") {
                if (!creating) showWarningToast(datasetFormText("manage_table_save_failed"));
            } else if (outcome.status === "created") {
                await applyCreated(outcome);
            } else {
                showSuccessToast(datasetFormText("manage_table_saved"));
                if (outcome.status === "saved") host.close?.();
                else showWarningToast(datasetFormText("manage_table_settings_need_attention"));
                await host.afterSave?.(outcome);
            }
        } finally {
            saving = false;
            submit.disabled = false;
        }
    });

    const ready = Promise.allSettled([
        visibilityRead,
        ...Object.values(controls).map((control) => control.ready),
    ]).then(() => undefined);

    return {
        element: form,
        ready,
        /** Stop following the interface language and ignore answers still on their way. */
        dispose: () => {
            disposed = true;
            disposeLanguage();
            // The symbol dropdown keeps its open list and its outside-click
            // listener on the page, not inside the form, so it is taken off here.
            controls.symbol.dispose();
        },
    };
}
