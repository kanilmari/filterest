<!-- Frontend_Dataset_Appearance.md: explains dataset and site appearance ownership. -->
<!-- Connects the shared definition, scoped palette, storage and revision-protected APIs. -->
<!-- Exists to keep appearance guidance aligned with the shipped product. -->
<!-- Part of the Frontend Guide; Frontend_Guide.md lists every focused frontend guide. -->

# Frontend Guide: Dataset Appearance

Part of the [Frontend Guide](Frontend_Guide.md); this section was formerly part of section 2, UI Configuration. Card rendering and field layout are described in [Card_Style_Presentation.md](Card_Style_Presentation.md). The [Home palette](Frontend_Home_Page.md) edits Home's separate presentation settings.

## Dataset appearance definition

Appearance belongs either to one dataset tab or to the whole site. **This tab**
means the dataset identified by its immutable UID, shared by everyone viewing
that dataset; it is not a personal browser-tab preference.

The browser imports and Go embeds the same
[definition](../../frontend/shared/dataset_appearance/definition.json).
Its `place` metadata assigns every canonical path exactly one storage place:

- **Tab-only** (`tab_only`): complete cover/background and hero values owned by
  the tab, with no site inheritance.
- **Site-wide only** (`site_only`): one administrator-managed value for the
  whole site, with no per-tab override.
- **Site default + tab override** (`site_default`): an administrator-managed
  default with an optional explicit value for each tab.

The nested rendering groups `light`, `dark` and `shared` describe theme
selection. `shared` means theme-independent; it does not mean site-wide.
Storage and API maps use flat canonical paths such as `light.image_opacity`.

### Setting places

This inventory is expanded from the definition's theme owners, fields and
`place` metadata: 45 canonical paths, comprising 28 tab-only values, nine
site defaults and eight site-only values. Each theme path below is independent;
the `shared.*` rows apply in both themes. Bounds, choices and initial values
remain authoritative in the definition rather than in this table.

| Setting | Canonical paths | Place |
| --- | --- | --- |
| Oval mask enabled | `light.oval_enabled`, `dark.oval_enabled` | Tab-only |
| Oval width | `light.oval_width`, `dark.oval_width` | Tab-only |
| Oval height | `light.oval_height`, `dark.oval_height` | Tab-only |
| Oval vertical position | `light.oval_position_y`, `dark.oval_position_y` | Tab-only |
| Mask centre opacity | `light.center_opacity`, `dark.center_opacity` | Tab-only |
| Mask middle opacity | `light.mid_opacity`, `dark.mid_opacity` | Tab-only |
| Mask edge opacity | `light.edge_opacity`, `dark.edge_opacity` | Tab-only |
| Mask centre stop | `light.center_stop`, `dark.center_stop` | Tab-only |
| Mask middle stop | `light.mid_stop`, `dark.mid_stop` | Tab-only |
| Mask edge stop | `light.edge_stop`, `dark.edge_stop` | Tab-only |
| Cover image opacity / Show cover photo | `light.image_opacity`, `dark.image_opacity` | Tab-only |
| Cover overlay opacity | `light.overlay_opacity`, `dark.overlay_opacity` | Tab-only |
| Background image blur | `light.image_blur`, `dark.image_blur` | Tab-only |
| Hero extra height | `shared.hero_extra_height` | Tab-only |
| Hero bottom fade | `shared.hero_bottom_fade` | Tab-only |
| Card image width | `shared.card_image_width` | Site default + tab override |
| Card image presentation | `shared.card_image_presentation` | Site default + tab override |
| Article image caption position | `shared.article_image_caption_position` | Site default + tab override |
| All fields or only filled fields | `shared.card_show_all_fields` | Site default + tab override |
| Label/value layout | `shared.label_value_layout` | Site default + tab override |
| Card style | `shared.card_style_variant` | Site default + tab override |
| Card description lines | `shared.card_description_lines` | Site default + tab override |
| Card detail columns | `shared.card_detail_columns` | Site default + tab override |
| Space above dataset header icon | `shared.filterbar_content_top_space` | Site default + tab override |
| Active navigation tab fade | `shared.active_tab_fade` | Site-wide only (administrator) |
| Active navigation tab maximum opacity | `shared.active_tab_max_opacity` | Site-wide only (administrator) |
| Active navigation tab glow intensity | `shared.active_tab_glow_intensity` | Site-wide only (administrator) |
| Active navigation tab glow width | `shared.active_tab_glow_width` | Site-wide only (administrator) |
| Active navigation tab glow blur | `shared.active_tab_glow_blur` | Site-wide only (administrator) |
| Filter chip remove-button side | `shared.active_filter_remove_side` | Site-wide only (administrator) |
| Category heading order | `shared.row_group_heading_order` | Site-wide only (administrator) |
| Brand colour | `shared.brand_color` | Site-wide only (administrator) |

