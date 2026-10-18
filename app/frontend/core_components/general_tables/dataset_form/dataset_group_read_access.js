// dataset_group_read_access.js
// The dataset form's reading rights, in both modes: whether signed-in users and
// guests may read the dataset.
// Bridges the form with the permission routes the permission editor already
// uses, through the form's persistence adapters, so no second way of storing a
// right is invented.
// Exists so the reading rights granted while a dataset is created can also be
// granted or withdrawn afterwards, where the dataset is described.
import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { fetch_all_functions, fetch_user_groups } from "../../admin_tools/permission_checker.js";
import { createDatasetFormStatus, setDatasetFormText } from "./dataset_form_text.js";

// Mirrors creation defaults in dtt_crud_workflows/create_table_registration.go;
// create_table_read_defaults_test.go pins both lists across the language boundary.
// Guest AI grants require a separate choice; withdrawal removes all eight read routes.
export const DATASET_GUEST_READ_FUNCTION_NAMES = Object.freeze([
    "dtt_1_row_read.GetResultsHandlerWrapper",
    "dtt_1_row_read.GetRowCountHandlerWrapper",
    "dtt_1_row_read.GetFilterOptionsHandler",
    "dtt_1_row_read.GetDynamicChildItemsHandler",
    "dtt_2_column_crud.GetTableColumnsHandler",
    "dtt_3_table_read.GetTableViewHandlerWrapper",
]);

// Signed-in users retain the existing eight-capability bundle, including AI.
export const DATASET_READ_FUNCTION_NAMES = Object.freeze([
    "dtt_1_row_read.GetResultsHandlerWrapper",
    "dtt_1_row_read.GetIntelligentResultsHandlerWrapper",
    "dtt_1_row_read.GetRowCountHandlerWrapper",
    "dtt_1_row_read.GetFilterOptionsHandler",
    "dtt_1_row_read.GetDynamicChildItemsHandler",
    "dtt_1_row_read.GetResultsVector",
    "dtt_2_column_crud.GetTableColumnsHandler",
    "dtt_3_table_read.GetTableViewHandlerWrapper",
]);

// The two groups the form decides about. Every other group stays with the
// permission editor, which can express the whole matrix.
const GROUPS = Object.freeze([
    { groupName: "users", copyKey: "grant_users_read", grantFunctionNames: DATASET_READ_FUNCTION_NAMES },
    { groupName: "guests", copyKey: "grant_guests_read", grantFunctionNames: DATASET_GUEST_READ_FUNCTION_NAMES },
]);

/**
 * Which of the two groups may currently read this dataset.
 * Full means the whole grant bundle is held, even with extra guest AI grants.
 * AI routes without any ordinary route mean ai_only for both groups.
 * Every other nonempty holding without the full bundle means partial, never none.
 */
export function resolveGroupReadState({ functions = [], groups = [], permissions = [], tableUID = 0 }) {
    const datasetPermissions = (Array.isArray(permissions) ? permissions : [])
        .filter((entry) => Number(entry?.target_table_uid) === Number(tableUID));

    const state = {};
    const readFunctionIds = functions
        .filter((entry) => DATASET_READ_FUNCTION_NAMES.includes(entry?.name))
        .map((entry) => Number(entry.id));
    const ordinaryReadFunctionIds = functions
        .filter((entry) => DATASET_GUEST_READ_FUNCTION_NAMES.includes(entry?.name))
        .map((entry) => Number(entry.id));
    for (const { groupName, grantFunctionNames } of GROUPS) {
        const grantFunctionIds = functions
            .filter((entry) => grantFunctionNames.includes(entry?.name))
            .map((entry) => Number(entry.id));
        const group = groups.find((candidate) => String(candidate?.name || "").toLowerCase() === groupName);
        // Authorization uses the dataset ID regardless of schema, but deletion
        // also matches the stored schema. Keep every row, including duplicates
        // for one function under different schemas, for a complete withdrawal.
        const heldReadPermissions = datasetPermissions.filter((entry) =>
            Number(entry.user_group_id) === Number(group?.id) && readFunctionIds.includes(Number(entry.function_id)))
            .map((entry) => ({ ...entry }));
        const heldReadFunctionIds = readFunctionIds.filter((id) =>
            heldReadPermissions.some((entry) => Number(entry.function_id) === id));
        const full = grantFunctionIds.length === grantFunctionNames.length
            && grantFunctionIds.every((id) => heldReadFunctionIds.includes(id));
        let status = "none";
        if (full) status = "full";
        else if (heldReadFunctionIds.length > 0) {
            status = ordinaryReadFunctionIds.some((id) => heldReadFunctionIds.includes(id)) ? "partial" : "ai_only";
        }
        state[groupName] = {
            groupId: Number(group?.id) || 0,
            grantFunctionIds,
            heldReadFunctionIds,
            heldReadPermissions,
            status,
        };
    }
    return { state };
}

/** The two groups' current reading rights on one existing dataset. */
export async function readGroupReadState(tableUID) {
    const uid = Number(await tableUID) || 0;
    if (!uid) throw new Error("The dataset's identity is unknown");
    const [functions, groups, permissions] = await Promise.all([
        fetch_all_functions(),
        fetch_user_groups(),
        endpoint_router("datasetPermissions", { suppressErrorToast: true }),
    ]);
    return { ...resolveGroupReadState({ functions, groups, permissions, tableUID: uid }), tableUID: uid };
}

