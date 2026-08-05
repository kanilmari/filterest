// main_tab_active_state.js
// Synchronizes the main SVG tab active classes and outline geometry.
// Bridges navigation state, navbar layout state, and tab presentation SVG paths.
// Exists so dataset tabs only look active when their own dataset view is active.

import {
    NAVBAR_WIDTH_THRESHOLD,
    NAVTAB_BUTTON_BREAKPOINT_PX,
} from "../../../ui_config.js";
import {
    buildNavTabsRightOffset,
    buildTabOutlinePresentation,
} from "./tab_presentation_builder.js";

const NAVTAB_OUTLINE_MORPH_ATTRIBUTE = "d";
const NAVTAB_PRESENTATION_DURATION_PROPERTY = "--navtab-presentation-transition-duration";
const DEFAULT_NAVTAB_PRESENTATION_DURATION_MS = 150;
const DEFAULT_NAVTAB_NAVBAR_WIDTH = 300;
const PATH_NUMBER_PATTERN = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;
const NAVTAB_MORPH_PRECISION = 3;
const activeOutlineMorphs = new WeakMap();

function isNavbarUsingOverlayLayout() {
    if (window.innerWidth < NAVBAR_WIDTH_THRESHOLD) {
        return true;
    }

    const navbar = document.getElementById("navbar");
    const tabsContainer = document.getElementById("tabs_container");

    return Boolean(
        navbar?.classList.contains("collapsed") ||
        tabsContainer?.classList.contains("navbar_hidden")
    );
}

function parseDurationToMs(rawValue) {
    const value = String(rawValue || "").trim();
    if (!value) {
        return DEFAULT_NAVTAB_PRESENTATION_DURATION_MS;
    }

    if (value.endsWith("ms")) {
        const milliseconds = Number.parseFloat(value);
        return Number.isFinite(milliseconds)
            ? Math.max(0, milliseconds)
            : DEFAULT_NAVTAB_PRESENTATION_DURATION_MS;
    }

    if (value.endsWith("s")) {
        const seconds = Number.parseFloat(value);
        return Number.isFinite(seconds)
            ? Math.max(0, seconds * 1000)
            : DEFAULT_NAVTAB_PRESENTATION_DURATION_MS;
    }

    const numericValue = Number.parseFloat(value);
    return Number.isFinite(numericValue)
        ? Math.max(0, numericValue)
        : DEFAULT_NAVTAB_PRESENTATION_DURATION_MS;
}

function getNavTabPresentationDurationMs() {
    const navbar = document.getElementById("navbar");
    if (!navbar) {
        return DEFAULT_NAVTAB_PRESENTATION_DURATION_MS;
    }

    const computedDuration = window
        .getComputedStyle(navbar)
        .getPropertyValue(NAVTAB_PRESENTATION_DURATION_PROPERTY);
    return parseDurationToMs(computedDuration);
}

function getNavbarWidthPx() {
    const navbar = document.getElementById("navbar");
    if (!navbar) {
        return DEFAULT_NAVTAB_NAVBAR_WIDTH;
    }

    const rectWidth = navbar.getBoundingClientRect?.().width;
    if (Number.isFinite(rectWidth) && rectWidth > 0) {
        return rectWidth;
    }

    const computedWidth = Number.parseFloat(window.getComputedStyle(navbar).width);
    return Number.isFinite(computedWidth) && computedWidth > 0
        ? computedWidth
        : DEFAULT_NAVTAB_NAVBAR_WIDTH;
}

function isReducedMotionPreferred() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
}

function getPathMorphSignature(pathD) {
    return String(pathD || "")
        .replace(PATH_NUMBER_PATTERN, "#")
        .replace(/\s+/g, " ")
        .trim();
}

function arePathMorphCompatible(fromPathD, toPathD) {
    return Boolean(fromPathD && toPathD)
        && getPathMorphSignature(fromPathD) === getPathMorphSignature(toPathD);
}

