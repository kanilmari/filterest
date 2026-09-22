// dataset_dimension_panels.js
// Assembles the dataset dimensions that both dataset forms describe.
// Bridges an editing dialog with the shared symbol, folder, picture,
// deletion-protection, reading-rights and foreign-key controls.
// Exists so a form asks for one set of dimensions instead of wiring six
// controls, six identities and six save steps of its own.
import { createDatasetSymbolPicker, readDatasetSymbol } from "./dataset_symbol_picker.js";
import { createDatasetFolderPicker } from "./dataset_folder_picker.js";
import { createDatasetGroupReadControl } from "./dataset_group_read_access.js";
import { createDatasetDeletionProtectionControl } from "./dataset_deletion_protection.js";
import { createDatasetImageAttachmentControl } from "./dataset_image_attachments.js";
import { createDatasetForeignKeyPanel } from "./dataset_foreign_keys_panel.js";

/**
 * Build every dataset-level dimension for one existing dataset.
 *
 * @param {object} options
 * @param {string} options.datasetName - the dataset being described
 * @param {() => string[]} options.columnNames - the column names the open form
 *   currently shows, including ones the same save is about to add
 * @returns {object} the elements to place, and the one save step that applies them
 */
export function createDatasetDimensionPanels({ datasetName, columnNames = () => [] }) {
    // One lookup names the dataset for every control that needs its identity.
    const identity = readDatasetSymbol(datasetName).catch((error) => {
        console.warn("Dataset identity lookup failed:", error);
        return { iconKey: "", tableUID: 0 };
    });

    // The dataset's own symbol belongs where the dataset is defined, so it is
    // chosen here rather than only in the separate symbol tool. The symbol the
    // dataset already has is what a Save compares against, so choosing
    // "No symbol" removes it.
    const symbolPicker = createDatasetSymbolPicker({ stored: identity });

    // The dimensions below were previously offered only while a dataset was
    // being created. A dataset is described in one place, so the editing form
    // reaches the same settings through the routes that already own them.
    const folderPicker = createDatasetFolderPicker({ datasetName });
    const imageAttachments = createDatasetImageAttachmentControl({ datasetName });
    const deletionProtection = createDatasetDeletionProtectionControl({ datasetName });
    const groupReadAccess = createDatasetGroupReadControl({
        datasetName,
        tableUID: identity.then(({ tableUID }) => tableUID),
    });
    const foreignKeys = createDatasetForeignKeyPanel({ datasetName, columnNames });

    const settingsPanel = document.createElement("section");
    settingsPanel.className = "manage-table-dataset-settings dataset-form-section";
    settingsPanel.append(imageAttachments.element, deletionProtection.element);

    return {
        /** Placed with the rest of the dataset's own description, above the columns. */
        elements: [symbolPicker.element, folderPicker.element, settingsPanel, groupReadAccess.element],
        /** Placed after the columns, because a link names a column of this dataset. */
        foreignKeysElement: foreignKeys.element,
        /** Resolves once every control shows the dataset's current state. */
        ready: Promise.allSettled([
            symbolPicker.ready, folderPicker.ready, imageAttachments.ready,
            deletionProtection.ready, groupReadAccess.ready, foreignKeys.ready,
        ]),
        /**
         * The deletion switch travels inside the schema request, so a refused
         * change never leaves the dataset half-protected. Undefined means the
         * person did not touch it.
         */
        preventDeletionChange: () => (deletionProtection.changed() ? deletionProtection.value() : undefined),
        /** Remember the deletion switch after the schema request succeeded. */
        acceptPreventDeletion: () => deletionProtection.accept(),
        /**
         * Apply every remaining dimension through its own route. Each one
         * reports beside its own control, so one refused setting never hides
         * the rest of a successful save.
         *
         * @returns {Promise<boolean>} true when nothing is left needing attention
         */
        saveAll: async () => {
            const outcomes = [
                await symbolPicker.save(),
                await folderPicker.save(),
                await imageAttachments.save(),
                await groupReadAccess.save(),
                await foreignKeys.save(),
            ];
            return outcomes.every((outcome) => outcome === "saved" || outcome === "unchanged");
        },
    };
}