/**
 * The permission rows one dataset's changed reading rights add and remove.
 * An unchanged group contributes nothing, so a save never rewrites rights the
 * person did not touch.
 */
export function buildGroupReadPermissionChanges({
    state = {}, chosen = {}, touched = {}, datasetName = "", tableUID = 0,
}) {
    const add = [];
    const remove = [];
    for (const { groupName } of GROUPS) {
        const current = state[groupName];
        if (!current?.groupId || !touched[groupName] || chosen[groupName] === undefined) continue;
        if (!chosen[groupName]) {
            for (const held of current.heldReadPermissions) {
                remove.push({
                    user_group_id: Number(held.user_group_id),
                    function_id: Number(held.function_id),
                    target_schema_name: held.target_schema_name,
                    target_dataset_name: held.target_dataset_name ?? datasetName,
                    target_table_uid: Number(held.target_table_uid),
                });
            }
            continue;
        }
        const functionIds = current.grantFunctionIds.filter((id) => !current.heldReadFunctionIds.includes(id));
        for (const functionId of functionIds) {
            add.push({
                user_group_id: current.groupId,
                function_id: functionId,
                target_schema_name: "public",
                target_dataset_name: datasetName,
                target_table_uid: Number(tableUID),
            });
        }
    }
    return { add, remove };
}

/** Apply one dataset's changed reading rights through the permission editor's route. */
export function saveGroupReadPermissionChanges(changes) {
    return endpoint_router("datasetPermissions", {
        method: "PATCH",
        body_data: changes,
        suppressErrorToast: true,
    });
}

/**
 * Build the reading-rights control.
 *
 * @param {object} [options]
 * @param {Promise<{state: object}>} [options.stored] - when editing, the rights
 *   the dataset has now (readGroupReadState); a group whose right cannot be read
 *   stays closed rather than showing a guess. Without it the control describes
 *   a new dataset, which nobody but administrators may read unless chosen.
 */
export function createDatasetGroupReadControl({ stored = null } = {}) {
    const section = document.createElement("section");
    section.className = "dataset-group-read dataset-form-section";
    section.dataset.testid = "dataset-group-read";

    const title = setDatasetFormText(document.createElement("div"), "default_permissions");
    title.className = "dataset-group-read-title dataset-form-section-title";
    section.appendChild(title);

    const checkboxes = {};
    const touched = { users: false, guests: false };
    const partialLabels = {};
    for (const { groupName, copyKey } of GROUPS) {
        const label = document.createElement("label");
        label.className = "dataset-group-read-option dataset-form-option";
        const input = Object.assign(document.createElement("input"), {
            type: "checkbox", name: `dataset_group_read_${groupName}`,
        });
        input.dataset.testid = `dataset-group-read-${groupName}`;
        input.disabled = Boolean(stored);
        const partial = setDatasetFormText(document.createElement("span"), "dataset_permissions_partial");
        partial.className = "dataset-group-read-partial dataset-form-status";
        partial.hidden = true;
        input.addEventListener("change", () => {
            touched[groupName] = true;
            input.indeterminate = false;
            partial.hidden = true;
        });
        label.append(input, setDatasetFormText(document.createElement("span"), copyKey), partial);
        section.appendChild(label);
        checkboxes[groupName] = input;
        partialLabels[groupName] = partial;
    }
    const status = createDatasetFormStatus("dataset-group-read-status");
    section.appendChild(status.element);

    if (stored) status.show("dataset_permissions_loading");

    function showStoredState(resolved) {
        let readable = false;
        for (const { groupName } of GROUPS) {
            const current = resolved?.state?.[groupName];
            if (!current?.groupId) continue;
            readable = true;
            checkboxes[groupName].checked = current.status === "full";
            const mixed = current.status === "ai_only" || current.status === "partial";
            checkboxes[groupName].indeterminate = mixed;
            setDatasetFormText(partialLabels[groupName], current.status === "ai_only"
                ? "dataset_permissions_ai_only" : "dataset_permissions_partial");
            partialLabels[groupName].hidden = !mixed;
            checkboxes[groupName].disabled = false;
        }
        if (readable) status.clear();
        else status.show("dataset_permissions_unavailable");
    }

    const ready = !stored ? Promise.resolve() : Promise.resolve(stored)
        .then(showStoredState)
        .catch((error) => {
            status.show("dataset_permissions_unavailable");
            void error;
        });

    return {
        element: section,
        checkboxes,
        ready,
        /** The chosen right of each group the control could read. */
        value: () => Object.fromEntries(
            GROUPS.filter(({ groupName }) => !checkboxes[groupName].disabled)
                .map(({ groupName }) => [groupName, checkboxes[groupName].checked])
        ),
        /** Interaction is explicit: an untouched mixed right is never an off choice. */
        touched: () => ({ ...touched }),
        changed: () => GROUPS.some(({ groupName }) => touched[groupName]),
        /** Accept the re-read rights when supplied, rather than assuming the choice persisted. */
        accept: (resolved = null) => {
            for (const { groupName } of GROUPS) touched[groupName] = false;
            if (resolved) showStoredState(resolved);
            else status.clear();
        },
        /** Show that saving the rights failed, beside the control. */
        reportFailure: () => status.show("dataset_permissions_save_failed"),
    };
}
