// accordion_filter_builder.js
// Builds favefox-style accordion filter sections with CSS-animated expand and collapse behavior.
// Bridges filter section data and DOM construction with filterbar state persistence.
// Exists to encapsulate accordion animation and opened-filter persistence in one builder.

import { buildFilterControlParts } from "../filter_column_builder.js";
import { shouldHideRedundantGeneratedForeignDisplayColumn } from "../filter_column_builder_helpers.js";
import {
    getOpenedFilters,
    hasOpenedFiltersSaved,
    saveOpenedFilters,
} from "../../filterbar_engine/filterbar_state_saver.js";
import { createCollapsibleHeightController } from "../../../../reusable_components/collapsible_height/collapsible_height_controller.js";
import { FAVEFOX_FILTER_LAYOUT_MODE } from "../../../../ui_config.js";

const FAVEFOX_FILTER_LAYOUT_MODES = Object.freeze({
    ACCORDION: "accordion",
    INLINE_OPEN: "inline-open",
});

function resolveFavefoxFilterLayoutMode(modeRaw) {
    const normalizedMode = String(modeRaw || "")
        .trim()
        .toLowerCase();

    if (normalizedMode === FAVEFOX_FILTER_LAYOUT_MODES.INLINE_OPEN) {
        return FAVEFOX_FILTER_LAYOUT_MODES.INLINE_OPEN;
    }

    return FAVEFOX_FILTER_LAYOUT_MODES.ACCORDION;
}

/**
 * Compose favefox section content from the shared filter controls without building
 * a legacy filter header that would need to be removed afterward.
 *
 * @param {string} tableName
 * @param {string} column
 * @param {*} colType
 * @param {boolean} showVisibilityToggle
 * @returns {{row: HTMLDivElement, sortButton: HTMLButtonElement, displayModeControls: HTMLDivElement|null, visibilityToggle: HTMLInputElement|null}}
 */
function createFavefoxFilterRowContent(tableName, column, colType, showVisibilityToggle) {
    const {
        safeTableName,
        safeColumnName,
        visibilityToggle,
        filterElement,
        sortButton,
        displayModeControls,
    } = buildFilterControlParts(tableName, column, colType, {
        showVisibilityToggle,
        includeFieldHeader: false,
        includeFieldLabel: false,
    });

    const row = document.createElement("div");
    row.classList.add("row-container");
    row.dataset.testid = `column-filter-row-${safeTableName}-${safeColumnName}`;
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = ".5rem";

    row.appendChild(filterElement);

    return { row, sortButton, displayModeControls, visibilityToggle };
}