**Brand colour** and the **active-tab navigation highlight** are site-wide-only
examples: selecting another dataset cannot give it a different brand or change
its navigation highlight. The active-tab controls style navigation, not the
tab's cover. Category heading order is another site-only setting; see below.

**Show cover photo** aliases the active theme's `image_opacity`; there is no
stored visibility boolean. The compatibility-only `shared.image_blur` derives
from `light.image_blur` and is excluded from the 45 canonical paths. It is not
another independently editable setting or storage place.

### Resolution and new tabs

For a setting that permits overrides, resolution is **tab override → site
default → definition default**. Presence determines an override: zero, false
and a value equal to today's site default are still explicit overrides. A later
site change affects only tabs without that override. Removing the key restores
inheritance; JSON null is not an override value.

Tab-only settings resolve from the tab's complete `tab_values` map. They do
not inherit site values. Site-only settings resolve from `site_values`; no tab
map can replace them. An absent site setting uses the definition defaults;
the server treats malformed saved maps as errors.

A new dataset without an appearance row reads all 28 tab-only definition
defaults and an empty override map, without creating storage. Its first
successful appearance save stores the complete tab map. Thus its cards,
captions and header spacing initially follow current site defaults, while its
cover starts from the definition. During the three-place migration, existing
datasets instead received a copy of the then-current normalized site cover,
preserving their visible appearance and existing card overrides.

The [Go definition and validators](../../frontend/shared/dataset_appearance/definition.go)
and their [JavaScript twins](../../frontend/shared/dataset_appearance/validator.js)
validate complete tab/site/default groups and sparse overrides. Mask opacity
and stop sequences must be ascending within each theme of the same tab. Site
changes cannot invalidate another tab's masks. Numeric slider steps are UI
hints; valid off-step values are accepted without rounding.

### Palette scopes and section order

The dataset palette opens in **This tab** mode every time, including after
closing it in **All datasets**. A native radio group switches scopes. Its
collapsible toolboxes follow this order:

1. **Background and cover image**: the tab's own values, with separate Light
   and Dark controls, Background image blur and Cover image mask/opacity/hero
   controls.
2. **Card layout**: the seven overridable card settings.
3. **Article images**: the overridable caption position.
4. **Dataset header**: the overridable space above the header icon.
5. **Dataset tabs**: the eight site-only values, readable but not editable here.

**All datasets** hides cover controls and tab editor actions. It edits the nine
site defaults in the same card/article/header order, followed by site-only
values. Toolbox open/closed choices are remembered in local storage. The scope
switch always opens on This tab regardless of those choices.

In This tab, overridable settings display **Site default** or **Override**.
**Use site default** removes the override from the draft; **Save this tab**
persists that removal. Tab-only rows have no inheritance action. Site-only
rows display **Site-wide**, the current saved value, and **Edit in All
datasets** when permitted; that action switches scope and opens the toolbox.
A missing right keeps values readable with an explanation and disabled editing
or Save for the affected scope.

**Edit tab images and header** and **Edit card fields** open the existing
editors with this dataset selected. These editors save media/header and field
metadata through their own flows; the appearance draft survives their use.

### Drafts, reset and phone layout

Tab and site scopes keep independent drafts. Switching scope retains both but
previews only the selected scope. **Save this tab** or **Save all datasets**
saves that scope alone. Closing, clicking outside or pressing Escape hides the
palette and keeps its draft and preview; Close and Escape return focus to its
trigger. Reopening selects This tab and activates its preview. Destroying the
palette releases both preview owners.

**Reset to saved values** discards the selected scope's unsaved changes and
restores its saved baseline and the panel geometry. It does not reset all tabs
or replace saved values with factory defaults. Conflicts and reload refusals
keep the draft and its loaded revision tokens for review; reload and review
before saving again. Edits made while a save is pending survive and adopt the
successful save's revisions. A successful site save made in this palette also
updates its tab draft's matching site token; unrelated stale tokens still
conflict. Language changes update copy while retaining focus, drafts and scope.

