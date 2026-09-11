// dataset_corner_controls.js
// Places existing dataset show buttons in the visible surface's control corners.
// Bridges hero/shared-toolbar slots with the existing navbar and filterbar actions.
// Owns button placement and accessibility only; panel state and actions stay with their builders.
import { getLanguageWithBrowserFallback } from "../state_stores/lang_preference_reader.js";

const LABELS = {
    fi: { menu: "Näytä päävalikko", show: "Näytä suodatuspalkki", hide: "Piilota suodatuspalkki" },
    en: { menu: "Show main menu", show: "Show filter toolbar", hide: "Hide filter toolbar" },
    ch: { menu: "显示主菜单", show: "显示筛选工具栏", hide: "隐藏筛选工具栏" },
    yue: { menu: "顯示主選單", show: "顯示篩選工具列", hide: "隱藏篩選工具列" },
};

export function selectDatasetCornerOwner({ active, heroControlsVisible, topbarVisible }) {
    if (!active) return "none";
    if (heroControlsVisible) return "hero";
    return topbarVisible ? "topbar" : "fallback";
}

// The hero may still be partially visible after its top buttons have scrolled
// away. That state uses the existing fixed fallback until the shared bar opens.
export function isHeroControlAreaVisible(hero, scrollable) {
    if (!hero?.isConnected || !scrollable?.isConnected) return false;
    const area = hero.getBoundingClientRect();
    const viewport = scrollable.getBoundingClientRect();
    return area.height > 0 && viewport.height > 0
        && area.top + 12 >= Math.max(0, viewport.top)
        && area.top + 56 <= Math.min(window.innerHeight, viewport.bottom);
}

function setButtonVisibility(button, visible) {
    button.setAttribute("aria-hidden", String(!visible));
    button.tabIndex = visible ? 0 : -1;
    if (!visible && document.activeElement === button) button.blur();
}

function setLabel(button, label) {
    if (!button) return;
    button.title = label;
    button.setAttribute("aria-label", label);
}

function moveButton(button, host) {
    if (button.parentElement === host) return;
    const wasFocused = document.activeElement === button;
    host.appendChild(button);
    if (wasFocused) button.focus({ preventScroll: true });
}

/**
 * Keep a single sidebar opener and one visible menu opener per active dataset.
 * The original global menu node stays in its original DOM home for its existing
 * navbar wiring; a local menu button delegates to that same canonical action.
 */
export function createDatasetCornerControls({
    hero, fallbackHost, filterButton, hideFilterButton, panel,
    heroMenuButton, topbarEnd, topbarMenuButton, topbarMenuSlot,
    sourceMenuButton, menuOwner, syncNavbarAccessibility,
}) {
    const start = document.createElement("div");
    start.className = "dataset-corner-controls dataset-corner-controls--start";
    const end = document.createElement("div");
    end.className = "dataset-corner-controls dataset-corner-controls--end";
    start.hidden = true;
    end.hidden = true;
    start.appendChild(heroMenuButton);
    hero?.append(start, end);
    topbarEnd.classList.add("dataset-corner-controls-topbar-end");
    filterButton.type = "button";
    filterButton.setAttribute("aria-controls", panel.id);
    hideFilterButton.type = "button";
    hideFilterButton.setAttribute("aria-controls", panel.id);
    let destroyed = false;

    function refreshLabels() {
        const language = getLanguageWithBrowserFallback();
        const labels = LABELS[language] || LABELS.en;
        setLabel(heroMenuButton, labels.menu);
        setLabel(topbarMenuButton, labels.menu);
        setLabel(filterButton, labels.show);
        setLabel(hideFilterButton, labels.hide);
    }
    refreshLabels();
    const languageObserver = new MutationObserver(refreshLabels);
    languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });

    function sync({ active, heroControlsVisible, topbarVisible, navbarVisible, filterbarVisible }) {
        if (destroyed) return "none";
        const owner = selectDatasetCornerOwner({ active, heroControlsVisible, topbarVisible });
        const showFilter = active && !filterbarVisible;
        const heroMenuVisible = owner === "hero" && !navbarVisible;
        const topbarMenuVisible = owner === "topbar" && !navbarVisible;
        start.hidden = !heroMenuVisible;
        end.hidden = !(owner === "hero" && showFilter);
        setButtonVisibility(heroMenuButton, heroMenuVisible);
        setButtonVisibility(topbarMenuButton, topbarMenuVisible);
        for (const button of [heroMenuButton, topbarMenuButton]) {
            button.setAttribute("aria-expanded", String(navbarVisible));
        }
        topbarMenuSlot.classList.toggle("dataset-shared-topbar__menu-slot--visible", topbarMenuVisible);
        topbarMenuSlot.setAttribute("aria-hidden", String(!topbarMenuVisible));
        topbarMenuSlot.inert = !topbarMenuVisible;
        if (sourceMenuButton && (heroMenuVisible || topbarMenuVisible)) {
            sourceMenuButton.__sharedTopbarMenuOwner = menuOwner;
            sourceMenuButton.classList.add("shared-topbar-menu-source-hidden");
        } else if (sourceMenuButton?.__sharedTopbarMenuOwner === menuOwner) {
            sourceMenuButton.__sharedTopbarMenuOwner = null;
            sourceMenuButton.classList.remove("shared-topbar-menu-source-hidden");
        }
        const target = showFilter && owner === "hero" ? end
            : showFilter && owner === "topbar" ? topbarEnd : fallbackHost;
        moveButton(filterButton, target);
        filterButton.dataset.cornerOwner = owner;
        filterButton.classList.toggle("filterbar-fixed-toggle--hosted", target !== fallbackHost);
        filterButton.classList.toggle("filterbar-fixed-toggle--exposed", showFilter);
        setButtonVisibility(filterButton, showFilter);
        filterButton.setAttribute("aria-expanded", String(filterbarVisible));
        hideFilterButton.setAttribute("aria-expanded", String(filterbarVisible));
        setButtonVisibility(hideFilterButton, active && filterbarVisible);
        syncNavbarAccessibility();
        return owner;
    }

    function destroy() {
        if (destroyed) return;
        destroyed = true;
        languageObserver.disconnect();
        if (sourceMenuButton?.__sharedTopbarMenuOwner === menuOwner) {
            sourceMenuButton.__sharedTopbarMenuOwner = null;
            sourceMenuButton.classList.remove("shared-topbar-menu-source-hidden");
            syncNavbarAccessibility();
        }
        moveButton(filterButton, fallbackHost);
        start.remove();
        end.remove();
    }
    return { sync, destroy };
}
