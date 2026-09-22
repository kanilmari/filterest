// dataset_create_source.js
// The dataset form's creation adapter: what a new dataset starts from, and how
// its draft is sent.
// Bridges the form with the dataset-creation route, then with the symbol and
// picture routes that need the dataset to exist first.
// Exists so the form itself never knows an endpoint: creating differs from
// editing only in this adapter and in the form's mode.
import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { fetch_columns_for_table } from "../../endpoints/endpoint_column_fetcher.js";
import { buildFolderOptionsFromNodes, resolveFolderSelectionDefaults } from "./dataset_folder_options.js";
import { readNavigationTreeNodes } from "./dataset_folder_picker.js";
import { assignDatasetSymbol, readDatasetSymbol } from "./dataset_symbol_picker.js";
import { setImageAttachments } from "./dataset_image_attachments.js";
import { buildDatasetCreateRequest } from "./dataset_form_requests.js";

// Every new dataset starts with these automatic columns and one blank row.
const NEW_DATASET_COLUMNS = Object.freeze([
    Object.freeze({ name: "id", dataType: "SERIAL" }),
    Object.freeze({ name: "created", dataType: "TIMESTAMPTZ NOT NULL DEFAULT NOW()" }),
    Object.freeze({ name: "updated", dataType: "TIMESTAMPTZ NOT NULL DEFAULT NOW()" }),
    Object.freeze({}),
]);

/** The folders, with the one a new dataset goes to unless the person chooses another. */
export async function readNewDatasetFolderChoices() {
    const options = buildFolderOptionsFromNodes(await readNavigationTreeNodes());
    return { options, selected: resolveFolderSelectionDefaults(options).existingFolderValue };
}

/**
 * Where the new dataset went, as the server reports it. An older server
 * answers with a sentence only; the form's own choice then stands in.
 */
export function describeCreatedDataset(response, tableName, chosenFolder = {}) {
    const body = response && typeof response === "object" ? response : {};
    const reported = typeof body.in_site_navigation === "boolean";
    return {
        name: String(body.dataset_name || tableName),
        tableUID: Number(body.table_uid) || 0,
        folderId: String(body.folder_id ?? chosenFolder.folderId ?? ""),
        folderPath: String(body.folder_path || chosenFolder.label || ""),
        inSiteNavigation: reported ? body.in_site_navigation : chosenFolder.isCurrentProject === true,
    };
}

async function settle(operation) {
    try {
        await operation();
        return "saved";
    } catch (error) {
        void error;
        return "failed";
    }
}

/** The adapter the dataset form uses to create a new dataset. */
export function createDatasetCreateSource() {
    return {
        mode: "create",
        initialColumns: NEW_DATASET_COLUMNS,
        multilingualDefault: false,
        /** A new dataset has no stored state; only the choices are read. */
        load: () => ({
            folderChoices: readNewDatasetFolderChoices(),
            datasetNames: endpoint_router("datasetNames", { suppressErrorToast: true }),
        }),
        readFolderChoices: readNewDatasetFolderChoices,
        readColumns: (datasetName) => fetch_columns_for_table(datasetName),

        /**
         * Create the dataset, then give it its symbol and pictures. Once the
         * dataset exists, nothing that follows can undo or repeat the creation:
         * a refused symbol or picture setting is reported beside its control.
         */
        async save(draft) {
            const request = buildDatasetCreateRequest(draft);
            if (!request.ok) return { status: "invalid", warningKey: request.warningKey, field: request.field };

            let response;
            try {
                // The router reports a refused creation in the server's own words.
                response = await endpoint_router("createDataset", { method: "POST", body_data: request.requestData });
            } catch (error) {
                return { status: "failed", error };
            }
            const dataset = describeCreatedDataset(response, request.tableName, draft.folder);

            const settings = {};
            if (draft.symbol) {
                // An unknown identity is a failed save, not a silently skipped one.
                const tableUID = dataset.tableUID
                    || (await readDatasetSymbol(dataset.name).catch(() => ({ tableUID: 0 }))).tableUID;
                settings.symbol = tableUID
                    ? await settle(() => assignDatasetSymbol(tableUID, draft.symbol))
                    : "failed";
            }
            if (draft.images) {
                settings.images = await settle(() => setImageAttachments(dataset.name, true));
            }
            return { status: "created", dataset, settings };
        },
    };
}