export function create_favefox_style_filter_bar(table_name, sections = [], options = {}) {
    const layoutMode = resolveFavefoxFilterLayoutMode(
        options.layoutMode ?? FAVEFOX_FILTER_LAYOUT_MODE
    );
    const useInlineOpenLayout = layoutMode === FAVEFOX_FILTER_LAYOUT_MODES.INLINE_OPEN;
    const opened = useInlineOpenLayout ? new Set() : new Set(getOpenedFilters(table_name));

    // If no saved preferences exist, open the first filter by default
    const isFirstVisit = !useInlineOpenLayout && !hasOpenedFiltersSaved(table_name);
    if (isFirstVisit && sections.length > 0) {
        opened.add(sections[0].key);
        saveOpenedFilters(table_name, Array.from(opened));
    }

    const wrapper = document.createElement('div');
    wrapper.classList.add('favefox-filterbar-wrapper');
    wrapper.dataset.layoutMode = layoutMode;
    if (useInlineOpenLayout) {
        wrapper.classList.add('favefox-filterbar-wrapper--inline-open');
    }

    const barContainer = document.createElement('div');
    barContainer.classList.add('favefox-filterbar');
    if (useInlineOpenLayout) {
        barContainer.classList.add('favefox-filterbar--inline-open');
    }
    const barHeightController = useInlineOpenLayout
        ? null
        : createCollapsibleHeightController(barContainer, {
            startExpanded: true,
            hiddenWhenCollapsed: false,
        });

    const scrollArea = document.createElement('div');
    scrollArea.classList.add('favefox-filterbar-scroll');
    if (useInlineOpenLayout) {
        scrollArea.classList.add('favefox-filterbar-scroll--inline-open');
    }
    scrollArea.appendChild(barContainer);
    wrapper.appendChild(scrollArea);

    barContainer.adjustSideModeHeight = () => {
        if (useInlineOpenLayout) {
            barContainer.style.removeProperty("height");
            return;
        }
        barHeightController.sync({ animate: false });
    };

    sections.forEach(({ key, title, content, sortButton, displayModeControls, visibilityToggle }) => {
        const sectionWrapper = document.createElement('div');
        sectionWrapper.classList.add('filter-section');
        if (useInlineOpenLayout) {
            sectionWrapper.classList.add('filter-section--inline-open', 'section-expanded');
        }

        const headerContainer = document.createElement('div');
        headerContainer.classList.add('filter-header');
        if (useInlineOpenLayout) {
            headerContainer.classList.add('filter-header--static');
        }

        const headerLead = document.createElement('div');
        headerLead.classList.add('filter-header-lead');

        let sectionToggleBtn = null;
        if (!useInlineOpenLayout) {
            sectionToggleBtn = document.createElement('button');
            sectionToggleBtn.classList.add('toggle-filters-button');
            sectionToggleBtn.type = 'button';
            headerLead.appendChild(sectionToggleBtn);
        }

        const titleElem = document.createElement('h3');
        titleElem.dataset.langKey = key;
        titleElem.textContent = title;
        headerLead.appendChild(titleElem);
        headerContainer.appendChild(headerLead);

        const headerActions = document.createElement('div');
        headerActions.classList.add('filter-section-header-actions');

        const hoverActions = document.createElement('div');
        hoverActions.classList.add('filter-section-hover-actions');
        if (displayModeControls) {
            hoverActions.appendChild(displayModeControls);
        }
        if (sortButton) {
            sortButton.addEventListener('click', (e) => e.stopPropagation());
            hoverActions.appendChild(sortButton);
        }
        if (hoverActions.childElementCount > 0) {
            headerActions.appendChild(hoverActions);
        }

        if (visibilityToggle) {
            visibilityToggle.addEventListener('click', (e) => e.stopPropagation());
            const persistentActions = document.createElement('div');
            persistentActions.classList.add('filter-section-persistent-actions');
            persistentActions.appendChild(visibilityToggle);
            headerActions.appendChild(persistentActions);
        }
        if (headerActions.childElementCount > 0) {
            headerContainer.appendChild(headerActions);
        }

        const contentContainer = document.createElement('div');
        contentContainer.classList.add('filter-content');
        if (useInlineOpenLayout) {
            contentContainer.classList.add('filter-content--inline-open');
        }
        if (content instanceof Node) {
            contentContainer.appendChild(content);
        } else {
            const placeholderText = document.createElement('div');
            placeholderText.textContent = content ?? 'coming soon';
            placeholderText.dataset.langKey = 'coming_soon';
            contentContainer.appendChild(placeholderText);
        }
        const isInitiallyExpanded = useInlineOpenLayout || opened.has(key);
        if (isInitiallyExpanded) {
            contentContainer.classList.add('expanded');
        }

        const contentHeightController = useInlineOpenLayout
            ? null
            : createCollapsibleHeightController(contentContainer, {
                startExpanded: isInitiallyExpanded,
                hiddenWhenCollapsed: true,
                observeResize: true,
            });
        if (useInlineOpenLayout) {
            contentContainer.hidden = false;
            contentContainer.style.height = 'auto';
        } else {
            sectionToggleBtn.setAttribute('aria-expanded', String(isInitiallyExpanded));
            sectionToggleBtn.textContent = isInitiallyExpanded ? '▾' : '▸';
            sectionWrapper.classList.toggle('section-expanded', isInitiallyExpanded);
        }

        function focusFirstInput() {
            const firstInput = Array.from(contentContainer.querySelectorAll(
                'input:not(.column-visibility-toggle), select, textarea'
            )).find((input) => !input.closest('[hidden]'));
            if (firstInput) {
                firstInput.focus();
            }
        }

        function toggle() {
            const isExpanded = contentHeightController.isExpanded();
            const nextExpanded = !isExpanded;

            sectionToggleBtn.setAttribute('aria-expanded', String(nextExpanded));
            sectionToggleBtn.textContent = nextExpanded ? '▾' : '▸';
            sectionWrapper.classList.toggle('section-expanded', nextExpanded);

            if (nextExpanded) {
                contentContainer.classList.add('expanded');
                opened.add(key);
                contentHeightController.expand().then(() => {
                    if (contentHeightController.isExpanded()) {
                        focusFirstInput();
                    }
                });
            } else {
                contentContainer.classList.remove('expanded');
                opened.delete(key);
                contentHeightController.collapse();
            }
            saveOpenedFilters(table_name, Array.from(opened));
        }

        if (!useInlineOpenLayout) {
            headerContainer.addEventListener('click', toggle);
            sectionToggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggle();
            });
        }

        sectionWrapper.appendChild(headerContainer);
        sectionWrapper.appendChild(contentContainer);
        barContainer.appendChild(sectionWrapper);

    });

    return wrapper;
}

/**
 * Build the favefox filterbar directly from column metadata.
 *
 * @param {string} table_name
 * @param {string[]} columns
 * @param {Object<string, object>} data_types
 * @param {boolean} [show_visibility_toggle]
 * @param {{layoutMode?: string, prependSections?: Array<{key: string, title: string, content: Node|string, sortButton?: HTMLButtonElement|null, displayModeControls?: HTMLDivElement|null, visibilityToggle?: HTMLInputElement|null}>}} [options]
 * @returns {HTMLDivElement}
 */
export function build_favefox_style_filter_bar_from_columns(
    table_name,
    columns,
    data_types,
    show_visibility_toggle = true,
    options = {},
) {
    const filterableColumns = columns.filter(
        (column) => !shouldHideRedundantGeneratedForeignDisplayColumn(column, columns, data_types)
    );
    const sorted_columns = [...filterableColumns].sort((a, b) => {
        const aNum =
            data_types[a]?.fco_number ?? data_types[a]?.co_number ?? 0;
        const bNum =
            data_types[b]?.fco_number ?? data_types[b]?.co_number ?? 0;
        return aNum - bNum;
    });

    const prependSections = Array.isArray(options.prependSections)
        ? options.prependSections
        : [];
    const columnSections = sorted_columns.map((col) => {
        const { row, sortButton, displayModeControls, visibilityToggle } = createFavefoxFilterRowContent(
            table_name,
            col,
            data_types[col],
            show_visibility_toggle,
        );
        return {
            key: col,
            title: col,
            content: row,
            sortButton,
            displayModeControls,
            visibilityToggle,
        };
    });

    return create_favefox_style_filter_bar(
        table_name,
        [...prependSections, ...columnSections],
        options
    );
}
