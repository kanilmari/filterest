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

    test("allows the selected article view to force the shared topbar open", () => {
        expect(
            shouldShowSharedTopBar({
                navbarVisible: true,
                filterbarVisible: true,
                articleViewActive: true,
                allowBigCardSearchBar: true,
            })
        ).toBe(true);
    });

    test("keeps the article view's header even when no row can open", () => {
        // An article view whose search matches nothing never opens a row, so no
        // article-open event ever arrives. The bar must still carry the dataset
        // title and search field instead of hiding itself.
        expect(
            shouldShowSharedTopBar({
                navbarVisible: true,
                filterbarVisible: true,
                articleViewActive: true,
                allowBigCardSearchBar: true,
                inlineHeroVisible: false,
            })
        ).toBe(true);
    });

    test("leaves the other views with both sidebars unchanged", () => {
        expect(
            shouldShowSharedTopBar({
                navbarVisible: true,
                filterbarVisible: true,
                articleViewActive: false,
                allowBigCardSearchBar: true,
            })
        ).toBe(false);
    });

    test("honours an installation that forbids the flat bar in the article view", () => {
        expect(
            shouldShowSharedTopBar({
                navbarVisible: true,
                filterbarVisible: true,
                articleViewActive: true,
                allowBigCardSearchBar: false,
            })
        ).toBe(false);
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
