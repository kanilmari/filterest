<!-- Frontend_Guide.md: indexes the guides to maintained browser components and interactions. -->
<!-- Connects readers and older section links with the focused guide that owns each topic. -->
<!-- Exists to keep frontend behavior and accessibility guidance aligned with the product. -->
<!-- Installation-specific operator procedures remain outside these shared guides. -->

# Frontend Guide

This document consolidates information regarding Filterest's frontend architecture, UI components, configuration, and accessibility standards.

For the future admin/media architecture behind image linking and broader asset support, see [Asset_Linking_Architecture.md](Asset_Linking_Architecture.md).

The guide is divided into focused guides in this folder. Add new frontend text to the guide that owns its topic and keep every file well within the 700-line limit; when a topic needs a guide of its own, add it to the table below.

## Focused guides

| Guide | Covers |
|---|---|
| [Category panel and dropdowns](Frontend_Category_Panel_And_Dropdowns.md) | The administrator's Classes and categories window, how a results page resolves category selections, the category panel and selected filters row, the shared multiselect dropdown and its callers, and the vanilla dropdown component. |
| [Results, cards and articles](Frontend_Results_Cards_And_Articles.md) | How search results reach the card, table and tree views, where each browser tab keeps a dataset's view and open row, and the image and attachment surfaces of the article view and the add-row modal. |
| [UI configuration](Frontend_UI_Configuration.md) | The administrator Site information panel in the clock bar and the interface flags collected in `ui_config.js`. |
| [Dataset appearance](Frontend_Dataset_Appearance.md) | The dataset appearance definition, its storage and revisions, the results and administrator APIs, and which values a dataset may override. |
| [Home page](Frontend_Home_Page.md) | The optional Home page: its navigation and lifecycle, texts, the Home palette and presentation, background media and the Home settings editor. |
| [Coding conventions](Frontend_Coding_Conventions.md) | Accessibility expectations, the `[subject]_[role].js` file naming convention, import validation with `check_js_imports.js`, and translated interface text. |
| [Document startup and recovery](Frontend_Document_Startup_And_Recovery.md) | How the application document and the standalone login, registration and First Run pages reveal their shell, recover from failed loading and keep development diagnostics. |

## Former sections

Every section of the former single-file guide keeps its anchor in this list, so an older link such as `Frontend_Guide.md#view-types` still arrives here, next to a link to the section's new place. The focused guides keep the same headings and section numbers.

- <a name="1-showing-results-in-different-views"></a>[1. Showing Results in Different Views](Frontend_Results_Cards_And_Articles.md#1-showing-results-in-different-views)
  - <a name="overview"></a>[Overview](Frontend_Results_Cards_And_Articles.md#overview)
  - <a name="category-panel-and-selected-filters"></a>[Category panel and selected filters](Frontend_Category_Panel_And_Dropdowns.md#category-panel-and-selected-filters)
  - <a name="view-types"></a>[View Types](Frontend_Results_Cards_And_Articles.md#view-types)
  - <a name="where-a-datasets-view-state-lives"></a>[Where a Dataset's View State Lives](Frontend_Results_Cards_And_Articles.md#where-a-datasets-view-state-lives)
- <a name="2-ui-configuration"></a>[2. UI Configuration](Frontend_UI_Configuration.md#2-ui-configuration)
  - <a name="administrator-site-information"></a>[Administrator Site information](Frontend_UI_Configuration.md#administrator-site-information)
  - <a name="settings"></a>[Settings](Frontend_UI_Configuration.md#settings)
  - <a name="dataset-appearance-definition"></a>[Dataset appearance definition](Frontend_Dataset_Appearance.md#dataset-appearance-definition)
  - <a name="dataset-toolbar-and-appearance-controls"></a>[Dataset toolbar and appearance controls](Frontend_Dataset_Appearance.md#dataset-toolbar-and-appearance-controls)
  - <a name="optional-home-page"></a>[Optional Home page](Frontend_Home_Page.md#optional-home-page)
- <a name="3-reusable-components-vanilla-dropdown"></a>[3. Reusable Components: Vanilla Dropdown](Frontend_Category_Panel_And_Dropdowns.md#3-reusable-components-vanilla-dropdown)
- <a name="4-asset--media-surfaces"></a>[4. Asset / Media Surfaces](Frontend_Results_Cards_And_Articles.md#4-asset--media-surfaces)
  - <a name="current-end-user-surfaces"></a>[Current End-User Surfaces](Frontend_Results_Cards_And_Articles.md#current-end-user-surfaces)
  - <a name="current-rules"></a>[Current Rules](Frontend_Results_Cards_And_Articles.md#current-rules)
- <a name="5-accessibility-principles"></a>[5. Accessibility Principles](Frontend_Coding_Conventions.md#5-accessibility-principles)
  - <a name="core-expectations"></a>[Core Expectations](Frontend_Coding_Conventions.md#core-expectations)
  - <a name="testing-checklist"></a>[Testing Checklist](Frontend_Coding_Conventions.md#testing-checklist)
- <a name="6-file-naming-convention-subject_rolejs"></a>[6. File Naming Convention: `[subject]_[role].js`](Frontend_Coding_Conventions.md#6-file-naming-convention-subject_rolejs)
  - <a name="pattern"></a>[Pattern](Frontend_Coding_Conventions.md#pattern)
  - <a name="core-role-palette-open-to-reviewed-extensions"></a>[Core Role Palette (Open to Reviewed Extensions)](Frontend_Coding_Conventions.md#core-role-palette-open-to-reviewed-extensions)
  - <a name="rules"></a>[Rules](Frontend_Coding_Conventions.md#rules)
  - <a name="the-boss-powerpoint-test"></a>[The "Boss PowerPoint Test"](Frontend_Coding_Conventions.md#the-boss-powerpoint-test)
  - <a name="exceptions-pure-data--config-files"></a>[Exceptions: Pure Data / Config Files](Frontend_Coding_Conventions.md#exceptions-pure-data--config-files)
- <a name="7-import-validation-check_js_importsjs"></a>[7. Import Validation: `check_js_imports.js`](Frontend_Coding_Conventions.md#7-import-validation-check_js_importsjs)
  - <a name="usage"></a>[Usage](Frontend_Coding_Conventions.md#usage)
  - <a name="what-it-does"></a>[What it does](Frontend_Coding_Conventions.md#what-it-does)
  - <a name="integration"></a>[Integration](Frontend_Coding_Conventions.md#integration)
  - <a name="output"></a>[Output](Frontend_Coding_Conventions.md#output)
- <a name="7-languages-and-translations-ui"></a>[7. Languages and Translations (UI)](Frontend_Coding_Conventions.md#7-languages-and-translations-ui)
  - <a name="menu-strings-with-data-lang-key"></a>[Menu strings with `data-lang-key`](Frontend_Coding_Conventions.md#menu-strings-with-data-lang-key)
  - <a name="ui-literal-localization-sweep"></a>[UI literal localization sweep](Frontend_Coding_Conventions.md#ui-literal-localization-sweep)
- <a name="document-startup-and-recovery"></a>[Document startup and recovery](Frontend_Document_Startup_And_Recovery.md#document-startup-and-recovery)
