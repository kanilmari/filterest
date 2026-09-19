# Frontend Guide

This document consolidates information regarding Filterest's frontend architecture, UI components, configuration, and accessibility standards.

For the future admin/media architecture behind image linking and broader asset support, see [Asset_Linking_Architecture.md](Asset_Linking_Architecture.md).

## 1. Showing Results in Different Views

This section outlines the workflow for displaying search results and summarizes the differences between view types.

### Overview
1.  **Search**: The user submits a search query. `do_intelligent_search()` sends a request to `/api/get-intelligent-results` and streams results.
2.  **Backend**: `GetIntelligentResultsHandlerWrapper` returns matching records in two stages (text and AI).
3.  **Notices**: When the text-search stage finishes, a `text_search_ended` notice is inserted. If the AI stage returns suggestions, a `see_also` notice appears.
4.  **Rendering**: `filterest/app/frontend/core_components/table_views/dataset_view_printer.js` renders the data using the selected view module.
5.  **Filters**: The global search term appears as an `.active-filter-item` above the results.

### View Types
-   **Card View**: Presents each record as a card. Suitable for rich media. Implemented in `filterest/app/frontend/core_components/table_views/card_view/card_view_printer.js`.
-   **Table View**: Displays results in rows and columns. Good for comparing fields. Implemented in `filterest/app/frontend/core_components/table_views/table_view/table_structure_builder.js`.
-   **Tree View**: Organizes results hierarchically. Helps explore nested relationships. For ordinary datasets it uses row-level `id` + `parent_*` data; for the database catalog datasets (`system_table_folders`, `system_db_tables`) it reuses `/api/tree_data` so folders include their table leaves. Implemented in `filterest/app/frontend/core_components/table_views/tree_view/tree_view_printer.js`.
-   **Other Views**: Register view keys, labels, container suffixes, selector groups, and UI permission routes in `filterest/app/frontend/core_components/table_views/dataset_view_registry.js`; keep concrete renderer imports in `filterest/app/frontend/core_components/table_views/dataset_view_printer.js`.

## 2. UI Configuration

`filterest/app/frontend/ui_config.js` collects flags that control the UI structure.

### Settings
-   `LAYOUT_BREAKPOINTS`: Named global viewport bands for navbar collapse, filter bar overlay, and stacked cards.
-   `LAYOUT_DIMENSIONS`: Named shared layout dimensions such as the compact filter bar rail width.
-   `NAVBAR_WIDTH_THRESHOLD`: Alias for the navbar collapse breakpoint used by existing modules.
-   `FILTERBAR_OVERLAY_BREAKPOINT_PX`: Shared filter bar overlay breakpoint.
-   `CARD_STACK_BREAKPOINT_PX`: Shared breakpoint for stacked card layouts.
-   `FILTERBAR_COLUMN_WIDTH_PX`: Shared width for the compact filter bar rail and its reserved content margin.
-   `MINIFY_PROJECT`: Minify project build when `true`.
-   `always_show_column_sort_buttons`: Keep sort buttons visible without hover.
-   `show_child_items_on_big_cards`: Show child items in the article view. The setting name still uses the internal `big_card` term.
-   `always_show_empty_fields_on_cards`: Show empty fields on cards to maintain order.

## 3. Reusable Components: Vanilla Dropdown

`filterest/app/frontend/reusable_components/vanilla_dropdown/` contains a small dropdown component with search and clear functionality.

-   **JS**: `vanilla_dropdown_builder.js` creates the dropdown via `createVanillaDropdown`.
-   **CSS**: `vanilla_dropdown.css` defines styles. The list opens absolutely (`top: 100%`), floating over content.
-   **Icons**: Uses `chevron.svg` for the arrow icon (CSP prevents `data:` URLs).
-   **Usage**: Options are provided as `{ value, label }`. Events are handled via `onChange`.

## 4. Asset / Media Surfaces

Shared asset-linking is now visible in multiple frontend surfaces, not only the admin capability view.