The shared [palette shell](../../frontend/core_components/admin_tools/presentation_palette_shell.js)
and [stylesheet](../../frontend/core_components/admin_tools/presentation_palette.css)
provide a draggable, resizable panel with a scrolling body. At widths up to
600 px, it fills the viewport width apart from 12 px side margins, uses 97dvh
height and one-column controls. The scope switch and Save/Reset sit outside
the scrolling body; controls have 44 px minimum touch targets. Surfaces follow
the application's theme variables. The separate media/field editors stack their
dataset tree above the fields on phones; see [Card styles](Card_Style_Presentation.md).

### Editing rights and server refusals

Both appearance write endpoints use the administrator pipeline profile:
authentication, CSRF, route access control, administrator status and a request
transaction remain required. Access control follows the route's registered
permission scope: function-level, or dataset-scoped using the requested UID
when configured that way. New registrations of these handlers default to
function-level access. The saver checks that the target dataset still exists.
Ordinary dataset read or row-edit access alone does not grant appearance editing.

The palette's [capability reader](../../frontend/core_components/admin_tools/dataset_appearance_capabilities.js)
derives separate tab and site editing rights. Mounting requires the appearance
palette feature flag and dataset-header configuration permission. Tab editing
also requires the dataset-appearance API right; site editing requires the site
presentation API right. Card controls additionally require card-visibility
permission in either scope. Media/header and card-field actions keep their
existing permissions. These UI capabilities do not grant server access.

The server refuses:

- Site-only fields in any tab override, including brand colour and navigation
  highlight values. Override `set` and `unset` accept only the nine defaults.
- Non-tab paths in `tab_set`, or attempts to unset tab-only values into
  inheritance. The site endpoint accepts only site-only/default paths, never
  tab cover settings.
- Unknown paths, aliases, derived blur, null values, wrong types, out-of-range
  values, invalid choices and masks out of order. A path cannot be both set and
  unset in one patch. These validation refusals use HTTP 400.
- Obsolete save formats, with translated reload feedback (400), and missing or
  stale revision tokens, with translated conflict feedback (409). Saving to a
  deleted dataset is refused (404).
- Generic row writes to the private appearance table or generic creation,
  editing, renaming or deletion of the site's appearance configuration row;
  dedicated revision-protected APIs own these writes.

### Storage, API and revisions

| Store | Ownership and source |
| --- | --- |
| `system_config.json_value`, key `dataset_cover_theme_config` | Schema version 2, `site_values` and `defaults`. Reads fill absent keys from the definition; storage omits the default category heading order (see below). [Site value decoder](../../backend/core_components/dataset_appearance_store/site_appearance_values.go) and [site persistence](../../backend/core_components/system_table_tools/site_presentation_store.go). No cover values. |
| `system_dataset_appearance` | One row per immutable `system_db_tables.table_uid`: schema version 2, complete `tab_values`, sparse `overrides` and a positive `revision`; [tab reader/saver](../../backend/core_components/dataset_appearance_store/dataset_appearance_saver.go). Rename preserves ownership; dataset deletion cascades the row. |

The tab table is internal, unregistered and excluded from ordinary runtime
grants. Removing its last override retains the row with an advanced revision;
one revision covers both tab values and overrides. The
[resolver](../../backend/core_components/dataset_appearance_store/dataset_appearance_resolver.go)
builds nested `light`/`dark`/`shared` effective values for rendering; that
projection is not another storage authority.

| Endpoint | Contract and source |
| --- | --- |
| `GET /api/get-results` | After dataset read authorization, includes `dataset_appearance`, even for empty results; [results handler](../../backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read/get_results.go). |
| `GET /api/site-presentation-settings` | Public site-only values and defaults, schema version and site revision; excludes tab values/overrides. Also returns the separate table-line and article timestamp settings. [Site handlers](../../backend/core_components/system_table_tools/site_presentation_settings.go). |
| `GET/POST /api/admin/site-presentation-settings` | Administrator read or patch: `{schema_version:2,version,set}`, plus optional `table_cell_max_lines` and `row_article_timestamp_display_mode`. Omitted settings are preserved; returns saved site settings. [Patch validator](../../backend/core_components/system_table_tools/site_presentation_validator.go). |
| `POST /api/admin/dataset-appearance` | `{schema_version:2,dataset_uid,tab_set,set,unset,shared_version,version}`; patches tab-owned values and default overrides atomically, returning the persisted snapshot. [Tab handler](../../backend/core_components/system_table_tools/dataset_appearance_handler.go). |

