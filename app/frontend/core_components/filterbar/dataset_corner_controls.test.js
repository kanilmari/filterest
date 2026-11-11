// dataset_corner_controls.test.js
// Verifies active control ownership and lifecycle while keeping canonical button actions.
// Connects dataset corners to real shell accessibility during focus handoff.
// Prevents navigation from blurring menu focus or taking unrelated focus.
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createDatasetCornerControls } from "./dataset_corner_controls.js";
import { syncNavbarMenuButtonAccessibility } from "../navigation/menu_button/navbar_visibility_handler.js";
import { placeTopNavHomeButton } from '../front_page/top_nav_home_button.js';

let controls;
let parts;
function fixture() {
    document.body.innerHTML = `<div id="navbar" class="collapsed"><button id="hideMenuButton"></button></div>
        <button id="showMenuButton"></button><div id="parts">
        <div id="hero"></div><div id="topbar"><div id="menu-slot"><button id="topbar-menu"></button></div><div id="end"></div></div>
        <button id="filter"></button><div id="panel"><div class="filterbar-panel__toggle-dock"><button id="hide-filter"></button></div></div></div>`;
    const byId = (id) => document.getElementById(id);
    parts = {
        hero: byId("hero"), fallbackHost: byId("parts"), filterButton: byId("filter"),
        hideFilterButton: byId("hide-filter"), panel: byId("panel"),
        topbarEnd: byId("end"),
        topbarMenuButton: byId("topbar-menu"), topbarMenuSlot: byId("menu-slot"),
        sourceMenuButton: byId("showMenuButton"), menuOwner: {}, syncNavbarAccessibility: vi.fn(),
    };
    controls = createDatasetCornerControls(parts);
    return { active: true, topbarVisible: true, navbarVisible: false, filterbarVisible: false };
}
beforeEach(() => { localStorage.clear(); });
afterEach(() => { controls?.destroy(); document.body.innerHTML = ""; });

