<!-- Frontend_Category_Panel_And_Dropdowns.md: explains category selection, the category panel and dropdowns. -->
<!-- Connects row-group categories and unified filters with the shared multiselect popup and result views. -->
<!-- Exists to keep category, selected-filter and dropdown guidance aligned with the product. -->
<!-- Part of the Frontend Guide; Frontend_Guide.md lists every focused frontend guide. -->

# Frontend Guide: Category Panel and Dropdowns

Part of the [Frontend Guide](Frontend_Guide.md). Section numbers continue those of the former single-file guide, so older references to them stay valid.

The administrator’s Classes and categories window uses the existing row-group endpoints and captures the row selection when opened. Catalogue requests use `target` and membership writes carry `dataset` in the body, keeping the administrator pool. Saving sends only edited names and changed assignments, then calls the unified refresh so the first-page category reconciliation and committed search caches retain their existing owners. Partial failures retain the remaining draft and report that earlier successful requests persist.

A class replacement uses one atomic membership POST, which removes peer values
and assigns the chosen value in the backend transaction. The editor advances
all membership baselines under that heading only after the replacement
succeeds; a failed POST leaves the old assignment available for retry or
cancellation when the chosen value or heading is disabled. Explicit clearing
uses DELETE, and category checkboxes keep independent membership changes.

A successful, current full first-page response resolves category selections and modes
from `row_group_selection: {slugs, modes}` (never from the capped facets)
through `row_group_facet_printer.js`. Removing unavailable values also updates
the same search's filter/execution signatures and its AI request context, and rekeys a matching remembered row prefix in `dataset_loaded_rows.js`. It keeps
ordinary filters, search identity, rows, projection and next offset, without
another fetch. Ordinary view builds remember their rows after reconciliation;
searched listing reloads rekey the prefix already remembered by infinite scroll.
Omitted selection metadata, failures, later pages and stale responses cannot resolve it.

## Category panel and selected filters

The existing row-group printer (`filterbar/filter_list/row_group_facet_printer.js`)
shows a 550 px category card before selected tags and the shared result count;
`dataset_view_printer.js` owns that placement. Heading buttons open one shared multiselect popup at a time over the results,
without changing the card's height or the results' position. The persistent card
controller (`row_group_facet_card_builder.js`) lazily creates one instance per
heading, anchored to its stable button and owned by the connected dataset tab.
This explicit owner keeps a popup alive across a full redraw: the old results and category card remain mounted while the next view builds off screen, then a current completed view replaces the result surface once. Heading badges count selections; row numbers count
hits. The first three headings are shown initially, with selected headings
always reachable and remaining headings available through Show more. The panel
lists up to 200 readable values in server order, with selected values pinned before
the cap. Zero-hit values stay visible, dimmed through theme text tokens, and selectable;
only the 20-selection limit blocks an unchecked value, exposing `aria-disabled`
without evicting a previous selection. Dimming never disables a value.
The popup is a named nonmodal dialog containing a named multiselect listbox.
Include-only options are single interaction targets with decorative checkbox
marks and accessible names that include hit counts. Match radios, the changing
hint and the limit notice sit above search inside the popup; category clear and
zero-results recovery stay on the card.
Its name search is local to that returned list, never a complete vocabulary
query. Escape and the close cross return focus to the heading; refreshes and language
switches retain the open panel, query, focus, caret and list scroll position.

