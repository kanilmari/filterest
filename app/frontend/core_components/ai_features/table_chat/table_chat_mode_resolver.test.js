// table_chat_mode_resolver.test.js
// Verifies filterbar AI chat mode selection for the API-first facade only.
// Bridges UI config compatibility and cached route permissions with the resolver decision.
// Exists to keep the removed legacy SSE transport from creeping back into product mode selection.

import { beforeEach, describe, expect, test, vi } from "vitest";

let configuredChatMode = "api_tools";
const hasRoutePermissionMock = vi.fn();

async function loadModule() {
    vi.resetModules();
    vi.doMock("../../route_permission_checker.js", () => ({
        hasRoutePermission: hasRoutePermissionMock,
    }));
    vi.doMock("../../../ui_config.js", () => ({
        FILTERBAR_AI_CHAT_MODE: configuredChatMode,
    }));
    return import("./table_chat_mode_resolver.js");
}

describe("resolveAvailableFilterbarAIChatMode", () => {
    beforeEach(() => {
        configuredChatMode = "api_tools";
        hasRoutePermissionMock.mockReset();
        hasRoutePermissionMock.mockReturnValue(false);
        document.head.innerHTML = "";
    });

    test("prefers api_tools when the configured route is available", async () => {
        hasRoutePermissionMock.mockImplementation(
            (route) => route === "/api/app/ai-chat/query"
        );
        const mod = await loadModule();

        expect(mod.resolveAvailableFilterbarAIChatMode()).toBe("api_tools");
    });

    test("returns null when the api_tools route is unavailable", async () => {
        const mod = await loadModule();

        expect(mod.resolveAvailableFilterbarAIChatMode()).toBeNull();
    });

    test("normalizes removed legacy_sql config back to api_tools", async () => {
        configuredChatMode = "legacy_sql";
        const mod = await loadModule();

        expect(mod.normalizeFilterbarAIChatMode()).toBe("api_tools");
    });

    test("normalizes unknown configured modes back to api_tools", async () => {
        configuredChatMode = "unexpected_mode";
        const mod = await loadModule();

        expect(mod.normalizeFilterbarAIChatMode()).toBe("api_tools");
    });

    test("a stale route list or the dev flag never enables a coding-agent mode", async () => {
        document.head.innerHTML = '<meta name="app-env" content="dev">';
        configuredChatMode = "code_workspace";
        hasRoutePermissionMock.mockImplementation((route) =>
            [
                "/api/app/ai-chat/query",
                "/api/app/ai-chat/codex-query",
            ].includes(route)
        );
        const mod = await loadModule();

        expect(mod.normalizeFilterbarAIChatMode()).toBe("code_workspace");
        expect(mod.resolveAvailableFilterbarAIChatMode()).toBe("api_tools");
    });

    test("normalizes the removed codex_dev value back to api_tools", async () => {
        configuredChatMode = "codex_dev";
        const mod = await loadModule();

        expect(mod.normalizeFilterbarAIChatMode()).toBe("api_tools");
    });
});

test.each([
    ["code_workspace", [{ mode: "code_workspace", ready: true }], true, "code_workspace"],
    ["code_workspace", [{ mode: "code_workspace", ready: false }], true, "api_tools"],
    ["site_assistant", [{ mode: "code_workspace", ready: true }], true, "api_tools"],
    ["site_assistant", [{ mode: "site_assistant", ready: true }], false, "api_tools"],
    ["site_assistant", [{ mode: "site_assistant", ready: true }], true, "site_assistant"],
])("mode %s with availability %j and permission %s answers with %s", async (mode, modes, enabled, expected) => {
    const mod = await loadModule();
    expect(mod.resolveAvailableFilterbarAIChatMode({
        configuredMode: mode, hasApiToolsPermission: true,
        codingAgentCapability: { feature_enabled: enabled, modes },
    })).toBe(expected);
});
