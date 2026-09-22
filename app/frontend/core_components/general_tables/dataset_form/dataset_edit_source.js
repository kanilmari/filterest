// dataset_edit_source.js
// The dataset form's editing adapter: what an existing dataset holds now, and
// how an edited draft is saved.
// Bridges the form with the schema route first, then with the routes that own
// each remaining setting (symbol, folder, pictures, reading rights, links).
// Exists so the form itself never knows an endpoint, and so a save that the
// server partly accepted is remembered: a retry repeats nothing already made.
import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { fetch_columns_for_table } from "../../endpoints/endpoint_column_fetcher.js";
import { invalidateDatabaseCatalogTreeCache } from "../../table_views/tree_view/tree_view_printer.js";
import { getDatasetUIVisibility, setDatasetUIVisibility } from "../gt_2_column_crud/dataset_ui_visibility.js";
import { buildFolderOptionsFromNodes, findDatasetPlacement } from "./dataset_folder_options.js";
import { describeFolderConflict, moveDatasetToFolder, readNavigationTreeNodes } from "./dataset_folder_picker.js";
import { assignDatasetSymbol, readDatasetSymbol } from "./dataset_symbol_picker.js";
import { readImageAttachmentState, setImageAttachments } from "./dataset_image_attachments.js";
import { readDeletionProtection } from "./dataset_deletion_protection.js";
import {
    buildGroupReadPermissionChanges, readGroupReadState, saveGroupReadPermissionChanges,
} from "./dataset_group_read_access.js";
import { addDatasetForeignKey, readDatasetForeignKeys } from "./dataset_foreign_keys_panel.js";
import { findDatasetColumnType } from "./dataset_column_type_catalog.js";
import { buildDatasetEditRequest, toSavedColumn } from "./dataset_form_requests.js";

const SETTLED = new Set(["saved", "unchanged"]);

/**
 * The adapter the dataset form uses to edit one existing dataset. It reads the
 * dataset's columns before the form opens, because the form shows them at once.
 *
 * @param {string} datasetName
 * @param {object} [options]
 * @param {() => void} [options.drop] - opens the dataset's removal dialog
 */
