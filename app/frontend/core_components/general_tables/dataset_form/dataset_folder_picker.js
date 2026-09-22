// dataset_folder_picker.js
// The dataset form's folder control, in both modes: where a new dataset goes,
// or which folder an existing dataset sits in.
// Bridges the form with the navigation tree (its folder choices) and, through
// the form's persistence adapters, with the dataset-creation and folder-move routes.
// Exists so one control decides a dataset's place in the tree. A new dataset
// goes into the current project's folder unless the person chooses otherwise,
// and a new folder is made only when the person asks for one and names it.
import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { createDatasetFormStatus, datasetFormLabel, datasetFormText, setDatasetFormText } from "./dataset_form_text.js";
import { resolveFolderSelectionDefaults } from "./dataset_folder_options.js";

let pickerSequence = 0;

/** The tree the navigation itself draws, preferring the server's current answer. */
export async function readNavigationTreeNodes() {
    try {
        const treeData = await endpoint_router("fetchTreeData", { suppressErrorToast: true });
        const nodes = Array.isArray(treeData?.nodes) ? treeData.nodes : [];
        if (nodes.length > 0) return nodes;
    } catch (error) {
        // A cached tree still names the folders, which is better than offering none.
        void error;
    }
    try {
        const cached = JSON.parse(localStorage.getItem("full_tree_data") || "null");
        return Array.isArray(cached?.nodes) ? cached.nodes : [];
    } catch (error) {
        void error;
        return [];
    }
}

/**
 * Move one dataset to another folder, bound to both identities the tree gives
 * it. `confirmed` answers the question the server asks before a move that
 * changes what the site navigation shows.
 */
export function moveDatasetToFolder(placement, folderId, { confirmed = false } = {}) {
    return endpoint_router("updateTableFolder", {
        method: "POST",
        body_data: {
            item_id: placement.itemId,
            item_type: "table",
            dataset_uid: placement.datasetUID,
            new_folder_id: Number(folderId),
            confirm_cross_project_move: confirmed,
            confirm_tab_visibility_change: confirmed,
        },
        suppressErrorToast: true,
    });
}

/** The server's own sentence about a move it refused, without the route noise. */
export function describeFolderConflict(error) {
    const message = String(error?.message || "");
    const separator = message.indexOf("): ");
    return separator === -1 ? message.trim() : message.slice(separator + 3).trim();
}

function fillFolderOptions(select, options, { rootKey = "" } = {}) {
    select.replaceChildren();
    if (rootKey) {
        select.appendChild(setDatasetFormText(Object.assign(document.createElement("option"), { value: "" }), rootKey));
    }
    for (const option of options) {
        const element = document.createElement("option");
        element.value = option.value;
        // The current project's folder says so: only its direct datasets are
        // listed in the site navigation.
        if (option.isCurrentProject) {
            setDatasetFormText(element, "dataset_folder_option_current_project", { folder: option.label });
        } else {
            element.textContent = option.label;
        }
        select.appendChild(element);
    }
}

/**
 * Build the folder control.
 *
 * @param {object} options
 * @param {boolean} [options.allowNewFolder] - creation may make a new folder for
 *   the new dataset; editing only moves a dataset between existing folders
 * @param {Promise<{options: object[], selected?: string}>} options.choices - the
 *   folders and the one to show chosen: the dataset's own folder when editing,
 *   the default folder when creating. A choice-less answer leaves the control
 *   closed, with the reason beside it.
 */
