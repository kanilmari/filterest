// auth_broadcast_sync.test.js
// Verifies that cross-tab auth broadcasts reuse the existing guest-shell reset path.
// Bridges auth-broadcast subscription events and the current logout/login-entry shell rebuild flow.
// Exists to keep sibling tabs in sync when one tab invalidates the shared auth session.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

const subscribeToAuthBroadcastMock = vi.fn();
const applyLoggedOutShellResetMock = vi.fn().mockResolvedValue(undefined);
const navigateToPostLogoutPathMock = vi.fn(() => false);
const setAuthModesMock = vi.fn().mockResolvedValue(undefined);
const initTabsMock = vi.fn().mockResolvedValue(undefined);
const handleLoginShellEntryMock = vi.fn().mockResolvedValue(undefined);
const runPostAuthBootstrapMock = vi.fn().mockResolvedValue(undefined);
const hideModalMock = vi.fn();
const isCrossTabLoginSyncEnabledMock = vi.fn().mockResolvedValue(true);
const requestSessionAccessPromptMock = vi.fn();

async function loadModule() {
    vi.resetModules();
    vi.doMock("./auth_broadcast.js", () => ({
        subscribeToAuthBroadcast: subscribeToAuthBroadcastMock,
    }));
    vi.doMock("./logout_shell_reset.js", () => ({
        applyLoggedOutShellReset: applyLoggedOutShellResetMock,
        navigateToPostLogoutPath: navigateToPostLogoutPathMock,
    }));
    vi.doMock("../admin_tools/auth_mode_handler.js", () => ({
        setAuthModes: setAuthModesMock,
    }));
    vi.doMock("../navigation/main_tabs/main_tab_printer.js", () => ({
        initTabs: initTabsMock,
    }));
    vi.doMock("./login_shell_entry.js", () => ({
        handleLoginShellEntry: handleLoginShellEntryMock,
    }));
    vi.doMock("./post_auth_bootstrap.js", () => ({
        runPostAuthBootstrap: runPostAuthBootstrapMock,
    }));
    vi.doMock("../../reusable_components/modal/modal_builder.js", () => ({
        hideModal: hideModalMock,
    }));
    vi.doMock("../config_fetcher.js", () => ({
        isCrossTabLoginSyncEnabled: isCrossTabLoginSyncEnabledMock,
    }));
    vi.doMock('./session_access_prompt.js', () => ({
        requestSessionAccessPrompt: requestSessionAccessPromptMock,
    }));
    return import("./auth_broadcast_sync.js");
}

