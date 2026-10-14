// floating_panel_placement.js
// Chooses the visible side and height budget for anchored floating panels.
// Shares the multiselect popup's measured placement rule with the language menu.
// Keeps viewport fitting independent of content, styling and interaction policy.

/**
 * Prefer below when measured content fits; otherwise use the larger side.
 * Coordinates use the visual viewport within the layout viewport, as fixed overlays do.
 */
export function measureFloatingPanelPlacement({
    anchorRect, requiredHeight, viewportHeight, layoutHeight = viewportHeight,
    offsetTop = 0, margin = 8, gap = 4,
}) {
    const visibleHeight = Math.max(0, viewportHeight - margin * 2);
    const anchorVisible = anchorRect.bottom > offsetTop && anchorRect.top < offsetTop + viewportHeight;
    const below = Math.max(0, offsetTop + viewportHeight - anchorRect.bottom - margin - gap);
    const above = Math.max(0, anchorRect.top - offsetTop - margin - gap);
    const upward = below < requiredHeight && above > below;
    return {
        upward,
        anchorVisible,
        visibleHeight,
        availableHeight: Math.min(upward ? above : below, visibleHeight),
        top: Math.max(anchorRect.bottom + gap, offsetTop + margin),
        bottom: layoutHeight - Math.min(anchorRect.top - gap, offsetTop + viewportHeight - margin),
    };
}