An authorized snapshot contains `dataset_uid`, `schema_version`, `tab_values`,
`site_values`, `defaults`, `overrides`, nested `effective`, `sources`,
`shared_version` and `version`. Sources cover all 45 paths with `tab`, `site`,
`default` or `override`. Both scopes and revisions are read in one SQL
statement after dataset authorization, outside the mutable schema cache; see
[snapshot and revision handling](../../backend/core_components/dataset_appearance_store/shared_appearance_revision.go).

Treat both revision tokens as opaque. The tab token is its durable increasing
revision, or `none` before a row exists. The site token hashes stored JSON and
its update stamp, or is `none` for absent storage. Every tab save checks both;
every site save checks its loaded site token and preserves tab values and
overrides. Writers take the shared-setting advisory lock first: exclusive for
site writes, shared for tab writes. Tab writes then take the dataset advisory
lock, registry key-share lock and appearance-row lock, including first saves.

Saves run inside the caller-owned request transaction. A refusal rolls it back;
rolling back a tab save also rolls back its revision. Revisions are concurrency
guards, not saved appearance history. To undo an unsaved edit, use Reset or
leave the surface so preview ownership is released. To reverse a committed
choice, load current revisions and save the earlier values again; to restore
inheritance, unset the relevant default override. The API has no appearance
history/restore endpoint.

The [schema extension](../../server_tools/migrations/20261009000060_extend_dataset_appearance_three_places.sql)
and [backfill](../../server_tools/migrations/20261009000061_backfill_dataset_appearance_three_places.sql)
separate storage setup from copying existing covers. The backfill checks
unchanged effective appearance, preserves overrides, advances migrated row
revisions once and creates missing rows at revision 1 before removing the old
active site cover.

Legacy nullable `card_style_variant` and `card_detail_columns` metadata are
projections of overrides, not additional authorities; their physical registry
columns were retired. Compatibility card and generic metadata writers use the
same saver and both revisions, preserve omitted fields, and translate null to
removing the corresponding override. Column visibility and media stay in their
own stores. See [Card styles](Card_Style_Presentation.md) for these adapters and
scoped rendering.

### Category heading order

