// main_tab_active_state.test.js
// Verifies main tab presentation changes keep the visible SVG path animated.
// Bridges nav state updates with path-level morph timing in a jsdom runtime.
// Exists to prevent rounded/button tab outlines from snapping at the start of transitions.
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
    buildTabOutlinePresentation,
} from "./tab_presentation_builder.js";

vi.mock("../../../ui_config.js", () => ({
    NAVBAR_WIDTH_THRESHOLD: 1850,
    NAVTAB_BUTTON_BREAKPOINT_PX: 768,
}));

describe("applyMainTabActiveState", () => {
    let originalMatchMedia;
    let frameCallbacks;

    beforeEach(() => {
        vi.resetModules();
        localStorage.clear();
        frameCallbacks = [];
        originalMatchMedia = window.matchMedia;
        window.matchMedia = vi.fn(() => ({ matches: false }));
        vi.spyOn(window.performance, "now").mockReturnValue(0);
        vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
            frameCallbacks.push(callback);
            return frameCallbacks.length;
        });
        vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

        Object.defineProperty(window, "innerWidth", {
            configurable: true,
            value: 1920,
        });

        const roundedPath = buildTabOutlinePresentation({
            isNarrow: false,
            isNavbarOverlay: false,
            isActive: true,
            viewKey: "card",
        }).pathD;

        document.body.innerHTML = `
            <nav id="navbar" style="--navtab-presentation-transition-duration: 5000ms;">
                <div id="tabs_container"></div>
                <div id="navmenu" class="navtabs">
                    <button class="navtablinks active" data-id="app_service_catalog">
                        <svg class="svg-container">
                            <path d="${roundedPath}" fill="var(--bg_color_2)" stroke-width="2"></path>
                        </svg>
                    </button>
                </div>
            </nav>
        `;
        document.getElementById("navbar").getBoundingClientRect = vi.fn(() => ({
            bottom: 900,
            height: 900,
            left: 0,
            right: 300,
            top: 0,
            width: 300,
            x: 0,
            y: 0,
        }));
    });

    afterEach(() => {
        window.matchMedia = originalMatchMedia;
        vi.restoreAllMocks();
    });

    function runQueuedFrames(timestamp) {
        const callbacks = frameCallbacks.splice(0);
        callbacks.forEach((callback) => callback(timestamp));
    }

    test("keeps the visible path at the previous outline until the morph frame advances", async () => {
        localStorage.setItem("app_service_catalog_view", "table");
        const { applyMainTabActiveState } = await import("./main_tab_active_state.js");
        const outlinePath = document.querySelector(".svg-container path");
        const roundedPath = outlinePath.getAttribute("d");
        const buttonPath = buildTabOutlinePresentation({
            isNarrow: false,
            isNavbarOverlay: false,
            isActive: true,
            viewKey: "table",
        }).pathD;

        applyMainTabActiveState("app_service_catalog", {
            viewDatasetName: "app_service_catalog",
        });

        expect(outlinePath.getAttribute("d")).toBe(roundedPath);
        expect(outlinePath.getAttribute("d")).not.toBe(buttonPath);
        expect(frameCallbacks.length).toBeGreaterThan(0);

        runQueuedFrames(2500);
        const midwayPath = outlinePath.getAttribute("d");

        expect(midwayPath).not.toBe(roundedPath);
        expect(midwayPath).not.toBe(buttonPath);

        while (frameCallbacks.length > 0) {
            runQueuedFrames(5000);
        }

        expect(outlinePath.getAttribute("d")).toBe(buttonPath);
    });

    test("keeps the tab shell layout stable while only the outline path morphs", async () => {
        localStorage.setItem("app_service_catalog_view", "table");
        const { applyMainTabActiveState } = await import("./main_tab_active_state.js");
        const navTabs = document.querySelector(".navtabs");
        const tabButton = document.querySelector(".navtablinks");
        const svgContainer = document.querySelector(".svg-container");

        applyMainTabActiveState("app_service_catalog", {
            viewDatasetName: "app_service_catalog",
        });

        expect(tabButton.dataset.tabPresentation).toBe("button-active");
        expect(navTabs.style.right).toBe("0px");
        expect(tabButton.style.transform).toBe("");
        expect(tabButton.style.width).toBe("");
        expect(tabButton.style.height).toBe("");
        expect(svgContainer.style.transform).toBe("");
        expect(svgContainer.style.width).toBe("");
        expect(svgContainer.style.height).toBe("");
        expect(svgContainer.getAttribute("viewBox")).toBe("0 0 300 65");
        expect(tabButton.style.getPropertyValue("--navtab-rounded-left-offset")).toBe("56px");
    });
});
