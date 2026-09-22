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

// The reading capabilities a dataset grants as one decision. The server grants
// exactly this set when a dataset is created with reading rights, so the two
// modes mean the same thing by "may read this dataset".
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
    { groupName: "users", copyKey: "grant_users_read" },
    { groupName: "guests", copyKey: "grant_guests_read" },
]);

/**
 * Which of the two groups may currently read this dataset.
 * A group counts as a reader only when it holds every reading capability, so a
 * partly granted right is never shown as a complete one.
 */
export function resolveGroupReadState({ functions = [], groups = [], permissions = [], tableUID = 0 }) {
    const readFunctionIds = functions
        .filter((entry) => DATASET_READ_FUNCTION_NAMES.includes(entry?.name))
        .map((entry) => Number(entry.id));
    const held = new Set(
        (Array.isArray(permissions) ? permissions : [])
            .filter((entry) => Number(entry?.target_table_uid) === Number(tableUID))
            .map((entry) => `${Number(entry?.user_group_id)}:${Number(entry?.function_id)}`)
    );

    const state = {};
    for (const { groupName } of GROUPS) {
        const group = groups.find((candidate) => String(candidate?.name || "").toLowerCase() === groupName);
        state[groupName] = {
            groupId: Number(group?.id) || 0,
            granted: readFunctionIds.length > 0
                && readFunctionIds.every((functionId) => held.has(`${Number(group?.id)}:${functionId}`)),
        };
    }
    return { readFunctionIds, state };
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
export function buildGroupReadPermissionChanges({ readFunctionIds = [], state = {}, chosen = {}, datasetName = "", tableUID = 0 }) {
    const add = [];
    const remove = [];
    for (const { groupName } of GROUPS) {
        const current = state[groupName];
        if (!current?.groupId || chosen[groupName] === undefined || chosen[groupName] === current.granted) continue;
        const target = chosen[groupName] ? add : remove;
        for (const functionId of readFunctionIds) {
            target.push({
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
    for (const { groupName, copyKey } of GROUPS) {
        const label = document.createElement("label");
        label.className = "dataset-group-read-option dataset-form-option";
        const input = Object.assign(document.createElement("input"), {
            type: "checkbox", name: `dataset_group_read_${groupName}`,
        });
        input.dataset.testid = `dataset-group-read-${groupName}`;
        input.disabled = Boolean(stored);
        label.append(input, setDatasetFormText(document.createElement("span"), copyKey));
        section.appendChild(label);
        checkboxes[groupName] = input;
    }
    const status = createDatasetFormStatus("dataset-group-read-status");
    section.appendChild(status.element);

    // What each group holds now. Nobody but administrators reads a new dataset.
    const granted = { users: false, guests: false };
    if (stored) status.show("dataset_permissions_loading");

    const ready = !stored ? Promise.resolve() : Promise.resolve(stored)
        .then((resolved) => {
            let readable = false;
            for (const { groupName } of GROUPS) {
                const current = resolved?.state?.[groupName];
                if (!current?.groupId) continue;
                readable = true;
                granted[groupName] = current.granted === true;
                checkboxes[groupName].checked = granted[groupName];
                checkboxes[groupName].disabled = false;
            }
            if (readable) status.clear();
            else status.show("dataset_permissions_unavailable");
        })
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
        /** Whether the person changed either group's reading right this time. */
        changed: () => GROUPS.some(({ groupName }) =>
            !checkboxes[groupName].disabled && checkboxes[groupName].checked !== granted[groupName]),
        /** The server now holds the chosen rights. */
        accept: () => {
            if (stored) {
                for (const { groupName } of GROUPS) granted[groupName] = checkboxes[groupName].checked;
            }
            status.clear();
        },
        /** Show that saving the rights failed, beside the control. */
        reportFailure: () => status.show("dataset_permissions_save_failed"),
    };
}
