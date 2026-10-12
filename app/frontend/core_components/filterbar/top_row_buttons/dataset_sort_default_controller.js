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
import { ensureHistoryEntryId, HISTORY_ENTRY_ID } from "../../navigation/nav_engine/history_entry_state.js";
import { hasRoutePermission } from "../../route_permission_checker.js";
import { fetchCurrentUserProfile } from "../../user_tools/current_user_profile_fetcher.js";
import { showErrorToast, showSuccessToast } from "../../../reusable_components/notifications/toast_notification_printer.js";
import { showSortDefaultScopeModal } from "./sort_default_scope_modal_builder.js";
import { NEWEST_SORT_COLUMN } from "./sort_dropdown_builder_helpers.js";

const ADMIN_SAVE_ROUTE = "/api/admin/dataset-sort-default";
const attemptedDefaultApplications = new Map();
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

/** Share the saved-sort request while applying it once in the current history entry. */
export async function applyDatasetSortDefault(tableName, dropdown, availableValues) {
    const params = getParams(tableName);
    if (params.sort_column && params.sort_order) return;
    const requestedEntryId = ensureHistoryEntryId();
    if (!attemptedDefaultApplications.has(tableName)) {
        attemptedDefaultApplications.set(tableName, { lastEntryId: null, entries: new Map() });
    }
    const applications = attemptedDefaultApplications.get(tableName);
    const previousApplication = applications.entries.get(requestedEntryId);
    // Same-entry controls share an attempt. Rebuilding after Back replaces a
    // pending control, while a retained control can still consume its own answer.
    if (previousApplication
        && (previousApplication.completed || applications.lastEntryId === requestedEntryId)) return;
    const application = { completed: false };
    applications.entries.set(requestedEntryId, application);
    applications.lastEntryId = requestedEntryId;
    const ownsApplication = () => applications.entries.get(requestedEntryId) === application;
    const isCurrentApplication = () => ownsApplication()
        && history.state?.[HISTORY_ENTRY_ID] === requestedEntryId;
    const inheritedRequest = defaultRequestCache.has(tableName);

    try {
        const response = await fetchDatasetSortDefault(tableName).catch((error) => {
            // A reopened control gets one fresh attempt if the request it
            // inherited fails. Departed controls cannot start that retry.
            if (!inheritedRequest || !isCurrentApplication()) throw error;
            return fetchDatasetSortDefault(tableName);
        });
        // The dropdown's change handler writes the dataset address. Its async
        // default must not replace an entry the person has since navigated to,
        // even if both entries have the same URL. Startup replaceState keeps
        // this identity. The application object also rejects an obsolete control
        // when Back restores its entry and a rebuilt control now owns the answer.
        if (!isCurrentApplication()) return;
        application.completed = true;
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
        if (ownsApplication()) applications.entries.delete(requestedEntryId);
        console.warn("dataset_sort_default_controller: load failed", error);
    } finally {
        // An old waiter must never release a reopened entry's once-only claim.
        if (ownsApplication() && history.state?.[HISTORY_ENTRY_ID] !== requestedEntryId) {
            applications.entries.delete(requestedEntryId);
        }
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
        const request = endpoint_router("getDatasetSortDefault", {
            url_params: `?dataset=${encodeURIComponent(tableName)}`,
            suppressAuthRedirect: true,
        }).catch((error) => {
            // Keep successful answers cached, but let a failed load recover.
            // A concurrent save may already have replaced this cached request.
            if (defaultRequestCache.get(tableName) === request) defaultRequestCache.delete(tableName);
            throw error;
        });
        defaultRequestCache.set(tableName, request);
    }
    return defaultRequestCache.get(tableName);
}
