// ui_config.js
// Centralised UI configuration constants for layout breakpoints and feature toggles.
// Bridges per-component defaults into a single authoritative source of truth.
// Exists to prevent magic numbers and flag values from scattering across feature modules.

export const LAYOUT_BREAKPOINTS = Object.freeze({
    navbarCollapsed: 1850,
    filterbarOverlay: 1100,
    cardStack: 1060,
    // 1060px card stack threshold + 450px fixed filterbar rail + 40px card-list padding.
    // Wide cards start only when they stay wide after the filterbar appears.
    cardViewportStack: 1550,
});

export const LAYOUT_DIMENSIONS = Object.freeze({
    filterbarColumn: 450,
});

export const NAVBAR_WIDTH_THRESHOLD = LAYOUT_BREAKPOINTS.navbarCollapsed;
export const NAVTAB_BUTTON_BREAKPOINT_PX = LAYOUT_BREAKPOINTS.cardStack;
export const FILTERBAR_OVERLAY_BREAKPOINT_PX =
    LAYOUT_BREAKPOINTS.filterbarOverlay;
export const CARD_STACK_BREAKPOINT_PX = LAYOUT_BREAKPOINTS.cardStack;
export const CARD_VIEWPORT_STACK_BREAKPOINT_PX =
    LAYOUT_BREAKPOINTS.cardViewportStack;
export const FILTERBAR_COLUMN_WIDTH_PX = LAYOUT_DIMENSIONS.filterbarColumn;

export function isCardStackViewport(viewportWidth = window.innerWidth) {
    return viewportWidth <= CARD_VIEWPORT_STACK_BREAKPOINT_PX;
}

export function resolveCardMediaFolder(measuredWidth, { basis = "container" } = {}) {
    const hasExplicitMeasurement = Number.isFinite(measuredWidth);
    const width = hasExplicitMeasurement ? measuredWidth : window.innerWidth;
    const threshold =
        !hasExplicitMeasurement || basis === "viewport"
            ? CARD_VIEWPORT_STACK_BREAKPOINT_PX
            : CARD_STACK_BREAKPOINT_PX;
    return width <= threshold ? "1000" : "300";
}

export function syncGlobalLayoutCssVariables(
    root = typeof document !== "undefined" ? document.documentElement : null
) {
    if (!root) return;

    root.style.setProperty(
        "--navbar-breakpoint",
        `${NAVBAR_WIDTH_THRESHOLD}px`
    );
    root.style.setProperty(
        "--filterbar-breakpoint",
        `${FILTERBAR_OVERLAY_BREAKPOINT_PX}px`
    );
    root.style.setProperty(
        "--card-stack-breakpoint",
        `${CARD_STACK_BREAKPOINT_PX}px`
    );
    root.style.setProperty(
        "--card-viewport-stack-breakpoint",
        `${CARD_VIEWPORT_STACK_BREAKPOINT_PX}px`
    );
    root.style.setProperty(
        "--filterbar-column-width",
        `${FILTERBAR_COLUMN_WIDTH_PX}px`
    );
}

syncGlobalLayoutCssVariables();

export const MINIFY_PROJECT = true;
export const always_show_column_sort_buttons = true;
export const show_related_items_on_big_cards = true;
export const show_child_items_on_big_cards = show_related_items_on_big_cards;
export const always_show_empty_fields_on_cards = true;
export const ROW_ARTICLE_RELATION_DETAILS_MODES = Object.freeze({
    HIDE: "hide",
    NAMES_AT_END: "names_at_end",
    IDS_AND_NAMES_AT_END: "ids_and_names_at_end",
});
// Controls FK-backed fields whose card_element is empty or starts with details.
// Keep relations out of ordinary article details by default; linked-object and
// related-row sections remain the intentional surfaces for relationship data.
export const row_article_relation_details_mode =
    ROW_ARTICLE_RELATION_DETAILS_MODES.HIDE;
export const show_search_and_filter_button = false; //a.k.a. "Advanced search" button
export const show_search_only_bar_in_big_card_view = true; // Show the flat top search bar when a big card is open
export const show_more_button_on_cards = true;
// Global Favefox filter section layout mode.
// Options:
// - "accordion": current two-part filter-header/filter-content accordion
// - "inline-open": headers stay visible as static labels and filter controls stay directly open
export const FAVEFOX_FILTER_LAYOUT_MODE = "accordion";

// Global filterbar panel mode.
// Options:
// - "morphing": wide hero at the top, compact sidebar after scrolling
// - "inline-hero": hero rendered inside scrollable content, fixed filterbar stays compact
export const FILTERBAR_PANEL_MODE = "inline-hero";

// Compact filterbar section visibility toggles.
// These keep the code path available without rendering rarely needed sections.
export const show_filterbar_search_overview_section = false;
export const show_filterbar_search_basic_controls_section = false;

// Global filterbar AI chat mode.
// Options:
// - "api_tools": canonical API-first read facade via /api/app/ai-chat/query
// The legacy SSE filterbar chat rollback path has been removed from the frontend.
// Keep this constant as the compatibility seam for the API-first chat facade.
export const FILTERBAR_AI_CHAT_MODE = "api_tools";
