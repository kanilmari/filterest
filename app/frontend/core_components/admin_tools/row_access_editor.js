// row_access_editor.js
// Builds the shared selected-row access action and administrator modal.
// Bridges view-independent row selection with normalized read/update/delete rule readback.
// Exists so table, card, and article-card lists invoke one fail-closed permission workflow.

import { endpoint_router } from "../endpoints/endpoint_router.js";
import { getTranslationForKey } from "../lang/translation_handler.js";
import { applyTranslationVariable } from "../lang/translation_handler_helpers.js";
import { get_selected_items } from "../table_views/table_view/selected_items_reader.js";
import {
    createModal,
    hideModal,
    showModal,
} from "../../reusable_components/modal/modal_builder.js";
import {
    showErrorToast,
    showSuccessToast,
    showWarningToast,
} from "../../reusable_components/notifications/toast_notification_printer.js";
import {
    createMultiselectDropdown,
} from "../../reusable_components/multiselect_dropdown/multiselect_dropdown_builder.js";

const ROW_ACCESS_ACTION_FALLBACKS = Object.freeze({
    read: "Read",
    update: "Update",
    delete: "Delete",
});
const ROW_ACCESS_ACTION_KEYS = Object.freeze(["read", "update", "delete"]);
const ROW_ACCESS_STATES = new Set(["allow", "deny", "mixed", "inherited"]);
const MAX_ROW_ACCESS_PRINCIPALS = 50;
const MAX_ROW_ACCESS_ASSIGNMENTS = 5000;

function translatedText(langKey, fallback) {
    return getTranslationForKey(langKey, { fallback }) || fallback;
}

function createTranslatedElement(tagName, langKey, fallback) {
    const element = document.createElement(tagName);
    element.dataset.langKey = langKey;
    element.textContent = translatedText(langKey, fallback);
    return element;
}

function translatedVariableText(langKey, fallback, variable) {
    return applyTranslationVariable(
        translatedText(langKey, fallback),
        String(variable)
    );
}

function invalidResponseError() {
    return new Error(translatedText(
        "row_access_invalid_response",
        "The row access response was incomplete. Nothing was changed."
    ));
}

// Treat the service readback as an authorization boundary, not merely display
// data. An incomplete, widened, or confused response must leave the editor
// unusable instead of silently targeting a different row or action.
function validateRowAccessResponse(
    response,
    datasetName,
    rowIDs,
    expectedPrincipalValues = []
) {
    if (!response || typeof response !== "object") throw invalidResponseError();
    if (response.dataset !== datasetName) throw invalidResponseError();
    if (!Number.isSafeInteger(Number(response.table_uid)) || Number(response.table_uid) <= 0) {
        throw invalidResponseError();
    }
    if (!Array.isArray(response.row_ids) || response.row_ids.length !== rowIDs.length) {
        throw invalidResponseError();
    }
    const readbackRowIDs = response.row_ids.map(Number);
    if (readbackRowIDs.some((rowID, index) => rowID !== rowIDs[index])) {
        throw invalidResponseError();
    }
    const normalizedExpectedPrincipals = normalizePrincipalValues(
        expectedPrincipalValues,
        { allowEmpty: true }
    );
    if (!Array.isArray(response.selected_principals)) {
        throw invalidResponseError();
    }
    const readbackPrincipalValues = response.selected_principals.map((principal) =>
        principalValue(principal)
    );
    if (readbackPrincipalValues.some((value) => !value)) {
        throw invalidResponseError();
    }
    const normalizedReadbackPrincipals = normalizePrincipalValues(
        readbackPrincipalValues,
        { allowEmpty: true }
    );
    if (normalizedReadbackPrincipals.length !== readbackPrincipalValues.length
        || normalizedReadbackPrincipals.length !== normalizedExpectedPrincipals.length
        || normalizedReadbackPrincipals.some(
            (value, index) => value !== normalizedExpectedPrincipals[index]
        )) {
        throw invalidResponseError();
    }
    const expectedTargetCount = rowIDs.length * Math.max(
        normalizedExpectedPrincipals.length,
        1
    );
    if (Number(response.state_target_count) !== expectedTargetCount) {
        throw invalidResponseError();
    }
    if (!Array.isArray(response.actions) || response.actions.length !== ROW_ACCESS_ACTION_KEYS.length) {
        throw invalidResponseError();
    }
    const actionKeys = response.actions.map((action) => action?.key);
    if (new Set(actionKeys).size !== ROW_ACCESS_ACTION_KEYS.length
        || ROW_ACCESS_ACTION_KEYS.some((key) => !actionKeys.includes(key))) {
        throw invalidResponseError();
    }
    if (!response.states || typeof response.states !== "object") {
        throw invalidResponseError();
    }
    for (const key of ROW_ACCESS_ACTION_KEYS) {
        const state = response.states[key];
        const counts = [state?.allow_count, state?.deny_count, state?.inherited_count]
            .map(Number);
        if (!ROW_ACCESS_STATES.has(state?.state)
            || counts.some((count) => !Number.isSafeInteger(count) || count < 0)
            || counts.reduce((total, count) => total + count, 0) !== expectedTargetCount) {
            throw invalidResponseError();
        }
    }
    return response;
}

