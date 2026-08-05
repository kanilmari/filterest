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

    test("allows codex_dev only in dev mode with the dev route permission", async () => {
        document.head.innerHTML = '<meta name="app-env" content="dev">';
        configuredChatMode = "codex_dev";
        hasRoutePermissionMock.mockImplementation(
            (route) => route === "/api/app/ai-chat/codex-query"
        );
        const mod = await loadModule();

        expect(mod.resolveAvailableFilterbarAIChatMode()).toBe("codex_dev");
    });

    test("falls back from codex_dev to api_tools outside dev mode", async () => {
        configuredChatMode = "codex_dev";
        hasRoutePermissionMock.mockImplementation((route) =>
            [
                "/api/app/ai-chat/query",
                "/api/app/ai-chat/codex-query",
            ].includes(route)
        );
        const mod = await loadModule();

        expect(mod.resolveAvailableFilterbarAIChatMode()).toBe("api_tools");
    });
});