export async function createDatasetEditSource(datasetName, { drop = () => {} } = {}) {
    const columns = await fetch_columns_for_table(datasetName);
    const declaredDefault = columns[0]?.new_columns_multilingual;
    // What the server holds, as far as this adapter knows; it advances with
    // every schema change the server accepts.
    let savedMultilingualDefault = typeof declaredDefault === "boolean"
        ? declaredDefault : columns.some((column) => column.is_multilingual === true);
    // Every stored type is spelled the way the shared catalogue spells it, so
    // an unrelated Save cannot rewrite a column merely because PostgreSQL and
    // the form use different names for the same type.
    columns.forEach((column) => {
        column.data_type = findDatasetColumnType(column.data_type)?.value || column.data_type;
    });
    const savedColumns = columns.map((column) =>
        toSavedColumn(column.column_name, column.data_type, column.character_maximum_length));

    let identity = Promise.resolve({ iconKey: "", tableUID: 0 });
    let placement = { folderId: "", itemId: 0, datasetUID: 0 };
    let readers = null;

    // Once the server has taken a schema change, the adapter describes what it
    // now holds. A later setting can still be refused and keep the form open;
    // a retry compared against the columns as they were opened would repeat an
    // addition or rename the server already made, be refused for it, and take
    // the settings still waiting to be saved down with it. Only what was sent
    // is recorded, so an edit made while the request was under way stays a
    // change for the next Save.
    function acceptSavedColumns({ removed, modified, added, sentRows, sentRoles, requestData }) {
        // Find every changed column before renaming any, so two columns that
        // swap names in one save are not mistaken for each other.
        const updates = [...modified, ...added].map((change) => ({
            change,
            entry: change.original_name
                ? savedColumns.find((column) => column.column_name === change.original_name) : null,
        }));
        for (const name of removed) {
            const index = savedColumns.findIndex((column) => column.column_name === name);
            if (index !== -1) savedColumns.splice(index, 1);
        }
        for (const { change, entry } of updates) {
            const held = toSavedColumn(change.new_name, change.data_type, change.length);
            if (entry) Object.assign(entry, held);
            else savedColumns.push(held);
            sentRows.get(change)?.markSaved(change.new_name);
        }
        for (const { row, role } of sentRoles) row.acceptRole(role);
        if (requestData.new_columns_multilingual !== undefined) {
            savedMultilingualDefault = requestData.new_columns_multilingual;
        }
    }

    // A setting is saved through its own route; the outcome is shown beside
    // its own control, and only a saved one becomes the new baseline.
    async function applySetting(control, operation) {
        try {
            await operation();
            control.accept();
            return "saved";
        } catch (error) {
            control.reportFailure();
            void error;
            return "failed";
        }
    }

    async function saveSymbol(draft, control) {
        if (!control.changed()) return "unchanged";
        const { tableUID } = await identity;
        return applySetting(control, () => {
            if (!tableUID) throw new Error("The dataset's identity is unknown");
            return assignDatasetSymbol(tableUID, draft.symbol);
        });
    }

    async function moveFolder(control, confirmed) {
        const folderId = control.value().folderId;
        await moveDatasetToFolder(placement, folderId, { confirmed });
        placement = { ...placement, folderId };
        control.accept();
    }

    async function saveFolder(control) {
        if (!control.changed() || !placement.itemId) return "unchanged";
        try {
            await moveFolder(control, false);
            return "saved";
        } catch (error) {
            // A conflict is the server asking a question, not a failure: the
            // move is offered again beside the control, as a decision.
            if (error?.status === 409) {
                control.offerConfirmation(describeFolderConflict(error), () =>
                    moveFolder(control, true).catch(() => control.reportFailure()));
                return "needs_confirmation";
            }
            control.reportFailure();
            return "failed";
        }
    }

    async function saveImages(draft, control) {
        if (!control.changed()) return "unchanged";
        return applySetting(control, () => setImageAttachments(datasetName, draft.images));
    }

    async function saveReaders(draft, control) {
        if (!control.changed() || !readers) return "unchanged";
        const changes = buildGroupReadPermissionChanges({
            ...readers, chosen: draft.readers, datasetName, tableUID: readers.tableUID,
        });
        if (changes.add.length === 0 && changes.remove.length === 0) return "unchanged";
        return applySetting(control, async () => {
            await saveGroupReadPermissionChanges(changes);
            for (const [groupName, granted] of Object.entries(draft.readers)) {
                if (readers.state[groupName]) readers.state[groupName].granted = granted;
            }
        });
    }

    async function saveLinks(draft, control) {
        if (draft.links.length === 0) return "unchanged";
        try {
            for (const link of draft.links) await addDatasetForeignKey(datasetName, link);
        } catch (error) {
            control.reportFailure();
            void error;
            return "failed";
        }
        control.accept(await readDatasetForeignKeys(datasetName).catch(() => null));
        return "saved";
    }

    return {
        mode: "edit",
        datasetName,
        initialColumns: columns.map((column) => ({
            existing: true,
            name: column.column_name,
            dataType: column.data_type,
            length: column.character_maximum_length,
            role: column.card_element,
        })).concat([{}]),
        multilingualDefault: savedMultilingualDefault,

        /** Everything the dataset holds now, read when the form opens. */
        load() {
            // One lookup names the dataset for every control that needs its identity.
            identity = readDatasetSymbol(datasetName).catch((error) => {
                console.warn("Dataset identity lookup failed:", error);
                return { iconKey: "", tableUID: 0 };
            });
            const nodes = readNavigationTreeNodes();
            return {
                symbol: identity,
                folderChoices: nodes.then((treeNodes) => {
                    placement = findDatasetPlacement(treeNodes, datasetName);
                    const known = placement.itemId && placement.datasetUID;
                    return { options: buildFolderOptionsFromNodes(treeNodes), selected: known ? placement.folderId : "" };
                }),
                images: readImageAttachmentState(datasetName),
                preventDeletion: readDeletionProtection(datasetName),
                readers: readGroupReadState(identity.then(({ tableUID }) => tableUID))
                    .then((state) => { readers = state; return state; }),
                links: readDatasetForeignKeys(datasetName),
                datasetNames: endpoint_router("datasetNames", { suppressErrorToast: true }),
                visibility: getDatasetUIVisibility(datasetName),
            };
        },
        readColumns: (name) => fetch_columns_for_table(name),
        restore: () => setDatasetUIVisibility(datasetName, false),
        drop,

        /**
         * Save the columns first, then every remaining setting through its own
         * route. Each setting reports beside its own control, so one refused
         * setting never hides the rest of a successful save.
         */
        async save(draft, controls) {
            const edit = buildDatasetEditRequest({
                datasetName,
                savedColumns,
                columns: draft.columns,
                multilingualDefault: draft.multilingualDefault,
                savedMultilingualDefault,
                // The deletion switch travels inside the schema request, so a
                // refused change never leaves the dataset half-protected.
                preventDeletion: controls.deletion.changed() ? draft.preventDeletion : undefined,
            });
            if (!edit.ok) return { status: "invalid", warningKey: edit.warningKey };

            try {
                await endpoint_router("modifyColumns", {
                    method: "POST", body_data: edit.requestData, suppressErrorToast: true,
                });
            } catch (error) {
                console.warn("Column management save failed:", error);
                return { status: "failed", error };
            }
            // Before anything else can fail: the columns are saved now, and a
            // retry must compare against them rather than repeat them.
            controls.deletion.accept();
            acceptSavedColumns(edit);

            const outcomes = [
                await saveSymbol(draft, controls.symbol),
                await saveFolder(controls.folder),
                await saveImages(draft, controls.images),
                await saveReaders(draft, controls.readers),
                await saveLinks(draft, controls.links),
            ];
            // The navigation trees read the dataset list and its symbols from
            // the cached catalog, so it is forgotten here: a changed symbol or
            // a new column appears at once.
            invalidateDatabaseCatalogTreeCache();
            return {
                status: outcomes.every((outcome) => SETTLED.has(outcome)) ? "saved" : "attention",
                removedColumns: edit.removed,
                renamedColumns: edit.modified
                    .filter((change) => change.original_name !== change.new_name)
                    .map((change) => ({ old_name: change.original_name, new_name: change.new_name })),
            };
        },
    };
}
