// filterbar_runtime_controller.js
// Owns responsive panel visibility, scrolling and teardown.
// Connects the shared dataset filterbar to its existing component builders.
// Keeps one implementation and a bounded lifetime for each mounted surface.

import { createSharedTopbarVisibilityController } from "./shared_topbar_visibility_controller.js";
import { createFilterbarChatLayout } from "./filterbar_chat_layout_controller.js";
import { FILTERBAR_BREAKPOINT_PX, updateOverlayState } from "./filterbar_engine/filterbar_visibility_handler.js";
import { bindFilterbarVisibilityMemory, rememberFilterbarVisibility as setStoredVisibility } from './filterbar_visibility_memory.js';
import { resolveResponsivePanelVisibilityState } from "./filterbar_visibility_resolver.js";
import { FILTERBAR_COLUMN_WIDTH_PX } from "../../ui_config.js";
import { setupScrollPassthrough } from "../../reusable_components/scroll_passthrough.js";
import { VIEW_DEACTIVATE_EVENT } from "../../reusable_components/view_lifecycle_events.js";
import { addEnvironmentBadgeIfNeeded, NAVBAR_VISIBILITY_CHANGED_EVENT, syncNavbarMenuButtonAccessibility } from "../navigation/menu_button/navbar_visibility_handler.js";
import { isSharedTopBarHostActive } from "./shared_topbar_builder.js";
import { createDatasetCornerControls, isHeroControlAreaVisible } from "./dataset_corner_controls.js";
import { createTemporaryFiltersOpenerAndCloser } from "./filters_opener_and_closer.js";
import { FILTERBAR_PANEL_MODES } from "./filterbar_panel_mode_resolver.js";
const FILTERBAR_COLUMN_WIDTH_CSS = `${FILTERBAR_COLUMN_WIDTH_PX}px`;
const FILTERBAR_PANEL_HIDE_CONTENT_DELAY_MS = 700;

// Keep the dismissal target test separate from state/memory ownership below.
function wireOutsidePanelClose({ panel, fixedToggleButton, sharedTopBar, isNarrowScreen, isHidden, onClose, signal }) {
    document.addEventListener('click', event => {
        if (!isNarrowScreen() || isHidden()) return;
        if (panel.contains(event.target) || fixedToggleButton.contains(event.target) || sharedTopBar.contains(event.target)) return;
        onClose();
    }, { signal });
}