function parsePathMorphParts(pathD) {
    const normalizedPathD = String(pathD || "");
    return {
        textParts: normalizedPathD.split(PATH_NUMBER_PATTERN),
        numbers: (normalizedPathD.match(PATH_NUMBER_PATTERN) || []).map(Number),
    };
}

function formatMorphNumber(value) {
    if (!Number.isFinite(value)) {
        return "0";
    }

    return Number(value.toFixed(NAVTAB_MORPH_PRECISION)).toString();
}

function buildInterpolatedPathD(fromParts, toParts, progress) {
    return fromParts.textParts.reduce((pathD, textPart, index) => {
        const fromNumber = fromParts.numbers[index];
        const toNumber = toParts.numbers[index];

        if (fromNumber === undefined || toNumber === undefined) {
            return `${pathD}${textPart}`;
        }

        const currentNumber = fromNumber + ((toNumber - fromNumber) * progress);
        return `${pathD}${textPart}${formatMorphNumber(currentNumber)}`;
    }, "");
}

function getAnimationNow() {
    return window.performance?.now?.() ?? Date.now();
}

function shouldAnimatePresentationTransition(durationMs) {
    return durationMs > 0
        && !isReducedMotionPreferred()
        && typeof window.requestAnimationFrame === "function";
}

function cancelActiveOutlineMorph(outlinePath) {
    const activeMorph = activeOutlineMorphs.get(outlinePath);
    if (!activeMorph) {
        return;
    }

    if (
        activeMorph.frameId !== null
        && typeof window.cancelAnimationFrame === "function"
    ) {
        window.cancelAnimationFrame(activeMorph.frameId);
    }

    activeOutlineMorphs.delete(outlinePath);
}

function getCurrentOutlinePathD(outlinePath) {
    const activeMorph = activeOutlineMorphs.get(outlinePath);
    if (!activeMorph) {
        return outlinePath.getAttribute(NAVTAB_OUTLINE_MORPH_ATTRIBUTE) || "";
    }

    const elapsedMs = getAnimationNow() - activeMorph.startTime;
    const rawProgress = activeMorph.durationMs > 0
        ? Math.min(1, Math.max(0, elapsedMs / activeMorph.durationMs))
        : 1;
    return buildInterpolatedPathD(activeMorph.fromParts, activeMorph.toParts, rawProgress);
}

// SVG `d` changes do not transition through CSS, so interpolate the compatible
// path numbers directly and keep the visible path at the previous shape on frame zero.
function applyOutlinePathWithMorph(outlinePath, nextPathD) {
    const currentPathD = getCurrentOutlinePathD(outlinePath);
    cancelActiveOutlineMorph(outlinePath);

    if (currentPathD === nextPathD) {
        outlinePath.setAttribute(NAVTAB_OUTLINE_MORPH_ATTRIBUTE, nextPathD);
        return;
    }

    const durationMs = getNavTabPresentationDurationMs();
    const shouldMorph = shouldAnimatePresentationTransition(durationMs)
        && arePathMorphCompatible(currentPathD, nextPathD);

    if (!shouldMorph) {
        outlinePath.setAttribute(NAVTAB_OUTLINE_MORPH_ATTRIBUTE, nextPathD);
        return;
    }

    const fromParts = parsePathMorphParts(currentPathD);
    const toParts = parsePathMorphParts(nextPathD);
    const morphState = {
        durationMs,
        frameId: null,
        fromParts,
        startTime: getAnimationNow(),
        toParts,
    };

    outlinePath.setAttribute(NAVTAB_OUTLINE_MORPH_ATTRIBUTE, currentPathD);
    activeOutlineMorphs.set(outlinePath, morphState);

    const animateFrame = (timestamp) => {
        if (activeOutlineMorphs.get(outlinePath) !== morphState) {
            return;
        }

        const elapsedMs = timestamp - morphState.startTime;
        const rawProgress = Math.min(1, Math.max(0, elapsedMs / durationMs));
        outlinePath.setAttribute(
            NAVTAB_OUTLINE_MORPH_ATTRIBUTE,
            buildInterpolatedPathD(fromParts, toParts, rawProgress)
        );

        if (rawProgress < 1) {
            morphState.frameId = window.requestAnimationFrame(animateFrame);
            return;
        }

        outlinePath.setAttribute(NAVTAB_OUTLINE_MORPH_ATTRIBUTE, nextPathD);
        activeOutlineMorphs.delete(outlinePath);
    };

    morphState.frameId = window.requestAnimationFrame(animateFrame);
}

