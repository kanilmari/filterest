// permission_form_editor.js
// Updates in-memory and DOM state for the admin permission form as users edit checkboxes.
// Bridges permission form elements with derived multi-table and edited-state calculations.
// Exists to keep permission-form state mutations separate from loading and saving logic.

import { computeMultipleTableState } from "./permission_checker.js";

export function storeOriginalStates(permission_form) {
    const allCheckboxes = permission_form.querySelectorAll(
        'input[type="checkbox"][data-function-id][data-group-id]'
    );
    allCheckboxes.forEach((cb) => {
        cb.dataset.originalChecked = cb.checked;
        cb.dataset.originalAmbiguous =
            cb.dataset.ambiguous === "true" ? "true" : "false";
        cb.dataset.edited = "false";
    });
}

export function updateStaticIcons(
    permission_form,
    { checkedSVG, uncheckedSVG, ambiguousSVG }
) {
    permission_form.querySelectorAll(".checkbox-cell").forEach((cell) => {
        const cb = cell.querySelector('input[type="checkbox"]');
        const icon = cell.querySelector(".mp-static-checkbox");
        if (icon) {
            if (cb.dataset.ambiguous === "true") {
                icon.innerHTML = ambiguousSVG;
                icon.classList.add("mp-ambiguous-icon");
            } else {
                icon.innerHTML = cb.checked ? checkedSVG : uncheckedSVG;
                icon.classList.remove("mp-ambiguous-icon");
            }
        }
    });
}

export function removeEditLabels(permission_form) {
    permission_form
        .querySelectorAll(".mp-edited-label")
        .forEach((l) => l.remove());
}

export async function fetchCurrentPermissions(endpoint_router) {
    const result = await endpoint_router("datasetPermissions");
    return result;
}

export function clearAllCheckboxes(
    permission_form,
    selector = 'input[type="checkbox"][data-function-id][data-group-id]'
) {
    const allCheckboxes = permission_form.querySelectorAll(selector);
    allCheckboxes.forEach((cb) => {
        cb.checked = false;
        cb.indeterminate = false;
        delete cb.dataset.ambiguous;
    });
}

export async function updatePermissionsForMultipleTables({
    permission_form,
    endpoint_router,
    selectedNames,
}) {
    const permissions_data = await fetchCurrentPermissions(endpoint_router);
    const allCheckboxes = permission_form.querySelectorAll(
        'input[type="checkbox"][data-function-id][data-group-id][data-table-related="true"]'
    );

    allCheckboxes.forEach((cb) => {
        const funcId = parseInt(cb.dataset.functionId, 10);
        const groupId = parseInt(cb.dataset.groupId, 10);
        const state = computeMultipleTableState(
            permissions_data,
            selectedNames,
            funcId,
            groupId
        );
        if (state === "checked") {
            cb.checked = true;
            delete cb.dataset.ambiguous;
        } else if (state === "unchecked") {
            cb.checked = false;
            delete cb.dataset.ambiguous;
        } else {
            cb.checked = false;
            cb.dataset.ambiguous = "true";
        }
        cb.indeterminate = false;
    });

    storeOriginalStates(permission_form);
    return permissions_data;
}

export async function updatePermissionsForSingleTable({
    permission_form,
    endpoint_router,
    selected_table_name,
}) {
    const permissions_data = await fetchCurrentPermissions(endpoint_router);
    clearAllCheckboxes(
        permission_form,
        'input[type="checkbox"][data-function-id][data-group-id][data-table-related="true"]'
    );

    permissions_data
        .filter((item) => item.target_dataset_name === selected_table_name)
        .forEach((permission_item) => {
            const selector = `input[type="checkbox"][data-function-id="${permission_item.function_id}"][data-group-id="${permission_item.user_group_id}"][data-table-related="true"]`;
            const cb = permission_form.querySelector(selector);
            if (cb) {
                cb.checked = true;
                delete cb.dataset.ambiguous;
            }
        });
    storeOriginalStates(permission_form);
}

export async function updatePermissionsForTableless({
    permission_form,
    endpoint_router,
}) {
    const permissions_data = await fetchCurrentPermissions(endpoint_router);
    clearAllCheckboxes(
        permission_form,
        'input[type="checkbox"][data-function-id][data-group-id][data-table-related="false"]'
    );

    permissions_data
        .filter((item) => item.target_dataset_name === "")
        .forEach((permission_item) => {
            const sel = `input[type="checkbox"][data-function-id="${permission_item.function_id}"][data-group-id="${permission_item.user_group_id}"][data-table-related="false"]`;
            const cb = permission_form.querySelector(sel);
            if (cb) {
                cb.checked = true;
                delete cb.dataset.ambiguous;
            }
        });
    storeOriginalStates(permission_form);
}

