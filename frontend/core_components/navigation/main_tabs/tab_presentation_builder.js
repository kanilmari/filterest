// tab_presentation_builder.js
// Builds the presentation metadata used by main navigation tabs.
// Bridges main-tab state (active/overlay/narrow) with the historic outline geometry and icon masks.
// Exists to keep tab-shape decisions centralised so the nav can preserve its original visual language.

const TAB_ICON_SVG_PREFIX =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path fill="black" d="';
const TAB_ICON_SVG_SUFFIX = '"/></svg>';

const NAVTAB_DEFAULT_NAVBAR_WIDTH = 300;
const NAVTAB_ROUNDED_WIDTH = 244;
const NAVTAB_ROW_HEIGHT = 65;
const NAVTAB_CORNER_RADIUS = 7;
const NAVTAB_BUTTON_OVERSHOOT = 20;
const NAVTAB_ACTIVE_RIGHT_CAP_WIDTH = 3;
const NAVTAB_NAVBAR_EDGE_OVERLAP = 2;
const NAVTAB_STROKE_WIDTH = 2;
const NAVTAB_STROKE_INSET = NAVTAB_STROKE_WIDTH / 2;
const BUTTON_PRESENTATION_VIEW_KEYS = new Set(["table", "normal", "list", "transposed"]);

function formatPathNumber(value) {
    if (!Number.isFinite(value)) {
        return "0";
    }

    return Number(value.toFixed(3)).toString();
}

function normalizeNavbarWidth(navbarWidth) {
    const width = Number.parseFloat(navbarWidth);
    return Number.isFinite(width) && width > 0
        ? width
        : NAVTAB_DEFAULT_NAVBAR_WIDTH;
}

function buildCompatibleTabPath({
    isActive,
    isButton,
    navbarWidth = NAVTAB_DEFAULT_NAVBAR_WIDTH,
}) {
    const width = normalizeNavbarWidth(navbarWidth);
    const roundedWidth = Math.min(NAVTAB_ROUNDED_WIDTH, width);
    const left = isButton ? -NAVTAB_BUTTON_OVERSHOOT : width - roundedWidth;
    const curveRight = isButton
        ? width + NAVTAB_BUTTON_OVERSHOOT
        : width - NAVTAB_ACTIVE_RIGHT_CAP_WIDTH;
    const right = isButton || isActive
        ? width + (isButton ? NAVTAB_BUTTON_OVERSHOOT : 0)
        : curveRight;
    const radius = isButton ? 0 : NAVTAB_CORNER_RADIUS;
    const top = NAVTAB_STROKE_INSET;
    const bottom = NAVTAB_ROW_HEIGHT - NAVTAB_STROKE_INSET;
    const faceTop = top + radius;
    const faceBottom = bottom - radius;
    const upperArcBaseline = faceTop + radius;
    const lowerArcBaseline = faceBottom - radius;
    const leftInner = left + radius;
    const curveRightInner = curveRight - radius;

    return [
        "M", right, top,
        "L", curveRight, top,
        "A", radius, radius, 0, 0, 1, curveRightInner, faceTop,
        "L", leftInner, faceTop,
        "A", radius, radius, 0, 0, 0, left, upperArcBaseline,
        "L", left, lowerArcBaseline,
        "A", radius, radius, 0, 0, 0, leftInner, faceBottom,
        "L", curveRightInner, faceBottom,
        "A", radius, radius, 0, 0, 1, curveRight, bottom,
        "L", right, bottom,
        "L", right, top,
        "Z",
    ].map((part) => (
        typeof part === "number" ? formatPathNumber(part) : part
    )).join(" ");
}

export function shouldUseButtonTabsForView(viewKey) {
    return BUTTON_PRESENTATION_VIEW_KEYS.has(String(viewKey || "").trim());
}

export function buildTabPresentationState({ isNarrow, isNavbarOverlay, isActive, viewKey }) {
    if (!isNarrow && !isNavbarOverlay && !shouldUseButtonTabsForView(viewKey)) {
        return isActive ? "tab-active" : "tab-inactive";
    }

    return isActive ? "button-active" : "button-inactive";
}

export function buildNavTabsRightOffset({ isNarrow, isNavbarOverlay, viewKey }) {
    if (isNarrow || isNavbarOverlay) {
        return "0px";
    }

    return shouldUseButtonTabsForView(viewKey)
        ? "0px"
        : `-${NAVTAB_NAVBAR_EDGE_OVERLAP}px`;
}

export function buildTabOutlinePresentation({
    isNarrow,
    isNavbarOverlay,
    isActive,
    navbarWidth = NAVTAB_DEFAULT_NAVBAR_WIDTH,
    viewKey,
}) {
    const state = buildTabPresentationState({
        isNarrow,
        isNavbarOverlay,
        isActive,
        viewKey,
    });
    const isButton = state.startsWith("button");
    const width = normalizeNavbarWidth(navbarWidth);
    const roundedWidth = Math.min(NAVTAB_ROUNDED_WIDTH, width);
    const basePresentation = {
        height: NAVTAB_ROW_HEIGHT,
        pathD: buildCompatibleTabPath({ isActive, isButton, navbarWidth: width }),
        roundedLeft: width - roundedWidth,
        state,
        strokeWidth: String(NAVTAB_STROKE_WIDTH),
        viewBox: `0 0 ${formatPathNumber(width)} ${NAVTAB_ROW_HEIGHT}`,
        width,
    };

    if (state === "tab-active") {
        return {
            ...basePresentation,
            fill: "var(--bg_color_2)",
        };
    }

    if (state === "tab-inactive") {
        return {
            ...basePresentation,
            fill: "var(--bg_color_1_5)",
        };
    }

    return {
        ...basePresentation,
        fill: "none",
    };
}

export function buildTabIconMaskImage(iconPathD) {
    const svgMarkup = `${TAB_ICON_SVG_PREFIX}${iconPathD}${TAB_ICON_SVG_SUFFIX}`;
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(svgMarkup)}")`;
}
