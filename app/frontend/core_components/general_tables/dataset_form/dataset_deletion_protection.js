// dataset_deletion_protection.js
// The dataset form's deletion-protection switch, in both modes.
// Bridges the form with the dataset-settings read, and with the create and
// schema requests that carry the switch.
// Exists so the protection chosen while a dataset is created can be seen and
// corrected later, instead of being discovered only when a deletion fails.
import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { createDatasetFormStatus, setDatasetFormText } from "./dataset_form_text.js";

/** Whether one dataset currently refuses deletion. */
export async function readDeletionProtection(datasetName) {
    const settings = await endpoint_router("modifyColumns", {
        url_params: `?${new URLSearchParams({ dataset_name: String(datasetName) }).toString()}`,
        suppressErrorToast: true,
    });
    if (settings?.dataset_name !== String(datasetName) || typeof settings.prevent_deletion !== "boolean") {
        throw new Error("Dataset settings readback did not match the requested dataset");
    }
    return settings.prevent_deletion;
}

/**
 * Build the deletion-protection switch. The choice travels inside the create
 * or schema request, so a refused change never leaves the protection half-applied.
 *
 * @param {object} [options]
 * @param {Promise<boolean>} [options.stored] - when editing, whether the dataset
 *   refuses deletion now; the switch stays closed until that is known. Without
 *   it the switch describes a new dataset, which is unprotected unless chosen.
 */
export function createDatasetDeletionProtectionControl({ stored = null } = {}) {
    const label = document.createElement("label");
    label.className = "dataset-deletion-protection dataset-form-option";
    label.dataset.testid = "dataset-deletion-protection";

    const input = Object.assign(document.createElement("input"), { type: "checkbox", name: "dataset_prevent_deletion" });
    input.dataset.testid = "dataset-deletion-protection-input";
    const status = createDatasetFormStatus("dataset-deletion-protection-status");
    label.append(input, setDatasetFormText(document.createElement("span"), "prevent_table_deletion_hosting_request"),
        status.element);

    let prevented = false;
    if (stored) input.disabled = true;

    const ready = !stored ? Promise.resolve() : Promise.resolve(stored)
        .then((current) => {
            prevented = current === true;
            input.checked = prevented;
            input.disabled = false;
        })
        .catch((error) => {
            status.show("dataset_deletion_protection_unavailable");
            void error;
        });

    return {
        element: label,
        input,
        ready,
        /** The chosen protection. */
        value: () => input.checked,
        /** Whether the person changed the protection this time. */
        changed: () => !input.disabled && input.checked !== prevented,
        /** Remember a saved choice, so a second Save sends nothing new. */
        accept: () => { prevented = input.checked; },
    };
}
