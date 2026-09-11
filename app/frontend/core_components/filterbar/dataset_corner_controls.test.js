// @vitest-environment jsdom
// Verifies active control ownership and lifecycle while keeping canonical button actions.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createDatasetCornerControls, isHeroControlAreaVisible, selectDatasetCornerOwner } from "./dataset_corner_controls.js";

let controls;
let parts;
function fixture() {
    document.body.innerHTML = `<button id="showMenuButton"></button><div id="parts">
        <div id="hero"></div><div id="topbar"><div id="menu-slot"><button id="topbar-menu"></button></div><div id="end"></div></div>
        <button id="filter"></button><div id="panel"><button id="hide-filter"></button></div></div>`;
    const byId = (id) => document.getElementById(id);
    parts = {
        hero: byId("hero"), fallbackHost: byId("parts"), filterButton: byId("filter"),
        hideFilterButton: byId("hide-filter"), panel: byId("panel"),
        heroMenuButton: document.createElement("button"), topbarEnd: byId("end"),
        topbarMenuButton: byId("topbar-menu"), topbarMenuSlot: byId("menu-slot"),
        sourceMenuButton: byId("showMenuButton"), menuOwner: {}, syncNavbarAccessibility: vi.fn(),
    };
    controls = createDatasetCornerControls(parts);
    return { active: true, heroControlsVisible: true, topbarVisible: false, navbarVisible: false, filterbarVisible: false };
}
beforeEach(() => { localStorage.clear(); });
afterEach(() => { controls?.destroy(); document.body.innerHTML = ""; });

describe("dataset corner owner", () => {
    test.each([
        [false, true, true, "none"], [true, true, false, "hero"],
        [true, false, true, "topbar"], [true, false, false, "fallback"],
    ])("selects only an available active host", (active, heroControlsVisible, topbarVisible, expected) => {
        expect(selectDatasetCornerOwner({ active, heroControlsVisible, topbarVisible })).toBe(expected);
    });
    test("releases a partially visible hero whose corner has scrolled away", () => {
        fixture();
        parts.fallbackHost.getBoundingClientRect = () => ({ top: 0, bottom: 600, height: 600 });
        parts.hero.getBoundingClientRect = () => ({ top: 0, bottom: 300, height: 300 });
        expect(isHeroControlAreaVisible(parts.hero, parts.fallbackHost)).toBe(true);
        parts.hero.getBoundingClientRect = () => ({ top: -30, bottom: 270, height: 300 });
        expect(isHeroControlAreaVisible(parts.hero, parts.fallbackHost)).toBe(false);
        parts.hero.remove();
        expect(isHeroControlAreaVisible(parts.hero, parts.fallbackHost)).toBe(false);
    });
    test("moves the same filter button while preserving its existing action and focus", () => {
        const state = fixture();
        const action = vi.fn();
        parts.filterButton.addEventListener("click", action);
        const sourceHome = parts.sourceMenuButton.parentElement;
        controls.sync(state);
        expect(parts.hero.contains(parts.filterButton)).toBe(true);
        expect(parts.heroMenuButton.tabIndex).toBe(0);
        expect(parts.topbarMenuButton.tabIndex).toBe(-1);
        expect(parts.sourceMenuButton.parentElement).toBe(sourceHome);
        parts.filterButton.focus();
        controls.sync({ ...state, heroControlsVisible: false, topbarVisible: true });
        expect(parts.filterButton.parentElement).toBe(parts.topbarEnd);
        expect(document.activeElement).toBe(parts.filterButton);
        expect(parts.heroMenuButton.tabIndex).toBe(-1);
        expect(parts.topbarMenuButton.tabIndex).toBe(0);
        parts.filterButton.click();
        expect(action).toHaveBeenCalledTimes(1);
        controls.sync({ ...state, heroControlsVisible: false });
        expect(parts.filterButton.parentElement).toBe(parts.fallbackHost);
        expect(parts.sourceMenuButton.classList.contains("shared-topbar-menu-source-hidden")).toBe(false);
    });
    test("keeps panel hide controls and expanded state when the sidebar is open", () => {
        const state = fixture();
        controls.sync({ ...state, filterbarVisible: true, navbarVisible: true });
        expect(parts.hideFilterButton.parentElement).toBe(parts.panel);
        expect(parts.hideFilterButton.tabIndex).toBe(0);
        expect(parts.hideFilterButton.getAttribute("aria-expanded")).toBe("true");
        expect(parts.filterButton.tabIndex).toBe(-1);
        expect(parts.filterButton.getAttribute("aria-controls")).toBe("panel");
        expect(parts.heroMenuButton.tabIndex).toBe(-1);
        expect(parts.topbarMenuButton.tabIndex).toBe(-1);
    });
    test("removes inactive dataset controls from tab order without releasing another dataset owner", () => {
        const state = fixture();
        controls.sync(state);
        const otherOwner = {};
        parts.sourceMenuButton.__sharedTopbarMenuOwner = otherOwner;
        controls.sync({ ...state, active: false });
        for (const button of [parts.filterButton, parts.heroMenuButton, parts.topbarMenuButton, parts.hideFilterButton]) {
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
        expect(parts.heroMenuButton.title).toBe("Näytä päävalikko");
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
});
