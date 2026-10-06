<!-- Frontend_Guide.md: explains maintained browser components and interactions. -->
<!-- Connects application state, translated presentation and administrator workflows. -->
<!-- Exists to keep frontend behavior and accessibility guidance aligned with the product. -->
<!-- Installation-specific operator procedures remain outside this shared guide. -->

# Frontend Guide

This document consolidates information regarding Filterest's frontend architecture, UI components, configuration, and accessibility standards.

For the future admin/media architecture behind image linking and broader asset support, see [Asset_Linking_Architecture.md](Asset_Linking_Architecture.md).

The administrator’s Classes and categories window uses the existing row-group endpoints and captures the row selection when opened. Catalogue requests use `target` and membership writes carry `dataset` in the body, keeping the administrator pool. Saving sends only edited names and changed assignments, then calls the unified refresh so the first-page ribbon reconciliation and committed search caches retain their existing owners. Partial failures retain the remaining draft and report that earlier successful requests persist.

A class replacement uses one atomic membership POST, which removes peer values
and assigns the chosen value in the backend transaction. The editor advances
all membership baselines under that heading only after the replacement
succeeds; a failed POST leaves the old assignment available for retry or
cancellation when the chosen value or heading is disabled. Explicit clearing
uses DELETE, and category checkboxes keep independent membership changes.

## 1. Showing Results in Different Views

This section outlines the workflow for displaying search results and summarizes the differences between view types.

### Overview
1.  **Search**: The user submits a search query. `do_intelligent_search()` sends a request to `/api/get-intelligent-results` and streams results.
2.  **Backend**: `GetIntelligentResultsHandlerWrapper` returns matching records in two stages (text and AI). The request carries the interface language as `lang`, the reader's language: the AI stage searches every stored embedding, general and per language, and only ranks a match in the reader's language slightly ahead.
3.  **Notices**: When the text-search stage finishes, a `text_search_ended` notice is inserted. If the AI stage returns suggestions, a `see_also` notice appears.
4.  **Rendering**: `filterest/app/frontend/core_components/table_views/dataset_view_printer.js` renders the data using the selected view module.
5.  **Filters**: The global search term appears as an `.active-filter-item` above the results.

A successful, current first-page facet response resolves the row-group selection
through `row_group_facet_printer.js`. Removing unavailable values also updates
the same search's filter/execution signatures and its AI request context, and
rekeys a matching remembered row prefix in `dataset_loaded_rows.js`. It keeps
ordinary filters, search identity, rows, projection and next offset, without
another fetch. Ordinary view builds remember their rows after reconciliation;
searched listing reloads rekey the prefix already remembered by infinite scroll.
Omitted facets, failures, later pages and stale responses cannot resolve it.

### View Types
-   **Card View**: Presents each record as a card. Suitable for rich media. Implemented in `filterest/app/frontend/core_components/table_views/card_view/card_view_printer.js`.
-   **Table View**: Displays results in rows and columns. Good for comparing fields. Implemented in `filterest/app/frontend/core_components/table_views/table_view/table_structure_builder.js`.
-   **Tree View**: Organizes results hierarchically. Helps explore nested relationships. For ordinary datasets it uses row-level `id` + `parent_*` data; for the database catalog datasets (`system_table_folders`, `system_db_tables`) it reuses `/api/tree_data` so folders include their table leaves. Implemented in `filterest/app/frontend/core_components/table_views/tree_view/tree_view_printer.js`.
-   **Other Views**: Register view keys, labels, container suffixes, selector groups, and UI permission routes in `filterest/app/frontend/core_components/table_views/dataset_view_registry.js`; keep concrete renderer imports in `filterest/app/frontend/core_components/table_views/dataset_view_printer.js`.

### Where a Dataset's View State Lives
Each browser tab keeps its own view and open row, so one tab never changes or erases another's (owner decision K143, 3.10.2026):
-   **This tab only** (`sessionStorage`): the view a dataset shows, read and written only through `filterest/app/frontend/core_components/state_stores/dataset_view_choice_saver.js`, and the row the article or card view holds open, the `articleView` and `cardView` parts of `getUnifiedTableState`/`setUnifiedTableState` in `filterest/app/frontend/core_components/state_stores/table_state_store.js`. The view in a dataset's cached address parameters stays in the page's memory (`query_params.js`).
-   **A browser that refuses session storage** keeps that view and open row in the page's memory instead (`filterest/app/frontend/core_components/state_stores/tab_session_storage.js`), so a deep link still opens its article and a chosen view still reaches the redraw. Sign-out forgets this memory together with the cached address parameters (`clearClientAuthArtifacts` in `logout_shell_reset.js`).
-   **Every tab** (`localStorage`): sorting, filters and paging, through the same table state store.
-   A fresh page shows the view and row its address names, otherwise the dataset's default: page load forgets the earlier visit's views and open rows in its own tab only (`table_loader_handler.js`). Reloading an open article's own address keeps its related tab and scroll position. A duplicated browser tab copies the session storage, so on the same row's address it keeps that position too; this is intended, and afterwards each tab's changes stay its own.