### Current End-User Surfaces
-   **Article View**: Existing rows can use `big_card_image_gallery.js` and `big_card_attachment_list.js` for image upload/delete/set-primary plus attachment upload/open/download/delete. PDF attachments should preview inline inside the existing article view rather than spawning a second modal on top. The implementation still uses internal `big_card` identifiers.
-   **Add-Row Modal**: `gt_1_1_row_create/row_relation_builder.js` now understands shared `file_upload.profiles` metadata and renders separate profile-aware file inputs for shared `<parent>_assets` relations.

### Current Rules
-   Prefer the canonical shared `_assets` child relation when it is resolved; do not silently fall back to writing into legacy `_images` tables from new UI surfaces.
-   `_assets` uploads must send canonical asset metadata for each child row: `asset_kind`, `original_name`, `mime_type`, and `size_bytes`.
-   Empty shared-asset placeholder rows must not be submitted from the add-row modal. Only sections with an actual selected file should become child inserts.
-   Add-row shared attachment inputs should preserve all selected files until submit, render a visible selected-file tray, and expand one attachment selection into one child insert per file instead of keeping only a single attachment.
-   Article-view media actions should respect dataset permissions explicitly. The image gallery should hide upload/delete affordances when `/api/add-row-multipart` or `/api/delete-rows` is not allowed for the resolved child dataset.
-   Article-view attachment UX should keep upload discoverable even when the row has zero attachments: a visible dropzone/chooser hint is preferred over invisible section-level drag-and-drop alone.
-   PDF preview in the article-view attachment section should stay inline within the same article view. Reusing the global modal builder from inside attachment actions would replace the already-open article view and is therefore the wrong pattern here.
-   Previewable PDF attachments should also show a lightweight first-page thumbnail tile in the attachment row itself. Clicking the tile should reuse the same inline preview panel instead of introducing a separate modal or navigation path.
-   Big-card shared-asset attachment rows may offer inline metadata editing (`title`, `description`) when the resolved child dataset allows `/api/update-row`. Keep the original uploaded filename visible as secondary metadata even after the friendlier title changes.
-   Big-card shared-asset image rows may offer the same inline metadata editing (`title`, `description`) for the currently selected image when the resolved child dataset allows `/api/update-row`. Save those edits through one batched request instead of one field request per keystroke.
-   Attachment refreshes should be sorted deterministically (`sort_order`, then `created`, then `id`, then display name) so edit/delete flows do not become brittle around row-index assumptions.
-   Big-card image delete affordances should stay lightweight in the thumbnail itself: a small top-right `x`, a subtle primary-image toggle, and a right-click context menu for the same actions.
-   Big-card media sections should refresh through one shared `fetchDynamicChildren` -> resolver pass after asset mutations or parent-field saves. This keeps image and attachment surfaces aligned on the same shared relation metadata instead of each surface guessing separately.
-   Attachment detail surfaces should prefer attachment-linking status + `relation_kind` metadata when resolving the shared child dataset. Do not treat `_assets` suffix checks as canonical runtime truth.
-   When attachment/image linking status is available, prefer both `relation_kind` and `foreign_key_column` from the backend before inventing a shared child stub locally.
-   `fetchDynamicChildren` child rows may now expose `relation_kind` such as `shared_asset`, `image_asset`, or `related_rows`. Treat that backend hint as the source of truth for generic related-row/media resolution.
-   Custom-named child datasets with explicit media metadata are valid. Do not assume that real media relations must literally end with `_assets` or `_images`.
-   Generic related-row UI must not surface media relations as ordinary child tabs. Filter `relation_kind=shared_asset|image_asset` out before rendering related tabs or child-tab-config candidate lists.

## 5. Accessibility Principles

This section summarizes practical accessibility expectations for Filterest.
The canonical baseline now lives in
[accessibility_principles.md](accessibility_principles.md);
keep this section as a quick overview and use the dedicated document for the
durable rule set.

### Core Expectations
-   **Semantic structure**: Use native HTML elements (buttons, headings, lists) first.
-   **Keyboard support**: Ensure every interactive element is reachable and operable via keyboard with visible focus.
-   **Labels**: Pair inputs with `<label>` or `aria-label`.
-   **Images**: Provide `alt` text or `aria-hidden="true"`.
-   **Contrast**: Meet WCAG AA contrast standards.
-   **Focus management**: Manage focus in modals/menus; avoid traps.
-   **Announcements**: Use live regions for dynamic updates.

