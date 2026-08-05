// filterbar_visibility_resolver.js
// Resolves whether the responsive filterbar should stay visible or collapse at the current breakpoint.
// Bridges viewport-width state and user-hide state with the filterbar builder's show/hide operations.
// Exists to keep narrow-mode auto-collapse rules testable instead of burying them inside DOM event handlers.

import { resolveInitialVisibility } from "./filterbar_engine/filterbar_visibility_handler_helpers.js";

export function buildInitialResponsivePanelState({
    storedVisibility,
    dbDefault,
    isNarrowScreen,
}) {
    const normalizedStoredVisibility = storedVisibility ?? null;
    const hasStoredVisibility = normalizedStoredVisibility !== null;
    const shouldAutoCollapseForNarrow =
        isNarrowScreen && !hasStoredVisibility && dbDefault !== false;

    return {
        shouldShowPanel: shouldAutoCollapseForNarrow
            ? false
            : resolveInitialVisibility(
                  normalizedStoredVisibility,
                  dbDefault,
                  !isNarrowScreen
              ),
        panelManuallyHidden:
            normalizedStoredVisibility === false ||
            (normalizedStoredVisibility === null && dbDefault === false),
        autoCollapsedForNarrow: shouldAutoCollapseForNarrow,
    };
}

export function resolveResponsivePanelVisibilityState({
    wasNarrowScreen,
    isNarrowScreen,
    panelManuallyHidden,
    autoCollapsedForNarrow,
    panelHidden,
}) {
    if (isNarrowScreen) {
        if (panelManuallyHidden) {
            return {
                shouldShowPanel: false,
                autoCollapsedForNarrow: false,
            };
        }

        if (!wasNarrowScreen && !panelHidden) {
            return {
                shouldShowPanel: false,
                autoCollapsedForNarrow: true,
            };
        }

        if (autoCollapsedForNarrow) {
            return {
                shouldShowPanel: false,
                autoCollapsedForNarrow: true,
            };
        }

        return {
            shouldShowPanel: true,
            autoCollapsedForNarrow: false,
        };
    }

    return {
        shouldShowPanel: !panelManuallyHidden,
        autoCollapsedForNarrow: false,
    };
}
