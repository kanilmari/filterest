// table_chat_query_runner.js
// Runs the API-first filterbar AI chat query path and renders its dataset result.
// Bridges ai-chat facade responses, cached dataset metadata, and table rendering.
// Exists to keep the non-legacy chat transport out of the legacy SSE UI printer.

import { generate_table } from "../../table_views/dataset_view_printer.js";
import { endpoint_router } from "../../endpoints/endpoint_router.js";
import {
    disconnectInfiniteScroll,
    resetOffset,
    updateOffset,
} from "../../infinite_scroll/infinite_scroll_handler.js";
import {
    getUnifiedTableState,
    setUnifiedTableState,
    refreshTableUnified,
} from "../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js";
import { getParams, setParams, updateURL } from "../../navigation/nav_engine/query_params.js";
import { emitDatasetSortSelection } from "../../filterbar/top_row_buttons/sort_sync_state.js";
import {
    hasCachedSearchResults,
    sortCachedSearchResults,
} from "../../filterbar/text_search/dataset_search_executor.js";

function readStoredJSON(storageKey) {
    try {
        return JSON.parse(localStorage.getItem(storageKey));
    } catch (error) {
        console.warn(`Error reading localStorage key "${storageKey}":`, error);
        return null;
    }
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeChatColumnMeta(rawMeta) {
    if (isPlainObject(rawMeta)) {
        return { ...rawMeta };
    }
    if (typeof rawMeta === "string" && rawMeta.trim()) {
        return { data_type: rawMeta.trim() };
    }
    return {};
}

function shouldRenderChatResult(result) {
    return isPlainObject(result)
        && Array.isArray(result.columns)
        && Array.isArray(result.data)
        && result.data.length > 0;
}

export function buildChatResultDataTypes(table_name, columns, providedTypes = null) {
    const storedTypes = readStoredJSON(`${table_name}_dataTypes`);
    const storedTypeMap = isPlainObject(storedTypes) ? storedTypes : {};
    const providedTypeMap = isPlainObject(providedTypes) ? providedTypes : {};
    const mergedTypes = {};

    Object.entries(storedTypeMap).forEach(([columnName, rawMeta]) => {
        const normalizedMeta = normalizeChatColumnMeta(rawMeta);
        if (Object.keys(normalizedMeta).length > 0) {
            mergedTypes[columnName] = normalizedMeta;
        }
    });

    columns.forEach((columnName) => {
        const storedMeta = normalizeChatColumnMeta(mergedTypes[columnName]);
        const providedMeta = normalizeChatColumnMeta(providedTypeMap[columnName]);
        const hasStoredMeta = Object.keys(storedMeta).length > 0;
        const nextMeta = {
            ...(hasStoredMeta
                ? storedMeta
                : { show_value_on_card: true, data_type: "text", card_element: "details" }),
            ...providedMeta,
        };

        if (!nextMeta.data_type) {
            nextMeta.data_type = "text";
        }
        if (nextMeta.show_value_on_card !== true && nextMeta.show_value_on_card !== false) {
            nextMeta.show_value_on_card = true;
        }
        if (!nextMeta.card_element && nextMeta.show_value_on_card === true) {
            nextMeta.card_element = "details";
        }

        mergedTypes[columnName] = nextMeta;
    });

    return mergedTypes;
}

async function renderChatQueryResult(table_name, result = {}) {
    const columns = Array.isArray(result.columns) ? result.columns : [];
    const rows = Array.isArray(result.data) ? result.data : [];
    const dataTypes = buildChatResultDataTypes(table_name, columns, result.types);
    const storedTableMeta = readStoredJSON(`${table_name}_tableMeta`) || undefined;

    disconnectInfiniteScroll(table_name);
    resetOffset(table_name);
    updateOffset(table_name, rows.length);
    await generate_table(
        table_name,
        columns,
        rows,
        dataTypes,
        Number.isFinite(result.row_count) ? result.row_count : rows.length,
        Boolean(result.has_geo),
        result.table_meta || storedTableMeta
    );
}

async function applyChatSortPlan(table_name, plan = {}) {
    const sortColumn = String(plan?.sort_column || "").trim();
    const sortOrder = String(plan?.sort_order || "").trim().toUpperCase();
    if (!plan?.apply_as_sort || !sortColumn || !["ASC", "DESC"].includes(sortOrder)) {
        return false;
    }

    const currentState = getUnifiedTableState(table_name);
    if (!currentState.sort) {
        currentState.sort = { column: null, direction: null };
    }
    currentState.sort.column = sortColumn;
    currentState.sort.direction = sortOrder;
    setUnifiedTableState(table_name, currentState);

    const params = getParams(table_name);
    params.sort_column = sortColumn;
    params.sort_order = sortOrder;
    setParams(table_name, params);
    updateURL(table_name, params, undefined, { replace: true });
    emitDatasetSortSelection(table_name, `${sortColumn}:${sortOrder}`);
    if (String(params.search || "").trim() && hasCachedSearchResults(table_name)) {
        await sortCachedSearchResults(table_name, {
            sortColumn,
            sortOrder,
        });
        return true;
    }
    await refreshTableUnified(table_name, { skipUrlParams: true });
    return true;
}

function normalizeChatPlanFilters(plan = {}) {
    const rawFilters = plan?.filters;
    if (!rawFilters || typeof rawFilters !== "object" || Array.isArray(rawFilters)) {
        return {};
    }
    return Object.fromEntries(
        Object.entries(rawFilters)
            .map(([key, value]) => [String(key || "").trim(), String(value || "").trim()])
            .filter(([key, value]) => key && value)
    );
}

function shouldApplyChatPlanToTable(table_name, plan = {}) {
    const planDataset = String(plan?.dataset || "").trim();
    return !planDataset || planDataset === table_name;
}

function applyChatFilterPlan(table_name, plan = {}) {
    if (!shouldApplyChatPlanToTable(table_name, plan)) {
        return false;
    }

    const filters = normalizeChatPlanFilters(plan);
    if (Object.keys(filters).length === 0) {
        return false;
    }

    const currentState = getUnifiedTableState(table_name);
    currentState.filters = { ...filters };
    currentState.offset = 0;
    if (!currentState.sort) {
        currentState.sort = { column: null, direction: null };
    }

    const sortColumn = String(plan?.sort_column || "").trim();
    const sortOrder = String(plan?.sort_order || "").trim().toUpperCase();
    const nextParams = { ...filters };
    if (sortColumn && ["ASC", "DESC"].includes(sortOrder)) {
        currentState.sort.column = sortColumn;
        currentState.sort.direction = sortOrder;
        nextParams.sort_column = sortColumn;
        nextParams.sort_order = sortOrder;
        emitDatasetSortSelection(table_name, `${sortColumn}:${sortOrder}`);
    } else {
        currentState.sort.column = null;
        currentState.sort.direction = null;
    }

    setUnifiedTableState(table_name, currentState);
    setParams(table_name, nextParams);
    updateURL(table_name, nextParams, undefined, { replace: true });
    return true;
}

export async function runApiToolsChatQuery(table_name, user_message, conversationMessages = []) {
    const payload = {
        dataset: table_name,
        query: user_message,
    };
    const currentLang = String(document.documentElement.lang || "").trim();
    if (currentLang) {
        payload.lang = currentLang;
    }
    if (Array.isArray(conversationMessages) && conversationMessages.length > 0) {
        payload.messages = conversationMessages;
    }

    const response = await endpoint_router("aiChatQuery", {
        method: "POST",
        body_data: payload,
    });

    if (response?.configuration_required?.code === "openai_api_key_missing") {
        const configurationError = new Error("Chat configuration is required.");
        configurationError.code = "openai_api_key_missing";
        throw configurationError;
    }

    let resultActionTaken = false;
    const responsePlan = response?.plan || {};
    const appliedSort = shouldApplyChatPlanToTable(table_name, responsePlan)
        ? await applyChatSortPlan(table_name, responsePlan)
        : false;
    resultActionTaken = appliedSort;
    if (!appliedSort) {
        const appliedFilters = applyChatFilterPlan(table_name, responsePlan);
        if (shouldRenderChatResult(response?.result)) {
            await renderChatQueryResult(table_name, response.result);
            resultActionTaken = true;
        } else if (appliedFilters) {
            await refreshTableUnified(table_name, { skipUrlParams: true });
            resultActionTaken = true;
        }
    }
    if (!resultActionTaken && Array.isArray(response?.results) && response.results.length > 0) {
        resultActionTaken = true;
    }

    return {
        answer: String(response?.answer || "Request completed.").trim(),
        memory: response?.memory || null,
        usage: response?.usage || null,
        resultActionTaken,
    };
}

export async function runCodexDevChatQuery(table_name, user_message, conversationMessages = []) {
    const payload = {
        dataset: table_name,
        query: user_message,
    };
    const currentLang = String(document.documentElement.lang || "").trim();
    if (currentLang) {
        payload.lang = currentLang;
    }
    if (Array.isArray(conversationMessages) && conversationMessages.length > 0) {
        payload.messages = conversationMessages;
    }

    const response = await endpoint_router("aiChatCodexQuery", {
        method: "POST",
        body_data: payload,
    });

    let resultActionTaken = false;
    const responsePlan = response?.plan || {};
    const appliedSort = shouldApplyChatPlanToTable(table_name, responsePlan)
        ? await applyChatSortPlan(table_name, responsePlan)
        : false;
    resultActionTaken = appliedSort;
    if (!appliedSort) {
        const appliedFilters = applyChatFilterPlan(table_name, responsePlan);
        if (shouldRenderChatResult(response?.result)) {
            await renderChatQueryResult(table_name, response.result);
            resultActionTaken = true;
        } else if (appliedFilters) {
            await refreshTableUnified(table_name, { skipUrlParams: true });
            resultActionTaken = true;
        }
    }

    return {
        answer: String(response?.answer || "Codex completed without a visible answer.").trim(),
        memory: response?.memory || null,
        usage: response?.usage || null,
        resultActionTaken,
    };
}