export function createDatasetFolderPicker({ allowNewFolder = false, choices }) {
    const idPrefix = `dataset-folder-${++pickerSequence}`;

    const section = document.createElement("section");
    section.className = "dataset-folder-picker dataset-form-section";
    section.dataset.testid = "dataset-folder-picker";
    const title = setDatasetFormText(document.createElement("div"), "folder");
    title.className = "dataset-form-section-title";

    const choiceLabel = datasetFormLabel(allowNewFolder ? "dataset_folder_for_new_dataset" : "select_folder",
        "dataset-folder-choice");
    const select = document.createElement("select");
    select.name = "dataset_folder_id";
    select.dataset.testid = "dataset-folder-select";
    select.disabled = true;
    choiceLabel.appendChild(select);

    const status = createDatasetFormStatus("dataset-folder-status");
    section.append(title, choiceLabel);

    let newFolder = null;
    if (allowNewFolder) {
        const hint = setDatasetFormText(document.createElement("p"), "table_folder_hint");
        hint.className = "dataset-form-hint";

        // The new folder's name and parent stay out of sight until the person
        // asks for a new folder, so a parent is never mistaken for the choice above.
        const toggle = setDatasetFormText(document.createElement("button"), "dataset_new_folder_open");
        toggle.type = "button";
        toggle.className = "dataset-form-button dataset-new-folder-toggle";
        toggle.dataset.testid = "dataset-new-folder-toggle";
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-controls", `${idPrefix}-new`);

        const fields = document.createElement("div");
        fields.id = `${idPrefix}-new`;
        fields.className = "dataset-form-fields dataset-new-folder";
        fields.hidden = true;
        const nameLabel = datasetFormLabel("new_folder_name");
        const name = Object.assign(document.createElement("input"), { type: "text", name: "dataset_new_folder_name" });
        name.dataset.testid = "dataset-new-folder-name";
        name.setAttribute("aria-describedby", `${idPrefix}-new-status`);
        nameLabel.appendChild(name);
        const parentLabel = datasetFormLabel("dataset_new_folder_parent");
        const parent = document.createElement("select");
        parent.name = "dataset_new_folder_parent_id";
        parent.dataset.testid = "dataset-new-folder-parent";
        parentLabel.appendChild(parent);
        const nameStatus = createDatasetFormStatus("dataset-new-folder-status");
        nameStatus.element.id = `${idPrefix}-new-status`;
        fields.append(nameLabel, parentLabel);

        newFolder = { toggle, fields, name, parent, nameStatus, open: false };
        section.append(hint, toggle, fields, nameStatus.element);

        // The browser's own reminder for the empty name speaks the page's
        // language rather than the browser's, and the reason also stays beside
        // the field.
        const syncValidity = () => {
            const missing = newFolder.open && !name.value.trim();
            name.setCustomValidity(missing ? datasetFormText("dataset_new_folder_name_required") : "");
        };
        newFolder.syncValidity = syncValidity;
        name.addEventListener("invalid", () => nameStatus.show("dataset_new_folder_name_required"));

        const setOpen = (open) => {
            newFolder.open = open;
            fields.hidden = !open;
            // While a new folder is being named it is where the dataset goes,
            // so the choice above steps aside rather than being silently ignored.
            select.disabled = open || select.options.length === 0;
            name.required = open;
            toggle.setAttribute("aria-expanded", String(open));
            setDatasetFormText(toggle, open ? "dataset_new_folder_cancel" : "dataset_new_folder_open");
            nameStatus.clear();
            if (open) {
                parent.value = select.value;
                name.focus();
            } else {
                name.value = "";
            }
            syncValidity();
        };
        newFolder.setOpen = setOpen;
        toggle.addEventListener("click", () => setOpen(!newFolder.open));
        // The name may stay empty while the person picks; it is required only
        // when the form is sent, and the reminder goes once a name is typed.
        name.addEventListener("input", () => {
            if (name.value.trim()) nameStatus.clear();
            syncValidity();
        });
    }

    // A move the server refuses without an explicit decision is offered again
    // here, with the server's own explanation beside it.
    const confirmButton = setDatasetFormText(document.createElement("button"), "dataset_folder_move_anyway");
    confirmButton.type = "button";
    confirmButton.className = "dataset-folder-confirm dataset-form-button";
    confirmButton.dataset.testid = "dataset-folder-confirm";
    confirmButton.hidden = true;
    let pendingConfirmation = null;
    confirmButton.addEventListener("click", async () => {
        if (!pendingConfirmation) return;
        confirmButton.disabled = true;
        try {
            await pendingConfirmation();
        } finally {
            confirmButton.disabled = false;
        }
    });
    section.append(status.element, confirmButton);

    let confirmed = "";
    let loadedOptions = [];

    function show(loaded) {
        loadedOptions = Array.isArray(loaded?.options) ? loaded.options : [];
        fillFolderOptions(select, loadedOptions);
        if (newFolder) fillFolderOptions(newFolder.parent, loadedOptions, { rootKey: "root_folder" });
        const selected = String(loaded?.selected ?? "");
        if (loadedOptions.length === 0 || (!allowNewFolder && !selected)) {
            select.disabled = true;
            status.show("dataset_folder_unavailable");
            return;
        }
        status.clear();
        select.disabled = Boolean(newFolder?.open);
        select.value = selected;
        // A new dataset has no folder yet; an existing one is measured from its own.
        confirmed = allowNewFolder ? "" : select.value;
    }

    function load(pending) {
        return Promise.resolve(pending).then(show, (error) => {
            select.disabled = true;
            status.show("dataset_folder_unavailable");
            void error;
        });
    }

    const ready = load(choices);

    return {
        element: section,
        select,
        ready,
        /**
         * The chosen folder, or the new folder to make when one was asked for,
         * with the path it is shown by and whether the site navigation lists
         * the datasets directly in it.
         */
        value: () => {
            const optionFor = (value) => loadedOptions.find((option) => option.value === value);
            if (newFolder?.open) {
                const name = newFolder.name.value.trim();
                const parentLabel = optionFor(newFolder.parent.value)?.label;
                return {
                    folderId: "",
                    newFolder: { name, parentId: newFolder.parent.value },
                    label: parentLabel ? `${parentLabel} / ${name}` : name,
                    isCurrentProject: false,
                };
            }
            const folderId = select.disabled ? "" : select.value;
            const option = optionFor(folderId);
            return { folderId, newFolder: null, label: option?.label || "", isCurrentProject: option?.isCurrentProject === true };
        },
        /** Whether the person moved the dataset away from the folder it is in. */
        changed: () => !select.disabled && select.value !== confirmed,
        /** The server now holds this folder for the dataset. */
        accept: () => {
            confirmed = select.value;
            pendingConfirmation = null;
            status.clear();
            confirmButton.hidden = true;
        },
        /**
         * The reason the form cannot be sent as it is, or null: a new folder
         * was asked for but has no name. The reason is shown beside the name.
         */
        validate: () => {
            if (!newFolder?.open || newFolder.name.value.trim()) return null;
            newFolder.nameStatus.show("dataset_new_folder_name_required");
            newFolder.name.focus();
            return "dataset_new_folder_name_required";
        },
        /** Refresh the browser's reminder for a new folder without a name, in the current language. */
        syncValidity: () => newFolder?.syncValidity(),
        /** Show that saving the folder failed, beside the control. */
        reportFailure: () => {
            confirmButton.hidden = true;
            status.show("dataset_folder_save_failed");
        },
        /** Show the server's question and offer the move again as a decision. */
        offerConfirmation: (message, onConfirm) => {
            pendingConfirmation = onConfirm;
            if (message) status.showMessage(message);
            else status.show("dataset_folder_save_failed");
            confirmButton.hidden = false;
        },
        /** Start over for the next new dataset, with the folders as they are now. */
        reset: (nextChoices) => {
            newFolder?.setOpen(false);
            return load(nextChoices ?? { options: loadedOptions, selected: resolveFolderSelectionDefaults(loadedOptions).existingFolderValue });
        },
    };
}
