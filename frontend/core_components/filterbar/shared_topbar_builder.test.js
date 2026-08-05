// @vitest-environment jsdom
// shared_topbar_builder.test.js
// Verifies shared topbar visibility rules and DOM-safe button docking for dataset topbars.
// Bridges hidden tab containers, reused menu/filter buttons, and restoration of original button homes.
// Exists to prevent duplicated controls and stale docking regressions in the shared topbar flow.

import { describe, expect, test } from "vitest";
import {
    dockButtonIntoSharedTopBar,
    isSharedTopBarHostActive,
    restoreButtonFromSharedTopBar,
    shouldShowSharedTopBar,
} from "./shared_topbar_builder.js";

describe("shouldShowSharedTopBar", () => {
    test("shows the shared topbar when either sidebar is hidden", () => {
        expect(
            shouldShowSharedTopBar({
                navbarVisible: false,
                filterbarVisible: true,
            })
        ).toBe(true);

        expect(
            shouldShowSharedTopBar({
                navbarVisible: true,
                filterbarVisible: false,
            })
        ).toBe(true);
    });

    test("keeps the shared topbar hidden when both sidebars are visible", () => {
        expect(
            shouldShowSharedTopBar({
                navbarVisible: true,
                filterbarVisible: true,
            })
        ).toBe(false);
    });

    test("allows the big-card override to force the shared topbar open", () => {
        expect(
            shouldShowSharedTopBar({
                navbarVisible: true,
                filterbarVisible: true,
                bigCardOpen: true,
                allowBigCardSearchBar: true,
            })
        ).toBe(true);
    });
});

describe("shared topbar button docking", () => {
    test("moves an existing button into the topbar host and restores it without cloning", () => {
        document.body.innerHTML = `
            <div class="body_content">
                <button id="showMenuButton">menu</button>
                <div class="content_div">
                    <div class="dataset-shared-topbar__slot"></div>
                </div>
            </div>
        `;

        const owner = { name: "demo" };
        const button = document.getElementById("showMenuButton");
        const originalParent = button.parentElement;
        const slot = document.querySelector(".dataset-shared-topbar__slot");

        expect(document.querySelectorAll("#showMenuButton")).toHaveLength(1);

        dockButtonIntoSharedTopBar(button, slot, owner);

        expect(document.querySelectorAll("#showMenuButton")).toHaveLength(1);
        expect(slot.firstElementChild).toBe(button);
        expect(button.classList.contains("shared-topbar-docked-button")).toBe(true);

        restoreButtonFromSharedTopBar(button, owner);

        expect(document.querySelectorAll("#showMenuButton")).toHaveLength(1);
        expect(button.parentElement).toBe(originalParent);
        expect(button.classList.contains("shared-topbar-docked-button")).toBe(false);
    });

    test("treats hidden content containers as inactive topbar hosts", () => {
        document.body.innerHTML = `
            <div class="content_div hidden">
                <div class="dataset-shared-topbar"></div>
            </div>
        `;

        const hiddenHost = document.querySelector(".dataset-shared-topbar");

        expect(isSharedTopBarHostActive(hiddenHost)).toBe(false);

        hiddenHost.closest(".content_div").classList.remove("hidden");

        expect(isSharedTopBarHostActive(hiddenHost)).toBe(true);
    });
});
