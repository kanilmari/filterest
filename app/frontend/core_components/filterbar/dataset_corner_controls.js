// dataset_corner_controls.js
// Places each existing panel toggle in the bar at its viewport corner.
// Bridges the selected dataset toolbar and the existing navbar and filterbar actions.
// Owns button placement and accessibility only; panel state and actions stay with their builders.
import { getLanguageWithBrowserFallback } from "../state_stores/lang_preference_reader.js";
import { getTranslationForKey } from "../lang/translation_handler.js";

const LABELS = {
    fi: { menu: "Näytä päävalikko", show: "Näytä suodatuspalkki", hide: "Piilota suodatuspalkki" },
    en: { menu: "Show main menu", show: "Show filter toolbar", hide: "Hide filter toolbar" },
    ch: { menu: "显示主菜单", show: "显示筛选工具栏", hide: "隐藏筛选工具栏" },
    yue: { menu: "顯示主選單", show: "顯示篩選工具列", hide: "隱藏篩選工具列" },
    'zh-CN': { menu: "显示主菜单", show: "显示筛选工具栏", hide: "隐藏筛选工具栏" },
    'zh-TW': { menu: "顯示主選單", show: "顯示篩選工具列", hide: "隱藏篩選工具列" },
    'zh-HK': { menu: "顯示主選單", show: "顯示篩選工具列", hide: "隱藏篩選工具列" },
};

function setButtonVisibility(button, visible) {
    button.setAttribute("aria-hidden", String(!visible));
    button.tabIndex = visible ? 0 : -1;
    if (!visible && document.activeElement === button) button.blur();
}

function setLabel(button, label) {
    if (!button || !label) return;
    button.title = label;
    button.setAttribute("aria-label", label);
}

function moveButton(button, host) {
    if (button.parentElement === host) return;
    const wasFocused = document.activeElement === button;
    host.appendChild(button);
    if (wasFocused) button.focus({ preventScroll: true });
}

/** An open panel owns its corner at every width, including overlay layouts. */
export function createDatasetCornerControls({
    fallbackHost, filterButton, hideFilterButton, panel, topbarEnd, topbarMenuButton, topbarMenuSlot,
    sourceMenuButton, menuOwner, syncNavbarAccessibility,
}) {
    topbarEnd.classList.add("dataset-corner-controls-topbar-end");
    for (const button of [filterButton, hideFilterButton]) {
        button.type = "button";
        button.setAttribute("aria-controls", panel.id);
    }
    let destroyed = false;
    let filterbarIsVisible = false;
    let navbarIsVisible = false;
    function refreshLabels() {
        const labels = LABELS[getLanguageWithBrowserFallback()] || LABELS.en;
        setLabel(topbarMenuButton, navbarIsVisible ? getTranslationForKey("close", { countUsage: false }) : labels.menu);
        setLabel(filterButton, filterbarIsVisible ? labels.hide : labels.show);
        setLabel(hideFilterButton, labels.hide);
    }
    refreshLabels();
    const languageObserver = new MutationObserver(refreshLabels);
    languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });

    function captureControlFocus(active) {
        if (destroyed) return null;
        const focused = document.activeElement;
        if (focused === topbarMenuButton || (active && (focused === sourceMenuButton || focused === document.getElementById("hideMenuButton")))) return "menu";
        if (focused === filterButton || focused === hideFilterButton) return "filter";
        return null;
    }

    function releaseMenu() {
        if (sourceMenuButton?.__sharedTopbarMenuOwner !== menuOwner) return;
        sourceMenuButton.__sharedTopbarMenuOwner = null;
        sourceMenuButton.classList.remove("shared-topbar-menu-source-hidden");
    }

    function sync({ active, topbarVisible, navbarVisible, filterbarVisible, focus = captureControlFocus(active) }) {
        if (destroyed) return "none";
        const barVisible = active && topbarVisible;
        const menuInBar = barVisible && !navbarVisible;
        const filterInBar = barVisible && !filterbarVisible;
        const showFilter = active && (filterInBar || !filterbarVisible);
        const panelClose = active && filterbarVisible && !filterInBar;
        filterbarIsVisible = filterbarVisible;
        navbarIsVisible = navbarVisible;
        setButtonVisibility(topbarMenuButton, menuInBar);
        topbarMenuButton.setAttribute("aria-expanded", String(navbarVisible));
        topbarMenuSlot.classList.toggle("dataset-shared-topbar__menu-slot--visible", menuInBar);
        topbarMenuSlot.setAttribute("aria-hidden", String(!menuInBar));
        topbarMenuSlot.inert = !menuInBar;
        if (sourceMenuButton && menuInBar) {
            sourceMenuButton.__sharedTopbarMenuOwner = menuOwner;
            sourceMenuButton.classList.add("shared-topbar-menu-source-hidden");
        } else {
            releaseMenu();
        }
        moveButton(filterButton, filterInBar ? topbarEnd : fallbackHost);
        const owner = filterInBar ? "topbar" : active ? "fallback" : "none";
        filterButton.dataset.cornerOwner = owner;
        filterButton.classList.toggle("filterbar-fixed-toggle--hosted", filterInBar);
        filterButton.classList.toggle("filterbar-fixed-toggle--exposed", showFilter);
        setButtonVisibility(filterButton, showFilter);
        filterButton.setAttribute("aria-expanded", String(filterbarVisible));
        hideFilterButton.setAttribute("aria-expanded", String(filterbarVisible));
        setButtonVisibility(hideFilterButton, panelClose);
        const dock = hideFilterButton.closest('.filterbar-panel__toggle-dock');
        if (dock) { dock.hidden = !panelClose; dock.inert = !panelClose; }
        refreshLabels();
        syncNavbarAccessibility();
        let incoming;
        if (focus === "menu") incoming = menuInBar ? topbarMenuButton
            : navbarVisible ? document.getElementById("hideMenuButton") : sourceMenuButton;
        if (active && focus === "filter") incoming = panelClose ? hideFilterButton : filterButton;
        if (incoming?.isConnected && !incoming.closest('[hidden],[inert],.hidden,[aria-hidden="true"]')) {
            incoming.focus({ preventScroll: true });
        }
        return owner;
    }

    function destroy() {
        if (destroyed) return;
        destroyed = true;
        languageObserver.disconnect();
        releaseMenu();
        syncNavbarAccessibility();
        moveButton(filterButton, fallbackHost);
    }
    return { captureControlFocus, sync, destroy };
}
