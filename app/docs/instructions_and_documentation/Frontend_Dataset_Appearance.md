<!-- Frontend_Dataset_Appearance.md: explains the dataset appearance definition and its contracts. -->
<!-- Connects the shared definition, Go and JavaScript validators, storage and appearance APIs. -->
<!-- Exists to keep dataset appearance guidance aligned with the product. -->
<!-- Part of the Frontend Guide; Frontend_Guide.md lists every focused frontend guide. -->

# Frontend Guide: Dataset Appearance

Part of the [Frontend Guide](Frontend_Guide.md); this section was formerly part of section 2, UI Configuration. Card styles and their palette controls are described in [Card_Style_Presentation.md](Card_Style_Presentation.md).

## Dataset appearance definition

Version-one runtime appearance retains the `dataset_cover_theme_config` shape:
`light`, `dark` and `shared`; `shared` means theme-independent, never storage scope.
The browser imports and Go embeds `frontend/shared/dataset_appearance/definition.json`.
Each of its 45 canonical paths has one `place`: 28 `tab_only` cover/hero values,
eight `site_only` brand/navigation/category-heading/remove-side values, or nine `site_default`
card/caption/header-spacing values that a tab may override. Inventories and flat
defaults derive from that metadata. Separate `ValidateTabValuesV2`,
`ValidateSiteValuesV2`, `ValidateDefaultsV2` and `ValidateOverridesV2` (Go) and
`isValidDatasetAppearance*V2` (JavaScript) check complete groups or sparse overrides.
Both themes' masks are checked within one complete tab map. Version-one consumers
remain unchanged. Types, bounds and choices stay authoritative; slider steps are
UI hints, so valid off-step numbers remain accepted without rounding.

“Show cover photo” aliases the active theme's `image_opacity`; it stores no boolean.
The compatibility-only `shared.image_blur` borrows the light blur rule and remains
copied from light blur by palette saves. Go stored reads inherit that legacy value
only when a theme blur is absent; explicit zero wins. Browser snapshots retain
their existing more permissive read guard and normalization. Strict complete and
leaf validators in `dataset_appearance/validator.js` mirror the embedded Go policy.
Paired examples live in `testing/shared_contracts/dataset_appearance{,_v2}_examples.json`.
Site handlers, persistence, validation and the stored shape are separated into
`site_presentation_settings.go`, `site_presentation_store.go`,
`site_presentation_validator.go` and `dataset_cover_theme_config.go`.

Dataset appearance is stored in `system_dataset_appearance`: one sparse canonical-path
map, schema version and durable revision per immutable dataset UID. Zero, false
and a value equal to the shared choice remain overrides; null is refused and
removing the last override retains the empty revision row. Renames preserve it;
dataset deletion cascades it. The unregistered internal table has no ordinary
runtime grants and generic writes are refused.

Authorized `/api/get-results` responses include `dataset_appearance` with
`dataset_uid`, `schema_version`, nested `shared` and `effective` values, sparse
`overrides`, all 45 canonical-path `sources` (`shared` or `override`),
`shared_version` and `version`. Both scopes and revisions are read in one SQL
statement after existing dataset read checks, including empty results. Mutable
appearance projections are refreshed outside the schema cache. The public site
settings endpoint continues to return shared values only, now with `version`.

Administrator POST `/api/admin/dataset-appearance` accepts
`{dataset_uid,set,unset,shared_version,version}` and returns that persisted
snapshot. Site presentation POST keeps its complete settings shape and requires
`version`. The shared token hashes stored JSON plus its durable update stamp;
`none` covers an absent shared row. Every shared writer takes the same exclusive
advisory lock; every override/compatibility writer takes its shared form before
the dataset advisory lock, registry key-share lock and override row lock.
Missing/stale revisions receive translated 409 refusals; invalid leaves receive
translated 400 refusals. Drafts retain their loaded tokens after refusal.

Legacy nullable card style and detail-column choices were migrated as explicit
overrides, including equality with the shared value. The physical registry
columns and their editable metadata are retired. Results/card APIs keep nullable
`card_style_variant`/`card_detail_columns` projections from this map. Both card
editors use the new authority. Compatibility card writes and generic metadata
card writes require loaded `shared_version` and `version`; omitted fields are
preserved and null removes the corresponding override. Generic shared-setting
creation, editing, renaming and deletion are refused in favour of the dedicated
revision-protected administrator endpoint. Column visibility/media remain in
their own stores. Full scoped rendering and scope palette controls are later slices.

The version-one shared writer validates shared values without rewriting overrides.
Its override writers still accept only `shared.card_style_variant` and
`shared.card_detail_columns`; stored legacy paths resolve under the full canonical
read contract, including merged masks. K289–K291/K298 settle future ownership:
cover values belong to tabs, so site changes cannot invalidate another tab's masks.
Slice 3b adds ownership metadata and validators only. Slice 5 activates the new
storage/API contracts and permits overrides for exactly the nine site defaults;
it refuses site-only and tab-only overrides, aliases and derived blur.

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
