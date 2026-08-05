// filterbar_visibility_resolver.test.js
// Verifies the responsive filterbar visibility resolver used by the unified sidebar builder.
// Bridges pure breakpoint/user-choice inputs with regression-safe show/hide expectations.
// Exists to keep narrow-mode auto-collapse behavior stable without requiring a full DOM render.

import { describe, expect, test } from "vitest";
import {
    buildInitialResponsivePanelState,
    resolveResponsivePanelVisibilityState,
} from "./filterbar_visibility_resolver.js";

describe("buildInitialResponsivePanelState", () => {
    test("keeps a stored visible preference open on narrow screens after reload", () => {
        expect(
            buildInitialResponsivePanelState({
                storedVisibility: true,
                dbDefault: undefined,
                isNarrowScreen: true,
            })
        ).toEqual({
            shouldShowPanel: true,
            panelManuallyHidden: false,
            autoCollapsedForNarrow: false,
        });
    });

    test("treats a stored hidden preference as manually hidden", () => {
        expect(
            buildInitialResponsivePanelState({
                storedVisibility: false,
                dbDefault: true,
                isNarrowScreen: false,
            })
        ).toEqual({
            shouldShowPanel: false,
            panelManuallyHidden: true,
            autoCollapsedForNarrow: false,
        });
    });

    test("auto-collapses narrow screens when there is no stored preference", () => {
        expect(
            buildInitialResponsivePanelState({
                storedVisibility: null,
                dbDefault: undefined,
                isNarrowScreen: true,
            })
        ).toEqual({
            shouldShowPanel: false,
            panelManuallyHidden: false,
            autoCollapsedForNarrow: true,
        });
    });

    test("auto-collapses narrow screens even when the db default is visible", () => {
        expect(
            buildInitialResponsivePanelState({
                storedVisibility: null,
                dbDefault: true,
                isNarrowScreen: true,
            })
        ).toEqual({
            shouldShowPanel: false,
            panelManuallyHidden: false,
            autoCollapsedForNarrow: true,
        });
    });

    test("keeps a db-default hidden panel manually hidden on narrow screens", () => {
        expect(
            buildInitialResponsivePanelState({
                storedVisibility: null,
                dbDefault: false,
                isNarrowScreen: true,
            })
        ).toEqual({
            shouldShowPanel: false,
            panelManuallyHidden: true,
            autoCollapsedForNarrow: false,
        });
    });

    test("treats an undefined stored preference as unset", () => {
        expect(
            buildInitialResponsivePanelState({
                storedVisibility: undefined,
                dbDefault: undefined,
                isNarrowScreen: false,
            })
        ).toEqual({
            shouldShowPanel: true,
            panelManuallyHidden: false,
            autoCollapsedForNarrow: false,
        });
    });
});

describe("resolveResponsivePanelVisibilityState", () => {
    test("auto-collapses a visible panel when the viewport first enters narrow mode", () => {
        expect(
            resolveResponsivePanelVisibilityState({
                wasNarrowScreen: false,
                isNarrowScreen: true,
                panelManuallyHidden: false,
                autoCollapsedForNarrow: false,
                panelHidden: false,
            })
        ).toEqual({
            shouldShowPanel: false,
            autoCollapsedForNarrow: true,
        });
    });

    test("reopens an auto-collapsed panel after returning to wide mode", () => {
        expect(
            resolveResponsivePanelVisibilityState({
                wasNarrowScreen: true,
                isNarrowScreen: false,
                panelManuallyHidden: false,
                autoCollapsedForNarrow: true,
                panelHidden: true,
            })
        ).toEqual({
            shouldShowPanel: true,
            autoCollapsedForNarrow: false,
        });
    });

    test("keeps the panel hidden on narrow screens after an explicit user hide", () => {
        expect(
            resolveResponsivePanelVisibilityState({
                wasNarrowScreen: true,
                isNarrowScreen: true,
                panelManuallyHidden: true,
                autoCollapsedForNarrow: false,
                panelHidden: true,
            })
        ).toEqual({
            shouldShowPanel: false,
            autoCollapsedForNarrow: false,
        });
    });

    test("keeps the panel visible on narrow screens after the user reopens it", () => {
        expect(
            resolveResponsivePanelVisibilityState({
                wasNarrowScreen: true,
                isNarrowScreen: true,
                panelManuallyHidden: false,
                autoCollapsedForNarrow: false,
                panelHidden: false,
            })
        ).toEqual({
            shouldShowPanel: true,
            autoCollapsedForNarrow: false,
        });
    });
});