Selections use unified filters and the `row_group` URL parameter with a 20-value
limit. Multi-valued and untitled legacy headings offer native ANY/ALL radios in a
fieldset before name search: At least one (default) or All selected. The changing
hint is connected with `aria-describedby`; single-valued headings retain their hint
and ANY matching. Headings always combine with AND. `row_group_mode=1:all,3:all`
records only ALL preferences, sorted by heading ID; legacy values use ID 0. A
readable heading can retain its mode without selections, with no filtering effect.
Removing one selection tag retains its mode; there is no separate mode tag. Clearing
categories removes both category parameters and preserves search/ordinary filters. The shared selected-tags row
(`active_filter_tag_printer.js`) adds Selected: and Clear all; Clear all invokes
`top_row_builder.js`'s existing whole reset, including text search, ordinary
filters, modes and paging, while preserving view and ordinary sorting. Tag redraws keep Clear all connected and reuse its listener, preserving keyboard focus when a chip-removal build settles before the next Enter. All three selected chips (text search, ordinary filters and category values) use
`active_filter_chip_builder.js`; their owners retain label formatting, translation and removal commands.
`active_filter_tags.css` owns their geometry: Selected: first,
chips in the middle and Clear all last, with each wrapped line centred. The row and category card share the search column's `--filterbar-hero-content-max-width` and auto inline margins, wrapping within the available width on phones and tablets. The phone top bar does not move this row; only an opened article uses its sidebar. Chips have
6 px corners, inherited font size, zero vertical padding and a 33 px minimum height; logical inline padding
is 12 px on the label side and 4 px on the button side. At desktop widths the remove
button is 24 × 24 px and Clear all has no 44 px minimum, so a single-line chip is
33 px tall (the owner's 11.10.2026 choice, 7 px above the former 26 px chip). At widths up to 700 px or
on any coarse pointer both controls keep real 44 × 44 px touch targets, giving
46 px single-line chips. The K282 size values live together as custom properties
in the row's stylesheet block; the media query only chooses the touch values.
The palette's Dataset header group offers Remove button: Before the label / After
the label. This site-wide, theme-independent choice is stored as
`dataset_cover_theme.shared.active_filter_remove_side` (`start` / `end`, default
`start`), with Finnish/English labels in the palette's own copy dictionary. It needs
no language-key migration or database version change. Preview and reset reorder
existing labels in real DOM order, preserving the remove button's focus and
listeners without rebuilding filters or sending requests. Legacy saves omitting
the field preserve the saved side under the upsert's row lock. Tags continue
to move into an open article's sidebar, whose explicit left alignment stays. The shared count publishes its numeric
value so zero-result guidance never parses translated labels or requests new
counts. Guidance is shown only for zero results with selected categories.

Category toggles, tag removal, match-mode changes and category clear each use one first-page listing refresh. Busy state announces work without discarding subsequent choices; listing/search generations reject older replies and card builds. During a committed search, its listing owns row replacement: the search does not empty rows first, and replacement cards build off screen before one guarded swap. Later-page requests still belong to endless scrolling, which stops before observing or fetching when the current search/filter/sort count is already loaded. Card fields have their card ancestor during construction but wait for the accepted, connected swap before receiving `easelect:card-mounted`. `card_resource_lifecycle.js` releases keyword/detail observers, timers and card listeners on replacement or abandonment; reordering a keyword inside its parent keeps it alive. The search-owned AI “See also” group uses this same connected mount notification and disposal on replacement, explicit search clearing and cancelled staging builds. A current build failure clears stale rows and counts, keeps the selected filters and shows the existing keyed failure notice as a toast and persistent result alert. Cancelled work leaves the committed surface alone; the next selection can replace the alert. Search never retries a null listing reload: missing initial card hosts already use the listing owner's guarded rebuild and its same first page, while failed or abandoned work ends that action.

Both application themes use `variables.css` tokens; fonts and spacing are scoped to the card and the opt-in class on
the portalled popup. Only the option list scrolls within a popup capped at 400 px; search, match-mode controls and header remain visible. Controls offer 44 px touch targets. Category popups are at least
360 px wide on desktop, bounded by the viewport; at 600 px and narrower they use the visual viewport minus 16 px on
each side. The shared popup controller measures fixed controls at that width and budgets three option rows (the
whole list if shorter), capped at its maximum height; plain dropdowns also retain their existing minimum opening
space. It opens below when that fits, otherwise on the larger side. The option budget is sampled after the opening's
reset or preserved query renders its rows, including zero matches, then retained until close so search cannot change
sides; fixed controls are remeasured on repositioning and content-size changes (ResizeObserver). On short screens, with
an on-screen keyboard and once the heading has left the view, the popup stays within the visual viewport, at most 400 px high. Its fixed shell never scrolls; the options use the remaining height. This applies to plain column dropdowns as well as category popups.
Enter, Space and ArrowDown open from the heading and focus search without scrolling the page.
Focus changes and preserved updates reveal their target only inside the option list, keeping
fixed controls and the page stationary. Unmoved targets retain the option scroll position;
a fresh opening starts at the top. Repositioning on resize and scroll sets no scroll position,
so a person's own scrolling inside the popup is never undone. Native radio keys
retain their behavior. Tab exits to the page without a focus
trap; Escape and header-close return focus, while outside click and view
deactivation close without moving focus. Facet counts omit the candidate heading in ANY; in ALL they
count rows satisfying the current selections plus the candidate value, with other
headings applied in both modes. Listing freshness (`getDatasetListingSignature`) and search filter context
include modes, ordinary filters and order where applicable, and leave page
language out. Only the loaded-rows cache adds page language to the listing
signature, so a late page-language initialization cannot make a current response stale.
Search execution identity also includes sorting: a late saved sort starts a fresh listing instead of joining the obsolete request that its change cancels. Identical synchronized controls still share one execution. Obsolete AI streams are aborted. Hierarchy and server facet paging remain later slices.
Finnish/English mode copy is seeded by
`20261007000001_seed_row_group_match_mode_language_keys.sql` for DB 9.10.1.
The reworded general hint uses `row_group_categories_modes_hint`, preserving reviewed
copy under the previous key. Existing translations are never replaced. Apply copy
through the migration lifecycle, never ad hoc SQL.
Column inputs and selected-filter chips follow the
[column filter visibility contract](Frontend_Dataset_Appearance.md#column-filter-visibility):
hiding a reference source hides its generated name filter too. Saved hidden-name
selections are discarded and the remaining listing is reloaded; saved panel
layouts cannot expose them. Visible-source duplicate suppression is unchanged.

The column filter also supplies shared search, selected/excluded count,
empty-results and clear-action labels. Its extracted input builder retains raw
option payloads and updates labels and localized options in place on language
changes, preserving query, focus and include/exclude state. Missing shared copy
is seeded by `20261007000002_seed_multiselect_language_keys.sql`, also under
DB 9.10.1, for Finnish and English only. Existing dropdown callers keep their
input row, search-reset (also when an opening key reaches an already open list)
and oldest-selection replacement defaults; categories opt into preserved view
state and a blocking global selection limit. Every caller gets five shared
changes: Escape inside a list closes only the list and returns focus to its
field, so a surrounding form or modal stays open (it used to close the form
too); keys on an exclude action activate the action (Enter there used to toggle
the value); keyboard focus brings the option into view without scrolling the
page; positions follow the visual viewport, for example above an on-screen
keyboard; and include-only lists keep their two-column rows in the portalled list.

The additional `E_search_filter/E14_selected_category_refresh.spec.ts` checks centred wrapping, K282 target sizes, keyboard removal/clear (including a delayed removal build settling while Clear all is focused), one populated commit, and rapid changes with reversed response delivery. It uses the same native dataset fixture, Finnish/English and both explicit themes over the opposite OS preference. Set `FILTEREST_E2E_CATEGORY_LANGUAGES` to a comma-separated list to exercise other installed languages. Run mobile-card, tablet-card and desktop-card. `E_search_filter/E17_card_refresh_lifecycle.spec.ts` uses the same fixture and matrix for ordinary and searched replacements: intercepted read-only responses supply synthetic keyword rows, and a rejected real avatar build verifies connected mounting, observer cleanup, translated failure and recovery. It counts outgoing first-page requests and accepted swaps separately (card-host replacements remove previous cards; later-page additions are not swaps) for four category clicks, the rejected build and recovery (one request and one swap each), waits for action/reply completion and observer ticks, then removes routes with `unrouteAll({ behavior: 'ignoreErrors' })` after the counts. Its keyword widths use an adopted constructed stylesheet through CSSOM, keeping the constraints on replacement cards without CSP-refused inline style elements.

The opt-in browser proof `E_search_filter/E13_row_group_category_panel.spec.ts` reads an existing categorized dataset named by `FILTEREST_E2E_CATEGORY_DATASET`; it needs one heading with two returned values that have hits and a second heading.
The mode proof also needs a multi-valued heading with two values whose readable support differs, so ANY/ALL counts can visibly change.
It resolves the popup through the heading's ARIA reference and checks stable card/result geometry
and scrolling, counts, both focus-return paths, match
controls inside the popup, and state retained through refresh. It checks a selectable dimmed value when one is returned, and never edits classifications.
The browser matrix covers 320, 375, 600, 601 px and desktop, short height, Finnish
and English, and application light/OS light, application dark/OS light, and
application light/OS dark.

## 3. Reusable Components: Vanilla Dropdown

`filterest/app/frontend/reusable_components/vanilla_dropdown/` contains a small dropdown component with search and clear functionality.

-   **JS**: `vanilla_dropdown_builder.js` creates the dropdown via `createVanillaDropdown`.
-   **CSS**: `vanilla_dropdown.css` defines styles. The list opens absolutely (`top: 100%`), floating over content.
-   **Icons**: Uses `chevron.svg` for the arrow icon (CSP prevents `data:` URLs).
-   **Usage**: Options are provided as `{ value, label }`. Events are handled via `onChange`.