function validateMutationReadback(
    response,
    datasetName,
    rowIDs,
    principalValues,
    changes
) {
    validateRowAccessResponse(response, datasetName, rowIDs, principalValues);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        String(response.change_set_id || "")
    )) {
        throw invalidResponseError();
    }
    for (const [action, requested] of Object.entries(changes)) {
        if (requested === "no_change") continue;
        const expected = requested === "remove" ? "inherited" : requested;
        if (response.states[action]?.state !== expected) throw invalidResponseError();
    }
    return response;
}

function selectedRowsOrWarn(datasetName) {
    const selected = get_selected_items(datasetName);
    const ids = Array.from(new Set(
        selected.ids
            .map((value) => Number(value))
            .filter((value) => Number.isSafeInteger(value) && value > 0)
    )).sort((left, right) => left - right);
    if (ids.length === 0) {
        showWarningToast(translatedText(
            "row_access_select_first",
            "Select at least one row first."
        ));
        return null;
    }
    if (ids.length > 200) {
        showWarningToast(translatedVariableText(
            "row_access_maximum_rows",
            "Select at most $count rows at a time.",
            200
        ));
        return null;
    }
    return { ids, rows: selected.rows };
}

export function createEditRowPermissionsButton(datasetName) {
    const button = document.createElement("button");
    button.type = "button";
    button.classList.add("button", "fw-btn", "edit-row-permissions-button");
    button.dataset.testid = "btn-edit-row-permissions";

    const label = createTranslatedElement(
        "span",
        "edit_row_permissions",
        "Edit row permissions"
    );
    const count = document.createElement("span");
    count.classList.add("edit-row-permissions-button__count");
    count.hidden = true;
    count.setAttribute("aria-hidden", "true");
    button.append(label, count);

    button.__updateSelectionCount = (nextCount) => {
        const normalizedCount = Number(nextCount) || 0;
        count.textContent = normalizedCount > 0 ? `(${normalizedCount})` : "";
        count.hidden = normalizedCount <= 0;
    };
    button.addEventListener("click", () => {
        void openRowAccessEditor(datasetName);
    });
    return button;
}

function principalOptionLabel(principal) {
    const details = principal.full_name
        ? `${principal.name} — ${principal.full_name}`
        : principal.name;
    return `${details} (#${principal.id})`;
}

function principalValue(principal) {
    const type = String(principal?.type || "");
    const id = Number(principal?.id);
    if ((type !== "user" && type !== "group")
        || !Number.isSafeInteger(id)
        || id <= 0) {
        return "";
    }
    return `${type}:${id}`;
}

function parsePrincipalValue(value) {
    const [type, rawID] = String(value || "").split(":", 2);
    const id = Number(rawID);
    if ((type !== "user" && type !== "group") || !Number.isSafeInteger(id) || id <= 0) {
        return null;
    }
    return { type, id };
}

function normalizePrincipalValues(values, { allowEmpty = false } = {}) {
    if (!Array.isArray(values)) throw invalidResponseError();
    const unique = new Set();
    values.forEach((value) => {
        const principal = parsePrincipalValue(value);
        if (!principal) throw invalidResponseError();
        unique.add(`${principal.type}:${principal.id}`);
    });
    if (!allowEmpty && unique.size === 0) throw invalidResponseError();
    return Array.from(unique).sort((left, right) => {
        const leftPrincipal = parsePrincipalValue(left);
        const rightPrincipal = parsePrincipalValue(right);
        if (leftPrincipal.type === rightPrincipal.type) {
            return leftPrincipal.id - rightPrincipal.id;
        }
        return leftPrincipal.type.localeCompare(rightPrincipal.type);
    });
}

