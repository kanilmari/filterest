<!-- Frontend_Coding_Conventions.md: explains frontend accessibility, naming, import and text rules. -->
<!-- Connects frontend changes with the shared accessibility, naming and translation rules. -->
<!-- Exists to keep frontend code accessible, understandable and multilingual. -->
<!-- Part of the Frontend Guide; Frontend_Guide.md lists every focused frontend guide. -->

# Frontend Guide: Coding Conventions

Part of the [Frontend Guide](Frontend_Guide.md). Section numbers continue those of the former single-file guide, so older references such as "section 6" stay valid.

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

Cross-stack features follow the [component contract](../../components/README.md).
Import their `frontend/index.js` or portable `frontend/lib/index.js` through
relative paths; keep implementation imports internal. Import their CSS from
`frontend/styles/imports.css`, with translated text and explicit application themes.

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

### Browser-native module imports and component styles

Native source mode serves frontend JavaScript modules directly to the browser.
Shipped modules must not import `.css` files: the browser requires a JavaScript
module MIME type, so a stylesheet import prevents the whole application from
starting even when Vite and Vitest accept it.

Keep component styles beside their implementation and register them with
`@import url("../core_components/.../component.css");` in
[`frontend/styles/imports.css`](../../frontend/styles/imports.css), following the
existing card-view entries and preserving cascade order. The
[`index.html` shell](../../frontend/index.html) links that entry in native source
mode; [`vite.config.mjs`](../../frontend/vite.config.mjs) uses the same entry to
produce `imports.*.min.css` for bundled delivery. No JavaScript stylesheet
loader is needed. The ordinary Python tier's
[`test_import_boundaries.py`](../../testing/python/test_import_boundaries.py)
rejects stylesheet module imports across shipped frontend source.

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

## 7.1. Responsive structure

The phone boundary is viewport width ≤ 700 px (K444); its single source is
`LAYOUT_BREAKPOINTS.phone` in [ui_config.js](../../frontend/ui_config.js), with
`PHONE_BREAKPOINT_PX` for JavaScript. CSS uses exactly `@media (width <= 700px)`;
the [structure guard](../../frontend/styles/responsive_structure.test.js) ties that literal to the source.
CSS escapes in names are decoded before the checks, so `@m\65 dia` and `(w\69 dth …)` are read as `@media` and `width`.
The guard runs in every whole-Vitest run (the batch jobs and the nightly); selecting it by stylesheet change belongs to the test-map work (WO69 S2), not to this guard.
Other viewport widths use the named layout bands there: 1060, 1100, 1550 and 1850 px.
Container queries size components intrinsically; they never replace the viewport phone gate.
Keep one phone section at the end of each stylesheet, introduced by `/* Phone (≤ 700px, K444) */`.
The phone query is outermost; hover, pointer, any-pointer, reduced-motion and color-scheme
conditions may nest inside it, but width conditions may not. No top-level style rule follows it.
Phone selectors need a base rule in the same file or explicit ownership in the
[owner map](../../frontend/styles/responsive_owner_map.json); shared classes follow their named owner.
Add an ownership entry only with a reviewed reason; the seeded map only shrinks as ownership is resolved.
Do not use `!important` inside phone sections.
The [allow-list](../../frontend/styles/responsive_allowlist.json) records individual pre-existing deviations;
it only shrinks, and the guard rejects both new deviations and stale entries.
Migrations prove the old boundary at −1, exactly, and +1 px, plus phone/tablet/desktop in both themes.
Moving a section also proves cascade order; changing an old 720 px boundary changes the 701–720 px layout.

## 7. Languages and Translations (UI)

Filterest uses `data-lang-key` attributes for menu and UI string localization.

### Language menu placement and interaction

The reusable selector in `frontend/core_components/lang/lang_panel_printer.js`
serves the menu bar and authentication forms. Its viewport controller moves the
open panel into the document body (or its enclosing shared modal layer), outside
scrolling ancestors. Closing returns it to the selector. The panel remains
right-aligned with the selector and keeps its 10 px gap when there is room.

