// table_chat_mode_resolver.js
// Resolves which filterbar AI chat backend is available.
// Bridges UI config compatibility, DEV-only Codex mode, and route permissions.
// Exists to keep legacy transport removal behind one stable decision seam.

import { hasRoutePermission } from "../../route_permission_checker.js";
import { FILTERBAR_AI_CHAT_MODE } from "../../../ui_config.js";

export const FILTERBAR_AI_CHAT_ROUTES = Object.freeze({
    api_tools: "/api/app/ai-chat/query",
    codex_dev: "/api/app/ai-chat/codex-query",
});

export function normalizeFilterbarAIChatMode(
    configuredMode = FILTERBAR_AI_CHAT_MODE
) {
    if (configuredMode === "codex_dev") {
        return "codex_dev";
    }
    return "api_tools";
}

export function isFilterbarAIChatDevEnvironment(
    doc = typeof document !== "undefined" ? document : null
) {
    return doc?.querySelector('meta[name="app-env"]')?.content === "dev";
}

export function canUseFilterbarAICodexDevMode({
    hasCodexDevPermission = hasRoutePermission(
        FILTERBAR_AI_CHAT_ROUTES.codex_dev
    ),
    isDevEnvironment = isFilterbarAIChatDevEnvironment(),
} = {}) {
    return Boolean(isDevEnvironment && hasCodexDevPermission);
}

export function resolveAvailableFilterbarAIChatMode({
    configuredMode = FILTERBAR_AI_CHAT_MODE,
    hasApiToolsPermission = hasRoutePermission(
        FILTERBAR_AI_CHAT_ROUTES.api_tools
    ),
    hasCodexDevPermission = hasRoutePermission(
        FILTERBAR_AI_CHAT_ROUTES.codex_dev
    ),
    isDevEnvironment = isFilterbarAIChatDevEnvironment(),
} = {}) {
    const normalizedMode = normalizeFilterbarAIChatMode(configuredMode);
    if (
        normalizedMode === "codex_dev" &&
        canUseFilterbarAICodexDevMode({
            hasCodexDevPermission,
            isDevEnvironment,
        })
    ) {
        return "codex_dev";
    }
    return hasApiToolsPermission ? "api_tools" : null;
}