The site-only `shared.row_group_heading_order` choice belongs to the palette's
Dataset tabs toolbox beside the remove-button choice. `manual` (default,
including absent older storage) preserves the administrator's heading order;
`result_count` uses the sum of returned value counts. It is independent of theme
and cannot be overridden by a dataset. Public site settings and authorized
get-results snapshots deliver it through existing appearance maps. Site previews,
reset and revision-protected saves repaint existing cards without requests.
The [category panel guide](Frontend_Category_Panel_And_Dropdowns.md#category-panel-and-selected-filters)
owns the first-response reference, deep-link limit and top-three visibility rule.
DB 9.12.0 migration `20261015000020` adds the database rule and permits an absent
stored choice without a data backfill. Only a site that chooses **Most results
first** stores the key, as `result_count`; all server writes omit the default
`manual`. Older binaries cannot read the appearance of a site storing the key.
Before a downgrade, choose **Administrator's order** and save to remove it, or
restore from a backup. Sites that never choose Most results first stay readable.

### Surface binding and repainting

`dataset_appearance_state.js` applies a new binding's CSS variables and source
attributes synchronously; card assembly reads those values immediately. Binding
never repaints other registered surfaces. Configuration changes (authorized
snapshots, site updates, previews and their release) coalesce in one microtask
before the browser can paint. Effective values and their signature are cached
per immutable UID and invalidated by those changes, including revoke/forget/clear.
The signature includes UID, authorization status and normalized values; a new
revision with identical values needs no surface CSS writes.

Cards and articles bind before and after assembly. A separate, coalesced adapter
refresh finishes new fields, images and captions without rewriting unchanged
surface variables. Explicit `paint(name)` also requests that assembly refresh;
ordinary configuration invalidation skips unchanged projections completely.
Queued bindings hold only weak DOM references and are removed on release,
forget and clear; detached article assembly and retained view hosts stay supported.
No observer, listener or recurring timer is added by the repaint scheduler.

The adjacent equivalence test compares all properties and attributes with the
frozen pre-WO19 test oracle. The scaling test counts renders and CSS writes at
50/100/200 bindings. The native `C18_article_open_appearance_probe.spec.ts`
records CSS writes, longest long task and click-to-visible-frame time on both
main and the changed source, with no timing threshold. Run it against a native
test target with the command below; it creates and removes its own 60-row dataset.

```bash
./filterest test testing/e2e/C_card_view/C18_article_open_appearance_probe.spec.ts --project=desktop-card --workers=1
```

### Dataset toolbar and appearance controls

`navigation_fit_controller.js` measures complete hero destinations, gaps and available width on row resize, translated label updates and font loading. It restores inline styles through CSSOM so the page's content security policy cannot leave buttons invisible. It hides trailing buttons; all destinations remain in the menu. Phones (up to 700 px) hide that row and retain menu, site icon/name, search toggle and filter toggle. The toggle opens the existing field in an overlay below the toolbar without shifting buttons or listing, focuses it, and closes on Escape or another press while retaining the draft. Scrolling never opens search or replaces identity. Tablet/desktop keep their ordinary search. The initially collapsed `style` section reuses theme/language builders and the permission-checked gear/palette; order and collapse state follow the existing filter-panel mechanism. Temporary browser reveals wait for shell startup and the panel's saved-layout promise (`__sectionLayoutReady`) before expanding, so a late response cannot collapse the newly revealed controls. `20261009000074_seed_filterbar_style_language_key.sql` seeds these labels in all five UI languages and joins bootstrap and released DB 9.11.0; `20261009000099_record_database_release_9_11_0.sql` records that release last. `20261015000021_seed_filterbar_display_and_clear_language_keys.sql` (open DB 9.12.0) now owns the Finnish/English display-title values and the singular clear action in both upgrades and bootstrap. It replaces only exact old display defaults, preserves administrator edits, and leaves Chinese/Cantonese copy for reviewed translation. Browser locale checks read the served dictionary: disabled Chinese locales receive English with HTTP 200 even when `document.lang` still names Chinese. Rich category popup fixtures use the caller's 360 px minimum width; plain dropdowns follow their input row. Home keeps its own gear/palette because it has no dataset filter panel.

The phone toolbar deliberately hides the article close control. An article
opened from a result card pushes a history entry; browser Back dismisses it and
restores the listing. Tablet and desktop retain the shared toolbar close button.
`C3_close_big_card.spec.ts` verifies these two paths in the same test.

Card/filterbar copy uses the shared language dictionaries, seeded by `20261013000002_seed_card_and_filterbar_language_keys.sql` in DB 9.11.1 (`20261013000099_record_database_release_9_11_1.sql`). DB 9.11.2 added article-view permission explanations and group field-setting warnings without changing grants. The released target for application 9.5.0 is DB 9.12.0, which adds article and image presentation storage, filter bar preferences, table-cell limits and translated interface copy. Add-row names resolve the tab's own language key. Every card detail renderer, including article date fields, prints empty values through `empty_value_printer.js`: an em dash with the `unknown` tooltip and accessible label. The generated foreign-reference aliases `created_by_name` and `owner_name (ln)` have product translations; stored row values are unchanged.

### Column filter visibility

Administrators set **Hide in filter panel** in the existing card visibility /
view field settings. The source column's `hide_in_filter_panel` or
`hide_everywhere` also hides its generated reference-name filters, including
plain `_name`, `(ln)` and numbered `(ln)` aliases. This applies to all datasets
and references, including creator and owner fields (owner decision K377).
It does not hide a name value on a card merely because its filter is hidden.

For a visible source, the existing redundancy rule stays: when its relation-aware
filter is in the collection, the generated name input is omitted. If the source
is absent from the collection but still visible in metadata, the name input
remains available. A restored selection on such a visible generated name remains
valid. Physical-column metadata takes precedence over generated alias inference:
a stored `owner_name` remains independent of `owner_id` and `owner_name (ln)`.
There is currently no independent ID/name filter visibility setting.

The legacy, accordion and inline-open builders share
`getFilterableColumns` in `filter_column_builder_helpers.js`. They inspect full
source metadata before building sections; saved open-section lists, display
modes and section ordering cannot recreate an omitted field. A mounted panel
rebuilds when its available filter fields change.

Previously selected hidden source/name conditions are discarded when a current,
successful listing supplies complete metadata. Include, exclude and range keys
are removed from unified state and saved query parameters; the address is
replaced only if that dataset still owns the current address, using the same
route guard as settled-address reconciliation. The current row path, hash and
article history context survive. Remaining filters, search, sort and view stay.
The listing reloads from page one before rows or counts commit, including during
search reloads and pagination. An invalidated search restarts through its owner
with the original search options. Its replacement page rebuilds mounted filter
inputs, active chips and cached visibility metadata together. Rebuilt search
controls join the current search instead of restoring another execution;
unchanged conditions need no extra fetch. Chips also respect the cached
visibility during restoration, so an invisible input leaves no orphan chip.
Before metadata loads, selections are retained rather than guessed away.

The existing results API supplies source visibility and relation metadata in
`types` (`get_results_metadata.go`). A source marked `hide_everywhere` is omitted
from readable column metadata and selection; the join builder generates names
only for selected sources (`build_joins_1m.go`). When a saved name no longer has
a returned column, physical-column metadata or a readable relation source,
restoration discards that unavailable name too. Metadata-known ordinary name
fields remain ordinary filters. These are presentation rules, not an API access
restriction; no server, schema, data or permission change accompanies K377.

[Independent linked-name visibility](../future_documentation/Linked_Name_Filter_Visibility.md)
describes the missing separate-control capability and its adoption options.

Result counts use `results_count_singular` / `results_count_plural`, with
`results_count_text_search_singular` / `results_count_text_search_plural` and
`results_count_ai_search_singular` / `results_count_ai_search_plural` for search
breakdowns. Generic `result` / `results` and the older search-copy keys may be
site headings; this migration leaves them untouched. Both language storage
representations fill only missing or blank copy and exact English fallbacks in
other languages, retaining nonblank site translations.


## Dataset default view in the filterbar (WL162)

Administrators see **Default view for <dataset>** in **View content as…**.
The dataset name follows its translated tab label (with its saved display name
as fallback). The chooser uses the same vanilla dropdown and registered button/
More options as the view selector, intersected with the server's offered views
and the same route permissions, including the inherited site-default exception
(Chart always requires its explicit right). Changing this chooser changes only its draft:
the checkbox is checked exactly when that option is the saved dataset default.
Checking saves the draft for everyone; unchecking clears the dataset default
and inherits the site's choice. Pending controls are disabled and show the last
acknowledged value. Failed replies trigger readback because a save may already
have committed. Writes are serialized across remounts and superseded responses
cannot update the row. Language refreshes and view switches update the row;
removing its owner destroys the dropdown's portalled menu and listeners.

The offered views are Cards, Article, Table, List, Compare, Tickets, Product
cards and Calendar, plus specialized views only where they fit. Calendar can
show undated records. Tree needs a verified self-reference (or the existing
database catalogue tree); Chart needs delivered scalar temporal and numeric
columns and `/ui/view/price_chart`; Map needs a declared WGS 84 Point geometry/geography or a
recognized coordinate pair (unconstrained shapes, polygons and other SRIDs are
excluded); Settings needs key/value-type columns and a supported value column. Cloud
management is excluded because it operates its own cloud catalogue rather than
rendering the selected dataset. Selector aliases, image-first presentation
(which has no independent dataset renderer), unknown registry entries and
view rows whose `name` differs from their renderer key are excluded. The last
restriction matters because results metadata reads `system_table_views.name`.

The precedence stays: explicit URL `view=` → this tab's session choice → saved
dataset default → `frontend/config.json` → Cards. Clearing returns JSON null,
which overwrites cached metadata rather than reviving an older saved default.
A settled render replaces an address without `view=` with the resolved view;
this adds no history entry and does not change that precedence.
The UI uses `dataset_default_view_for`, `dataset_default_view_saved` and
`dataset_default_view_error`, seeded in Finnish, English and Chinese locales by
`20261015000003_seed_dataset_default_view_language_keys.sql` (DB 9.12.0).
Browser proof: `E18_dataset_default_view.spec.ts`, in both application themes
with the opposite operating-system theme, using the reserved administrator and
ordinary test user (`loadUserCredentials()`) with distinct account IDs. The
owned temporary dataset grants the Users group read access at creation; its
registered cleanup removes those dataset-scoped grants. The spec restores both
account theme preferences and the owned dataset's default in `afterEach`, using
independent account request contexts so timeouts and page crashes still reach
restoration and registered dataset cleanup. Its test-level budget covers both
logins and the scenario; checkbox clicks retain the normal action/assertion limits.
