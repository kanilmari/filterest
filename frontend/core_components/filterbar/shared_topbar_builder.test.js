// @vitest-environment jsdom
// shared_topbar_builder.test.js
// Verifies shared topbar visibility rules for persistent dataset topbars.
// Bridges hidden tab containers, navbar/filter visibility, and active topbar hosts.
// Exists to prevent inactive dataset bars from participating in shared layout state.

import { describe, expect, test } from "vitest";
import {
    isSharedTopBarHostActive,
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

    test("suppresses the repeated flat topbar while the inline hero is visible", () => {
        expect(
            shouldShowSharedTopBar({
                navbarVisible: true,
                filterbarVisible: false,
                inlineHeroVisible: true,
            })
        ).toBe(false);

        expect(
            shouldShowSharedTopBar({
                navbarVisible: true,
                filterbarVisible: false,
                inlineHeroVisible: false,
            })
        ).toBe(true);
    });
});

describe("shared topbar host activity", () => {
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
