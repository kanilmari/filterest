// floating_panel_placement.test.js
// Verifies the shared measured placement decision for floating menus.
// Connects anchor and viewport geometry to direction and scrolling budgets.
// Protects the multiselect rule as the language menu becomes a second consumer.

import { expect, test } from 'vitest';
import { measureFloatingPanelPlacement } from './floating_panel_placement.js';

test.each([
    ['room below', 100, 144, 667, 200, false, 505],
    ['phone menu at the bottom', 548, 592, 667, 206, true, 530],
    ['neither side fits; above is larger', 210, 254, 400, 300, true, 192],
    ['neither side fits; below is larger', 140, 184, 400, 300, false, 198],
    ['equal sides prefer below', 178, 222, 400, 300, false, 160],
    ['desktop retains downward placement', 50, 94, 900, 206, false, 788],
])('%s', (_name, top, bottom, viewportHeight, requiredHeight, upward, availableHeight) => {
    const placement = measureFloatingPanelPlacement({
        anchorRect: { top, bottom }, viewportHeight, requiredHeight, gap: 10,
    });
    expect(placement.upward).toBe(upward);
    expect(placement.availableHeight).toBe(availableHeight);
    const panelHeight = Math.min(requiredHeight, placement.availableHeight);
    const panelTop = upward ? viewportHeight - placement.bottom - panelHeight : placement.top;
    expect(panelTop).toBeGreaterThanOrEqual(8);
    expect(panelTop + panelHeight).toBeLessThanOrEqual(viewportHeight - 8);
});

test('a visual viewport offset bounds both the side budget and fixed bottom anchor', () => {
    const placement = measureFloatingPanelPlacement({ anchorRect: { top: 480, bottom: 524 },
        requiredHeight: 300, viewportHeight: 400, layoutHeight: 900, offsetTop: 150 });
    expect(placement.upward).toBe(true);
    expect(placement.availableHeight).toBe(318);
    expect(placement.bottom).toBe(424);
});

test('offscreen anchors cannot supply more height than the visible viewport', () => {
    const placement = measureFloatingPanelPlacement({ anchorRect: { top: 800, bottom: 844 },
        requiredHeight: 200, viewportHeight: 400 });
    expect(placement.anchorVisible).toBe(false);
    expect(placement.availableHeight).toBe(384);
    expect(placement.bottom).toBe(8);
});