function validatePrincipalDirectory(principals) {
    if (!Array.isArray(principals) || principals.length === 0) {
        throw invalidResponseError();
    }
    const values = principals.map((principal) => {
        if (typeof principal?.name !== "string" || !principal.name.trim()) {
            throw invalidResponseError();
        }
        return principalValue(principal);
    });
    if (values.some((value) => !value)
        || normalizePrincipalValues(values).length !== values.length) {
        throw invalidResponseError();
    }
    return principals;
}

function createPrincipalOptions(principals) {
    const groupLabels = {
        group: translatedText("row_access_groups", "Groups"),
        user: translatedText("row_access_users", "Users"),
    };
    return ["group", "user"].flatMap((type) =>
        principals
            .filter((principal) => principal.type === type)
            .map((principal) => ({
                value: principalValue(principal),
                label: principalOptionLabel(principal),
                groupLabel: groupLabels[type],
                searchTerms: [
                    principal.name,
                    principal.full_name || "",
                    String(principal.id),
                    type,
                    groupLabels[type],
                ],
            }))
    );
}

function stateSummary(state) {
    switch (state?.state) {
    case "allow":
        return translatedText("row_access_allow", "Allow");
    case "deny":
        return translatedText("row_access_deny", "Deny");
    case "mixed":
        return translatedText("row_access_mixed", "Mixed current states");
    default:
        return translatedText("row_access_inherited", "Inherited (no direct rule)");
    }
}

function appendRuleSelectOptions(select) {
    const options = [
        ["no_change", "row_access_no_change", "No change"],
        ["allow", "row_access_allow", "Allow"],
        ["deny", "row_access_deny", "Deny"],
        ["remove", "row_access_remove_direct", "Remove direct rule"],
    ];
    options.forEach(([value, langKey, fallback]) => {
        const option = document.createElement("option");
        option.value = value;
        option.dataset.langKey = langKey;
        option.textContent = translatedText(langKey, fallback);
        select.appendChild(option);
    });
}

function buildActionRows(container, actions, states) {
    container.replaceChildren();
    const controls = new Map();
    actions.forEach((action) => {
        const row = document.createElement("div");
        row.classList.add("row-access-editor__action-row");
        row.dataset.action = action.key;

        const label = createTranslatedElement(
            "label",
            action.label_lang_key || `row_access_${action.key}`,
            ROW_ACCESS_ACTION_FALLBACKS[action.key] || action.key
        );
        const select = document.createElement("select");
        select.classList.add("fw-form-control");
        select.dataset.testid = `row-access-${action.key}`;
        label.htmlFor = `row_access_${action.key}_select`;
        select.id = label.htmlFor;
        appendRuleSelectOptions(select);

        const summary = document.createElement("span");
        summary.classList.add("row-access-editor__current-state");
        summary.dataset.testid = `row-access-${action.key}-current`;
        summary.textContent = stateSummary(states[action.key]);
        row.append(label, select, summary);
        container.appendChild(row);
        controls.set(action.key, select);
    });
    return controls;
}

async function fetchRowAccessState(datasetName, rowIDs, principalValues = []) {
    const params = new URLSearchParams({
        dataset: datasetName,
        row_ids: rowIDs.join(","),
    });
    const normalizedPrincipals = normalizePrincipalValues(
        principalValues,
        { allowEmpty: true }
    );
    if (normalizedPrincipals.length > 0) {
        params.set("principals", normalizedPrincipals.join(","));
    }
    const response = await endpoint_router("adminRowAccessRules", {
        url_params: `?${params.toString()}`,
        suppressAuthRedirect: true,
    });
    return validateRowAccessResponse(
        response,
        datasetName,
        rowIDs,
        normalizedPrincipals
    );
}

