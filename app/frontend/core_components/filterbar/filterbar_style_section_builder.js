// filterbar_style_section_builder.js
// Groups existing appearance, language and theme controls in one disclosure.
// Bridges the shared filter-section/language/theme builders and dataset editors.
// Leaves settings ownership and administrator permissions with their original controls.
import { buildFilterbarDisclosureSection } from './filterbar_section_heading_builder.js';
import { initializeThemeToggle } from '../theme.js';
import { initializeLanguageSelector } from '../lang/lang_panel_printer.js';
import { createDatasetHeaderConfigHeroButton } from '../admin_tools/dataset_header_config_modal.js';

/** Create the filter panel's ordinary translated, reorderable appearance section. */
export function buildFilterbarStyleSection(tableName, { allowDatasetManagement = true } = {}) {
    const lifetime = new AbortController();
    const actions = document.createElement('div');
    actions.className = 'filterbar-style-actions filterbar-inline-hero__actions';
    const theme = document.createElement('button');
    theme.type = 'button';
    theme.className = 'fw-btn';
    theme.dataset.themeToggle = 'true';
    theme.dataset.testid = 'filterbar-theme-toggle';
    initializeThemeToggle(theme);
    const language = document.createElement('div');
    language.className = 'language-selection menu-language-selection';
    initializeLanguageSelector(language, { signal: lifetime.signal, translateOnInitialize: false });
    actions.append(theme, language);
    if (allowDatasetManagement) {
        const gear = createDatasetHeaderConfigHeroButton(tableName);
        if (gear) actions.append(gear);
    }
    const section = buildFilterbarDisclosureSection({
        iconPath: '/frontend/icons/general/view-palette-icon.svg',
        iconClassName: 'filterbar-section-heading-icon--style',
        langKey: 'filterbar_style_and_colors',
        fallbackText: 'Style and color settings',
        contentElement: actions,
        sectionClassNames: ['filterbar-style-section'],
        startOpen: false,
    });
    section.dataset.filterbarSectionKey = 'style';
    const destroyDisclosure = section.destroy;
    section.destroy = () => { lifetime.abort(); destroyDisclosure?.(); };
    return { section, actions };
}
