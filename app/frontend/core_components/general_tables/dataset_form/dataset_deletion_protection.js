// dataset_deletion_protection.js
// Shows whether a dataset refuses deletion, and lets that be changed.
// Bridges the dataset forms with the dataset-settings read and write on the
// route that already edits a dataset's definition.
// Exists so the protection chosen while a dataset is created can be seen and
// corrected later, instead of being discovered only when a deletion fails.
import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { getTranslationForKey } from "../../lang/translation_handler.js";

// The site's own language keys carry the translations; the English text here is
// the fallback an installation without these keys still shows.
const COPY_KEYS = Object.freeze({
    label: ["prevent_table_deletion_hosting_request", "Protect this dataset from deletion"],
    unavailable: ["dataset_deletion_protection_unavailable", "The deletion protection could not be read."],
});

/** Read the control's copy from the language keys of the current interface language. */
export function datasetDeletionProtectionCopy() {
    const text = {};
    for (const [name, [key, fallback]] of Object.entries(COPY_KEYS)) {
        text[name] = getTranslationForKey(key, { fallback }) || fallback;
    }
    return text;
}

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
 * Build the deletion-protection control for a form that edits an existing
 * dataset. The choice travels with the rest of the dataset's save, so a refused
 * schema change never leaves the protection half-applied.
 */
export function createDatasetDeletionProtectionControl({ datasetName }) {
    const text = datasetDeletionProtectionCopy();

    const label = document.createElement("label");
    label.className = "dataset-deletion-protection dataset-form-option";
    label.dataset.testid = "dataset-deletion-protection";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "dataset_prevent_deletion";
    input.dataset.testid = "dataset-deletion-protection-input";
    input.disabled = true;

    const caption = document.createElement("span");
    caption.dataset.langKey = COPY_KEYS.label[0];
    caption.textContent = text.label;

    const status = document.createElement("span");
    status.className = "dataset-deletion-protection-status dataset-form-status";
    status.setAttribute("role", "status");
    status.hidden = true;

    label.append(input, caption, status);

    let prevented = false;

    const ready = readDeletionProtection(datasetName)
        .then((current) => {
            prevented = current;
            input.checked = current;
            input.disabled = false;
        })
        .catch((error) => {
            status.hidden = false;
            status.textContent = text.unavailable;
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