export async function openRowAccessEditor(datasetName) {
    const selected = selectedRowsOrWarn(datasetName);
    if (!selected) return null;

    const loading = createTranslatedElement("p", "loading", "Loading…");
    loading.classList.add("row-access-editor__loading");
    const content = document.createElement("form");
    content.classList.add("row-access-editor");
    content.dataset.testid = "row-access-editor";
    content.appendChild(loading);

    let principalDropdown = null;
    const { modal, modal_overlay: modalOverlay } = createModal({
        titleDataLangKey: "edit_row_permissions",
        titleDataLangKeyFallback: "Edit row permissions",
        contentElements: [content],
        width: "min(calc(100vw - 32px), 760px)",
        maxWidth: "760px",
        maxHeight: "min(calc(100dvh - 32px), 860px)",
        cleanupCallback: () => {
            principalDropdown?.destroy?.();
            principalDropdown = null;
        },
    });
    modal.dataset.testid = "row-access-editor-modal";
    showModal();

    try {
        const initial = await fetchRowAccessState(datasetName, selected.ids);
        try {
            validatePrincipalDirectory(initial.principals);
        } catch {
            throw new Error(translatedText(
                "row_access_no_principals",
                "No eligible users or groups are available."
            ));
        }

        content.replaceChildren();
        const selectedSummary = document.createElement("p");
        selectedSummary.classList.add("row-access-editor__selection-summary");
        selectedSummary.dataset.langKey = "row_access_selected_rows";
        selectedSummary.dataset.langVariable = String(selected.ids.length);
        selectedSummary.textContent = translatedVariableText(
            "row_access_selected_rows",
            "Selected rows: $count",
            selected.ids.length
        );

        const principalLabel = createTranslatedElement(
            "label",
            "row_access_principal",
            "Users or groups"
        );
        const principalPicker = document.createElement("div");
        principalPicker.id = "row_access_principal_picker";
        principalPicker.classList.add("row-access-editor__principal-picker");
        principalPicker.dataset.testid = "row-access-principals";
        principalLabel.htmlFor = principalPicker.id;

        const actionRows = document.createElement("div");
        actionRows.classList.add("row-access-editor__actions");
        let actionControls = new Map();

        const reasonLabel = createTranslatedElement(
            "label",
            "row_access_reason",
            "Reason for change"
        );
        const reason = document.createElement("textarea");
        reason.id = "row_access_reason_input";
        reason.classList.add("fw-form-control");
        reason.maxLength = 1000;
        reason.rows = 3;
        reasonLabel.htmlFor = reason.id;

        const status = document.createElement("p");
        status.classList.add("row-access-editor__status");
        status.setAttribute("role", "status");

        const actions = document.createElement("div");
        actions.classList.add("form-actions", "row-access-editor__footer");
        const cancelButton = createTranslatedElement("button", "cancel", "Cancel");
        cancelButton.type = "button";
        cancelButton.classList.add("fw-btn", "fw-btn--ghost", "cancel-button");
        const saveButton = createTranslatedElement(
            "button",
            "save_row_permissions",
            "Save row permissions"
        );
        saveButton.type = "submit";
        saveButton.classList.add("fw-btn", "fw-btn--primary", "submit-button");
        saveButton.dataset.testid = "row-access-save";
        saveButton.disabled = true;
        actions.append(cancelButton, saveButton);

        content.append(
            selectedSummary,
            principalLabel,
            principalPicker,
            actionRows,
            reasonLabel,
            reason,
            status,
            actions
        );

        let loadGeneration = 0;
        const currentPrincipalValues = () => normalizePrincipalValues(
            principalDropdown?.getValue?.() || [],
            { allowEmpty: true }
        );
        const updateSaveState = () => {
            saveButton.disabled = currentPrincipalValues().length === 0
                || !Array.from(actionControls.values())
                    .some((control) => control.value !== "no_change");
        };
        const loadPrincipalState = async () => {
            const generation = ++loadGeneration;
            const principalValues = currentPrincipalValues();
            actionControls = new Map();
            actionRows.replaceChildren();
            saveButton.disabled = true;
            if (principalValues.length === 0) {
                status.textContent = translatedText(
                    "row_access_select_principals",
                    "Select at least one user or group."
                );
                return;
            }
            if (principalValues.length > MAX_ROW_ACCESS_PRINCIPALS) {
                status.textContent = translatedVariableText(
                    "row_access_maximum_principals",
                    "Select at most $count users or groups at a time.",
                    MAX_ROW_ACCESS_PRINCIPALS
                );
                return;
            }
            if (principalValues.length * selected.ids.length > MAX_ROW_ACCESS_ASSIGNMENTS) {
                status.textContent = translatedVariableText(
                    "row_access_maximum_assignments",
                    "Reduce the selection to at most $count row-and-principal targets.",
                    MAX_ROW_ACCESS_ASSIGNMENTS
                );
                return;
            }
            principalPicker.setAttribute("aria-busy", "true");
            status.textContent = translatedText("loading", "Loading…");
            try {
                const response = await fetchRowAccessState(
                    datasetName,
                    selected.ids,
                    principalValues
                );
                if (generation !== loadGeneration) return;
                actionControls = buildActionRows(actionRows, response.actions, response.states);
                actionControls.forEach((control) => {
                    control.addEventListener("change", updateSaveState);
                });
                status.textContent = "";
                updateSaveState();
            } catch (error) {
                if (generation !== loadGeneration) return;
                status.textContent = error?.message || translatedText(
                    "row_access_load_failed",
                    "Row access rules could not be loaded."
                );
                actionRows.replaceChildren();
            } finally {
                if (generation === loadGeneration) {
                    principalPicker.removeAttribute("aria-busy");
                }
            }
        };

        principalDropdown = createMultiselectDropdown({
            containerElement: principalPicker,
            portalElement: modalOverlay,
            options: createPrincipalOptions(initial.principals),
            placeholder: translatedText(
                "row_access_choose_principals",
                "Select users or groups…"
            ),
            searchPlaceholder: translatedText(
                "row_access_search_principals",
                "Search by name, username, or ID…"
            ),
            noResultsLabel: translatedText(
                "row_access_no_matching_principals",
                "No matching users or groups"
            ),
            clearLabel: translatedText(
                "row_access_clear_principals",
                "Clear selected users and groups"
            ),
            selectedCountLabel: translatedText(
                "row_access_principals_selected",
                "users or groups selected"
            ),
            allowExclude: false,
            onChange: () => {
                void loadPrincipalState();
            },
        });
        const principalInput = principalPicker.querySelector(".msd-dropdown-input");
        if (!(principalInput instanceof HTMLInputElement)) {
            throw invalidResponseError();
        }
        principalInput.id = "row_access_principal_input";
        principalLabel.htmlFor = principalInput.id;

        cancelButton.addEventListener("click", () => hideModal());
        content.addEventListener("submit", async (event) => {
            event.preventDefault();
            const principalValues = currentPrincipalValues();
            if (principalValues.length === 0) return;
            const principals = principalValues.map(parsePrincipalValue);
            if (principals.some((principal) => !principal)) return;
            const changes = Object.fromEntries(
                Array.from(actionControls.entries()).map(([action, control]) => [
                    action,
                    control.value,
                ])
            );
            saveButton.disabled = true;
            principalDropdown.setDisabled(true);
            reason.disabled = true;
            actionControls.forEach((control) => {
                control.disabled = true;
            });
            status.textContent = translatedText("saving", "Saving…");
            try {
                const response = await endpoint_router("adminRowAccessRules", {
                    method: "POST",
                    body_data: {
                        dataset: datasetName,
                        row_ids: selected.ids,
                        principals,
                        changes,
                        reason: reason.value,
                    },
                    suppressAuthRedirect: true,
                });
                validateMutationReadback(
                    response,
                    datasetName,
                    selected.ids,
                    principalValues,
                    changes
                );
                showSuccessToast(translatedText(
                    "row_permissions_updated",
                    "Row permissions updated"
                ));
                hideModal();
            } catch (error) {
                status.textContent = error?.message || translatedText(
                    "row_access_save_failed",
                    "Row permissions could not be updated."
                );
                showErrorToast(status.textContent);
                principalDropdown.setDisabled(false);
                reason.disabled = false;
                actionControls.forEach((control) => {
                    control.disabled = false;
                });
                updateSaveState();
            }
        });

        await loadPrincipalState();
        return modal;
    } catch (error) {
        content.replaceChildren();
        const failure = document.createElement("p");
        failure.classList.add("row-access-editor__status", "row-access-editor__status--error");
        failure.textContent = error?.message || translatedText(
            "row_access_load_failed",
            "Row access rules could not be loaded."
        );
        content.appendChild(failure);
        showErrorToast(failure.textContent);
        return modal;
    }
}
