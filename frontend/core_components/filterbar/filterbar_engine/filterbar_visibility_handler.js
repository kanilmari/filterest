// filterbar_visibility_handler.js
// Controls filter bar visibility state across breakpoints and overlay modes.
// Bridges viewport width, local storage state, and overlay helpers with filter bar rendering.
// Exists to keep responsive filter bar open/close behavior consistent across dataset views.

import OverlayFilter from "../../../reusable_components/dark_overlay/dark_overlay_handler.js";
import { FILTERBAR_OVERLAY_BREAKPOINT_PX } from "../../../ui_config.js";
import { updateShowMenuButtonPosition } from "../../navigation/menu_button/navbar_visibility_handler.js";
import { getAllSpecs } from "../../state_stores/table_specs_reader.js";
import { buildVisibilityKey, parseStoredVisibility, resolveInitialVisibility } from "./filterbar_visibility_handler_helpers.js";

// Kynnysarvo, jonka alapuolella compact filterbar siirtyy overlay-käyttäytymiseen.
// Arvo pidetään tarkoituksella hieman 1280px-laptop-aluetta kapeampana, jotta
// oikea rail pysyy vielä selkeänä ja vakaana tavallisissa "narrow desktop" -leveyksissä.
export const FILTERBAR_BREAKPOINT_PX = FILTERBAR_OVERLAY_BREAKPOINT_PX;

// UUSI FUNKTIO: Palauttaa oikean avaimen localStorageen näytön leveyden perusteella
export function getVisibilityKey(tableName) {
    const isWide = window.innerWidth > FILTERBAR_BREAKPOINT_PX;
    return buildVisibilityKey(tableName, isWide);
}

// UUSI FUNKTIO: Hakee tallennetun näkyvyystilan localStoragesta
export function getStoredVisibility(tableName) {
    const key = getVisibilityKey(tableName);
    const stored = localStorage.getItem(key);
    return parseStoredVisibility(stored);
}

// UUSI FUNKTIO: Tallentaa näkyvyystilan localStorageen
export function setStoredVisibility(tableName, isVisible) {
    const key = getVisibilityKey(tableName);
    localStorage.setItem(key, isVisible.toString());
}

export function resolveFilterBarElement(tableName) {
    return (
        document.getElementById(`${tableName}_filterBar_panel`) ||
        document.getElementById(`${tableName}_filterBar`)
    );
}

export function isFilterBarElementVisible(filterBarElement) {
    if (!filterBarElement) return false;
    if (filterBarElement.classList.contains("filterbar-panel")) {
        return !filterBarElement.classList.contains("filterbar-panel--hidden");
    }
    return !filterBarElement.classList.contains("hidden");
}

/**
 * Näyttää jo luodun sijaintirivin, jos se on piilotettuna.
 */

let filterOverlay = null;
let overlayStateListenersAttached = false;

export function ensureOverlayStateListenersAttached() {
    if (overlayStateListenersAttached) return;
    overlayStateListenersAttached = true;

    // Debounced 150ms to avoid layout thrashing during continuous resize.
    // IMPORTANT: The resize handler must only HIDE the overlay, never show it.
    // Showing is handled explicitly by moveContentToSidebar() and other
    // sidebar-management functions that call updateOverlayState() at the
    // correct time.  If the resize handler also tries to show the overlay,
    // a race condition occurs when crossing the filterbar breakpoint from
    // wide → narrow: the sidebar is still visible for a brief moment and
    // the overlay flashes dark before the filterbar handler hides it.
    let _overlayResizeTimer = null;
    window.addEventListener("resize", () => {
        clearTimeout(_overlayResizeTimer);
        _overlayResizeTimer = setTimeout(_hideOverlayOnResize, 150);
    });

    // Navbar visibility can change via clicks outside the navbar (see navbar.js).
    // This keeps the overlay in sync without tightly coupling modules.
    document.addEventListener("click", () => {
        setTimeout(updateOverlayState, 0);
    });

    document.addEventListener("dataset-filterbar-visibility-changed", () => {
        requestAnimationFrame(updateOverlayState);
    });
}

/**
 * Resize-only overlay handler: hides overlay when screen is wide,
 * but NEVER shows it.  Prevents the flash-dark race condition when
 * crossing the filterbar breakpoint while a sidebar is still visible.
 */
function _hideOverlayOnResize() {
    if (!filterOverlay) return;
    if (window.innerWidth >= FILTERBAR_BREAKPOINT_PX) {
        filterOverlay.hideOverlay();
    }
    // On narrow screens we intentionally do nothing here.
    // The overlay will be shown/hidden by explicit sidebar code paths
    // (moveContentToSidebar, showSearchOnly, etc.) that call
    // updateOverlayState() at the right time.
}

