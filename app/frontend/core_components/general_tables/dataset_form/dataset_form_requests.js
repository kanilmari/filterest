// dataset_form_requests.js
// Pure request builders of the dataset form: the create request a new
// dataset's draft becomes, and the schema request an existing dataset's draft
// becomes when measured against what the server holds.
// Bridges the form's one draft shape with the two endpoints, without DOM or
// network access, so both translations stay testable on their own.
// Exists so the two persistence adapters share one draft and differ only in
// how they send it.
import { isValidCardRole } from "../../table_views/card_view/card_role_catalog.js";
import { isValidIdentifier } from "../../../reusable_components/dom_container_builder_helpers.js";
import { composeColumnTypeDefinition } from "./dataset_column_type_catalog.js";

function trimToEmpty(value) {
    return String(value ?? "").trim();
}

function positiveIntegerOrNull(value) {
    const parsed = Number.parseInt(trimToEmpty(value), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

const failure = (warningKey, field = "") => ({ ok: false, warningKey, ...(field ? { field } : {}) });

function buildCreateColumns(columns = []) {
    const definitions = {};
    const roles = {};
    const names = new Set();
    for (const column of columns) {
        const name = trimToEmpty(column?.name);
        if (!name) continue;
        const dataType = trimToEmpty(column?.dataType);
        if (!isValidIdentifier(name)) return failure("invalid_column_name", "columns");
        if (!dataType) return failure("missing_data_type", "columns");
        if (names.has(name.toLowerCase())) return failure("duplicate_column_name", "columns");
        names.add(name.toLowerCase());
        const role = trimToEmpty(column?.role) || "details";
        if (!isValidCardRole(role) || role.length > 255) return failure("invalid_card_role", "columns");
        roles[name] = role;
        definitions[name] = composeColumnTypeDefinition(dataType, { length: column?.length });
    }
    if (Object.keys(definitions).length === 0) return failure("add_at_least_one_column", "columns");
    return { ok: true, definitions, roles };
}

/**
 * The create request a new dataset's draft becomes, or the first reason it
 * cannot be sent. Picture uploads and the symbol are set up once the dataset
 * exists, so they stay outside this request.
 *
 * @param {object} draft - the form's draft (see buildDatasetForm)
 * @returns {{ok: true, tableName: string, requestData: object}
 *   | {ok: false, warningKey: string, field?: string}}
 */
export function buildDatasetCreateRequest(draft = {}) {
    const tableName = trimToEmpty(draft.name);
    if (!tableName) return failure("table_name_required", "name");
    if (!isValidIdentifier(tableName)) return failure("invalid_table_name_chars", "name");

    // A new folder was asked for: it must have a name. A parent chosen with no
    // name would otherwise be dropped silently and the dataset land elsewhere.
    const newFolder = draft.folder?.newFolder || null;
    const newFolderName = trimToEmpty(newFolder?.name);
    if (newFolder && !newFolderName) return failure("dataset_new_folder_name_required", "folder");

    const columns = buildCreateColumns(draft.columns);
    if (!columns.ok) return columns;

    const foreignKeys = (Array.isArray(draft.links) ? draft.links : [])
        .map((link) => ({
            referencing_column: trimToEmpty(link?.referencing_column),
            referenced_dataset: trimToEmpty(link?.referenced_dataset),
            referenced_column: trimToEmpty(link?.referenced_column),
        }))
        .filter((link) => link.referencing_column && link.referenced_dataset && link.referenced_column);

    return {
        ok: true,
        tableName,
        requestData: {
            dataset_name: tableName,
            columns: columns.definitions,
            column_card_roles: columns.roles,
            foreign_keys: foreignKeys,
            grant_users_read: draft.readers?.users === true,
            grant_guests_read: draft.readers?.guests === true,
            prevent_deletion: draft.preventDeletion === true,
            // A dataset born multilingual says so; a dataset that stays silent
            // keeps the metadata default.
            ...(draft.multilingualDefault === true ? { new_columns_multilingual: true } : {}),
            // No folder at all lets the server choose: the current project's
            // folder, or database / other_tables without one.
            folder_id: newFolder ? null : positiveIntegerOrNull(draft.folder?.folderId),
            create_folder: newFolder
                ? { folder_name: newFolderName, parent_id: positiveIntegerOrNull(newFolder.parentId) }
                : null,
        },
    };
}

/** One column as the edit adapter remembers the server holding it. */
export function toSavedColumn(columnName, dataType, length) {
    return { column_name: columnName, data_type: String(dataType || "").toUpperCase(), length: length ?? "" };
}

/**
 * The schema request an existing dataset's draft becomes, measured against the
 * columns the server holds. Only what changed travels: a renamed, retyped,
 * added or removed column, a role the person changed, the dataset's changed
 * text-language default and its changed deletion protection.
 *
 * @param {object} options
 * @param {string} options.datasetName
 * @param {object[]} options.savedColumns - toSavedColumn entries
 * @param {object[]} options.columns - the draft's columns, each with its `row`
 * @param {boolean} options.multilingualDefault - the draft's default
 * @param {boolean} options.savedMultilingualDefault - the server's default
 * @param {boolean} [options.preventDeletion] - undefined when unchanged
 */
export function buildDatasetEditRequest({
    datasetName, savedColumns = [], columns = [], multilingualDefault, savedMultilingualDefault, preventDeletion,
}) {
    if (columns.some((column) => column.name && !isValidIdentifier(column.name))) {
        return failure("invalid_column_name", "columns");
    }
    const removed = [];
    const modified = [];
    const added = [];
    // The row each sent change came from, to be marked saved once accepted.
    const sentRows = new Map();

    for (const saved of savedColumns) {
        const found = columns.find((column) => column.originalName === saved.column_name);
        if (!found) {
            removed.push(saved.column_name);
            continue;
        }
        const changedName = found.originalName !== found.name;
        let changedType = false;
        if (found.dataType && found.dataType !== saved.data_type) {
            changedType = true;
        } else if (saved.data_type === "VARCHAR") {
            const savedLength = saved.length === "" ? null : Number.parseInt(saved.length, 10);
            changedType = savedLength !== found.length;
        }
        if ((changedName || changedType) && found.dataType !== "") {
            const change = {
                original_name: found.originalName,
                new_name: found.name,
                data_type: found.dataType,
                length: found.dataType.toUpperCase() === "VARCHAR" ? found.length : null,
            };
            modified.push(change);
            sentRows.set(change, found.row);
        }
    }

    for (const column of columns) {
        if (column.originalName || column.name === "" || column.dataType === "") continue;
        const change = {
            original_name: "",
            new_name: column.name,
            data_type: column.dataType,
            length: column.dataType.toUpperCase() === "VARCHAR" ? column.length : null,
            ...(["TEXT", "VARCHAR"].includes(column.dataType) ? { is_multilingual: column.isMultilingual === true } : {}),
        };
        added.push(change);
        sentRows.set(change, column.row);
    }

    // A role can only be assigned to a column that will exist after this save.
    // A half-finished new row — named, but without a chosen type — is not
    // created, so sending its role would make the server refuse the whole
    // request and lose every other change in it.
    const createdNames = new Set(added.map((column) => column.new_name));
    const roles = {};
    const sentRoles = [];
    for (const { row, originalName, name, role, roleChanged } of columns) {
        if (!name) continue;
        const isNew = !originalName;
        if (isNew && !createdNames.has(name)) continue;
        // A new column's choice, or a role the person changed on an existing
        // column. An untouched column keeps whatever it has.
        if (isNew || roleChanged) {
            roles[name] = role;
            sentRoles.push({ row, role });
        }
    }

    const requestData = {
        dataset_name: datasetName,
        modified_columns: modified,
        added_columns: added,
        removed_columns: removed,
    };
    if (Object.keys(roles).length > 0) requestData.column_card_roles = roles;
    if (multilingualDefault !== savedMultilingualDefault) requestData.new_columns_multilingual = multilingualDefault;
    if (preventDeletion !== undefined) requestData.prevent_deletion = preventDeletion;

    return { ok: true, requestData, removed, modified, added, sentRows, sentRoles };
}
