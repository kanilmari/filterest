// filter_bar_builder.js
// Builds the filterbar's hero, sidebar, and search-only container structure.
// Bridges shared filter content, dataset search UI, and responsive layout transitions into one entry point.
// Exists to centralize filterbar container orchestration while lower-level modules handle visibility, metadata, and controls.

import {
    appendChatUIIfAllowed,
} from "../admin_tools/admin_button_builder.js";
import {
    createDatasetSearchPanel,
    DEFAULT_TITLE_LANG_KEY_MODE,
    tableMetaCache,
} from "./text_search/create_text_search_panel.js";
import { buildFilterSection } from "./filter_list/filter_column_builder.js";
import { build_favefox_style_filter_bar_from_columns } from "./filter_list/favefox_style_filters_container/accordion_filter_builder.js";
import { buildColumnViewPresetSelector } from "./filter_list/column_view_preset_builder.js";
import { setResultsCount } from "../../reusable_components/results_count/results_count_printer.js";

// Refactored imports
import {
    FILTERBAR_BREAKPOINT_PX,
    ensureFilterOverlay,
    getStoredVisibility,
    setStoredVisibility,
    updateOverlayState,
} from "./filterbar_engine/filterbar_visibility_handler.js";
import {
    buildInitialResponsivePanelState,
    resolveResponsivePanelVisibilityState,
} from "./filterbar_visibility_resolver.js";
import {
    FAVEFOX_FILTER_LAYOUT_MODE,
    FILTERBAR_PANEL_MODE,
    FILTERBAR_COLUMN_WIDTH_PX,
    show_search_only_bar_in_big_card_view,
    show_filterbar_search_overview_section,
} from "../../ui_config.js";
import { setupScrollPassthrough } from "../../reusable_components/scroll_passthrough.js";
import {
    ensureTableContainers,
    buildTopRow,
    clearAllFilters,
} from "./top_row_buttons/top_row_builder.js";
import { createSortDropdown } from "./top_row_buttons/sort_dropdown_builder.js";
import { getAllSpecs } from "../state_stores/table_specs_reader.js";
import { createMaskIconSpan } from "../../icons/icon_mask_builder.js";
import { getLanguageWithBrowserFallback } from "../state_stores/lang_preference_reader.js";
import {
    formatSiteNameForDisplay,
    getCurrentSiteName,
} from "../state_stores/site_identity_reader.js";
import { buildCalendarPopup } from "./filterbar_calendar.js";
import {
    NAVBAR_VISIBILITY_CHANGED_EVENT,
    updateShowMenuButtonPosition,
} from "../navigation/menu_button/navbar_visibility_handler.js";
import { getTabIconPath } from "../navigation/main_tabs/tab_icon_library.js";
import {
    dockButtonIntoSharedTopBar,
    isSharedTopBarHostActive,
    restoreButtonFromSharedTopBar,
    shouldShowSharedTopBar,
} from "./shared_topbar_builder.js";
import { buildFilterbarDisclosureSection } from "./filterbar_section_heading_builder.js";
import { setupFilterbarSectionOrdering } from "./filterbar_section_order_handler.js";
import { buildAdminVersionInfoIndicator } from "../admin_tools/admin_version_info_indicator.js";

/* ===========================================================
 *  Yleiset muuttujat ja apurit
 * =========================================================*/

// Piirretäänkö vanha filttereiden joukko vai ei
const SHOW_LEGACY_FILTERS = false;

// Kielen koodi → Intl-lokaali kellotaululle
const LANG_TO_LOCALE = { fi: "fi-FI", en: "en-GB", ch: "zh-CN", yue: "yue-Hant-HK" };

// Kielen koodi → lokalisoitu "viikko"-sana kellotauluun
const WEEK_LABELS = { fi: "viikko", en: "week", ch: "周", yue: "星期" };

// Tooltip for the clock time element — shows timezone and how to change it
const TZ_TIPS = {
    fi: (tz) => `Aikavyöhyke: ${tz}\nAikaa voi muuttaa käyttöjärjestelmän tai selaimen asetuksista.`,
    en: (tz) => `Time zone: ${tz}\nTo change the time, update your operating system or browser settings.`,
    ch: (tz) => `时区：${tz}\n如需修改时间，请更改操作系统或浏览器的设置。`,
    yue: (tz) => `時區：${tz}\n如果要更改時間，請更新作業系統或者瀏覽器設定。`,
};

function formatIsoCalendarDate(date, timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone,
    }).formatToParts(date);

    const year = parts.find((part) => part.type === "year")?.value ?? "0000";
    const month = parts.find((part) => part.type === "month")?.value ?? "00";
    const day = parts.find((part) => part.type === "day")?.value ?? "00";

    return `${year}-${month}-${day}`;
}

/**
 * Returns which occurrence (1–5) of the weekday the given date is within its month.
 * E.g. the 2nd Sunday → 2.
 */
function getWeekdayOccurrenceInMonth(date) {
    return Math.floor((date.getDate() - 1) / 7) + 1;
}

/**
 * Returns a localized tooltip string describing the weekday occurrence in the month.
 * E.g. fi: "Kuukauden 2. tiistai", en: "2nd Tuesday of the month"
 */
function buildOccurrenceTip(date, locale, lang) {
    const n = getWeekdayOccurrenceInMonth(date);
    const weekdayName = date.toLocaleDateString(locale, { weekday: "long" });
    if (lang === "fi") {
        return `Kuukauden ${n}. ${weekdayName}`;
    }
    if (lang === "ch") {
        return `本月第${n}个${weekdayName}`;
    }
    const ordinals = ["1st", "2nd", "3rd", "4th", "5th"];
    return `${ordinals[n - 1] || `${n}th`} ${weekdayName} of the month`;
}

/**
 * Returns the ISO 8601 week number for the given date.
 * Week 1 is the week containing the first Thursday of the year.
 */
function getISOWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayOfWeek = d.getUTCDay() || 7; // Mon=1 … Sun=7
    d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek); // nearest Thursday
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/**
 * Builds the clock strip shown at the very bottom of the filterbar sidebar.
 * Displays locale-aware weekday, ISO week number, date and timezone-corrected time (with seconds).
 * Returns a destroyable DOM element so filterbar teardown can clean its listeners and interval.
 */
function buildClockBar() {
    const lifetimeController = new AbortController();
    const { signal } = lifetimeController;
    const bar = document.createElement("div");
    bar.classList.add("filterbar-clock-bar", "filterbar-clock-bar--hidden");

    const contentEl = document.createElement("div");
    contentEl.classList.add("filterbar-clock-bar__content");

    const dayGroupEl = document.createElement("span");
    dayGroupEl.classList.add("filterbar-clock-bar__day-group");

    const weekdayEl = document.createElement("span");
    weekdayEl.classList.add("filterbar-clock-bar__weekday");

    const weekEl = document.createElement("span");
    weekEl.classList.add("filterbar-clock-bar__week");

    dayGroupEl.appendChild(weekdayEl);
    dayGroupEl.appendChild(weekEl);

    const dateEl = document.createElement("span");
    dateEl.classList.add("filterbar-clock-bar__date");

    const timeEl = document.createElement("span");
    timeEl.classList.add("filterbar-clock-bar__time");

    contentEl.appendChild(dayGroupEl);
    contentEl.appendChild(dateEl);
    contentEl.appendChild(timeEl);
    bar.appendChild(contentEl);
    const versionInfoIndicator = buildAdminVersionInfoIndicator();
    if (versionInfoIndicator) {
        bar.appendChild(versionInfoIndicator);
    }

    // ── Calendar popup ───────────────────────────────────────────────
    // Appended to body so it is never clipped by filterbar overflow.
    const calendar = buildCalendarPopup(() => getLanguageWithBrowserFallback());
    calendar.el.style.display = "none";
    document.body.appendChild(calendar.el);

    let calendarOpen = false;
    let deferredWidthSyncTimeout = null;
    let stableContentWidthPx = null;

    function clearDeferredWidthSync() {
        if (deferredWidthSyncTimeout) {
            clearTimeout(deferredWidthSyncTimeout);
            deferredWidthSyncTimeout = null;
        }
    }

    function setClockContentWidth(widthPx, animate = false) {
        if (!Number.isFinite(widthPx) || widthPx <= 0) {
            return;
        }

        contentEl.style.transition = animate ? "width 3s ease" : "none";
        contentEl.style.width = `${Math.ceil(widthPx)}px`;
    }

    function measureNaturalClockContentWidth() {
        if (!contentEl.isConnected || contentEl.getClientRects().length === 0) {
            return 0;
        }

        const previousWidth = contentEl.style.width;
        const previousTransition = contentEl.style.transition;
        contentEl.style.transition = "none";
        contentEl.style.width = "auto";
        const measuredWidth = Math.ceil(contentEl.getBoundingClientRect().width || contentEl.scrollWidth || 0);
        contentEl.style.width = previousWidth;
        contentEl.style.transition = previousTransition;
        return measuredWidth;
    }

    function syncClockContentWidth({ immediate = false } = {}) {
        const naturalWidthPx = measureNaturalClockContentWidth();
        if (!Number.isFinite(naturalWidthPx) || naturalWidthPx <= 0) {
            return;
        }

        if (stableContentWidthPx === null || immediate) {
            clearDeferredWidthSync();
            stableContentWidthPx = naturalWidthPx;
            setClockContentWidth(naturalWidthPx, false);
            return;
        }

        if (naturalWidthPx === stableContentWidthPx) {
            return;
        }

        const currentWidthPx = Math.ceil(contentEl.getBoundingClientRect().width) || stableContentWidthPx;
        clearDeferredWidthSync();
        setClockContentWidth(currentWidthPx, false);

        deferredWidthSyncTimeout = setTimeout(() => {
            stableContentWidthPx = naturalWidthPx;
            setClockContentWidth(naturalWidthPx, true);
            deferredWidthSyncTimeout = null;
        }, 1100);
    }

    function openCalendar() {
        calendar.showForToday();
        const rect = dateEl.getBoundingClientRect();
        const popupWidth = 260; // min-width fallback for initial placement
        let left = rect.left + rect.width / 2 - popupWidth / 2;
        // Clamp to viewport
        left = Math.max(8, Math.min(left, window.innerWidth - popupWidth - 8));
        calendar.el.style.left = `${left}px`;
        calendar.el.style.top = `${rect.top - 8}px`;
        calendar.el.style.transform = "translateY(-100%)";
        calendar.el.style.display = "";
        calendarOpen = true;
    }

    function closeCalendar() {
        calendar.el.style.display = "none";
        calendarOpen = false;
    }

    dateEl.style.cursor = "pointer";
    dateEl.addEventListener("click", (e) => {
        e.stopPropagation();
        calendarOpen ? closeCalendar() : openCalendar();
    }, { signal });

    document.addEventListener("click", (e) => {
        if (calendarOpen && !calendar.el.contains(e.target)) {
            closeCalendar();
        }
    }, { signal });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && calendarOpen) closeCalendar();
    }, { signal });

    // ── Clock tick ───────────────────────────────────────────────────
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    function tick() {
        const now = new Date();
        const lang = getLanguageWithBrowserFallback();
        const locale = LANG_TO_LOCALE[lang] || "en-GB";
        const tip = buildOccurrenceTip(now, locale, lang);
        weekdayEl.textContent = now.toLocaleDateString(locale, { weekday: "long", timeZone: tz });
        weekEl.textContent = `${WEEK_LABELS[lang] || "week"} ${getISOWeekNumber(now)}`;
        dayGroupEl.title = tip;
        dateEl.textContent = formatIsoCalendarDate(now, tz);
        timeEl.textContent = now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: tz });
        timeEl.title = (TZ_TIPS[lang] || TZ_TIPS.en)(tz);
        syncClockContentWidth();
    }

    tick();
    const intervalId = setInterval(tick, 1000);
    bar.destroy = () => {
        lifetimeController.abort();
        clearInterval(intervalId);
        clearDeferredWidthSync();
        closeCalendar();
        versionInfoIndicator?.destroy?.();
        calendar.el.remove();
    };

    return bar;
}

