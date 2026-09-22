// dataset_image_attachments.js
// The dataset form's picture switch, in both modes: whether people may attach
// pictures to the dataset's rows.
// Bridges the form with the asset-linking routes through the form's persistence
// adapters, so both modes mean the same capability by "images".
// Exists so a dataset can be created with pictures, be given them later, or put
// the upload surface away when it no longer needs one.
import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { createDatasetFormStatus, setDatasetFormText } from "./dataset_form_text.js";

/** Whether one dataset currently offers picture uploads. */
export async function readImageAttachmentState(datasetName) {
    const snapshot = await endpoint_router("imageAssetLinkingStatus", {
        url_params: `?${new URLSearchParams({ table: String(datasetName) }).toString()}`,
        suppressErrorToast: true,
    });
    const linkings = Array.isArray(snapshot?.asset_linkings) ? snapshot.asset_linkings : [];
    const match = linkings.find((entry) => String(entry?.parent_table || "") === String(datasetName));
    return match?.enabled === true;
}

/** Turn picture uploads on or off for one dataset. */
export function setImageAttachments(datasetName, enabled) {
    return endpoint_router(enabled ? "enableImageAssetLinking" : "disableImageAssetLinking", {
        method: "POST",
        body_data: { parent_table: String(datasetName) },
        suppressErrorToast: true,
    });
}

/**
 * Build the picture switch.
 *
 * @param {object} [options]
 * @param {Promise<boolean>} [options.stored] - when editing, whether the dataset
 *   offers pictures now; the switch stays closed until that is known. Without
 *   it the switch describes a new dataset, which offers pictures unless the
 *   person turns them off.
 */
export function createDatasetImageAttachmentControl({ stored = null } = {}) {
    const label = document.createElement("label");
    label.className = "dataset-image-attachments dataset-form-option";
    label.dataset.testid = "dataset-image-attachments";

    const input = Object.assign(document.createElement("input"), { type: "checkbox", name: "dataset_enable_images" });
    input.dataset.testid = "dataset-image-attachments-input";
    const status = createDatasetFormStatus("dataset-image-attachments-status");
    label.append(input, setDatasetFormText(document.createElement("span"), "create_table_enable_images"), status.element);

    // What the dataset offers now. A new dataset offers nothing until it exists.
    let enabled = false;
    if (stored) {
        input.disabled = true;
    } else {
        input.checked = true;
        input.defaultChecked = true;
    }

    const ready = !stored ? Promise.resolve() : Promise.resolve(stored)
        .then((current) => {
            enabled = current === true;
            input.checked = enabled;
            input.disabled = false;
        })
        .catch((error) => {
            status.show("dataset_images_unavailable");
            void error;
        });

    return {
        element: label,
        input,
        ready,
        /** Whether the dataset should offer pictures after this form is saved. */
        value: () => input.checked,
        /** Whether that differs from what the dataset offers now. */
        changed: () => !input.disabled && input.checked !== enabled,
        /** The server now holds the chosen setting. */
        accept: () => {
            if (stored) enabled = input.checked;
            status.clear();
        },
        /** Show that saving the setting failed, beside the switch. */
        reportFailure: () => status.show("dataset_images_save_failed"),
    };
}
