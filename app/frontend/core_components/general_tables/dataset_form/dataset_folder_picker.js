// dataset_folder_picker.js
// Lets an administrator choose which navigation folder holds a dataset.
// Bridges the dataset forms with the navigation tree data and the folder-move route.
// Exists so a dataset's place in the tree can be corrected where the dataset is
// defined, instead of only while the dataset is being created.
import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { getTranslationForKey } from "../../lang/translation_handler.js";
import { buildFolderOptionsFromNodes } from "../gt_3_table_crud/gt_3_1_table_create/table_creator_folder_helpers.js";

// The site's own language keys carry the translations; the English text here is
// the fallback an installation without these keys still shows.
const COPY_KEYS = Object.freeze({
    label: ["select_folder", "Choose a folder"],
    unavailable: ["dataset_folder_unavailable", "The folders could not be read."],
    saveFailed: ["dataset_folder_save_failed", "The folder could not be saved."],
    confirm: ["dataset_folder_move_anyway", "Move anyway"],
});

/** Read the control's copy from the language keys of the current interface language. */
export function datasetFolderCopy() {
    const text = {};
    for (const [name, [key, fallback]] of Object.entries(COPY_KEYS)) {
        text[name] = getTranslationForKey(key, { fallback }) || fallback;
    }
    return text;
}

/**
 * Where one dataset currently sits in the navigation tree.
 * A dataset the tree does not describe reports empty identities, so the form
 * can say so instead of moving the wrong row.
 */
export function findDatasetPlacement(nodes = [], datasetName = "") {
    const node = (Array.isArray(nodes) ? nodes : []).find(
        (candidate) => candidate?.table_uid && String(candidate?.name || "") === String(datasetName)
    );
    const parentNodeId = String(node?.parent_id || "");
    return {
        folderId: parentNodeId.startsWith("f_") ? parentNodeId.slice(2) : "",
        itemId: Number(node?.db_id) || 0,
        datasetUID: Number(node?.table_uid) || 0,
    };
}

/** The tree the navigation itself draws, preferring the server's current answer. */
export async function readNavigationTreeNodes() {
    try {
        const treeData = await endpoint_router("fetchTreeData");
        const nodes = Array.isArray(treeData?.nodes) ? treeData.nodes : [];
        if (nodes.length > 0) return nodes;
    } catch (error) {
        // A cached tree still names the dataset's folder, which is better than
        // offering no placement at all.
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
 * Build the folder control for a form that edits an existing dataset.
 * The returned handle saves the move only when the person changed the choice.
 */
export function createDatasetFolderPicker({ datasetName }) {
    const text = datasetFolderCopy();

    const label = document.createElement("label");
    label.className = "dataset-folder-picker";
    label.dataset.testid = "dataset-folder-picker";

    const caption = document.createElement("span");
    caption.dataset.langKey = COPY_KEYS.label[0];
    caption.textContent = text.label;

    const select = document.createElement("select");
    select.name = "dataset_folder_id";
    select.dataset.testid = "dataset-folder-select";
    select.disabled = true;

    const status = document.createElement("span");
    status.className = "dataset-folder-status";
    status.setAttribute("role", "status");
    status.hidden = true;

    // A move the server refuses without an explicit decision is offered again
    // here, with the server's own explanation beside it.
    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.className = "dataset-folder-confirm";
    confirmButton.dataset.testid = "dataset-folder-confirm";
    confirmButton.dataset.langKey = COPY_KEYS.confirm[0];
    confirmButton.textContent = text.confirm;
    confirmButton.hidden = true;

    label.append(caption, select, status, confirmButton);

    let placement = { folderId: "", itemId: 0, datasetUID: 0 };

    const ready = readNavigationTreeNodes()
        .then((nodes) => {
            placement = findDatasetPlacement(nodes, datasetName);
            for (const option of buildFolderOptionsFromNodes(nodes)) {
                const folderOption = document.createElement("option");
                folderOption.value = option.value;
                folderOption.textContent = option.label;
                select.appendChild(folderOption);
            }
            if (!placement.itemId || !placement.datasetUID || select.options.length === 0) {
                status.hidden = false;
                status.textContent = text.unavailable;
                return;
            }
            select.disabled = false;
            select.value = placement.folderId;
        })
        .catch((error) => {
            status.hidden = false;
            status.textContent = text.unavailable;
            void error;
        });

    async function move({ confirmed }) {
        await endpoint_router("updateTableFolder", {
            method: "POST",
            body_data: {
                item_id: placement.itemId,
                item_type: "table",
                dataset_uid: placement.datasetUID,
                new_folder_id: Number(select.value),
                confirm_cross_project_move: confirmed,
                confirm_tab_visibility_change: confirmed,
            },
            suppressErrorToast: true,
        });
        placement = { ...placement, folderId: select.value };
        status.hidden = true;
        confirmButton.hidden = true;
    }

    confirmButton.addEventListener("click", async () => {
        confirmButton.disabled = true;
        try {
            await move({ confirmed: true });
        } catch (error) {
            status.textContent = text.saveFailed;
            void error;
        } finally {
            confirmButton.disabled = false;
        }
    });

    return {
        element: label,
        select,
        ready,
        /** The chosen folder, as the tree identifies it. */
        value: () => select.value,
        /** Whether the person moved the dataset this time. */
        changed: () => !select.disabled && select.value !== placement.folderId,
        /**
         * Move the dataset. Returns "saved", "unchanged", "failed", or
         * "needs_confirmation" when the server asked for an explicit decision.
         */
        save: async () => {
            if (select.disabled || !select.value || select.value === placement.folderId) return "unchanged";
            try {
                await move({ confirmed: false });
                return "saved";
            } catch (error) {
                status.hidden = false;
                // A conflict is the server asking a question, not a failure.
                if (error?.status === 409) {
                    status.textContent = describeConflict(error) || text.saveFailed;
                    confirmButton.hidden = false;
                    return "needs_confirmation";
                }
                status.textContent = text.saveFailed;
                confirmButton.hidden = true;
                return "failed";
            }
        },
    };
}

/** The server's own sentence about a move it refused, without the route noise. */
function describeConflict(error) {
    const message = String(error?.message || "");
    const separator = message.indexOf("): ");
    return separator === -1 ? message.trim() : message.slice(separator + 3).trim();
}
