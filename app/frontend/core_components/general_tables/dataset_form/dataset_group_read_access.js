// dataset_group_read_access.js
// Offers the signed-in-users and guests read rights of one dataset.
// Bridges the dataset forms with the permission routes the permission editor
// already uses, so no second way of storing a right is invented.
// Exists so the reading rights granted while a dataset is created can also be
// granted or withdrawn afterwards, where the dataset is described.
import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { getTranslationForKey } from "../../lang/translation_handler.js";
import { fetch_all_functions, fetch_user_groups } from "../../admin_tools/permission_checker.js";

// The reading capabilities a dataset grants as one decision. The server grants
// exactly this set when a dataset is created with reading rights, so the two
// forms mean the same thing by "may read this dataset".
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

// The two groups a dataset form decides about. Every other group stays with the
// permission editor, which can express the whole matrix.
const GROUPS = Object.freeze([
    { groupName: "users", copyKey: "grant_users_read", fallback: "Signed-in users may read this dataset" },
    { groupName: "guests", copyKey: "grant_guests_read", fallback: "Guests may read this dataset" },
]);

const COPY_KEYS = Object.freeze({
    title: ["default_permissions", "Reading rights"],
    loading: ["dataset_permissions_loading", "Reading the rights…"],
    unavailable: ["dataset_permissions_unavailable", "The rights could not be read."],
    saveFailed: ["dataset_permissions_save_failed", "The rights could not be saved."],
});

/** Read the control's copy from the language keys of the current interface language. */
export function datasetGroupReadCopy() {
    const text = {};
    for (const [name, [key, fallback]] of Object.entries(COPY_KEYS)) {
        text[name] = getTranslationForKey(key, { fallback }) || fallback;
    }
    for (const group of GROUPS) {
        text[group.groupName] = getTranslationForKey(group.copyKey, { fallback: group.fallback }) || group.fallback;
    }
    return text;
}

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

/**
 * Build the reading-rights control for a form that edits an existing dataset.
 * The returned handle saves only the groups whose right the person changed.
 */
export function createDatasetGroupReadControl({ datasetName, tableUID = 0 }) {
    const text = datasetGroupReadCopy();

    const section = document.createElement("section");
    section.className = "dataset-group-read dataset-form-section";
    section.dataset.testid = "dataset-group-read";

    const title = document.createElement("div");
    title.className = "dataset-group-read-title dataset-form-section-title";
    title.dataset.langKey = COPY_KEYS.title[0];
    title.textContent = text.title;
    section.appendChild(title);

    const status = document.createElement("span");
    status.className = "dataset-group-read-status dataset-form-status";
    status.setAttribute("role", "status");
    status.textContent = text.loading;

    const checkboxes = {};
    for (const { groupName, copyKey } of GROUPS) {
        const label = document.createElement("label");
        label.className = "dataset-group-read-option dataset-form-option";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.name = `dataset_group_read_${groupName}`;
        input.dataset.testid = `dataset-group-read-${groupName}`;
        input.disabled = true;
        const caption = document.createElement("span");
        caption.dataset.langKey = copyKey;
        caption.textContent = text[groupName];
        label.append(input, caption);
        section.appendChild(label);
        checkboxes[groupName] = input;
    }
    section.appendChild(status);

    let resolved = { readFunctionIds: [], state: {} };
    // The dataset's identity may still be on its way when the dialog opens, so
    // the control accepts either the number or the promise that carries it.
    let resolvedTableUID = 0;

    const ready = Promise.resolve(tableUID)
        .then(async (identity) => {
            resolvedTableUID = Number(identity) || 0;
            if (!resolvedTableUID) throw new Error("The dataset's identity is unknown");
            return Promise.all([
                fetch_all_functions(),
                fetch_user_groups(),
                endpoint_router("datasetPermissions", { suppressErrorToast: true }),
            ]);
        })
        .then(([functions, groups, permissions]) => {
            resolved = resolveGroupReadState({ functions, groups, permissions, tableUID: resolvedTableUID });
            let readable = false;
            for (const { groupName } of GROUPS) {
                const current = resolved.state[groupName];
                if (!current?.groupId) continue;
                readable = true;
                checkboxes[groupName].checked = current.granted;
                checkboxes[groupName].disabled = false;
            }
            status.hidden = readable;
            if (!readable) status.textContent = text.unavailable;
        })
        .catch((error) => {
            status.hidden = false;
            status.textContent = text.unavailable;
            void error;
        });

    const chosenValues = () => Object.fromEntries(
        GROUPS.filter(({ groupName }) => !checkboxes[groupName].disabled)
            .map(({ groupName }) => [groupName, checkboxes[groupName].checked])
    );

    return {
        element: section,
        checkboxes,
        ready,
        /** Whether the person changed either group's reading right this time. */
        changed: () => {
            const chosen = chosenValues();
            return GROUPS.some(({ groupName }) =>
                chosen[groupName] !== undefined && chosen[groupName] !== resolved.state[groupName]?.granted);
        },
        /** Save the changed rights. Returns "saved", "unchanged" or "failed". */
        save: async () => {
            const changes = buildGroupReadPermissionChanges({
                readFunctionIds: resolved.readFunctionIds,
                state: resolved.state,
                chosen: chosenValues(),
                datasetName,
                tableUID: resolvedTableUID,
            });
            if (changes.add.length === 0 && changes.remove.length === 0) return "unchanged";
            try {
                await endpoint_router("datasetPermissions", {
                    method: "PATCH",
                    body_data: changes,
                    suppressErrorToast: true,
                });
                for (const { groupName } of GROUPS) {
                    if (resolved.state[groupName]) {
                        resolved.state[groupName].granted = checkboxes[groupName].checked;
                    }
                }
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
