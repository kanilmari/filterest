// dataset_image_attachments.js
// Turns picture attachments on or off for one dataset.
// Bridges the dataset forms with the asset-linking routes the creation form
// already calls, so both forms mean the same capability by "images".
// Exists so a dataset that was created without pictures can be given them, and
// a dataset that no longer needs them can put the upload surface away.
import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { getTranslationForKey } from "../../lang/translation_handler.js";

// The site's own language keys carry the translations; the English text here is
// the fallback an installation without these keys still shows.
const COPY_KEYS = Object.freeze({
    label: ["create_table_enable_images", "Allow pictures in this dataset"],
    unavailable: ["dataset_images_unavailable", "The picture setting could not be read."],
    saveFailed: ["dataset_images_save_failed", "The picture setting could not be saved."],
});

/** Read the control's copy from the language keys of the current interface language. */
export function datasetImageAttachmentCopy() {
    const text = {};
    for (const [name, [key, fallback]] of Object.entries(COPY_KEYS)) {
        text[name] = getTranslationForKey(key, { fallback }) || fallback;
    }
    return text;
}

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

/**
 * Build the picture-attachment control for a form that edits an existing
 * dataset. The returned handle saves only when the person changed the choice.
 */
export function createDatasetImageAttachmentControl({ datasetName }) {
    const text = datasetImageAttachmentCopy();

    const label = document.createElement("label");
    label.className = "dataset-image-attachments dataset-form-option";
    label.dataset.testid = "dataset-image-attachments";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "dataset_enable_images";
    input.dataset.testid = "dataset-image-attachments-input";
    input.disabled = true;

    const caption = document.createElement("span");
    caption.dataset.langKey = COPY_KEYS.label[0];
    caption.textContent = text.label;

    const status = document.createElement("span");
    status.className = "dataset-image-attachments-status dataset-form-status";
    status.setAttribute("role", "status");
    status.hidden = true;

    label.append(input, caption, status);

    let enabled = false;

    const ready = readImageAttachmentState(datasetName)
        .then((current) => {
            enabled = current;
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
        /** Whether the dataset would offer pictures after this form is saved. */
        value: () => input.checked,
        /** Whether the person changed the choice this time. */
        changed: () => !input.disabled && input.checked !== enabled,
        /** Save the choice. Returns "saved", "unchanged" or "failed". */
        save: async () => {
            if (input.disabled || input.checked === enabled) return "unchanged";
            try {
                await endpoint_router(
                    input.checked ? "enableImageAssetLinking" : "disableImageAssetLinking",
                    {
                        method: "POST",
                        body_data: { parent_table: String(datasetName) },
                        suppressErrorToast: true,
                    }
                );
                enabled = input.checked;
                status.hidden = true;
                return "saved";
            } catch (error) {
                status.hidden = false;
                status.textContent = text.saveFailed;
                void error;
                return "failed";
            }
        },
    };
}
