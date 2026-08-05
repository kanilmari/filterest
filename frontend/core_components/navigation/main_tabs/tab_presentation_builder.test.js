// tab_presentation_builder.test.js
// Verifies main-tab presentation presets and icon mask generation keep the historic tab geometry intact.
// Bridges pure tab presentation helpers with regression checks for nav-outline path selection.
// Exists to prevent future tab refactors from flattening the original nav silhouette.
// @vitest-environment jsdom

import { describe, expect, test } from "vitest";
import {
    buildNavTabsRightOffset,
    buildTabIconMaskImage,
    buildTabOutlinePresentation,
    buildTabPresentationState,
    shouldUseButtonTabsForView,
} from "./tab_presentation_builder.js";

describe("buildTabPresentationState", () => {
    test("uses right-opening tab presets for card-like views when the navbar has physical space", () => {
        expect(
            buildTabPresentationState({
                isNarrow: false,
                isNavbarOverlay: false,
                isActive: true,
                viewKey: "card",
            })
        ).toBe("tab-active");
        expect(
            buildTabPresentationState({
                isNarrow: false,
                isNavbarOverlay: false,
                isActive: false,
                viewKey: "card",
            })
        ).toBe("tab-inactive");
    });

    test("uses button presets for grid-like dataset views even with physical navbar space", () => {
        expect(
            buildTabPresentationState({
                isNarrow: false,
                isNavbarOverlay: false,
                isActive: true,
                viewKey: "table",
            })
        ).toBe("button-active");
        expect(
            buildTabPresentationState({
                isNarrow: false,
                isNavbarOverlay: false,
                isActive: true,
                viewKey: "normal",
            })
        ).toBe("button-active");
        expect(
            buildTabPresentationState({
                isNarrow: false,
                isNavbarOverlay: false,
                isActive: true,
                viewKey: "transposed",
            })
        ).toBe("button-active");
        expect(
            buildTabPresentationState({
                isNarrow: false,
                isNavbarOverlay: false,
                isActive: false,
                viewKey: "list",
            })
        ).toBe("button-inactive");
    });

    test("uses button presets in narrow views", () => {
        expect(
            buildTabPresentationState({
                isNarrow: true,
                isNavbarOverlay: false,
                isActive: false,
                viewKey: "card",
            })
        ).toBe("button-inactive");
    });
});

describe("shouldUseButtonTabsForView", () => {
    test("keeps the grid-view tab policy centralized", () => {
        expect(shouldUseButtonTabsForView("table")).toBe(true);
        expect(shouldUseButtonTabsForView("normal")).toBe(true);
        expect(shouldUseButtonTabsForView("list")).toBe(true);
        expect(shouldUseButtonTabsForView("transposed")).toBe(true);
        expect(shouldUseButtonTabsForView("card")).toBe(false);
    });
});

describe("buildNavTabsRightOffset", () => {
    test("only rounded physical-navbar tabs overlap the navbar edge", () => {
        expect(
            buildNavTabsRightOffset({
                isNarrow: false,
                isNavbarOverlay: false,
                viewKey: "card",
            })
        ).toBe("-2px");
        expect(
            buildNavTabsRightOffset({
                isNarrow: false,
                isNavbarOverlay: false,
                viewKey: "table",
            })
        ).toBe("0px");
        expect(
            buildNavTabsRightOffset({
                isNarrow: false,
                isNavbarOverlay: true,
                viewKey: "card",
            })
        ).toBe("0px");
        expect(
            buildNavTabsRightOffset({
                isNarrow: true,
                isNavbarOverlay: false,
                viewKey: "card",
            })
        ).toBe("0px");
    });
});

