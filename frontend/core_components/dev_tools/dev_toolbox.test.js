// dev_toolbox.test.js
// Verifies the DEV-only runtime toolbox shortcut and nav-tab timing control.
// Bridges local keyboard diagnostics and CSS custom-property tuning.
// Exists so the toolbox cannot accidentally activate outside DEV mode.

import { beforeEach, describe, expect, test, vi } from "vitest";

const createModalMock = vi.fn();
const showModalMock = vi.fn();

vi.mock("../../reusable_components/modal/modal_builder.js", () => ({
    createModal: createModalMock,
    showModal: showModalMock,
}));

const {
    applyNavTabPresentationDurationMs,
    initDevToolbox,
    isDevToolboxEnabled,
    normalizeNavTabPresentationDurationMs,
    resetDevToolboxForTests,
} = await import("./dev_toolbox.js");

describe("dev_toolbox", () => {
    beforeEach(() => {
        resetDevToolboxForTests();
        createModalMock.mockReset();
        showModalMock.mockReset();
        document.head.innerHTML = "";
        document.body.innerHTML = '<div id="navbar"></div>';
        localStorage.clear();
    });

    test("guards toolbox activation to DEV mode", () => {
        document.head.innerHTML = '<meta name="app-env" content="prod">';

        expect(isDevToolboxEnabled()).toBe(false);
        expect(initDevToolbox()).toBe(false);

        document.dispatchEvent(new KeyboardEvent("keydown", {
            key: "T",
            shiftKey: true,
            altKey: true,
        }));

        expect(createModalMock).not.toHaveBeenCalled();
        expect(showModalMock).not.toHaveBeenCalled();
    });

    test("opens the toolbox with Shift+Alt+T in DEV mode", () => {
        document.head.innerHTML = '<meta name="app-env" content="dev">';

        expect(initDevToolbox()).toBe(true);
        document.dispatchEvent(new KeyboardEvent("keydown", {
            key: "T",
            shiftKey: true,
            altKey: true,
            cancelable: true,
        }));

        expect(createModalMock).toHaveBeenCalledTimes(1);
        expect(showModalMock).toHaveBeenCalledTimes(1);
        expect(createModalMock.mock.calls[0][0].titlePlainText).toBe("DEV toolbox");
    });

    test("applies and persists nav tab transition duration", () => {
        const appliedDuration = applyNavTabPresentationDurationMs(1250);
        const navbar = document.getElementById("navbar");

        expect(appliedDuration).toBe(1250);
        expect(navbar?.style.getPropertyValue("--navtab-presentation-transition-duration")).toBe("1250ms");
        expect(JSON.parse(localStorage.getItem("easelect_dev_toolbox_settings"))).toEqual({
            navtabPresentationDurationMs: 1250,
        });
    });

    test("normalizes invalid and out-of-range duration values", () => {
        expect(normalizeNavTabPresentationDurationMs("not-a-number", 700)).toBe(700);
        expect(normalizeNavTabPresentationDurationMs(-50)).toBe(0);
        expect(normalizeNavTabPresentationDurationMs(8000)).toBe(5000);
    });
});
