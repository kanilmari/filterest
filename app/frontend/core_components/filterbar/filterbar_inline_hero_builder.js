// filterbar_inline_hero_builder.js
// Builds the scrolling hero and its dataset navigation.
// Connects the shared dataset filterbar to its existing component builders.
// Keeps one implementation and a bounded lifetime for each mounted surface.

import { toggleNavbarVisibility } from "../navigation/menu_button/navbar_visibility_handler.js";
import { createHeroDatasetTabs } from "../navigation/main_tabs/hero_dataset_tabs.js";
import { buildFilterbarHeroHeader } from "./filterbar_heading_builder.js";
import { encodeCssUrlValue, resolveDatasetMediaDisplayPath } from "../table_views/storage_media_urls.js";
import { createDatasetSearchPanel } from "./text_search/create_text_search_panel.js";
import { createSortDropdown } from "./top_row_buttons/sort_dropdown_builder.js";
import { createTemporaryFiltersToggleButton } from "./filters_opener_and_closer.js";
import { clearAllFilters } from "./top_row_buttons/top_row_builder.js";
import { mountDatasetCoverTestPalette } from "../admin_tools/dataset_cover_test_palette.js";

export function buildSharedTopBarMenuButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.classList.add("dataset-shared-topbar__menu-button");
    button.dataset.testid = "shared-topbar-menu-button";
    button.dataset.navbarMenuButton = "true";
    button.title = "Menu";
    button.setAttribute("aria-label", "Menu");
    button.setAttribute("aria-controls", "navbar");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-hidden", "true");
    button.tabIndex = -1;
    button.textContent = "☰";
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleNavbarVisibility();
    });
    return button;
}

/**
 * Build the inline-hero companion content used above scrollable dataset content.
 * Between the compact hero surface and the shared dataset-search + sort builders.
 * Exists so inline-hero mode can reuse the same search wiring with lightweight teardown.
 */
export function createInlineHeroContent(tableName, {
    headerTitleOverride = "",
    sloganOverride = "",
    iconKey = undefined,
    placeholder = undefined,
    columns = [],
    dataTypes = {},
    resetTargetElement = null,
    coverImagePath = "",
    allowDatasetManagement = true,
    appearanceActions,
    sortOptions = {},
    deferFilterSection = false,
} = {}) {
    const inlineHeroHost = document.createElement("div");
    inlineHeroHost.classList.add("filterbar-inline-hero");
    inlineHeroHost.dataset.filterbarInlineHeroFor = tableName;
    const topRow = document.createElement("div");
    topRow.className = "filterbar-inline-hero__top-row";
    const heroActions = document.createElement("div");
    heroActions.className = "filterbar-inline-hero__actions";
    const heroDatasetTabs = createHeroDatasetTabs(tableName);
    topRow.append(heroDatasetTabs.element, heroActions);
    inlineHeroHost.appendChild(topRow);
	if (coverImagePath) {
		inlineHeroHost.classList.add("filterbar-inline-hero--has-cover");
		inlineHeroHost.style.setProperty(
			"--dataset-cover-image",
			encodeCssUrlValue(resolveDatasetMediaDisplayPath(coverImagePath))
		);
	}

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
        placeholder,
    });
    heroInner.appendChild(searchPanel.element);

    const heroSortRow = document.createElement("div");
    heroSortRow.classList.add(
        "dataset-filter-primary-actions",
        "dataset-filter-primary-actions--query",
        "filterbar-inline-hero-sort-row"
    );
    const heroSortDropdown = createSortDropdown(tableName, columns, dataTypes, {
        ...sortOptions, allowPersistentDefault: allowDatasetManagement,
    });
    heroSortRow.appendChild(heroSortDropdown);

    const heroFilterActions = document.createElement("div");
    heroFilterActions.classList.add(
        "dataset-filter-primary-actions",
        "filterbar-inline-hero-filter-actions"
    );
    heroFilterActions.appendChild(
        createTemporaryFiltersToggleButton(tableName, "content-hero")
    );
    const resetSearchBtn = document.createElement("button");
    resetSearchBtn.classList.add("reset-search-button", "fw-btn");
    resetSearchBtn.dataset.testid = "btn-reset-search-content-hero";
    resetSearchBtn.dataset.langKey = "reset_search";
    resetSearchBtn.textContent = "Reset search";
    resetSearchBtn.addEventListener("click", () =>
        clearAllFilters(tableName, resetTargetElement || inlineHeroHost)
    );
    heroFilterActions.appendChild(resetSearchBtn);
    const filterSection = document.createElement("div");
    filterSection.id = `${tableName}_dataset_filter_section`;
    filterSection.className = "dataset-filter-section";
    filterSection.dataset.testid = "dataset-filter-section";
    // First-page assembly reveals all three rows together after facets arrive.
    filterSection.hidden = deferFilterSection;
    filterSection.append(heroSortRow, heroFilterActions);
    heroInner.appendChild(filterSection);

    inlineHeroHost.appendChild(heroInner);
    let paletteControl = null;
    let isDestroyed = false;
    if (allowDatasetManagement) void mountDatasetCoverTestPalette(inlineHeroHost, tableName, { canCommit: () => !isDestroyed })
        .then((control) => {
            if (isDestroyed) {
                control?.destroy?.();
                return;
            }
            paletteControl = control;
            if (control?.button) appearanceActions?.appendChild(control.button);
        })
        .catch(() => null);
    inlineHeroHost.destroy = () => {
        isDestroyed = true;
        paletteControl?.destroy?.();
        heroDatasetTabs.destroy();
        filterSection.querySelector('.row-group-facets')?.disposeRowGroupPanel?.();
        heroSortDropdown.destroy?.();
        searchPanel.destroy?.();
    };
    return inlineHeroHost;
}