describe("buildTabOutlinePresentation", () => {
    function getPathMorphSignature(pathD) {
        return String(pathD || "")
            .replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, "#")
            .replace(/\s+/g, " ")
            .trim();
    }

    test("uses active cap and inset inactive paths for wide physical-navbar tabs", () => {
        const activeOutline = buildTabOutlinePresentation({
            isNarrow: false,
            isNavbarOverlay: false,
            isActive: true,
            viewKey: "card",
        });
        const inactiveOutline = buildTabOutlinePresentation({
            isNarrow: false,
            isNavbarOverlay: false,
            isActive: false,
            viewKey: "card",
        });

        expect(activeOutline.state).toBe("tab-active");
        expect(activeOutline.pathD.startsWith("M 300 1")).toBe(true);
        expect(activeOutline.pathD).toContain("L 297 1");
        expect(activeOutline.pathD).toContain("A 7 7 0 0 1 290 8");
        expect(activeOutline.pathD).toContain("L 63 8");
        expect(activeOutline.pathD).toContain("L 56 50");
        expect(activeOutline.pathD).toContain("A 7 7 0 0 0 63 57");
        expect(activeOutline.pathD).toContain("A 7 7 0 0 1 297 64");
        expect(activeOutline.pathD).toContain("L 300 64");
        expect(activeOutline.fill).toBe("var(--bg_color_2)");
        expect(activeOutline.strokeWidth).toBe("2");
        expect(activeOutline.viewBox).toBe("0 0 300 65");
        expect(activeOutline.width).toBe(300);
        expect(activeOutline.roundedLeft).toBe(56);

        expect(inactiveOutline.state).toBe("tab-inactive");
        expect(inactiveOutline.pathD.startsWith("M 297 1")).toBe(true);
        expect(inactiveOutline.pathD).toContain("A 7 7 0 0 1 290 8");
        expect(inactiveOutline.pathD).not.toContain("L 300 64");
        expect(inactiveOutline.fill).toBe("var(--bg_color_1_5)");
        expect(inactiveOutline.strokeWidth).toBe("2");
    });

    test("uses button outlines for table, list, and comparison views with physical navbar space", () => {
        const activeOutline = buildTabOutlinePresentation({
            isNarrow: false,
            isNavbarOverlay: false,
            isActive: true,
            viewKey: "table",
        });

        expect(activeOutline.state).toBe("button-active");
        expect(activeOutline.pathD).toContain("A 0 0");
        expect(activeOutline.pathD.startsWith("M 320 1")).toBe(true);
        expect(activeOutline.pathD).toContain("L -20 1");
        expect(getPathMorphSignature(activeOutline.pathD)).toBe(
            getPathMorphSignature(buildTabOutlinePresentation({
                isNarrow: false,
                isNavbarOverlay: false,
                isActive: true,
                viewKey: "card",
            }).pathD)
        );
        expect(activeOutline.fill).toBe("none");
        expect(activeOutline.strokeWidth).toBe("2");
        expect(activeOutline.viewBox).toBe("0 0 300 65");
    });

    test("keeps full-width button geometry in narrow and overlay views", () => {
        const inactiveButton = buildTabOutlinePresentation({
            isNarrow: true,
            isNavbarOverlay: false,
            isActive: false,
            viewKey: "card",
        });
        const activeButton = buildTabOutlinePresentation({
            isNarrow: false,
            isNavbarOverlay: true,
            isActive: true,
            viewKey: "card",
        });

        expect(inactiveButton.state).toBe("button-inactive");
        expect(inactiveButton.pathD).toContain("A 0 0");
        expect(inactiveButton.fill).toBe("none");
        expect(inactiveButton.strokeWidth).toBe("2");

        expect(activeButton.state).toBe("button-active");
        expect(activeButton.pathD).toBe(inactiveButton.pathD);
        expect(activeButton.fill).toBe("none");
        expect(activeButton.strokeWidth).toBe("2");
    });
});

describe("buildTabIconMaskImage", () => {
    test("returns an encoded SVG mask URL instead of raw DOM markup", () => {
        const maskImage = buildTabIconMaskImage("M0 0h10v10H0Z");

        expect(maskImage.startsWith('url("data:image/svg+xml;utf8,')).toBe(true);
        expect(maskImage.includes("%3Csvg")).toBe(true);
        expect(maskImage.includes("M0%200h10v10H0Z")).toBe(true);
        expect(maskImage.includes("<path")).toBe(false);
    });
});
