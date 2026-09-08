// dataset_sort_default_controller.js
// Loads and saves persistent sorting defaults for the shared dataset sort dropdown.
// Bridges route-permission state, the backend settings API, modal scope choice, and sort controls.
// Exists so hero and filterbar controls share one behavior and one database-backed source of truth.

import { endpoint_router } from "../../endpoints/endpoint_router.js";
import {
    saveDatasetSortDefault,
    savePersonalDatasetSortDefault,
} from "../../endpoints/stable_endpoint_router.js";
import { getTranslationForKey } from "../../lang/translation_handler.js";
import { getUnifiedTableState } from "../../state_stores/table_state_store.js";
import { getParams } from "../../navigation/nav_engine/query_params.js";
import { hasRoutePermission } from "../../route_permission_checker.js";
import { fetchCurrentUserProfile } from "../../user_tools/current_user_profile_fetcher.js";
import { showErrorToast, showSuccessToast } from "../../../reusable_components/notifications/toast_notification_printer.js";
import { showSortDefaultScopeModal } from "./sort_default_scope_modal_builder.js";
import { NEWEST_SORT_COLUMN } from "./sort_dropdown_builder_helpers.js";

const ADMIN_SAVE_ROUTE = "/api/admin/dataset-sort-default";
const attemptedDefaultApplications = new Set();
const defaultRequestCache = new Map();
const t = (key, fallback) => getTranslationForKey(key, { fallback }) || fallback;

export function createDatasetSortDefaultAction(
    tableName,
    option,
    { selectOption = null, closeDropdown = null } = {}
) {
    const canChooseSiteScope = hasRoutePermission(ADMIN_SAVE_ROUTE);

    const button = document.createElement("button");
    button.type = "button";
    button.classList.add("button", "vdw-option-trailing-action", "sort-default-action");
    button.dataset.langKey = "sort_set_default";
    button.textContent = t("sort_set_default", "Set default");
    button.hidden = !canChooseSiteScope;
    if (!canChooseSiteScope) {
        void fetchCurrentUserProfile()
            .then((profile) => {
                if (Number(profile?.user_id) > 1) {
                    button.hidden = false;
                } else {
                    button.remove();
                }
            })
            .catch(() => button.remove());
    }
    button.addEventListener("click", async () => {
        let scope = "user";
        if (canChooseSiteScope) {
            scope = await showSortDefaultScopeModal();
            if (!scope) return;
        }

        try {
            const response = canChooseSiteScope
                ? await saveDatasetSortDefault({
                    dataset: tableName,
                    value: option.value,
                    scope,
                })
                : await savePersonalDatasetSortDefault({
                    dataset: tableName,
                    value: option.value,
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
        if (!response?.configured) return;
        // A late settings response must not overwrite a choice made while it loaded.
        if (getUnifiedTableState(tableName).sortSelectionExplicit) return;
        const latestParams = getParams(tableName);
        if (latestParams.sort_column && latestParams.sort_order) return;
        if (!response.value && !String(latestParams.search || "").trim()) return;
        const responseValue = normalizeStoredDatasetSortValue(response.value);
        if (!availableValues.has(responseValue)) return;
        dropdown.setValue(responseValue, true);
    } catch (error) {
        console.warn("dataset_sort_default_controller: load failed", error);
    }
}

export function normalizeStoredDatasetSortValue(value) {
    const normalized = String(value || "").trim();
    const match = normalized.match(/^created:(ASC|DESC)$/i);
    if (!match) return normalized;
    return `${NEWEST_SORT_COLUMN}:${match[1].toUpperCase()}`;
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