export function updateOverlayState() {
    if (!filterOverlay) return;

    const isNarrow = window.innerWidth < FILTERBAR_BREAKPOINT_PX;
    if (!isNarrow) {
        filterOverlay.hideOverlay();
        return;
    }

    // On narrow screens, show overlay when panel is visible (darkens content behind it)
    const anySidebarVisible = document.querySelector(
        ".filterbar-panel:not(.filterbar-panel--hidden)"
    );
    if (anySidebarVisible) {
        filterOverlay.showOverlay();
    } else {
        filterOverlay.hideOverlay();
    }
}

export function ensureFilterOverlay() {
    if (!filterOverlay) {
        filterOverlay = new OverlayFilter();
        ensureOverlayStateListenersAttached();
    }
    return filterOverlay;
}

/* ===========================================================
 *  Näytä/piilota dataset-filter-panel
 * =========================================================*/
export function setFilterBarVisibility(
    tableName,
    filterBarElement,
    tablePartsContainer,
    showBtn,
    shouldBeVisible
) {
    const wasVisible = !filterBarElement.classList.contains("hidden");
    ensureFilterOverlay();

    if (!showBtn) {
        // console.warn("showBtn missing"); // Suppressed warning
        showBtn = {
            classList: { add: () => {}, remove: () => {} },
            style: {},
        }; // minimi-stub, ettei lennä virhettä
    }

    if (shouldBeVisible) {
        filterBarElement.classList.remove("hidden");
        requestAnimationFrame(() => {
            filterBarElement
                .querySelectorAll(".favefox-filterbar")
                .forEach((bar) => {
                    bar.adjustSideModeHeight?.();
                });
        });
    } else {
        filterBarElement.classList.add("hidden");
    }
    const isVisible = !filterBarElement.classList.contains("hidden");

    updateOverlayState();

    updateShowFilterBarButtonPosition(tablePartsContainer, showBtn);
    updateShowMenuButtonPosition();
    setStoredVisibility(tableName, isVisible);

    const menuButton = document.getElementById("showMenuButton");
    if (menuButton) {
        menuButton.classList.toggle("filterbar-overlap", !isVisible);
    }
    const searchButton = tablePartsContainer.querySelector(
        ".card_search_filter_button"
    );
    if (searchButton) {
        searchButton.classList.toggle("filterbar-visible", isVisible);
    }

    if (
        isVisible &&
        (!wasVisible || !filterBarElement.dataset.initialFocusApplied)
    ) {
        const searchInput = tablePartsContainer.querySelector(
            ".dataset-search-input[data-dataset-search-variant='filterbar']"
        );
        if (searchInput) {
            searchInput.focus();
            filterBarElement.dataset.initialFocusApplied = "true";
        }
    }

    document.dispatchEvent(
        new CustomEvent("dataset-filterbar-visibility-changed", {
            detail: { tableName, isVisible },
        })
    );
}

export function updateShowFilterBarButtonPosition(tablePartsContainer, showBtn) {
    const visibleScrollable = tablePartsContainer.querySelector(
        ".scrollable_content:not([style*='display: none'])"
    );
    if (!visibleScrollable) return;

    const _hasScroll =
        visibleScrollable.scrollHeight > visibleScrollable.clientHeight;
    // if (hasScroll) {
    //     const scrollbarWidth =
    //         visibleScrollable.offsetWidth - visibleScrollable.clientWidth;
    //     // const pos = scrollbarWidth === 0 ? 17 : scrollbarWidth + 10;
    //     const pos = scrollbarWidth === 0 ? 10 : scrollbarWidth + 10; // dynaaminen arvo filtteripalkin näyttämisen napille scrollbarin leveyden mukaan
    //     showBtn.style.right = `${pos}px`;
    // } else {
    showBtn.style.right = "8px";
    // }
}

// Tarkistaa näytön leveyden ja asettaa näkyvyyden tallennetun tilan tai oletuksen mukaan
//   – säilyttää tallennetun tilan ja huolehtii overlayn näkyvyydestä
// ==========================================================
export function checkWindowWidth(tableName) {
    const filterBar = document.getElementById(`${tableName}_filterBar`);
    const tablePartsContainer = document.getElementById(
        `${tableName}_tab_parts_container`
    );
    if (!filterBar || !tablePartsContainer) return;

    const showBtn = tablePartsContainer.querySelector(
        ".show_filter_bar_button"
    );

    const storedVisibility = getStoredVisibility(tableName);
    const tableSpecs = getAllSpecs();
    const dbDefault = tableSpecs[tableName]?.filterbar_visible_by_default;
    const isWide = window.innerWidth > FILTERBAR_BREAKPOINT_PX;

    const shouldBeVisible = resolveInitialVisibility(storedVisibility, dbDefault, isWide);

    setFilterBarVisibility(
        tableName,
        filterBar,
        tablePartsContainer,
        showBtn,
        shouldBeVisible
    );
}