export function wireFilterbarRuntime({
    tableName, currentView, tablePartsContainer, contentArea, mainTableContainer, initialResponsivePanelState, panelMode, lifetimeController, signal, panel, panelBody, clockBar, chatDock, datasetTitleRow, inlineHeroHost, scrollSentinel, fixedToggleButton, hideFilterBtn, showMenuButton, sharedTopBarOwner, sharedTopBar, sharedTopBarEnd, sharedTopBarMenuButton, sharedTopBarMenuSlot, sharedTopBarArticleClose, sharedTopBarSearch, heroMenuButton, filterBarContent, overviewSection, sectionOrdering, styleSettings
}) {
    const WIDE_MODE_ENTER_THRESHOLD_PX = 8;
    const COMPACT_MODE_ENTER_THRESHOLD_PX = 48;
    const COMPACT_BODY_SCROLLED_ENTER_THRESHOLD_PX = 24;
    const COMPACT_BODY_SCROLLED_EXIT_THRESHOLD_PX = 6;
    const COMPACT_BODY_SCROLLED_MIN_ENTER_RANGE_PX = 320;
    const COMPACT_BODY_SCROLLED_MIN_STAY_RANGE_PX = 64;
    // =====================================================
    //  5. STATE MANAGEMENT
    //  Wide/compact mode follows scroll position and current responsive visibility.
    // =====================================================
    let panelManuallyHidden = initialResponsivePanelState.panelManuallyHidden;
    let bigCardOpen = false;
    let activeScrollable = null;
    let cleanupScrollListener = null;
    let scrollSyncRaf = 0;
    let wideModeInsetPx = 0;
    let wasNarrowScreen = isNarrowScreen();
    const cornerControls = createDatasetCornerControls({
        hero: inlineHeroHost, fallbackHost: tablePartsContainer,
        filterButton: fixedToggleButton, hideFilterButton: hideFilterBtn, panel,
        heroMenuButton, topbarEnd: sharedTopBarEnd,
        topbarMenuButton: sharedTopBarMenuButton, topbarMenuSlot: sharedTopBarMenuSlot,
        sourceMenuButton: showMenuButton, menuOwner: sharedTopBarOwner,
        syncNavbarAccessibility: syncNavbarMenuButtonAccessibility,
    });
    if (inlineHeroHost) addEnvironmentBadgeIfNeeded(inlineHeroHost);
    let autoCollapsedForNarrow = initialResponsivePanelState.autoCollapsedForNarrow;
    let compactBodyHideTimer = null;
    let inlineHeroVisible = false;
    function isCompact() {
        return panel.classList.contains("filterbar-panel--compact");
    }
    function isWide() {
        return panel.classList.contains("filterbar-panel--wide");
    }
    function isHidden() {
        return panel.classList.contains("filterbar-panel--hidden");
    }
    function isNarrowScreen() {
        return window.innerWidth < FILTERBAR_BREAKPOINT_PX;
    }
    function isNavbarVisible() {
        const navbar = document.getElementById("navbar");
        return Boolean(navbar) && !navbar.classList.contains("collapsed");
    }
    function setExternalToggleVisibility(shouldShow) {
        fixedToggleButton.setAttribute("aria-hidden", shouldShow ? "false" : "true");
        fixedToggleButton.tabIndex = shouldShow ? 0 : -1;
        fixedToggleButton.classList.toggle(
            "filterbar-fixed-toggle--exposed",
            shouldShow
        );
    }
    function clearCompactBodyHideTimer() {
        if (compactBodyHideTimer === null) {
            return;
        }
        clearTimeout(compactBodyHideTimer);
        compactBodyHideTimer = null;
    }
    function scheduleCompactBodyHideAfterPanelExit() {
        if (compactBodyHideTimer !== null) {
            return;
        }
        compactBodyHideTimer = setTimeout(() => {
            compactBodyHideTimer = null;
            if (isHidden() && isCompact()) {
                panelBody.classList.add("filterbar-panel-body--hidden");
                clockBar.classList.add("filterbar-clock-bar--hidden");
            }
        }, FILTERBAR_PANEL_HIDE_CONTENT_DELAY_MS);
    }
    function keepCompactBodyVisibleDuringPanelExit() {
        panelBody.classList.remove("filterbar-panel-body--hidden");
        clockBar.classList.remove("filterbar-clock-bar--hidden");
        scheduleCompactBodyHideAfterPanelExit();
    }
    function measureInlineHeroVisibility() {
        if (
            !inlineHeroHost ||
            !activeScrollable ||
            bigCardOpen ||
            !inlineHeroHost.isConnected
        ) {
            return false;
        }
        const heroRect = inlineHeroHost.getBoundingClientRect();
        const scrollableRect = activeScrollable.getBoundingClientRect();
        return heroRect.height > 0 && heroRect.bottom > scrollableRect.top;
    }
    function syncInlineHeroVisibility() {
        const nextInlineHeroVisible = measureInlineHeroVisibility();
        if (nextInlineHeroVisible === inlineHeroVisible) {
            syncSharedTopBar();
            return;
        }
        inlineHeroVisible = nextInlineHeroVisible;
        syncSharedTopBar();
    }
    const { syncSharedTopBar, destroy: destroySharedTopBarController } =
        createSharedTopbarVisibilityController({ tableName, currentView, tablePartsContainer,
        sharedTopBar, sharedTopBarArticleClose, inlineHeroHost,
            getState: () => ({ bigCardOpen, inlineHeroVisible, activeScrollable }),
            isHidden, isNavbarVisible, captureMenuFocus: cornerControls.captureMenuFocus, syncCornerControls });
    function syncCornerControls(active = isSharedTopBarHostActive(sharedTopBar), menuHadFocus) {
        cornerControls.sync({
            active,
            menuHadFocus,
            heroControlsVisible: inlineHeroVisible && !bigCardOpen
                && isHeroControlAreaVisible(inlineHeroHost, activeScrollable),
            topbarVisible: tablePartsContainer.dataset.sharedTopbarVisible === "true",
            navbarVisible: isNavbarVisible(),
            filterbarVisible: !isHidden(),
            phone: window.innerWidth <= 700,
        });
    }
    function closeOpenFilterDropdowns() {
        panel.querySelectorAll(".msd-dropdown, .vdw-dropdown").forEach((dropdownContainer) => {
            dropdownContainer.__dropdown?.close?.();
        });
    }
    const { setChatMaximized } = createFilterbarChatLayout({ chatDock, panel, panelBody,
        datasetTitleRow, signal, closeOpenFilterDropdowns, syncPanelBodyScrolledState });
    function shouldShowCompactPanelBody() {
        return !isHidden();
    }
    function getCompactBodyScrollRange() {
        return Math.max(0, panelBody.scrollHeight - panelBody.clientHeight);
    }
    function syncPanelBodyScrolledState() {
        const isBodyScrolled = panel.classList.contains("filterbar-panel--body-scrolled");
        const scrollRange = getCompactBodyScrollRange();
        const hasStableScrollRoom = scrollRange >= (
            isBodyScrolled
                ? COMPACT_BODY_SCROLLED_MIN_STAY_RANGE_PX
                : COMPACT_BODY_SCROLLED_MIN_ENTER_RANGE_PX
        );
        const scrollThreshold = isBodyScrolled
            ? COMPACT_BODY_SCROLLED_EXIT_THRESHOLD_PX
            : COMPACT_BODY_SCROLLED_ENTER_THRESHOLD_PX;
        panel.classList.toggle(
            "filterbar-panel--body-scrolled",
            isCompact() &&
                !isHidden() &&
                hasStableScrollRoom &&
                panelBody.scrollTop > scrollThreshold
        );
    }
    panelBody.addEventListener("scroll", syncPanelBodyScrolledState, {
        passive: true,
        signal,
    });
    function setContentReservedWidth(widthCss) {
        if (
            tablePartsContainer.style.getPropertyValue(
                "--filterbar-content-reserved-width"
            ) !== widthCss
        ) {
            tablePartsContainer.style.setProperty(
                "--filterbar-content-reserved-width",
                widthCss
            );
        }
        if (contentArea instanceof HTMLElement) {
            if (contentArea.style.marginRight !== widthCss) {
                contentArea.style.marginRight = widthCss;
            }
        }
    }
    function syncCompactPanelGeometry() {
        const reserveContentColumn = !isNarrowScreen() && !isHidden();
        setContentReservedWidth(reserveContentColumn ? FILTERBAR_COLUMN_WIDTH_CSS : "0px");
        return shouldShowCompactPanelBody();
    }
    function applyWideModeInset(nextInsetPx = panel.offsetHeight) {
        wideModeInsetPx = Math.max(0, Math.round(nextInsetPx));
        tablePartsContainer.style.setProperty(
            "--mini-hero-height",
            `${wideModeInsetPx}px`
        );
    }
    function clearWideModeInset() {
        wideModeInsetPx = 0;
        tablePartsContainer.style.setProperty("--mini-hero-height", "0px");
    }
    function getEffectiveScrollTop() {
        if (!activeScrollable) return 0;
        const wideInsetCompensation = isWide() ? wideModeInsetPx : 0;
        return Math.max(0, activeScrollable.scrollTop - wideInsetCompensation);
    }
    /** Switch panel to wide (hero) mode */
    function setWideMode() {
        setChatMaximized(false);
        if (!isWide()) {
            panel.classList.remove("filterbar-panel--compact");
            panel.classList.add("filterbar-panel--wide");
        }
        panel.classList.remove("filterbar-panel--body-scrolled");
        panelBody.scrollTop = 0;
        panelBody.classList.add("filterbar-panel-body--hidden");
        clockBar.classList.add("filterbar-clock-bar--hidden");
        setContentReservedWidth("0px");
        applyWideModeInset();
        requestAnimationFrame(() => {
            if (!isHidden() && isWide()) {
                applyWideModeInset();
            }
        });
    }
    /** Switch panel to compact (sidebar) mode */
    function setCompactMode() {
        if (!isCompact()) {
            panel.classList.remove("filterbar-panel--wide");
            panel.classList.add("filterbar-panel--compact");
        }
        clearWideModeInset();
        const showCompactPanelBody = syncCompactPanelGeometry();
        if (showCompactPanelBody) {
            clearCompactBodyHideTimer();
            panelBody.classList.remove("filterbar-panel-body--hidden");
            clockBar.classList.remove("filterbar-clock-bar--hidden");
            requestAnimationFrame(() => {
                if (!isHidden() && isCompact()) {
                    panelBody.querySelectorAll(".favefox-filterbar").forEach((bar) => {
                        bar.adjustSideModeHeight?.();
                    });
                    syncPanelBodyScrolledState();
                }
            });
        } else if (isHidden()) {
            if (
                compactBodyHideTimer !== null ||
                !panelBody.classList.contains("filterbar-panel-body--hidden")
            ) {
                keepCompactBodyVisibleDuringPanelExit();
            }
        } else {
            clearCompactBodyHideTimer();
            panelBody.classList.add("filterbar-panel-body--hidden");
            clockBar.classList.add("filterbar-clock-bar--hidden");
        }
        updateOverlayState();
        syncSharedTopBar();
    }
    /** Show the whole panel (respects current wide/compact) */
    function showPanel() {
        clearCompactBodyHideTimer();
        panel.classList.remove("filterbar-panel--hidden");
        setExternalToggleVisibility(false);
        if (bigCardOpen || panelMode === FILTERBAR_PANEL_MODES.INLINE_HERO) {
            setCompactMode(); // big card mode: always compact sidebar, never wide hero
        } else if (isCompact()) {
            setCompactMode(); // ensures compact-mode lower content is visible
        } else {
            setWideMode();
        }
        updateOverlayState();
        syncSharedTopBar();
    }
    /** Hide the whole panel */
    function hidePanel() {
        closeOpenFilterDropdowns();
        setChatMaximized(false);
        panel.classList.add("filterbar-panel--hidden");
        panel.classList.remove("filterbar-panel--body-scrolled");
        if (isCompact()) {
            keepCompactBodyVisibleDuringPanelExit();
        }
        setExternalToggleVisibility(true);
        clearWideModeInset();
        setContentReservedWidth("0px");
        updateOverlayState();
        syncSharedTopBar();
    }
    function applyResponsivePanelVisibility() {
        const nextVisibility = resolveResponsivePanelVisibilityState({
            wasNarrowScreen,
            isNarrowScreen: isNarrowScreen(),
            panelManuallyHidden,
            autoCollapsedForNarrow,
            panelHidden: isHidden(),
        });
        autoCollapsedForNarrow = nextVisibility.autoCollapsedForNarrow;
        if (nextVisibility.shouldShowPanel) {
            showPanel();
        } else {
            hidePanel();
        }
        wasNarrowScreen = isNarrowScreen();
    }
    // =====================================================
    //  6. SCROLL-DRIVEN MODE SWITCHING
    //  Determines wide/compact based on scrollTop.
    // =====================================================

    function syncModeToScroll() {
        if (isHidden() || !activeScrollable) return;
        if (panelMode === FILTERBAR_PANEL_MODES.INLINE_HERO) {
            setCompactMode();
            return;
        }
        const effectiveScrollTop = getEffectiveScrollTop();

        if (isCompact()) {
            if (effectiveScrollTop <= WIDE_MODE_ENTER_THRESHOLD_PX) {
                setWideMode();
            }
            return;
        }

        if (effectiveScrollTop >= COMPACT_MODE_ENTER_THRESHOLD_PX) {
            setCompactMode();
        } else {
            setWideMode();
        }
    }

    function scheduleModeSync() {
        if (scrollSyncRaf) return;
        scrollSyncRaf = requestAnimationFrame(() => {
            scrollSyncRaf = 0;
            syncModeToScroll();
        });
    }

    function attachToActiveView() {
        const nextScrollable = tablePartsContainer.querySelector(
            ".scrollable_content:not([style*='display: none'])"
        );
        if (!nextScrollable) return;

        const scrollableChanged = nextScrollable !== activeScrollable;

        if (scrollSentinel.parentElement !== nextScrollable) {
            nextScrollable.insertBefore(scrollSentinel, nextScrollable.firstChild);
        }
        if (inlineHeroHost) {
            const desiredInlineHeroSibling = scrollSentinel.nextSibling;
            if (
                inlineHeroHost.parentElement !== nextScrollable ||
                desiredInlineHeroSibling !== inlineHeroHost
            ) {
                nextScrollable.insertBefore(inlineHeroHost, desiredInlineHeroSibling);
            }
        }

        if (!scrollableChanged) {
            if (panelMode === FILTERBAR_PANEL_MODES.INLINE_HERO) {
                inlineHeroVisible = measureInlineHeroVisibility();
                setCompactMode();
                syncSharedTopBar();
            }
            return;
        }

        if (cleanupScrollListener) {
            cleanupScrollListener();
            cleanupScrollListener = null;
        }
        activeScrollable = nextScrollable;
        if (panelMode === FILTERBAR_PANEL_MODES.INLINE_HERO) {
            inlineHeroVisible = measureInlineHeroVisibility();
            setCompactMode();
            const onInlineHeroScroll = () => syncInlineHeroVisibility();
            activeScrollable.addEventListener("scroll", onInlineHeroScroll, {
                passive: true,
            });
            cleanupScrollListener = () =>
                activeScrollable.removeEventListener("scroll", onInlineHeroScroll);
            syncSharedTopBar();
            return;
        }

        const onScroll = () => scheduleModeSync();
        activeScrollable.addEventListener("scroll", onScroll, { passive: true });
        cleanupScrollListener = () =>
            activeScrollable.removeEventListener("scroll", onScroll);

        // Set initial mode based on current scroll position
        syncModeToScroll();
        syncSharedTopBar();
    }

    // =====================================================
    //  7. INITIALIZATION
    // =====================================================

    attachToActiveView();
    if (initialResponsivePanelState.shouldShowPanel) {
        showPanel();
    } else {
        hidePanel();
    }
    syncSharedTopBar();

    const temporaryFiltersCoordinator =
        createTemporaryFiltersOpenerAndCloser({
            tableName,
            eventHost: tablePartsContainer,
            panel,
            filtersSection: filterBarContent.filtersSection,
            sectionLayoutReady: sectionOrdering.ready,
            isPanelHidden: isHidden,
            showPanel,
            hidePanel,
        });

    // Scroll pass-through
    const getContentScrollTarget = () => activeScrollable;
    const isWideScreen = () => window.innerWidth >= FILTERBAR_BREAKPOINT_PX;

    setupScrollPassthrough(panel, {
        getScrollTarget: getContentScrollTarget,
        isActive: isWideScreen,
    });

    window.addEventListener(NAVBAR_VISIBILITY_CHANGED_EVENT, syncSharedTopBar, {
        signal,
    });

    // Cached datasets are hidden, not destroyed, on Back/Forward and route
    // changes. Release their local controls before Home borrows the source;
    // the host observer below restores ownership when this dataset returns.
    mainTableContainer?.addEventListener(VIEW_DEACTIVATE_EVENT, () => syncCornerControls(false), { signal });

    // Re-attach when views change (table → card → etc.)
    let viewObserverRaf = 0;
    const viewObserver = new MutationObserver(() => {
        if (viewObserverRaf) return;
        viewObserverRaf = requestAnimationFrame(() => {
            viewObserverRaf = 0;
            attachToActiveView();
        });
    });
    viewObserver.observe(tablePartsContainer, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style"],
    });

    const sharedTopBarHostObserver =
        mainTableContainer instanceof HTMLElement
            ? new MutationObserver(() => {
                syncSharedTopBar();
            })
            : null;
    sharedTopBarHostObserver?.observe(mainTableContainer, {
        attributes: true,
        attributeFilter: ["class"],
    });

    // =====================================================
    //  8. EVENT HANDLERS
    // =====================================================

    // Fixed toggle button — toggles panel visibility
    fixedToggleButton.addEventListener("click", () => {
        temporaryFiltersCoordinator.releaseTemporaryOwnership();
        if (!isHidden()) {
            panelManuallyHidden = true;
            autoCollapsedForNarrow = false;
            hidePanel();
            setStoredVisibility(tableName, false);
        } else {
            panelManuallyHidden = false;
            autoCollapsedForNarrow = false;
            showPanel();
            setStoredVisibility(tableName, true);
        }
    }, { signal });

    // Hide-filter button
    hideFilterBtn.addEventListener("click", () => {
        temporaryFiltersCoordinator.releaseTemporaryOwnership();
        panelManuallyHidden = true;
        autoCollapsedForNarrow = false;
        hidePanel();
        setStoredVisibility(tableName, false);
    }, { signal });

    // Resize handler
    let _filterbarResizeTimer = null;
    window.addEventListener("resize", () => {
        clearTimeout(_filterbarResizeTimer);
        _filterbarResizeTimer = setTimeout(() => {
            if (temporaryFiltersCoordinator.isActive()) {
                showPanel();
            } else {
                applyResponsivePanelVisibility();
            }
            if (!isHidden()) {
                syncModeToScroll();
            }
            syncInlineHeroVisibility();
        }, 150);
    }, { signal });

    // Big-card-open: keep the filterbar available in compact sidebar mode unless
    // the user has explicitly hidden it. This prevents the first filter edit from
    // causing the big-card refresh path to hide the whole filter UI.
    document.addEventListener("big-card-toggle", (e) => {
        if (e.detail?.tableName !== tableName) return;
        temporaryFiltersCoordinator.releaseTemporaryOwnership();
        bigCardOpen = e.detail.isOpen;
        if (panelManuallyHidden || autoCollapsedForNarrow) {
            hidePanel();
        } else {
            showPanel();
        }
        syncInlineHeroVisibility();
    }, { signal });

    // Close panel on outside click (mobile)
    wireOutsidePanelClose({ panel, fixedToggleButton, sharedTopBar, isNarrowScreen, isHidden, signal,
        onClose: () => {
            temporaryFiltersCoordinator.releaseTemporaryOwnership();
            panelManuallyHidden = true;
            autoCollapsedForNarrow = false;
            hidePanel();
            setStoredVisibility(tableName, false);
        }
    });

    let destroyed = false;
    const removalObserver = new MutationObserver(() => {
        if (!panel.isConnected) {
            destroyFilterBar();
        }
    });
    removalObserver.observe(document.body, {
        childList: true,
        subtree: true,
    });

    function destroyFilterBar() {
        if (destroyed) {
            return;
        }
        destroyed = true;
        lifetimeController.abort();
        destroySharedTopBarController();
        clearCompactBodyHideTimer();
        removalObserver.disconnect();
        viewObserver.disconnect();
        sharedTopBarHostObserver?.disconnect();
        cleanupScrollListener?.();
        cleanupScrollListener = null;
        if (scrollSyncRaf) {
            cancelAnimationFrame(scrollSyncRaf);
            scrollSyncRaf = 0;
        }
        if (viewObserverRaf) {
            cancelAnimationFrame(viewObserverRaf);
            viewObserverRaf = 0;
        }
        clearTimeout(_filterbarResizeTimer);
        temporaryFiltersCoordinator.destroy();
        filterBarContent.destroy?.();
        sectionOrdering.destroy?.();
        overviewSection?.destroy?.();
        styleSettings?.section.destroy?.();
        sharedTopBarSearch.destroy?.();
        cornerControls.destroy();
        clockBar.destroy?.();
        inlineHeroHost?.destroy?.();
        scrollSentinel.remove();
        inlineHeroHost?.remove?.();
        sharedTopBar.remove();
        fixedToggleButton.remove();
        if (contentArea instanceof HTMLElement) {
            contentArea.style.removeProperty("margin-right");
        }
        panel.remove();
    }

    const syncVisibilityMemory = bindFilterbarVisibilityMemory({
        tableName, panel, host: mainTableContainer, container: tablePartsContainer,
        visible: () => !isHidden(), signal,
        isActive: () => isSharedTopBarHostActive(mainTableContainer),
        apply: (visible) => {
            panelManuallyHidden = !visible;
            autoCollapsedForNarrow = false;
            if (visible) showPanel(); else hidePanel();
        },
    });
    panel.__syncSharedTopBar = () => { syncVisibilityMemory(); syncSharedTopBar(); };
    panel.__syncActiveView = () => {
        if (destroyed) return;
        syncVisibilityMemory();
        attachToActiveView();
        syncSharedTopBar();
    };
    panel.destroy = destroyFilterBar;
    return panel;
}