const FILTERBAR_TITLE_LANG_KEY_MODE = DEFAULT_TITLE_LANG_KEY_MODE;
const FILTERBAR_COLUMN_WIDTH_CSS = `${FILTERBAR_COLUMN_WIDTH_PX}px`;
const FILTERBAR_PANEL_MODES = Object.freeze({
    MORPHING: "morphing",
    INLINE_HERO: "inline-hero",
});
const DEFAULT_FILTERBAR_PANEL_MODE = FILTERBAR_PANEL_MODES.MORPHING;
const SHARED_TOPBAR_TRANSITION_DURATION_MS = 260;
const FILTERBAR_PANEL_HIDE_CONTENT_DELAY_MS = 700;

// fetchTableMeta moved to filterbar_service.js
// getVisibilityKey, getStoredVisibility, setStoredVisibility moved to filterbar_visibility_handler.js
// clearAllFilters moved to filterbar_ui.js
// ensureTableContainers, buildTopRow moved to filterbar_ui.js
// ensureOverlayStateListenersAttached, updateOverlayState moved to filterbar_visibility_handler.js
// setFilterBarVisibility, updateShowFilterBarButtonPosition, checkWindowWidth moved to filterbar_visibility_handler.js

function resolveFilterbarPanelMode(modeRaw) {
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

function createDatasetTitleIcon(iconKey, className = "filterbar-dataset-title-icon") {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add(className);
    svg.setAttribute("viewBox", "0 -960 960 960");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", getTabIconPath(iconKey));
    path.setAttribute("fill", "currentColor");
    svg.appendChild(path);
    return svg;
}

function resolveDatasetIconKey(tableName, tableSpec = {}) {
    if (tableSpec.icon_key) {
        return tableSpec.icon_key;
    }
    if (tableName === "system_users") {
        return "group_filled";
    }
    return undefined;
}

function resolveDatasetHeaderTitleOverride(tableName, tableSpec = {}) {
    if (typeof tableSpec.display_name !== "string") {
        return "";
    }

    const trimmedDisplayName = tableSpec.display_name.trim();
    if (!trimmedDisplayName) {
        return "";
    }

    if (trimmedDisplayName === String(tableName || "").trim()) {
        return "";
    }

    return trimmedDisplayName;
}

function buildFilterbarHeroHeader(tableName, {
    headerTitleOverride = "",
    sloganOverride = "",
    iconKey = undefined,
} = {}) {
    const header = document.createElement("div");
    header.classList.add("morphing-header");

    const heroIcon = createDatasetTitleIcon(iconKey, "filterbar-hero-dataset-icon");
    if (tableName === "system_users") {
        heroIcon.classList.add("filterbar-hero-dataset-icon--users");
    }
    header.appendChild(heroIcon);

    const titleEl = document.createElement("h1");
    titleEl.classList.add("morphing-title");
    const datasetTitle = document.createElement("span");
    datasetTitle.classList.add("morphing-title__dataset-name");
    datasetTitle.dataset.langKey = `${tableName}_front_page`;
    datasetTitle.textContent = headerTitleOverride || tableName;

    const siteName = formatSiteNameForDisplay(getCurrentSiteName());
    if (siteName) {
        const siteTitle = document.createElement("span");
        siteTitle.classList.add("morphing-title__site-name");
        siteTitle.textContent = siteName;

        const titleSeparator = document.createElement("span");
        titleSeparator.classList.add("morphing-title__separator");
        titleSeparator.textContent = " – ";
        titleEl.append(siteTitle, titleSeparator);
    }
    titleEl.appendChild(datasetTitle);

    const subtitleEl = document.createElement("p");
    subtitleEl.classList.add("morphing-subtitle");
    if (sloganOverride) {
        subtitleEl.textContent = sloganOverride;
    } else {
        subtitleEl.dataset.langKey = `search_slogan_${tableName}`;
        subtitleEl.textContent = `Search ${tableName}`;
    }

    header.appendChild(titleEl);
    header.appendChild(subtitleEl);

    return header;
}

function formatDatasetTitleFallback(tableName) {
    return String(tableName || "")
        .replace(/^app_/, "")
        .replace(/^system_/, "")
        .replace(/_/g, " ")
        .trim()
        .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Dataset";
}

function buildFilterbarDatasetTitleRow(tableName, tableSpec = {}, titleOverride = "") {
    const row = document.createElement("div");
    row.classList.add("filterbar-dataset-title-row");

    row.appendChild(createDatasetTitleIcon(resolveDatasetIconKey(tableName, tableSpec)));

    const label = document.createElement("span");
    label.classList.add("filterbar-dataset-title-text");
    label.dataset.langKey = tableName;
    label.textContent = titleOverride || formatDatasetTitleFallback(tableName);
    row.appendChild(label);

    return row;
}

function buildSharedTopBarDatasetTitle(tableName, titleOverride = "") {
    const title = document.createElement("div");
    title.classList.add("dataset-shared-topbar__dataset-title");
    title.dataset.langKey = tableName;
    title.textContent = titleOverride || formatDatasetTitleFallback(tableName);
    return title;
}

function buildSharedTopBarArticleCloseButton(onClose) {
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.classList.add("dataset-shared-topbar__article-close");
    closeButton.dataset.testid = "shared-topbar-article-close";
    closeButton.title = "Sulje artikkelinäkymä";
    closeButton.setAttribute("aria-label", "Sulje artikkelinäkymä");
    closeButton.setAttribute("aria-hidden", "true");
    closeButton.tabIndex = -1;
    closeButton.hidden = true;
    closeButton.textContent = "×";
    closeButton.addEventListener("click", onClose);
    return closeButton;
}

/**
 * Build the inline-hero companion content used above scrollable dataset content.
 * Between the compact hero surface and the shared dataset-search + sort builders.
 * Exists so inline-hero mode can reuse the same search wiring with lightweight teardown.
 */
function createInlineHeroContent(tableName, {
    headerTitleOverride = "",
    sloganOverride = "",
    iconKey = undefined,
    placeholder = undefined,
    columns = [],
    dataTypes = {},
    resetTargetElement = null,
} = {}) {
    const inlineHeroHost = document.createElement("div");
    inlineHeroHost.classList.add("filterbar-inline-hero");
    inlineHeroHost.dataset.filterbarInlineHeroFor = tableName;

    const heroInner = document.createElement("div");
    heroInner.classList.add("filter-content-inner");
    heroInner.appendChild(
        buildFilterbarHeroHeader(tableName, {
            headerTitleOverride,
            sloganOverride,
            iconKey,
        })
    );

    const searchPanel = createDatasetSearchPanel(tableName, {
        variant: "content-hero",
        panelClasses: ["dataset-search-panel", "dataset-search-panel--content-hero"],
        skipHeader: true,
        placeholder,
    });
    heroInner.appendChild(searchPanel.element);

    const heroSortRow = document.createElement("div");
    heroSortRow.classList.add(
        "dataset-filter-primary-actions",
        "dataset-filter-primary-actions--query",
        "dataset-filter-row-spread",
        "filterbar-inline-hero-sort-row"
    );
    heroSortRow.appendChild(createSortDropdown(tableName, columns, dataTypes));
    const resetSearchBtn = document.createElement("button");
    resetSearchBtn.classList.add("reset-search-button", "fw-btn");
    resetSearchBtn.dataset.testid = "btn-reset-search-content-hero";
    resetSearchBtn.dataset.langKey = "reset_search";
    resetSearchBtn.textContent = "Reset search";
    resetSearchBtn.addEventListener("click", () =>
        clearAllFilters(tableName, resetTargetElement || inlineHeroHost)
    );
    heroSortRow.appendChild(resetSearchBtn);
    heroInner.appendChild(heroSortRow);

    inlineHeroHost.appendChild(heroInner);
    inlineHeroHost.destroy = () => {
        searchPanel.destroy?.();
    };
    return inlineHeroHost;
}

function buildTextSearchFilterSection(tableName, {
    placeholder = undefined,
    showLocationCheckbox = false,
    columns = [],
    dataTypes = {},
} = {}) {
    const row = document.createElement("div");
    row.classList.add("row-container", "filterbar-text-search-row");

    const searchPanel = createDatasetSearchPanel(tableName, {
        variant: "filter-stack",
        panelClasses: [
            "dataset-search-panel",
            "dataset-search-panel--filter-stack",
        ],
        skipHeader: true,
        placeholder,
        searchComponentOptions: {
            showLocationCheckbox,
        },
    });
    row.appendChild(searchPanel.element);

    const searchControls = document.createElement("div");
    searchControls.classList.add(
        "dataset-filter-primary-actions",
        "dataset-filter-primary-actions--query",
        "dataset-filter-row-spread",
        "filterbar-text-search-controls"
    );
    const sortDropdown = createSortDropdown(tableName, columns, dataTypes);
    const resetSearchBtn = document.createElement("button");
    resetSearchBtn.classList.add("reset-search-button", "fw-btn");
    resetSearchBtn.dataset.testid = "btn-reset-search-filter-stack";
    resetSearchBtn.dataset.langKey = "reset_search";
    resetSearchBtn.textContent = "Reset search";
    resetSearchBtn.addEventListener("click", () => clearAllFilters(tableName, row));
    searchControls.append(sortDropdown, resetSearchBtn);
    row.appendChild(searchControls);

    return {
        key: "text_search",
        title: "Tekstihaku",
        content: row,
        destroy: () => {
            searchPanel.destroy?.();
            sortDropdown.destroy?.();
        },
    };
}

/**
 * Populate a filterbar content container with search, top-row, and filter controls.
 * Between dataset metadata, filter/search sub-builders, and the mounted filterbar shell.
 * Exists so the outer filterbar builder can reuse one assembly path for multiple panel modes.
 */
export function createFilterBarContent(container, {
    tableName,
    tableUID,
    columns,
    dataTypes,
    rowCount,
    hasGeo,
    currentView,
    headerActions = [],
    variant = "filterbar",
    includeOverviewSearch = show_filterbar_search_overview_section,
}) {
    const destroyCallbacks = [];
    const tableSpecs = getAllSpecs();
    const tableSpec = tableSpecs[tableName] || {};

    // Metadata from server
    // Note: fetchTableMeta is async and usually called before this or independently.
    // Here we just cache what we got.
    const meta = { rowCount, hasGeo };
    tableMetaCache[tableName] = meta;

    let searchPanel = null;
    if (includeOverviewSearch) {
        /* ---------- Search Panel ----------------------------------- */
        const titleLangKeyMode =
            tableSpecs[tableName]?.filterbar_title_lang_key_mode ||
            FILTERBAR_TITLE_LANG_KEY_MODE;

        const searchPanelOptions = {
            variant,
            titleLangKeyMode,
            headerActions,
            skipHeader: true,
            placeholder: tableSpec.search_placeholder || undefined,
        };

        searchPanel = createDatasetSearchPanel(tableName, searchPanelOptions);
        destroyCallbacks.push(() => searchPanel.destroy?.());

        /* ---------- Results Count (above search) ------------------- */
        let resultsCountEl = document.getElementById(`${tableName}_results_count`);
        if (!resultsCountEl) {
            resultsCountEl = document.createElement("div");
            resultsCountEl.id = `${tableName}_results_count`;
            resultsCountEl.classList.add("results_count");
        }
        resultsCountEl.classList.add("filterbar_results_count");
        container.appendChild(resultsCountEl);
        setResultsCount(tableName, rowCount);

        container.appendChild(searchPanel.element);
    }

    /* ---------- TopRow ---------------------------------------- */
    const topRow = buildTopRow(
        tableUID,
        tableName,
        currentView,
        columns,
        dataTypes,
        container
    );
    destroyCallbacks.push(() => topRow.destroy?.());
    container.appendChild(topRow);

    /* ---------- Filters ------------------------------------- */
    const hideFieldsOnCards =
        localStorage.getItem("hide_fields_on_cards") === "true";
    const showVisibilityToggle = !(currentView === "card" && hideFieldsOnCards);

    const visibleColumns = columns.filter(
        (col) =>
            !(
                dataTypes[col]?.hide_in_filter_panel ||
                dataTypes[col]?.hide_everywhere
            )
    );
    if (SHOW_LEGACY_FILTERS) {
        const legacyFilterSection = buildFilterSection(
            tableName,
            visibleColumns,
            dataTypes,
            showVisibilityToggle
        );
        destroyCallbacks.push(() => legacyFilterSection.destroy?.());
        container.appendChild(legacyFilterSection);
    }

    /* ---------- Column View Presets ----------------------------- */
    const columnPresetRow = buildColumnViewPresetSelector(tableName, visibleColumns);
    destroyCallbacks.push(() => columnPresetRow.destroy?.());
    container.appendChild(columnPresetRow);

    const textSearchFilterSection = buildTextSearchFilterSection(tableName, {
        placeholder: tableSpec.search_placeholder || undefined,
        showLocationCheckbox: hasGeo,
        columns,
        dataTypes,
    });
    destroyCallbacks.push(() => textSearchFilterSection.destroy?.());

    const secondaryFilterBar = build_favefox_style_filter_bar_from_columns(
        tableName,
        visibleColumns,
        dataTypes,
        showVisibilityToggle,
        {
            layoutMode: FAVEFOX_FILTER_LAYOUT_MODE,
            prependSections: [textSearchFilterSection],
        }
    );
    const secondaryFilterContent = document.createElement("div");
    while (secondaryFilterBar.firstChild) {
        secondaryFilterContent.appendChild(secondaryFilterBar.firstChild);
    }
    buildFilterbarDisclosureSection({
        iconPath: "/frontend/icons/general/filter-list-icon.svg",
        iconClassName: "filterbar-section-heading-icon--filters",
        langKey: "filters",
        fallbackText: "Suodattimet",
        contentElement: secondaryFilterContent,
        sectionElement: secondaryFilterBar,
        sectionClassNames: ["filterbar-filters-section"],
        contentClassNames: ["favefox-filterbar-disclosure-content"],
        startOpen: false,
    });
    secondaryFilterBar.dataset.filterbarSectionKey = "filters";
    container.appendChild(secondaryFilterBar);

    return {
        searchPanel,
        destroy() {
            destroyCallbacks.forEach((callback) => {
                try {
                    callback();
                } catch (err) {
                    console.warn("filter_bar_builder: destroy callback failed", err);
                }
            });
        },
    };
}

/**
 * Build and mount the unified filterbar for one dataset view.
 * Between dataset view rendering, filter/search sub-builders, and responsive panel state.
 * Exists to keep one mounted filterbar instance in sync with the active dataset view surface.
 */
export function create_filter_bar(
    tableName,
    tableUID,
    columns,
    dataTypes,
    rowCount = null,
    hasGeo = false,
    currentView
) {
    const WIDE_MODE_ENTER_THRESHOLD_PX = 8;
    const COMPACT_MODE_ENTER_THRESHOLD_PX = 48;
    const COMPACT_BODY_SCROLLED_ENTER_THRESHOLD_PX = 24;
    const COMPACT_BODY_SCROLLED_EXIT_THRESHOLD_PX = 6;
    const COMPACT_BODY_SCROLLED_MIN_ENTER_RANGE_PX = 320;
    const COMPACT_BODY_SCROLLED_MIN_STAY_RANGE_PX = 64;
    const tablePartsContainer = ensureTableContainers(tableName);
    const tableSpecs = getAllSpecs();
    const tableSpec = tableSpecs[tableName] || {};
    const datasetIconKey = resolveDatasetIconKey(tableName, tableSpec);
    const initialResponsivePanelState = buildInitialResponsivePanelState({
        storedVisibility: getStoredVisibility(tableName),
        dbDefault: tableSpec.filterbar_visible_by_default,
        isNarrowScreen: window.innerWidth < FILTERBAR_BREAKPOINT_PX,
    });
    const panelMode = resolveFilterbarPanelMode(FILTERBAR_PANEL_MODE);
    const headerTitleOverride = resolveDatasetHeaderTitleOverride(tableName, tableSpec);
    const sloganOverride = typeof tableSpec.search_slogan === "string"
        ? tableSpec.search_slogan.trim()
        : "";
    const searchPlaceholder = tableSpec.search_placeholder || undefined;
    const contentArea = tablePartsContainer.querySelector(".tab-content-area");
    const contentBody = contentArea?.querySelector(".tab-content-body");
    const mainTableContainer = tablePartsContainer.closest(".content_div");

    const existingPanel = document.getElementById(`${tableName}_filterBar_panel`);
    if (existingPanel) {
        existingPanel.__syncSharedTopBar?.();
        return existingPanel;
    }
    const lifetimeController = new AbortController();
    const { signal } = lifetimeController;

    ensureFilterOverlay();
    tablePartsContainer.dataset.filterbarPanelMode = panelMode;

    // =====================================================
    //  1. BUILD ALL CONTENT (single flex column, no splitting)
    // =====================================================

    const contentInner = document.createElement("div");
    contentInner.classList.add("filter-content-inner");
    contentInner.id = `${tableName}_filterContent`;

    if (show_filterbar_search_overview_section) {
        // Header (title + subtitle)
        const header = buildFilterbarHeroHeader(tableName, {
            headerTitleOverride,
            sloganOverride,
            iconKey: datasetIconKey,
        });
        contentInner.appendChild(header);
    }

    const hideFilterBtn = document.createElement("button");
    hideFilterBtn.classList.add("hide_filter_bar_button", "fw-btn");
    hideFilterBtn.title = "Piilota tai näytä suodatuspalkki";
    hideFilterBtn.appendChild(
        createMaskIconSpan(
            "/frontend/icons/general/filterbar-hide-icon.svg",
            ["filterbar-hide-button-icon"]
        )
    );

    const filterBarContent = createFilterBarContent(contentInner, {
        tableName,
        tableUID,
        columns,
        dataTypes,
        rowCount,
        hasGeo,
        currentView,
        headerActions: [hideFilterBtn],
        variant: "filterbar",
        includeOverviewSearch: show_filterbar_search_overview_section,
    });

    // Move compact-only elements into the panel's lower body so the
    // whole filterbar remains a single visual and DOM unit.
    const panelBody = document.createElement("div");
    panelBody.id = `${tableName}_filterBar_panelBody`;
    panelBody.classList.add("filterbar-panel-body", "filterbar-panel-body--hidden");

    for (const sel of [
        ".dataset-filter-top-grid",
        ".column-preset-row",
        ".favefox-filterbar-wrapper",
    ]) {
        const el = contentInner.querySelector(sel);
        if (!el) continue;
        if (el.classList.contains("dataset-filter-top-grid")) {
            while (el.firstElementChild) {
                panelBody.appendChild(el.firstElementChild);
            }
            el.remove();
            continue;
        }
        panelBody.appendChild(el);
    }

    let overviewSection = null;
    if (show_filterbar_search_overview_section) {
        overviewSection = buildFilterbarDisclosureSection({
            iconPath: "/frontend/icons/general/dataset-search-icon.svg",
            iconClassName: "filterbar-section-heading-icon--search-controls",
            langKey: "search_and_overview",
            fallbackText: "Haku ja yleiskuva",
            contentElement: contentInner,
            sectionClassNames: ["filterbar-overview-section"],
            startOpen: false,
        });
        overviewSection.dataset.filterbarSectionKey = "search_overview";
        panelBody.appendChild(overviewSection);
    }
    const sectionOrdering = setupFilterbarSectionOrdering(panelBody);

    // =====================================================
    //  2. CREATE SHARED PANEL (header + search + sort)
    // =====================================================

    const panel = document.createElement("div");
    panel.id = `${tableName}_filterBar_panel`;
    panel.classList.add(
        "filterbar-panel",
        panelMode === FILTERBAR_PANEL_MODES.INLINE_HERO
            ? "filterbar-panel--compact"
            : "filterbar-panel--wide"
    );
    if (!initialResponsivePanelState.shouldShowPanel) {
        panel.classList.add("filterbar-panel--hidden");
    }
    panel.dataset.filterbarPanelMode = panelMode;

    const panelToggleDock = document.createElement("div");
    panelToggleDock.classList.add("filterbar-panel__toggle-dock");
    panelToggleDock.appendChild(hideFilterBtn);
    panel.appendChild(panelToggleDock);
    const datasetTitleRow = buildFilterbarDatasetTitleRow(
        tableName,
        tableSpec,
        headerTitleOverride
    );
    panel.appendChild(datasetTitleRow);

    const chatDock = appendChatUIIfAllowed(tableName, null, {
        tableDisplayName: headerTitleOverride,
    });

    // Clock bar — compact-mode footer inside the same unified panel.
    const clockBar = buildClockBar();
    panel.appendChild(panelBody);
    if (chatDock) {
        panel.appendChild(chatDock);
    }
    panel.appendChild(clockBar);
    tablePartsContainer.appendChild(panel);

    // =====================================================
    //  3. SCROLL SENTINEL
    // =====================================================
    const scrollSentinel = document.createElement("div");
    scrollSentinel.classList.add("filterbar-scroll-sentinel");
    const inlineHeroHost = panelMode === FILTERBAR_PANEL_MODES.INLINE_HERO
        ? createInlineHeroContent(tableName, {
            headerTitleOverride,
            sloganOverride,
            iconKey: datasetIconKey,
            placeholder: searchPlaceholder,
            columns,
            dataTypes,
            resetTargetElement: tablePartsContainer,
        })
        : null;

    // =====================================================
    //  4. FIXED TOGGLE BUTTON
    // =====================================================
    const fixedToggleButton = document.createElement("button");
    fixedToggleButton.classList.add("filterbar-fixed-toggle");
    fixedToggleButton.dataset.testid = "filterbar-toggle";
    fixedToggleButton.title = "Näytä/piilota suodatuspalkki";
    fixedToggleButton.setAttribute("aria-hidden", "true");
    fixedToggleButton.tabIndex = -1;
    fixedToggleButton.appendChild(
        createMaskIconSpan(
            "/frontend/icons/general/filterbar-toggle-icon.svg",
            ["filterbar-fixed-toggle-icon"]
        )
    );
    tablePartsContainer.appendChild(fixedToggleButton);

    const showMenuButton = document.getElementById("showMenuButton");
    const hideMenuButton = document.getElementById("hideMenuButton");
    const sharedTopBarOwner = { tableName };
    const sharedTopBar = document.createElement("div");
    sharedTopBar.classList.add("dataset-shared-topbar", "filterbar-search-only");
    sharedTopBar.dataset.filterbarSharedTopbarFor = tableName;
    sharedTopBar.hidden = true;
    sharedTopBar.setAttribute("aria-hidden", "true");
    sharedTopBar.inert = true;

    const sharedTopBarInner = document.createElement("div");
    sharedTopBarInner.classList.add("dataset-shared-topbar__inner");

    const sharedTopBarStart = document.createElement("div");
    sharedTopBarStart.classList.add(
        "dataset-shared-topbar__slot",
        "dataset-shared-topbar__slot--start"
    );
    const sharedTopBarMenuSlot = document.createElement("div");
    sharedTopBarMenuSlot.classList.add("dataset-shared-topbar__menu-slot");
    sharedTopBarMenuSlot.hidden = true;
    sharedTopBarStart.append(
        sharedTopBarMenuSlot,
        buildSharedTopBarDatasetTitle(tableName, headerTitleOverride)
    );

    const sharedTopBarCenter = document.createElement("div");
    sharedTopBarCenter.classList.add("dataset-shared-topbar__center");

    const sharedTopBarEnd = document.createElement("div");
    sharedTopBarEnd.classList.add(
        "dataset-shared-topbar__slot",
        "dataset-shared-topbar__slot--end"
    );
    const sharedTopBarArticleClose = buildSharedTopBarArticleCloseButton(() => {
        const articleCloseButton = tablePartsContainer.querySelector(
            ".active_row_article .big_card_close"
        );
        articleCloseButton?.click();
    });
    sharedTopBarEnd.appendChild(sharedTopBarArticleClose);

    const sharedTopBarSearch = createDatasetSearchPanel(tableName, {
        variant: "search-only",
        panelClasses: ["dataset-search-panel"],
        skipHeader: true,
        placeholder: searchPlaceholder,
        searchComponentOptions: {
            showLocationCheckbox: false,
        },
    });
    sharedTopBarCenter.appendChild(sharedTopBarSearch.element);
    sharedTopBarInner.append(
        sharedTopBarStart,
        sharedTopBarCenter,
        sharedTopBarEnd
    );
    sharedTopBar.appendChild(sharedTopBarInner);

    if (contentArea && contentBody) {
        contentArea.insertBefore(sharedTopBar, contentBody);
    } else {
        tablePartsContainer.insertBefore(sharedTopBar, tablePartsContainer.firstChild);
    }

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
    let autoCollapsedForNarrow = initialResponsivePanelState.autoCollapsedForNarrow;
    let sharedTopBarHideTimer = null;
    let sharedTopBarShowFrame = 0;
    let compactBodyHideTimer = null;
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

    function clearSharedTopBarTransitionTimers() {
        if (sharedTopBarHideTimer !== null) {
            clearTimeout(sharedTopBarHideTimer);
            sharedTopBarHideTimer = null;
        }

        if (sharedTopBarShowFrame) {
            cancelAnimationFrame(sharedTopBarShowFrame);
            sharedTopBarShowFrame = 0;
        }
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

    function setSharedTopBarAccessibility(isInteractive) {
        sharedTopBar.setAttribute("aria-hidden", isInteractive ? "false" : "true");
        sharedTopBar.inert = !isInteractive;

        if (!isInteractive) {
            const activeElement = document.activeElement;
            if (activeElement instanceof HTMLElement && sharedTopBar.contains(activeElement)) {
                activeElement.blur();
            }
        }
    }

    function setSharedTopBarArticleCloseVisibility(shouldShowClose) {
        sharedTopBarArticleClose.hidden = !shouldShowClose;
        sharedTopBarArticleClose.setAttribute(
            "aria-hidden",
            shouldShowClose ? "false" : "true"
        );
        sharedTopBarArticleClose.tabIndex = shouldShowClose ? 0 : -1;
    }

    function setSharedTopBarVisibility(shouldShowBar) {
        tablePartsContainer.dataset.sharedTopbarVisible = shouldShowBar
            ? "true"
            : "false";

        if (shouldShowBar) {
            clearSharedTopBarTransitionTimers();
            sharedTopBar.hidden = false;
            setSharedTopBarAccessibility(true);
            sharedTopBar.getBoundingClientRect();
            sharedTopBarShowFrame = requestAnimationFrame(() => {
                sharedTopBarShowFrame = 0;
                sharedTopBar.classList.add("dataset-shared-topbar--visible");
            });
            return;
        }

        setSharedTopBarAccessibility(false);
        sharedTopBar.classList.remove("dataset-shared-topbar--visible");

        if (sharedTopBar.hidden) {
            return;
        }

        clearSharedTopBarTransitionTimers();
        sharedTopBarHideTimer = setTimeout(() => {
            sharedTopBarHideTimer = null;
            if (!sharedTopBar.classList.contains("dataset-shared-topbar--visible")) {
                sharedTopBar.hidden = true;
            }
        }, SHARED_TOPBAR_TRANSITION_DURATION_MS);
    }

    function syncSharedTopBar() {
        const navbarVisible = isNavbarVisible();
        const filterbarVisible = !isHidden();
        const shouldShowBar =
            isSharedTopBarHostActive(sharedTopBar) &&
            shouldShowSharedTopBar({
                navbarVisible,
                filterbarVisible,
                bigCardOpen,
                allowBigCardSearchBar: show_search_only_bar_in_big_card_view,
            });

        setSharedTopBarVisibility(shouldShowBar);
        setSharedTopBarArticleCloseVisibility(shouldShowBar && bigCardOpen);

        restoreButtonFromSharedTopBar(fixedToggleButton, sharedTopBarOwner);
        restoreButtonFromSharedTopBar(hideMenuButton, sharedTopBarOwner);
        restoreButtonFromSharedTopBar(showMenuButton, sharedTopBarOwner);

        const shouldShowMenuButton =
            shouldShowBar && !navbarVisible && Boolean(showMenuButton);
        sharedTopBarMenuSlot.hidden = !shouldShowMenuButton;
        if (shouldShowMenuButton) {
            dockButtonIntoSharedTopBar(
                showMenuButton,
                sharedTopBarMenuSlot,
                sharedTopBarOwner
            );
        }

        updateShowMenuButtonPosition();
    }

    function closeOpenFilterDropdowns() {
        panel.querySelectorAll(".msd-dropdown, .vdw-dropdown").forEach((dropdownContainer) => {
            dropdownContainer.__dropdown?.close?.();
        });
    }

    function getChatDockCollapsedHeight() {
        const header = chatDock?.querySelector(".filterbar-chat-dock__header");
        const headerHeight = header?.getBoundingClientRect?.().height || 0;
        if (headerHeight > 0) {
            return headerHeight;
        }
        return 56;
    }

    function getChatDockExpandedHeight() {
        const panelRect = panel.getBoundingClientRect();
        const titleRect = datasetTitleRow?.getBoundingClientRect?.();
        const panelStyles = window.getComputedStyle(panel);
        const reservedBottom = Number.parseFloat(panelStyles.paddingBottom || "0") || 0;
        return Math.max(
            getChatDockCollapsedHeight(),
            panelRect.height - (titleRect?.height || 0) - reservedBottom
        );
    }

    function setChatDockAnimationHeight(height) {
        const normalizedHeight = `${Math.max(0, height)}px`;
        chatDock.style.height = normalizedHeight;
        chatDock.style.maxHeight = normalizedHeight;
        chatDock.style.flex = `0 0 ${normalizedHeight}`;
    }

    function clearChatDockAnimationStyles() {
        chatDock.style.height = "";
        chatDock.style.maxHeight = "";
        chatDock.style.flex = "";
        chatDock.style.transition = "";
    }

    function animateChatLayout(maximized, onComplete) {
        if (!chatDock) {
            return;
        }

        const animationToken = Symbol("filterbar-chat-animation");
        chatDock.__chatAnimationToken = animationToken;
        const nextMaximized = Boolean(maximized);
        const currentChatHeight = chatDock.getBoundingClientRect().height ||
            getChatDockCollapsedHeight();
        const targetChatHeight = nextMaximized
            ? getChatDockExpandedHeight()
            : getChatDockCollapsedHeight();
        const duration = 240;

        const finishAnimation = () => {
            if (chatDock.__chatAnimationToken !== animationToken) {
                return;
            }
            onComplete?.();
            chatDock.removeEventListener("transitionend", handleChatDockTransitionEnd);
            panel.classList.remove("filterbar-panel--chat-layout-animating");
            clearChatDockAnimationStyles();
            delete chatDock.dataset.chatAnimationDirection;
            delete chatDock.__chatAnimationToken;
        };
        let completed = false;
        const finishOnce = () => {
            if (completed) {
                return;
            }
            completed = true;
            finishAnimation();
        };
        const handleChatDockTransitionEnd = (event) => {
            if (event.target !== chatDock) {
                return;
            }
            if (event.propertyName !== "height") {
                return;
            }
            finishOnce();
        };

        panel.classList.add("filterbar-panel--chat-layout-animating");
        chatDock.style.transition = "none";
        setChatDockAnimationHeight(currentChatHeight);
        void panel.offsetHeight;

        if (nextMaximized) {
            chatDock.__setMaximized?.(true);
            panel.classList.add("filterbar-panel--chat-maximized");
        }

        window.requestAnimationFrame(() => {
            const easing = "cubic-bezier(0.4, 0, 0.2, 1)";
            chatDock.style.transition = [
                `height ${duration}ms ${easing}`,
                `max-height ${duration}ms ${easing}`,
                `flex-basis ${duration}ms ${easing}`,
            ].join(", ");
            setChatDockAnimationHeight(targetChatHeight);
        });

        chatDock.addEventListener("transitionend", handleChatDockTransitionEnd);
        window.setTimeout(finishOnce, duration + 200);
    }

    function setChatMaximized(maximized) {
        if (!chatDock) {
            return;
        }

        const nextMaximized = Boolean(maximized);
        chatDock.dataset.chatAnimationDirection = nextMaximized ? "opening" : "closing";
        if (nextMaximized) {
            closeOpenFilterDropdowns();
            panel.classList.remove("filterbar-panel--body-scrolled");
            panelBody.scrollTop = 0;
            animateChatLayout(true);
            return;
        }

        animateChatLayout(false, () => {
            chatDock.__setMaximized?.(false);
            panel.classList.remove("filterbar-panel--chat-maximized");
            syncPanelBodyScrolledState();
        });
    }

    chatDock?.addEventListener("filterbar-chat-maximize-toggle", (event) => {
        event.preventDefault();
        setChatMaximized(Boolean(event.detail?.maximized));
    }, { signal });

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
            setCompactMode();
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
            applyResponsivePanelVisibility();
            if (!isHidden()) {
                syncModeToScroll();
            }
        }, 150);
    }, { signal });

    // Big-card-open: keep the filterbar available in compact sidebar mode unless
    // the user has explicitly hidden it. This prevents the first filter edit from
    // causing the big-card refresh path to hide the whole filter UI.
    document.addEventListener("big-card-toggle", (e) => {
        if (e.detail?.tableName !== tableName) return;
        bigCardOpen = e.detail.isOpen;
        if (panelManuallyHidden || autoCollapsedForNarrow) {
            hidePanel();
        } else {
            showPanel();
        }
    }, { signal });

    // Close panel on outside click (mobile)
    document.addEventListener("click", (e) => {
        if (!isNarrowScreen()) return;
        if (isHidden()) return;
        const clickedInside =
            panel.contains(e.target) ||
            fixedToggleButton.contains(e.target) ||
            sharedTopBar.contains(e.target);
        if (!clickedInside) {
            panelManuallyHidden = true;
            autoCollapsedForNarrow = false;
            hidePanel();
            setStoredVisibility(tableName, false);
        }
    }, { signal });

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
        clearSharedTopBarTransitionTimers();
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
        filterBarContent.destroy?.();
        sectionOrdering.destroy?.();
        overviewSection?.destroy?.();
        sharedTopBarSearch.destroy?.();
        restoreButtonFromSharedTopBar(showMenuButton, sharedTopBarOwner);
        restoreButtonFromSharedTopBar(hideMenuButton, sharedTopBarOwner);
        restoreButtonFromSharedTopBar(fixedToggleButton, sharedTopBarOwner);
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

    panel.__syncSharedTopBar = syncSharedTopBar;
    panel.destroy = destroyFilterBar;
    return panel;
}
