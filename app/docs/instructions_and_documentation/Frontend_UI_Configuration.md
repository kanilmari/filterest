<!-- Frontend_UI_Configuration.md: explains the Site information panel and interface flags. -->
<!-- Connects the administrator clock-bar disclosure and ui_config.js with the layouts they control. -->
<!-- Exists to keep interface configuration guidance aligned with the product. -->
<!-- Part of the Frontend Guide; Frontend_Guide.md lists every focused frontend guide. -->

# Frontend Guide: UI Configuration

Part of the [Frontend Guide](Frontend_Guide.md). Section numbers continue those of the former single-file guide, so older references to them stay valid. The dataset appearance definition and the optional Home page, formerly part of section 2, have their own guides: [Dataset appearance](Frontend_Dataset_Appearance.md) and [Home page](Frontend_Home_Page.md).

## 2. UI Configuration

### Administrator Site information

The administrator-only clock-bar disclosure shows each fact once in one table
(K287, 9 October 2026): site, running application, release identity, latest stable
version/link, check result, freshness, attempt/success times, running database
compatibility and its required version, and runtime. Availability appears only
in the check result, and stale evidence only in freshness. Matching attempt and
success timestamps share one **Checked successfully** row; differing timestamps
remain separate. **Required by the running application** describes the database
requirement and makes no claim about a newer release's compatibility.

Its only action, **Check releases** / **Tarkista julkaisut**, forces POST
`/api/admin/version-info`. It stays disabled until the server's
`refresh_allowed_at` time; `upstream_check_performed` distinguishes an actual
lookup from a reused result. An upstream or API failure retains the last
successful release/link as stale evidence and clears the update dot. The release
checker's history is process-local. Focus stays in the panel while checking or
cooling down, returning to the action when enabled unless the user moved focus.

The panel says **Updates are currently performed by the site operator.** There
is no application-update action, second disclosure, target preflight or command
suggestion. Changed Finnish/English copy uses seeded language keys and the shared
translation system; both application themes and live language changes remain
supported. The backend API contract is unchanged.

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