## 2. UI Configuration

### Administrator Site information

The clock-bar information disclosure has two persistent actions (K245,
6 October 2026): **Refresh information** forces POST `/api/admin/version-info`,
and **Application update…** opens read-only details for every version state.
The refresh action stays disabled until the server's `refresh_allowed_at` time;
`upstream_check_performed` distinguishes an actual lookup from a reused result.
Both surfaces show cache age, latest attempt/result and last successful check.
An upstream or API failure retains the last successful release as stale evidence
and clears the update dot. The release checker's history is process-local.

The running database mark never proves a new release's database or migration
compatibility: both target checks are explicitly **not checked**. The endpoint's
`update_procedure` distinguishes `main_checkout` from `site_operator`. Native
runtimes inspect their installation's Git branch with a bounded local command.
The ordinary launcher passes the host branch into Docker through Compose
(`FILTEREST_UPDATE_CHECKOUT_BRANCH`); detached/Gitless installations and direct
Compose launches without that evidence use neutral operator guidance.
A verified published runtime on main with a known available update may show
`./filterest update --dry-run --version <shown version>`. This command does not
rehearse the live database, migrations or recovery, and the box installs nothing.


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

### Optional Home page

The site-wide `separate_front_page` setting defaults to false, retaining the
existing default-dataset start and root history behavior. When enabled, `/`
opens the hidden `front_page` custom view; `/front_page` is never a view address.
The SPA reads the setting and the optional Home-button site name from the
auth-modes response before loading datasets. Explicit dataset/article links
and login/register entry flows retain their existing behavior.

`front_page/front_page_navigation.js` opens Home through the navigation
pipeline, clears dataset selection only after navigation succeeds, writes the
root entry, then retitles it. Repeated clicks on current-session Home do nothing;
bootstrap passes `forceReload` to refresh the current session. The static
`navbarFrontPage` region is rendered by `initTabs`, in the reserved `front-page`
grid area, with a translated label or the configured site name.