describe("dataset corner owner", () => {
    test.each([true, false])('original Home hosts and final panel survive handoffs, panel first=%s', panelFirst => {
        const initial = fixture();
        const home = document.createElement('a'); home.href = '/'; home.className = 'top-nav-home-button';
        const tabs = document.createElement('nav'); tabs.className = 'hero-dataset-tabs';
        tabs.append(document.createElement('button')); parts.hero.prepend(tabs);
        const start = document.createElement('div'); start.className = 'dataset-shared-topbar__slot--start';
        start.append(document.createElement('button')); parts.topbarEnd.before(start);
        parts.topbarEnd.classList.add('dataset-shared-topbar__slot--end');
        for (const [width, atTop] of [[1440, true], [1000, true], [1000, false], [700, true], [390, false], [1440, false], [1440, true]]) {
            const phone = width <= 700;
            const inHero = !phone && atTop;
            const host = inHero ? tabs : phone ? start : parts.topbarEnd;
            const state = initial;
            const moveHome = () => phone ? home.remove() : placeTopNavHomeButton(home, host);
            const movePanel = () => controls.sync(state);
            for (const move of panelFirst ? [movePanel, moveHome] : [moveHome, movePanel]) move();
            moveHome(); movePanel();
            if (phone) {
                expect(home.parentElement).toBeNull();
                expect(parts.filterButton.parentElement.lastElementChild).toBe(parts.filterButton);
                continue;
            }
            expect(home.parentElement).toBe(host);
            expect(inHero ? host.firstElementChild : phone ? host.lastElementChild : host.firstElementChild).toBe(home);
            expect(parts.filterButton.parentElement.lastElementChild).toBe(parts.filterButton);
            if (!inHero && !phone) expect(home.nextElementSibling).toBe(parts.filterButton);
            home.focus(); moveHome(); movePanel(); expect(document.activeElement).toBe(home);
        }
    });
    test.each([
        [false, false, true], [false, true, true], [true, false, true],
        [true, true, false], [true, true, true],
    ])("exactly one menu and filter target for nav=%s, filters=%s, toolbar=%s", (navbarVisible, filterbarVisible, topbarVisible) => {
        const state = fixture();
        parts.syncNavbarAccessibility.mockImplementation(syncNavbarMenuButtonAccessibility);
        document.getElementById("navbar").classList.toggle("collapsed", !navbarVisible);
        controls.sync({ ...state, navbarVisible, filterbarVisible, topbarVisible });
        const hideMenu = document.getElementById("hideMenuButton");
        const menuTargets = [parts.sourceMenuButton, hideMenu, parts.topbarMenuButton];
        const filterTargets = [parts.filterButton, parts.hideFilterButton];
        const interactive = button => button.tabIndex === 0 && button.getAttribute("aria-hidden") === "false";
        expect(menuTargets.filter(interactive)).toEqual([topbarVisible ? parts.topbarMenuButton : hideMenu]);
        expect(filterTargets.filter(interactive)).toEqual([topbarVisible ? parts.filterButton : parts.hideFilterButton]);
        expect(parts.filterButton.getAttribute("aria-controls")).toBe("panel");
        expect(parts.filterButton.getAttribute("aria-expanded")).toBe(String(filterbarVisible));
        expect(parts.topbarMenuButton.getAttribute("aria-expanded")).toBe(String(navbarVisible));
        expect(parts.hideFilterButton.parentElement.hidden).toBe(topbarVisible);
        expect(parts.hideFilterButton.parentElement.inert).toBe(topbarVisible);
    });
    test("hands filter focus between the same bar button and the real panel closer", () => {
        const state = fixture();
        controls.sync(state);
        const original = parts.filterButton;
        const action = vi.fn();
        original.addEventListener("click", action);
        original.focus();
        controls.sync({ ...state, topbarVisible: false, navbarVisible: true, filterbarVisible: true });
        expect(document.activeElement).toBe(parts.hideFilterButton);
        controls.sync(state);
        expect(document.activeElement).toBe(original);
        expect(original.parentElement).toBe(parts.topbarEnd);
        original.click();
        expect(action).toHaveBeenCalledTimes(1);
    });
    test("removes inactive dataset controls from tab order without releasing another dataset owner", () => {
        const state = fixture();
        controls.sync(state);
        const otherOwner = {};
        parts.sourceMenuButton.__sharedTopbarMenuOwner = otherOwner;
        controls.sync({ ...state, active: false });
        for (const button of [parts.filterButton, parts.topbarMenuButton, parts.hideFilterButton]) {
            expect(button.tabIndex).toBe(-1);
            expect(button.getAttribute("aria-hidden")).toBe("true");
        }
        expect(parts.sourceMenuButton.__sharedTopbarMenuOwner).toBe(otherOwner);
        expect(parts.sourceMenuButton.classList.contains("shared-topbar-menu-source-hidden")).toBe(true);
    });
    test("updates FI/EN accessible labels on the existing language lifecycle", async () => {
        const state = fixture();
        controls.sync(state);
        expect(parts.filterButton.getAttribute("aria-label")).toBe("Show filter toolbar");
        localStorage.setItem("chosen_language", "fi");
        document.documentElement.lang = "fi";
        await Promise.resolve();
        expect(parts.filterButton.getAttribute("aria-label")).toBe("Näytä suodatuspalkki");
        expect(parts.topbarMenuButton.title).toBe("Näytä päävalikko");
        expect(parts.hideFilterButton.title).toBe("Piilota suodatuspalkki");
    });
    test("tears down owned slots and releases the existing global fallback once", () => {
        const state = fixture();
        controls.sync(state);
        controls.destroy();
        expect(parts.filterButton.parentElement).toBe(parts.fallbackHost);
        expect(parts.hero.querySelector(".dataset-corner-controls")).toBeNull();
        expect(parts.sourceMenuButton.__sharedTopbarMenuOwner).toBeNull();
        const calls = parts.syncNavbarAccessibility.mock.calls.length;
        controls.destroy();
        controls.sync(state);
        expect(parts.syncNavbarAccessibility).toHaveBeenCalledTimes(calls);
    });
    test("hands focused menu to the shell and back on activation", () => {
        const state = fixture();
        parts.syncNavbarAccessibility.mockImplementation(syncNavbarMenuButtonAccessibility);
        const local = parts.topbarMenuButton;
        controls.sync(state);
        local.focus();
        controls.sync({ ...state, active: false });
        expect(document.activeElement).toBe(parts.sourceMenuButton);
        expect(parts.sourceMenuButton.getAttribute("aria-hidden")).toBe("false");
        expect(parts.sourceMenuButton.tabIndex).toBe(0);
        controls.sync(state);
        expect(document.activeElement).toBe(local);
        expect(local.getAttribute("aria-hidden")).toBe("false");
        expect(local.tabIndex).toBe(0);
    });
    test("inactive observers cannot take focus from the active dataset's menu", () => {
        const state = fixture();
        parts.syncNavbarAccessibility.mockImplementation(syncNavbarMenuButtonAccessibility);
        controls.sync(state);
        const activeMenu = document.createElement("button");
        document.body.append(activeMenu);
        parts.sourceMenuButton.__sharedTopbarMenuOwner = {};
        activeMenu.focus();
        controls.sync({ ...state, active: false });
        expect(document.activeElement).toBe(activeMenu);
        expect(parts.sourceMenuButton.tabIndex).toBe(-1);
    });
});