function getActiveMainTabId() {
    return document.querySelector(".navtablinks.active")?.dataset?.id || "";
}

// Applies the active presentation to the dataset tab that owns the current view.
// Operates between nav tab DOM buttons, persisted view mode, and SVG outline paths.
// Prevents non-dataset tool views from leaving stale SVG tabs visually open.
export function applyMainTabActiveState(activeTabId = "", options = {}) {
    const normalizedActiveTabId = String(activeTabId || "").trim();
    const viewDatasetName = String(options.viewDatasetName ?? normalizedActiveTabId).trim();
    const isNarrow = window.innerWidth <= NAVTAB_BUTTON_BREAKPOINT_PX;
    const isNavbarOverlay = isNavbarUsingOverlayLayout();
    const viewKey = viewDatasetName
        ? localStorage.getItem(`${viewDatasetName}_view`) || ""
        : "";
    const navTabs = document.querySelector(".navtabs");
    const allTabButtons = Array.from(document.querySelectorAll(".navtablinks"));
    const navbarWidth = getNavbarWidthPx();

    if (navTabs) {
        navTabs.style.right = buildNavTabsRightOffset({
            isNarrow,
            isNavbarOverlay,
            viewKey,
        });
    }

    let activeButton = null;

    allTabButtons.forEach((btn) => {
        const isActive = Boolean(
            normalizedActiveTabId &&
            btn.dataset.id === normalizedActiveTabId
        );
        btn.classList.toggle("active", isActive);
        if (isActive) {
            activeButton = btn;
        }

        const presentation = buildTabOutlinePresentation({
            isNarrow,
            isNavbarOverlay,
            isActive,
            navbarWidth,
            viewKey,
        });
        btn.dataset.tabPresentation = presentation.state;
        const outlineSvg = btn.querySelector(".svg-container");
        const outlinePath = outlineSvg?.querySelector("path");
        btn.style.setProperty(
            "--navtab-rounded-left-offset",
            `${formatMorphNumber(presentation.roundedLeft)}px`
        );
        if (outlineSvg) {
            outlineSvg.setAttribute("viewBox", presentation.viewBox);
            outlineSvg.setAttribute("width", formatMorphNumber(presentation.width));
            outlineSvg.setAttribute("height", formatMorphNumber(presentation.height));
        }

        if (outlinePath) {
            applyOutlinePathWithMorph(outlinePath, presentation.pathD);
            outlinePath.setAttribute("fill", presentation.fill);
            outlinePath.setAttribute("stroke-width", presentation.strokeWidth);
        }
    });

    return activeButton;
}

// Clears active SVG-tab state while preserving the current navbar presentation mode.
// Operates between custom/tool navigation routes and the shared tab presentation builder.
// Exists so admin/user tool views cannot inherit an unrelated dataset tab highlight.
export function clearMainTabActiveState(viewDatasetName = "") {
    return applyMainTabActiveState("", { viewDatasetName });
}

// Recomputes SVG-tab geometry after layout or view-mode changes without changing ownership.
// Operates between the currently active tab, local view preference, and tab outline SVG.
// Keeps navbar overlay and button-mode transitions aligned with the current active dataset.
export function refreshMainTabPresentation(viewDatasetName = "") {
    const activeTabId = getActiveMainTabId();
    return applyMainTabActiveState(activeTabId, {
        viewDatasetName: viewDatasetName || activeTabId,
    });
}
