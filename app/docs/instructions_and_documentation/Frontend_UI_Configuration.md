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

### Filter bar order and visibility memory

The style disclosure and the configuration dataset's settings view use the same
Finnish/English controls. Section order has one site setting
(`system_config.filterbar_section_layout`). Its public GET endpoint
(`/api/filterbar-section-layout`) returns only section order, collapse defaults
and the boolean policy allowing own orders. It requires no edit grant.
POST `/api/filterbar-section-layout/save` retains normal authentication, CSRF,
browser binding and the explicit route grant; administrators receive that grant
through the existing startup policy. A separately granted ordinary editor can
also change it. Generic configuration-row writers cannot bypass this API.

One controller loads the shared order for the document and publishes committed
changes to every mounted bar. Same-origin tabs receive a change notification and
reload the safe setting; focus refreshes it too. Order edits send only the order,
preserving collapse defaults. Explicit disclosure edits send only changed keys.
The published shaded filtering section and the style section retain their keys;
the conversation remains in its pinned dock.

Signed-in users may explicitly choose **Shared order / Own order**. An ordinary
account needs the site's permission; administrators may always choose their own.
The current shared order is copied only on that explicit choice. Account-wide
order and visibility mode extend the existing `system_user_visual_preferences`
row through `/api/user-filterbar-preference`; no dataset owns a personal order.
PATCH accepts only those choices, and DELETE resets them while preserving theme.
Theme reset likewise preserves filter bar choices. A disabled own-order policy
hides an ordinary user's saved exception without deleting it.

Visibility defaults to **Shared for all datasets** and initializes from the bar
currently in use. **Remember per dataset** restores the destination's saved
choice, starting from the source bar's actual state and transitioning once only
when it differs. Shared handover and reduced motion commit without animation.
Missing destination memory keeps the actual state; a first document visit uses
stored memory or the dataset/responsive default. Dataset results carry that
default (`table_meta.filterbar_visible_by_default`), so a stale navigation cache
cannot make a newly created dataset open incorrectly. Legacy per-dataset keys
remain during rollout and are never scanned to guess a shared starting value.
