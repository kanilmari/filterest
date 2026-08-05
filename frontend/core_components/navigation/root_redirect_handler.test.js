// root_redirect_handler.test.js
// Verifies dataset redirect notices and SPA-safe root redirects without a hard reload.
// Bridges mocked redirect storage, toast notifications, and post-auth bootstrap calls.
// Exists to keep root-return flows reusable across delete/missing-dataset SPA slices.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

const consumeRedirectNoticeMock = vi.fn();
const runPostAuthBootstrapMock = vi.fn();
const showInfoToastMock = vi.fn();

async function loadModule() {
    vi.resetModules();
    vi.doMock("../state_stores/dataset_selection_saver.js", () => ({
        consumeRedirectNotice: consumeRedirectNoticeMock,
    }));
    vi.doMock("../auth/post_auth_bootstrap.js", () => ({
        runPostAuthBootstrap: runPostAuthBootstrapMock,
    }));
    vi.doMock("../../reusable_components/notifications/toast_notification_printer.js", () => ({
        showInfoToast: showInfoToastMock,
    }));

    return import("./root_redirect_handler.js");
}

describe("root_redirect_handler", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        history.replaceState({}, "", "/app_service_catalog");
        consumeRedirectNoticeMock.mockReturnValue(null);
        runPostAuthBootstrapMock.mockResolvedValue({ dataLoaded: true });
    });

    test("builds deleted-dataset notices", async () => {
        const mod = await loadModule();

        expect(mod.buildDatasetRedirectNoticeMessage({ datasetName: "demo_table", reason: "deleted" }))
            .toBe("Taulu demo_table on poistettu. Siirryttiin oletusnäkymään.");
        expect(mod.buildDatasetRedirectNoticeMessage({ reason: "deleted" }))
            .toBe("Taulu on poistettu. Siirryttiin oletusnäkymään.");
    });

    test("builds missing-dataset notices", async () => {
        const mod = await loadModule();

        expect(mod.buildDatasetRedirectNoticeMessage({ datasetName: "ghost_table", reason: "missing" }))
            .toBe("Näkymää ghost_table ei löytynyt. Siirryttiin oletusnäkymään.");
        expect(mod.buildDatasetRedirectNoticeMessage({ reason: "missing" }))
            .toBe("Valittua näkymää ei löytynyt. Siirryttiin oletusnäkymään.");
    });

    test("redirects to root in the SPA and shows any queued redirect notice", async () => {
        consumeRedirectNoticeMock.mockReturnValue({
            datasetName: "demo_table",
            reason: "deleted",
        });
        const mod = await loadModule();

        await mod.redirectToRootInSpa();

        expect(window.location.pathname).toBe("/");
        expect(runPostAuthBootstrapMock).toHaveBeenCalledWith({ refreshAuthModes: false });
        expect(showInfoToastMock).toHaveBeenCalledWith("Taulu demo_table on poistettu. Siirryttiin oletusnäkymään.");
    });

    test("showDatasetRedirectNoticeIfAvailable is a no-op when no notice is queued", async () => {
        const mod = await loadModule();

        mod.showDatasetRedirectNoticeIfAvailable();

        expect(showInfoToastMock).not.toHaveBeenCalled();
    });
});
