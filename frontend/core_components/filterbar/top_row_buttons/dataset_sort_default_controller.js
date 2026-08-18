// dataset_sort_default_controller.js
// Loads and saves persistent sorting defaults for the shared dataset sort dropdown.
// Bridges route-permission state, the backend settings API, modal scope choice, and sort controls.
// Exists so hero and filterbar controls share one behavior and one database-backed source of truth.

import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { getTranslationForKey } from "../../lang/translation_handler.js";
import { getParams } from "../../navigation/nav_engine/query_params.js";
import { hasRoutePermission } from "../../route_permission_checker.js";
import { showErrorToast, showSuccessToast } from "../../../reusable_components/notifications/toast_notification_printer.js";
import { showSortDefaultScopeModal } from "./sort_default_scope_modal_builder.js";

const SAVE_ROUTE = "/api/admin/dataset-sort-default";
const attemptedDefaultApplications = new Set();
const defaultRequestCache = new Map();
const t = (key, fallback) => getTranslationForKey(key, { fallback }) || fallback;

export function createDatasetSortDefaultAction(
    tableName,
    option,
    { selectOption = null, closeDropdown = null } = {}
) {
    if (!hasRoutePermission(SAVE_ROUTE)) {
        return null;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.classList.add("button", "vdw-option-trailing-action", "sort-default-action");
    button.dataset.langKey = "sort_set_default";
    button.textContent = t("sort_set_default", "Set default");
    button.addEventListener("click", async () => {
        const scope = await showSortDefaultScopeModal();
        if (!scope) return;

        try {
            const response = await endpoint_router("saveDatasetSortDefault", {
                method: "POST",
                body_data: {
                    dataset: tableName,
                    value: option.value,
                    scope,
                },
            });
            defaultRequestCache.set(tableName, Promise.resolve(response));
            const selectionPromise = selectOption?.(option.value);
            closeDropdown?.();

            const scopeMessage = scope === "site"
                ? t("sort_default_saved_for_everyone", "Sorting was set as the default for everyone.")
                : t("sort_default_saved_for_me", "Sorting was set as your default.");
            const optionLabel = t(option.langKey, option.label || option.value);
            const normalizedScopeMessage = scopeMessage.replace(/[.!?。！？]+$/u, "");
            showSuccessToast(`${normalizedScopeMessage}: ${optionLabel}.`);
            await selectionPromise;
        } catch (error) {
            console.warn("dataset_sort_default_controller: save failed", error);
            showErrorToast(t("save_failed", "Saving failed."));
        }
    });
    return button;
}

export async function applyDatasetSortDefault(tableName, dropdown, availableValues) {
    const params = getParams(tableName);
    if (params.sort_column && params.sort_order) return;
    if (attemptedDefaultApplications.has(tableName)) return;
    attemptedDefaultApplications.add(tableName);

    try {
        const response = await fetchDatasetSortDefault(tableName);
        if (!response?.configured || !availableValues.has(response.value)) return;
        dropdown.setValue(response.value, true);
    } catch (error) {
        console.warn("dataset_sort_default_controller: load failed", error);
    }
}

function fetchDatasetSortDefault(tableName) {
    if (!defaultRequestCache.has(tableName)) {
        defaultRequestCache.set(
            tableName,
            endpoint_router("getDatasetSortDefault", {
                url_params: `?dataset=${encodeURIComponent(tableName)}`,
                suppressAuthRedirect: true,
            })
        );
    }
    return defaultRequestCache.get(tableName);
}