### Testing Checklist
-   Navigate with keyboard only.
-   Verify labels with screen reader tools.
-   Inspect color contrast.
-   Confirm accessible alternatives for gestures/shortcuts.

## 6. File Naming Convention: `[subject]_[role].js`

Every human-maintained production frontend JS module must have **one purpose**,
and its name must communicate that purpose clearly enough for a non-technical
person to understand. Existing mismatches are migration debt, not permanent
exceptions; normalize them in reviewed batches rather than one repository-wide
rename.

This section specializes the cross-language naming contract in
the [public Developer Guide](DEV_GUIDE.md) for frontend JavaScript. The common meaning-first and constrained
generic-name rules also apply to Go, Python, shell, CSS, HTML, migrations,
configuration, documentation, packages, and folders through their own native
naming shapes.

The roles below are a maintained core vocabulary, not a closed whitelist and
not a substitute for the whole English dictionary. A precise new role may be
used when it describes one coherent responsibility better than the existing
roles and passes the same clarity tests. Repeated useful roles should be added
to this guide in a reviewed documentation change.

### Pattern

```
[subject]_[role].js
```

- **Subject**: What entity does the file work on? (`filter_bar`, `row`, `permission`, `card`, `column_settings`)
- **Role**: What does this component **do** with it? (see role palette below)

### Core Role Palette (Open to Reviewed Extensions)

| Role | Meaning | Example |
|------|---------|---------|
| `_printer` | Renders / draws UI | `filter_bar_printer.js` |
| `_builder` | Assembles a structure from parts | `nav_tree_builder.js` |
| `_fetcher` | Retrieves data from the server | `table_data_fetcher.js` |
| `_remover` | Deletes | `row_remover.js` |
| `_editor` | Modifies existing data | `cell_editor.js` |
| `_creator` | Creates a new record / element | `row_creator.js` |
| `_validator` | Validates input correctness | `login_form_validator.js` |
| `_formatter` | Formats data for display | `date_column_formatter.js` |
| `_checker` | Checks a condition or state | `permission_checker.js` |
| `_granter` | Grants / sets a right or value | `permission_granter.js` |
| `_saver` | Persists / stores data | `column_settings_saver.js` |
| `_handler` | Reacts to an event | `cell_click_handler.js` |
| `_reader` | Reads / extracts information | `selected_items_reader.js` |

Clear agent-noun roles outside the core palette are allowed when they name the
real responsibility. Existing examples that may be more accurate than a forced
core-role substitute include `_resolver`, `_router`, `_registry`, `_opener`,
`_adapter`, and `_subscriber`.

### Rules

1. **One file = one coherent responsibility.** Prefer one precise role. If a file is hard to name because it owns unrelated behavior, split it.
2. **Every role is a noun (agent noun).** The file *is* something, not *does* something. `row_remover.js`, not `remove_rows.js`.
3. **The role palette is open, not arbitrary.** A new role is acceptable when it is specific, subject-qualified, explainable in one sentence, and no existing role describes the responsibility more accurately.
4. **Generic collection suffixes are discouraged, not all forbidden.** `_helpers`, `_utils`, and `_common` are allowed only when the filename has a concrete subject, the file contains small cohesive functions for that one subject, no single role dominates, and splitting would make the code harder to understand. Bare `helpers.js`, `utils.js`, and `common.js` remain prohibited. If a dominant role emerges, rename or split the file.
5. **`_misc` remains prohibited.** It explicitly permits unrelated behavior and therefore cannot communicate one coherent responsibility.
6. **Dev-jargon roles need the same evidence.** Prefer a more exact role over `_factory`, `_store`, `_service`, or `_manager`; use one of those only when the subject-qualified name describes a real single responsibility and passes the "Boss PowerPoint Test".
7. **snake_case only.** No `camelCase` file names.

Examples of the constrained collection exception:

- `date_format_utils.js` may hold small pure date-format operations when no one role dominates.
- `table_selection_common.js` may hold narrowly shared table-selection primitives used by several modules.
- `utils.js`, `frontend_helpers.js`, and `feature_misc.js` are not acceptable because the subject or responsibility remains vague.

