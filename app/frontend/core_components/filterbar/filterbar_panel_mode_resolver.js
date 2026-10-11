// filterbar_panel_mode_resolver.js
// Resolves the configured filterbar presentation mode.
// Connects the shared dataset filterbar to its existing component builders.
// Keeps one implementation and a bounded lifetime for each mounted surface.

export const FILTERBAR_PANEL_MODES = Object.freeze({
    MORPHING: "morphing",
    INLINE_HERO: "inline-hero",
});
const DEFAULT_FILTERBAR_PANEL_MODE = FILTERBAR_PANEL_MODES.MORPHING;

export function resolveFilterbarPanelMode(modeRaw) {
    const normalizedMode = String(modeRaw || "")
        .trim()
        .toLowerCase();

    if (
        normalizedMode === FILTERBAR_PANEL_MODES.INLINE_HERO ||
        normalizedMode === "content-hero"
    ) {
        return FILTERBAR_PANEL_MODES.INLINE_HERO;
    }

    return DEFAULT_FILTERBAR_PANEL_MODE;
}