describe("auth_broadcast_sync", () => {
    beforeEach(() => {
        subscribeToAuthBroadcastMock.mockReset();
        applyLoggedOutShellResetMock.mockReset().mockResolvedValue(undefined);
        navigateToPostLogoutPathMock.mockReset().mockReturnValue(false);
        setAuthModesMock.mockReset().mockResolvedValue(undefined);
        initTabsMock.mockReset().mockResolvedValue(undefined);
        handleLoginShellEntryMock.mockReset().mockResolvedValue(undefined);
        runPostAuthBootstrapMock.mockReset().mockResolvedValue(undefined);
        hideModalMock.mockReset();
        isCrossTabLoginSyncEnabledMock.mockReset().mockResolvedValue(true);
        requestSessionAccessPromptMock.mockReset();
        vi.restoreAllMocks();
        history.replaceState({}, "", "/?login-entry=1&redirect=%2Freports&register-entry=1");
    });

    test("starts auth broadcast sync only once", async () => {
        subscribeToAuthBroadcastMock.mockReturnValue(() => {});
        const mod = await loadModule();

        mod.startAuthBroadcastSync();
        mod.startAuthBroadcastSync();

        expect(subscribeToAuthBroadcastMock).toHaveBeenCalledTimes(1);
    });

    test("applies remote logout reset and rebuilds the guest shell", async () => {
        let handler;
        subscribeToAuthBroadcastMock.mockImplementation((incomingHandler) => {
            handler = incomingHandler;
            return () => {};
        });
        const mod = await loadModule();

        mod.startAuthBroadcastSync();
        await handler({
            type: "logout",
            detail: { reason: 'logout', postLogoutPath: '/' },
        });

        expect(applyLoggedOutShellResetMock).toHaveBeenCalledWith({
            postLogoutPath: "/",
        });
        expect(navigateToPostLogoutPathMock).not.toHaveBeenCalled();
        expect(setAuthModesMock).toHaveBeenCalledTimes(1);
        expect(initTabsMock).toHaveBeenCalledWith({ dataAlreadyLoaded: false });
        expect(handleLoginShellEntryMock).toHaveBeenCalledTimes(1);
        expect(requestSessionAccessPromptMock).toHaveBeenCalledWith({
            reason: 'logged-out-another-tab',
        });
    });

    test("remote logout follows the server post-logout target instead of rebuilding the shell", async () => {
        let handler;
        subscribeToAuthBroadcastMock.mockImplementation((incomingHandler) => {
            handler = incomingHandler;
            return () => {};
        });
        applyLoggedOutShellResetMock.mockResolvedValue({
            postLogoutPath: '/login?auth_notice=logged-out-another-tab',
        });
        navigateToPostLogoutPathMock.mockReturnValue(true);
        const mod = await loadModule();

        mod.startAuthBroadcastSync();
        await handler({
            type: "logout",
            detail: { reason: 'logout', postLogoutPath: "/login" },
        });

        expect(applyLoggedOutShellResetMock).toHaveBeenCalledWith({
            postLogoutPath: '/login?auth_notice=logged-out-another-tab',
        });
        expect(navigateToPostLogoutPathMock).toHaveBeenCalledWith(
            '/login?auth_notice=logged-out-another-tab'
        );
        expect(setAuthModesMock).not.toHaveBeenCalled();
        expect(initTabsMock).not.toHaveBeenCalled();
        expect(handleLoginShellEntryMock).not.toHaveBeenCalled();
    });

    test('preserves a security session reset without mislabelling it as an explicit logout', async () => {
        let handler;
        subscribeToAuthBroadcastMock.mockImplementation((incomingHandler) => {
            handler = incomingHandler;
            return () => {};
        });
        applyLoggedOutShellResetMock.mockResolvedValue({ postLogoutPath: '/?login-entry=1' });
        navigateToPostLogoutPathMock.mockReturnValue(true);
        const mod = await loadModule();

        mod.startAuthBroadcastSync();
        await handler({
            type: 'logout',
            detail: { reason: 'session_reset', postLogoutPath: '/?login-entry=1' },
        });

        expect(applyLoggedOutShellResetMock).toHaveBeenCalledWith({
            postLogoutPath: '/?login-entry=1',
        });
        expect(requestSessionAccessPromptMock).not.toHaveBeenCalled();
    });

    test("deduplicates overlapping remote logout events", async () => {
        let handler;
        subscribeToAuthBroadcastMock.mockImplementation((incomingHandler) => {
            handler = incomingHandler;
            return () => {};
        });
        applyLoggedOutShellResetMock.mockImplementation(
            () => new Promise((resolve) => setTimeout(resolve, 20))
        );
        const mod = await loadModule();

        mod.startAuthBroadcastSync();
        await Promise.all([
            handler({ type: "logout", detail: {} }),
            handler({ type: "logout", detail: {} }),
        ]);

        expect(applyLoggedOutShellResetMock).toHaveBeenCalledTimes(1);
        expect(initTabsMock).toHaveBeenCalledTimes(1);
    });

    test("rebuilds the authenticated shell on remote login when enabled", async () => {
        let handler;
        subscribeToAuthBroadcastMock.mockImplementation((incomingHandler) => {
            handler = incomingHandler;
            return () => {};
        });
        const replaceStateSpy = vi.spyOn(window.history, "replaceState");
        const mod = await loadModule();

        mod.startAuthBroadcastSync();
        await handler({ type: "login", detail: { reason: "login" } });

        expect(hideModalMock).toHaveBeenCalledTimes(1);
        expect(setAuthModesMock).toHaveBeenCalledTimes(1);
        expect(runPostAuthBootstrapMock).toHaveBeenCalledWith({ refreshAuthModes: false });
        expect(replaceStateSpy).toHaveBeenCalledWith({}, "", "/");
    });

    test("ignores remote login events when cross-tab login sync is disabled", async () => {
        let handler;
        subscribeToAuthBroadcastMock.mockImplementation((incomingHandler) => {
            handler = incomingHandler;
            return () => {};
        });
        isCrossTabLoginSyncEnabledMock.mockResolvedValue(false);
        const mod = await loadModule();

        mod.startAuthBroadcastSync();
        await handler({ type: "login", detail: {} });

        expect(setAuthModesMock).not.toHaveBeenCalled();
        expect(runPostAuthBootstrapMock).not.toHaveBeenCalled();
        expect(hideModalMock).not.toHaveBeenCalled();
    });
});