`frontend/reusable_components/floating_panel_placement.js` owns the measured
side decision shared with the multiselect popup controller: prefer below when
the content fits; otherwise choose the larger side. Cap the panel to that side
and scroll its content internally when neither side fits. Bound its width and
position to the visual viewport too; an offscreen selector uses the visible
viewport. Opening, viewport resize/scroll, menu-bar scroll and translated
content changes trigger fresh measurements. Read natural content height from
`scrollHeight` plus borders while keeping the live panel's height cap in place;
expanding its scroll box for measurement can clamp `scrollTop` to zero. This
preserves internal scroll positions that still fit the content and new cap.
Captured scroll events from the panel or its descendants do not trigger
placement; scrolling ancestors and the viewport still do.
Closing removes position listeners and content observation; aborting the owning
form or removing the selector also releases interaction listeners and the panel.

The button retains `aria-controls` and `aria-expanded`. Escape returns focus to
the button; native radio arrow keys still choose a language, and Tab follows the
selector's original place in the page. M1's pinned scrolling menu bar and short
viewports exercise both themes, including explicit light over an OS dark
preference, independently of the installation's Home datasets.
The short-screen check holds the lower option in view across queued animation
frames and repeated polls, then clicks it before enlarging the viewport.

Clicks inside the portalled panel stop at the panel, preserving its selector's
interaction boundary. Otherwise the menu bar's document outside-click handler
collapses the bar before a radio's native change event, sliding the language
button offscreen even though translation succeeds. Translation updates labels
without changing the button anchor; replacing the selector disposes its old
listeners and observers. M1 verifies reopening after translation and restores
through `ensureNavbarVisible` with the current button's `aria-controls`, keeping
the first failed assertion if cleanup also fails.

### Menu strings with `data-lang-key`
-   **Attribute**: Every translatable element includes a `data-lang-key` attribute and an English fallback inside the element: `<div data-lang-key="show_more">Show more</div>`.
-   **Mechanism**: `app/frontend/core_components/lang/translation_handler.js` scans the DOM for these keys and replaces the fallback text with the active language's string from `system_lang_keys`.
-   **Programmatic Creation**: Prefer `element.dataset.langKey = "show_more"` and **always provide the fallback text**.
-   **Fallback**: Always include an English fallback text so the UI remains readable without JavaScript.

### UI literal localization sweep
-   When touching UI code, scan for user-facing hardcoded strings in `textContent`, `appendChild(document.createTextNode(...))`, button labels, placeholders, titles, and modal/toast messages.
-   Replace each user-facing literal with a stable `dataset.langKey` in JS, or `data-lang-key="..."` in HTML templates only. Keep an English fallback in the element so the UI remains readable while translations load.
-   Ship new copy as reviewed Finnish and English rows in a seed migration under `app/server_tools/migrations/` that adds missing keys and fills blank translations while preserving authored copy, list it in `language_seed_migrations` in `generate_bootstrap.py` and regenerate the public bootstrap; see [Lang Key Lifecycle](lang_key_lifecycle.md#5-translation-serving). The application API (`./filterest language upsert key_name --fi "..." --en "..." --usage-explanation "..."`, never direct SQL) changes only the installation it is run against.
-   Keep a value out of the key: copy that names something writes `$table_name` (or `$count`) and the element carries the value in `data-lang-variable`, so a language change keeps it. A startup notice also registers its bootstrap copy in the language layer's [local fallback catalogue](../../frontend/core_components/lang/local_translation_fallback_catalog.js), so the page translator keeps a readable sentence when both translation stores lack its key; `navigation/dataset_redirect_notice_copy.js` is a small example.
-   Keep `usage_explanation` concrete: identify the exact UI location, the control type, and what action or state the text represents.
