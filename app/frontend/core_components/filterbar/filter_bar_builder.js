// filter_bar_builder.js
// Mounts the dataset filterbar DOM and hands its lifetime to the runtime controller.
// Connects the shared dataset filterbar to its existing component builders.
// Keeps one implementation and a bounded lifetime for each mounted surface.

import { appendChatUIIfAllowed } from "../admin_tools/admin_button_builder.js";
import { createDatasetSearchPanel } from "./text_search/create_text_search_panel.js";
import { ensureTableContainers } from "./top_row_buttons/top_row_builder.js";
import { getAllSpecs } from "../state_stores/table_specs_reader.js";
import { resolveVisibleDatasetMediaPath } from "../table_views/dataset_media_visibility_resolver.js";
import { FILTERBAR_BREAKPOINT_PX, ensureFilterOverlay, getStoredVisibility } from "./filterbar_engine/filterbar_visibility_handler.js";
import { buildInitialResponsivePanelState } from "./filterbar_visibility_resolver.js";
import { FILTERBAR_PANEL_MODE, show_filterbar_search_overview_section } from "../../ui_config.js";
import { createMaskIconSpan } from "../../icons/icon_mask_builder.js";
import { addEnvironmentBadgeIfNeeded } from "../navigation/menu_button/navbar_visibility_handler.js";
import { buildFilterbarDisclosureSection } from "./filterbar_section_heading_builder.js";
import { setupFilterbarSectionOrdering } from "./filterbar_section_order_handler.js";
import { buildClockBar } from "./filterbar_clock_builder.js";
import { resolveDatasetIconKey, resolveDatasetHeaderTitleOverride, buildFilterbarHeroHeader,
    buildFilterbarDatasetTitleRow, buildSharedTopBarDatasetTitle, buildSharedTopBarArticleCloseButton } from "./filterbar_heading_builder.js";
import { createInlineHeroContent, buildSharedTopBarMenuButton } from "./filterbar_inline_hero_builder.js";
import { FILTERBAR_PANEL_MODES, resolveFilterbarPanelMode } from "./filterbar_panel_mode_resolver.js";
import { createFilterBarContent } from "./filterbar_content_builder.js";
import { wireFilterbarRuntime } from "./filterbar_runtime_controller.js";
import { buildFilterbarStyleSection } from "./filterbar_style_section_builder.js";
import { buildMobileSiteIdentity } from "./mobile_site_identity_builder.js";
export { createFilterBarContent, buildTextSearchFilterSection } from "./filterbar_content_builder.js";

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
    currentView,
    surfaceOptions = {},
) {
    const tablePartsContainer = ensureTableContainers(tableName);
    const tableSpecs = getAllSpecs();
    // Explicit extension metadata belongs to this mounted surface, never the global SQL catalog.
    const tableSpec = surfaceOptions.metadata || tableSpecs[tableName] || {};
    const allowDatasetManagement = surfaceOptions.allowDatasetManagement !== false;
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
        variant: "filterbar",
        includeOverviewSearch: show_filterbar_search_overview_section,
        surfaceProviderKey: typeof tableSpec.dataset_surface_provider_key === "string"
            ? tableSpec.dataset_surface_provider_key
            : "",
        surfaceCapabilityKeys: Array.isArray(
            tableSpec.dataset_surface_capability_keys
        )
            ? tableSpec.dataset_surface_capability_keys
            : [],
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
    const styleSettings = buildFilterbarStyleSection(tableName, { allowDatasetManagement });
    panelBody.appendChild(styleSettings.section);
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
    // Temporary consumers must wait for the saved layout before revealing a section.
    panel.__sectionLayoutReady = sectionOrdering.ready;

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

    const chatDock = allowDatasetManagement ? appendChatUIIfAllowed(tableName, null, {
        tableDisplayName: headerTitleOverride,
    }) : null;

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
            allowDatasetManagement,
            appearanceActions: styleSettings.actions,
            sortOptions: surfaceOptions.sortOptions,
			coverImagePath: resolveVisibleDatasetMediaPath(
				tableSpec.dataset_cover_image_path, tableSpec.dataset_cover_image_hidden),
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
    sharedTopBarMenuSlot.setAttribute("aria-hidden", "true");
    sharedTopBarMenuSlot.inert = true;
    const sharedTopBarMenuButton = buildSharedTopBarMenuButton();
    const heroMenuButton = buildSharedTopBarMenuButton();
    heroMenuButton.dataset.testid = "hero-menu-button";
    sharedTopBarMenuSlot.appendChild(sharedTopBarMenuButton);
    addEnvironmentBadgeIfNeeded(sharedTopBarMenuSlot);
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
            ".active_row_article .big_card_close, .active_big_card .big_card_close"
        );
        if (articleCloseButton instanceof HTMLElement) {
            articleCloseButton.click();
            return;
        }

        const cardViewButton = tablePartsContainer.querySelector(
            '.view-selector-buttons [data-testid="view-btn-card"]'
        );
        cardViewButton?.click();
    });
    sharedTopBarEnd.appendChild(sharedTopBarArticleClose);

    const sharedTopBarSearch = createDatasetSearchPanel(tableName, {
        variant: "search-only",
        panelClasses: ["dataset-search-panel"],
        placeholder: searchPlaceholder,
        searchComponentOptions: {
            showLocationCheckbox: false,
        },
    });
    sharedTopBarCenter.append(buildMobileSiteIdentity(), sharedTopBarSearch.element);
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

    return wireFilterbarRuntime({
        tableName, currentView, tablePartsContainer, contentArea, mainTableContainer, initialResponsivePanelState, panelMode, lifetimeController, signal, panel, panelBody, clockBar, chatDock, datasetTitleRow, inlineHeroHost, scrollSentinel, fixedToggleButton, hideFilterBtn, showMenuButton, sharedTopBarOwner, sharedTopBar, sharedTopBarEnd, sharedTopBarMenuButton, sharedTopBarMenuSlot, sharedTopBarArticleClose, sharedTopBarSearch, heroMenuButton, filterBarContent, overviewSection, sectionOrdering, styleSettings
    });
}
