// main_tab_active_state.test.js
// Verifies main tab presentation changes keep the visible SVG path animated.
// Bridges nav state updates with path-level morph timing in a jsdom runtime.
// Exists to prevent rounded/button tab outlines from snapping at the start of transitions.
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
    buildTabOutlinePresentation,
} from "./tab_presentation_builder.js";
import { setChosenDatasetView } from "../../state_stores/dataset_view_choice_saver.js";

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
        sessionStorage.clear();
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
        // A first visit is box-like until a catalogue decides (side_menu_tab_shape.js).
        const { applyMainTabActiveState } = await import("./main_tab_active_state.js");
        const outlinePath = document.querySelector(".svg-container path");
        const roundedPath = outlinePath.getAttribute("d");
        const buttonPath = buildTabOutlinePresentation({
            forceRectangular: true,
            isNarrow: false,
            isNavbarOverlay: false,
            isActive: true,
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
        setChosenDatasetView("app_service_catalog", "table");
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

    // Owner 2026-11-22: one shape for the whole side menu (side_menu_tab_shape.js); Home keeps it.
    test("Home keeps the menu's rounded decision without a morph, and leaving keeps the same shape", async () => {
        localStorage.setItem("side_menu_tab_shape", "rounded");
        const { applyMainTabActiveState, clearMainTabActiveState, refreshMainTabPresentation } = await import("./main_tab_active_state.js");
        const home = document.createElement("main");
        home.id = "front_page_container";
        document.body.append(home);
        const tab = document.querySelector(".navtablinks");
        const path = tab.querySelector("path");
        clearMainTabActiveState("front_page");
        expect(document.body.getAttribute("data-side-menu-tab-shape")).toBe("rounded");
        expect(tab.dataset.tabPresentation).toBe("tab-inactive");
        expect(frameCallbacks).toHaveLength(0);
        refreshMainTabPresentation();
        expect(tab.dataset.tabPresentation).toBe("tab-inactive");
        home.classList.add("hidden");
        setChosenDatasetView("app_service_catalog", "card");
        applyMainTabActiveState("app_service_catalog");
        while (frameCallbacks.length > 0) runQueuedFrames(5000);
        expect(tab.dataset.tabPresentation).toBe("tab-active");
        expect(path.getAttribute("d").match(/A 7 7/g)).toHaveLength(4);
    });

    test("a box-like menu decision gives every dataset button rows, also in a card view", async () => {
        localStorage.setItem("side_menu_tab_shape", "box");
        setChosenDatasetView("app_service_catalog", "card");
        const tabButton = document.querySelector(".navtablinks");
        const { applyMainTabActiveState } = await import("./main_tab_active_state.js");

        applyMainTabActiveState("app_service_catalog", {
            viewDatasetName: "app_service_catalog",
        });

        expect(tabButton.dataset.tabPresentation).toBe("button-active");
        expect(document.querySelector(".navtabs").style.right).toBe("0px");
        while (frameCallbacks.length > 0) {
            runQueuedFrames(5000);
        }
        expect(document.querySelector(".svg-container path").getAttribute("d"))
            .toContain("A 0 0");
    });

    test("a changed menu decision redraws the tabs, and an instant refresh does not morph", async () => {
        localStorage.setItem("side_menu_tab_shape", "box");
        setChosenDatasetView("app_service_catalog", "card");
        const { applyMainTabActiveState, refreshMainTabPresentation } = await import("./main_tab_active_state.js");
        const { syncSideMenuTabShape } = await import("./side_menu_tab_shape.js");
        const tab = document.querySelector(".navtablinks");
        const path = tab.querySelector("path");
        applyMainTabActiveState("app_service_catalog");
        while (frameCallbacks.length > 0) runQueuedFrames(5000);
        expect(tab.dataset.tabPresentation).toBe("button-active");
        const menu = document.getElementById("navmenu");
        menu.setAttribute("data-side-menu-rendered", "true");
        syncSideMenuTabShape(menu, { datasets: [{ dataset_name: "app_service_catalog",
            presentation_picture: { background: false, cover: false } }] });
        expect(tab.dataset.tabPresentation).toBe("tab-active");
        while (frameCallbacks.length > 0) runQueuedFrames(5000);
        expect(path.getAttribute("d").match(/A 7 7/g)).toHaveLength(4);
        syncSideMenuTabShape(menu, { datasets: [{ dataset_name: "app_service_catalog",
            presentation_picture: { background: true, cover: false } }] });
        while (frameCallbacks.length > 0) runQueuedFrames(5000);
        expect(tab.dataset.tabPresentation).toBe("button-active");
        tab.classList.remove("active");
        refreshMainTabPresentation("app_service_catalog", { instant: true });
        expect(frameCallbacks).toHaveLength(0);
        expect(tab.dataset.tabPresentation).toBe("button-inactive");
    });
    // Owner 2026-11-22: only datasets with a menu tab count; the open view itself no longer shapes the tabs.
    test("a table view of a dataset without a menu tab leaves the menu's rounded decision", async () => {
        localStorage.setItem("side_menu_tab_shape", "rounded");
        const { applyMainTabActiveState } = await import("./main_tab_active_state.js");
        const { noteDatasetViewShown, syncSideMenuTabShape } = await import("./side_menu_tab_shape.js");
        const tab = document.querySelector(".navtablinks");
        tab.classList.remove("active");
        const menu = document.getElementById("navmenu");
        menu.setAttribute("data-side-menu-rendered", "true");
        const catalogue = { datasets: [
            { dataset_name: "app_service_catalog", presentation_picture: { background: false, cover: false },
                default_view: { name: "card" } },
            { dataset_name: "subfolder_orders", presentation_picture: { background: false, cover: false },
                default_view: { name: "table" } },
        ] };
        syncSideMenuTabShape(menu, catalogue);
        noteDatasetViewShown("subfolder_orders", "table");
        applyMainTabActiveState("", { viewDatasetName: "subfolder_orders" });
        expect(document.body.getAttribute("data-side-menu-tab-shape")).toBe("rounded");
        expect(tab.dataset.tabPresentation).toBe("tab-inactive");
        // The menu's own dataset drawn in a table view makes every tab box-like.
        noteDatasetViewShown("app_service_catalog", "table");
        syncSideMenuTabShape(menu, catalogue);
        while (frameCallbacks.length > 0) runQueuedFrames(5000);
        expect(document.body.getAttribute("data-side-menu-tab-shape")).toBe("box");
        expect(tab.dataset.tabPresentation).toBe("button-inactive");
    });
});