### The "Boss PowerPoint Test"

Every file name must pass this: *"Could a non-technical executive explain it in one sentence?"*

| File | Explanation |
|------|-------------|
| `filter_bar_printer.js` | "This prints the search bar" |
| `row_remover.js` | "This removes rows" |
| `permission_checker.js` | "This checks permissions" |
| `column_settings_saver.js` | "This saves column settings" |

### Exceptions: Pure Data / Config Files

Files that hold only data or configuration don't need a role suffix:
- `theme.js` — theme configuration
- `kv_config.js` — key-value configuration

Generated, bundled, and vendored files are outside this naming contract.
Entrypoints and toolchain or package-reserved names such as `main.js`,
`index.js`, and narrowly scoped registration/check scripts may keep their
required role-free names. Test files mirror the production module name as
`<module>.test.js`; they do not add a second role suffix.

Apply the target convention to all new production modules immediately. Migrate
existing human-maintained mismatches in dependency-aware batches, using
GitNexus impact analysis, import validation, a frontend build, and relevant
tests after every batch. A rename must not be used to disguise a multi-role
file: split the responsibilities first when one accurate role cannot describe
the module.

## 7. Import Validation: `check_js_imports.js`

`filterest/app/frontend/check_js_imports.js` validates all JavaScript import paths in the project. Run it after renaming files, moving modules, or refactoring imports.

### Usage

```bash
# Check only (report broken imports)
node filterest/app/frontend/check_js_imports.js filterest/app/frontend/main.js --exclude=node_modules/**,dist/**

# Check and auto-fix (rewrites broken import paths when a unique match is found)
node filterest/app/frontend/check_js_imports.js filterest/app/frontend/main.js --exclude=node_modules/**,dist/**,filterest/app/frontend/check_js_imports.js --fix-imports
```

### What it does

1. **Builds a symbol map** — scans all JS files for exported functions and symbols
2. **Recursively parses imports** — starting from the entry point, follows all import chains
3. **Verifies paths** — checks that each imported file actually exists
4. **Auto-fix mode** (`--fix-imports`):
   - If the file exists under a different path, rewrites the import
   - If no filename match but named symbols match exactly one file, rewrites via symbol lookup
5. **Reports orphans** — files not reachable from the entry point

### Integration

- **QA pipeline**: `npm run qa` runs this automatically (see `filterest/app/server_tools/scripts/qa.sh`)
- **Worker routine**: `./worker_agent --routine file_name_convention_checker` audits naming convention compliance, renames violating files, and verifies imports
- **After renames**: Always run with `--fix-imports` after renaming or moving files

### Output

```
Checked 137 files. 0 errors, 473 OK, 473 total imports.
```

Zero errors = all imports resolve correctly.

## 7. Languages and Translations (UI)

Filterest uses `data-lang-key` attributes for menu and UI string localization.

### Menu strings with `data-lang-key`
-   **Attribute**: Every translatable element includes a `data-lang-key` attribute and an English fallback inside the element: `<div data-lang-key="show_more">Show more</div>`.
-   **Mechanism**: `filterest/app/frontend/core_components/lang/lang.js` scans the DOM for these keys and replaces the fallback text with the active language's string from `system_lang_keys`.
-   **Programmatic Creation**: Prefer `element.dataset.langKey = "show_more"` and **always provide the fallback text**.
-   **Fallback**: Always include an English fallback text so the UI remains readable without JavaScript.

### UI literal localization sweep
-   When touching UI code, scan for user-facing hardcoded strings in `textContent`, `appendChild(document.createTextNode(...))`, button labels, placeholders, titles, and modal/toast messages.
-   Replace each user-facing literal with a stable `dataset.langKey` in JS, or `data-lang-key="..."` in HTML templates only. Keep an English fallback in the element so the UI remains readable while translations load.
-   Seed or update the key through the application API, not direct SQL: `./filterest language upsert key_name --fi "..." --en "..." --ch "..." --usage-explanation "..."`.
-   Keep `usage_explanation` concrete: identify the exact UI location, the control type, and what action or state the text represents.
