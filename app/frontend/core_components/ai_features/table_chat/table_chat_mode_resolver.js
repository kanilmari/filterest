// table_chat_mode_resolver.js
// Resolves which filterbar AI chat backend answers the next message.
// Bridges UI config compatibility, the server's per-mode coding-agent availability and route permissions.
// Exists so a coding-agent mode is used only when the live server says that exact mode is ready.

import { hasRoutePermission } from "../../route_permission_checker.js";
import { FILTERBAR_AI_CHAT_MODE } from "../../../ui_config.js";
import { isCodingAgentMode } from "./table_chat_coding_agent_copy.js";

export const FILTERBAR_AI_CHAT_ROUTES = Object.freeze({
    api_tools: "/api/app/ai-chat/query",
});

/** API AI, or one of the coding agent's job modes; anything else becomes API AI. */
export function normalizeFilterbarAIChatMode(
    configuredMode = FILTERBAR_AI_CHAT_MODE
) {
    return isCodingAgentMode(configuredMode) ? configuredMode : "api_tools";
}

export function isFilterbarAIChatDevEnvironment(
    doc = typeof document !== "undefined" ? document : null
) {
    return doc?.querySelector('meta[name="app-env"]')?.content === "dev";
}

/**
 * A coding-agent mode is usable only when the administrator-protected
 * availability response lists that mode as ready. A cached route list or the
 * development flag never substitutes for it, and there is no fallback mode.
 */
export function canUseCodingAgentMode(mode, codingAgentCapability) {
    if (!isCodingAgentMode(mode) || codingAgentCapability?.feature_enabled !== true) {
        return false;
    }
    const modes = Array.isArray(codingAgentCapability.modes) ? codingAgentCapability.modes : [];
    return modes.some((entry) => entry?.mode === mode && entry.ready === true);
}

export function resolveAvailableFilterbarAIChatMode({
    configuredMode = FILTERBAR_AI_CHAT_MODE,
    hasApiToolsPermission = hasRoutePermission(
        FILTERBAR_AI_CHAT_ROUTES.api_tools
    ),
    codingAgentCapability,
} = {}) {
    const normalizedMode = normalizeFilterbarAIChatMode(configuredMode);
    if (canUseCodingAgentMode(normalizedMode, codingAgentCapability)) {
        return normalizedMode;
    }
    return hasApiToolsPermission ? "api_tools" : null;
}