`front_page/front_page_printer.js` makes one `/api/front-page` request per visit,
with cancellation, a render generation and a fifteen-second timeout/retry.
Deactivation empties the view and aborts its request. Navigation's cleanup hook
also removes the visit's listener and session subscription, so returning to a
retained Home container creates a complete new lifecycle. The shared session
generation also clears visible Home on sign-out,
expiry, sign-in and bootstrap before asynchronous work, independently of optional
login synchronization. Resume without a broadcast revalidates identity before
Home loads or reuses blocks; pending opens and responses require the same session
generation, and the response viewer must match the verified identity. The API
pipeline inspects the final response after CSRF recovery, so expiry on a retried
save invalidates Home even when the caller suppresses the sign-in redirect. Compact groups share
`table_views/compact_dataset_group.js` with cross-dataset search (three rows for
search; the server's row cap for Home). Search retains its existing navigation.
Home row links preselect their exact article without adding a dataset entry,
so one Back returns to Home; Show all opens the
card collection newest first (`__newest`). Theme surfaces keep text above a
decorative sized background, and phones show one column.

Admin → Site settings → Home settings uses the `/api/admin/front-page` permission
through the custom-view registry. The editor searches accounts by display name,
keeps global settings/background drafts across scope changes, and asks before
discarding unsaved blocks. Native inputs and up/down buttons work by keyboard.
Scope writes include the loaded opaque revision; a conflict keeps the draft and
requires an explicit reload before retrying. Reset and Copy common refresh the
chosen user's inheritance and read-access warnings from the API. Settings,
scope lists and staged background files/focal points save separately through the
routed pipeline, with translated live feedback. The shared web-image picker
supplies a local File to the same background upload flow. Deactivation releases
previews and requests and empties the management form so returning fetches fresh
settings. Both explicit themes use shared tokens; phones use one column and
controls have 44 px targets.

## 3. Reusable Components: Vanilla Dropdown

`filterest/app/frontend/reusable_components/vanilla_dropdown/` contains a small dropdown component with search and clear functionality.

-   **JS**: `vanilla_dropdown_builder.js` creates the dropdown via `createVanillaDropdown`.
-   **CSS**: `vanilla_dropdown.css` defines styles. The list opens absolutely (`top: 100%`), floating over content.
-   **Icons**: Uses `chevron.svg` for the arrow icon (CSP prevents `data:` URLs).
-   **Usage**: Options are provided as `{ value, label }`. Events are handled via `onChange`.

## 4. Asset / Media Surfaces

Shared asset-linking is now visible in multiple frontend surfaces, not only the admin capability view.

### Current End-User Surfaces
-   **Article View**: Existing rows can use `row_article_image_gallery.js` and `row_article_attachment_list.js` for image upload/delete/set-primary plus attachment upload/open/download/delete. PDF attachments should preview inline inside the existing article view rather than spawning a second modal on top. The article view's modules use the `row_article_` file prefix; its CSS classes still carry internal `big_card` identifiers.
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
-   When attachment linking status is available, prefer both `relation_kind` and `foreign_key_column` from the backend before inventing a shared child stub locally for the attachment list.
-   The article's image gallery is the one the related-rows response names (`gallery_relation`), and its main picture is the response's `card_picture`; the browser never chooses a gallery of its own. A response that names no gallery means the row has none this viewer may see, and the row's own image fields stand in only when no response arrived ([Asset_Linking_Architecture.md §4](Asset_Linking_Architecture.md#4-the-card-picture-rule)).
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


## Document startup and recovery

The application document and standalone login, registration and First Run forms
inline one nonce-authorized guard from `backend/core_components/frontend_assets/shell_boot_recovery.js`
and its independent stylesheet. Authentication fragments never arm this guard.
Only the unfinished shell is hidden, with layout retained. The base application
stylesheet (or the authentication stylesheet) supplies a computed-style sentinel;
the entry module signals evaluation at its first executable statement. Authentication
entry modules check the document's authentication CSS probe before signalling, since
the application also imports registration helpers. Both gates
reveal the shell immediately. The later `ready()` signal records development timing
and disarms diagnostics; a slow or failed data-driven startup never hides, reloads
or announces failure after the shell has been revealed.

A pending document shows translated loading text after three visible seconds.
Required-asset errors, pre-evaluation exceptions/rejections, a missing CSS sentinel
after stylesheet load, or thirty visible seconds without both gates trigger recovery.
Hidden/frozen time is excluded; visibility and page restoration recheck the gates.
After at least 1.5 visible seconds, a GET document may reload its initial URL once.
The session-storage allowance is per initial URL, with a ten-minute cooldown and
an unresolved-episode flag which cannot expire into a retry loop. Success ends the
episode while retaining the cooldown. Offline, storage-denied, non-GET and already
interacted documents offer the translated reload button immediately at that point.
Before reveal or interaction, automatic recovery reserves the initial URL's
allowance, restores that exact address with `history.replaceState` while preserving
history state, verifies the result, then reloads. A failed or ineffective restoration
offers the button and keeps the allowance reserved; no extra history entry is added.
The button makes a fresh GET document request, retaining the initial query bytes
(including repeated values and encoding) and fragment even after a POST-rendered
failure. GET documents restore the captured address and reload; POST documents use
`location.replace`, first adding a temporary query marker through `replaceState`
when a fragment could cause same-document navigation. Cancelled navigation restores
the previous address and state without resetting the budget. Nothing clears sessions
or user preferences. Unsupported browsers and disabled JavaScript receive escaped,
server-rendered notices. Emergency fi/en copy covers unavailable language keys;
the first available request `?lang` then `Accept-Language` preference in descending
quality order (stable for ties, excluding `q=0`) determines recovery copy, falling
back to the canonical enabled default before frontend preferences load. Ordinary
page metadata keeps its existing language resolver. Recovery respects the stored
light/dark/system theme.

Every rendered shell and maintenance response is no-store; this reduces stale
asset references but does not guarantee browser session-restoration behavior.
Authentication renderers apply cache protection before session/template work and
buffer template output. Missing, broken or failing standalone templates return the
shared translated recovery document; fragment failures retain their JSON response.
Development-only records in sessionStorage keep at most ten entries for thirty
minutes, with asset/source path, stage, probe state, timing, visibility and offline
state. Exception/rejection details contain only an allowed standard error name and
fixed category. They exclude free messages/stacks, URL queries/fragments, forms,
credentials and response bodies. Replay uses the same representation whitelist,
and recovery entries in the existing local development buffer capture only the
current address's pathname.
Early imports of the development transport leave pending-shell errors to the
guard, preventing an unsanitized duplicate in the normal error buffer.
The existing development error forwarder replays these after recovery and deletes
each only after an acknowledged 2xx. Production never forwards them. Resource-error
events cannot identify HTTP/TLS causes; diagnosis must not invent those details.
