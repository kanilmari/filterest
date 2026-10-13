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
Each of its 44 canonical paths has one `place`: 28 `tab_only` cover/hero values,
seven `site_only` brand/navigation/remove-side values, or nine `site_default`
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
`overrides`, all 44 canonical-path `sources` (`shared` or `override`),
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

### Dataset toolbar and appearance controls

`navigation_fit_controller.js` measures complete hero destinations, gaps and available width on row resize, translated label updates and font loading. It restores inline styles through CSSOM so the page's content security policy cannot leave buttons invisible. It hides trailing buttons; all destinations remain in the menu. Phones (up to 700 px) hide that row and retain menu, site icon/name, search toggle and filter toggle. The toggle opens the existing field in an overlay below the toolbar without shifting buttons or listing, focuses it, and closes on Escape or another press while retaining the draft. Scrolling never opens search or replaces identity. Tablet/desktop keep their ordinary search. The initially collapsed `style` section reuses theme/language builders and the permission-checked gear/palette; order and collapse state follow the existing filter-panel mechanism. Temporary browser reveals wait for shell startup and the panel's saved-layout promise (`__sectionLayoutReady`) before expanding, so a late response cannot collapse the newly revealed controls. `20261009000074_seed_filterbar_style_language_key.sql` seeds these labels in all five UI languages and joins bootstrap and unreleased DB 9.11.0; `20261009000099_record_database_release_9_11_0.sql` records that release last. Browser locale checks read the served dictionary: disabled Chinese locales receive English with HTTP 200 even when `document.lang` still names Chinese. Rich category popup fixtures use the caller's 360 px minimum width; plain dropdowns follow their input row. Home keeps its own gear/palette because it has no dataset filter panel.

The phone toolbar deliberately hides the article close control. An article
opened from a result card pushes a history entry; browser Back dismisses it and
restores the listing. Tablet and desktop retain the shared toolbar close button.
`C3_close_big_card.spec.ts` verifies these two paths in the same test.

Card/filterbar copy uses the shared language dictionaries, seeded by `20261013000002_seed_card_and_filterbar_language_keys.sql` under unreleased DB 9.11.1 (`20261013000099_record_database_release_9_11_1.sql`). Add-row names resolve the tab's own language key. Every card detail renderer, including article date fields, prints empty values through `empty_value_printer.js`: an em dash with the `unknown` tooltip and accessible label. The generated foreign-reference aliases `created_by_name` and `owner_name (ln)` have product translations; stored row values are unchanged.

Result counts use `results_count_singular` / `results_count_plural`, with
`results_count_text_search_singular` / `results_count_text_search_plural` and
`results_count_ai_search_singular` / `results_count_ai_search_plural` for search
breakdowns. Generic `result` / `results` and the older search-copy keys may be
site headings; this migration leaves them untouched. Both language storage
representations fill only missing or blank copy and exact English fallbacks in
other languages, retaining nonblank site translations.
