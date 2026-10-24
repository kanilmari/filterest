<!-- Frontend_Home_Search.md -->
<!-- Documents Home's ordinary cross-dataset text search on phones and desktop. -->
<!-- Connects the accepted readable tab list, shared result groups and history. -->
<!-- Keeps request bounds and modal behavior separate from Home presentation settings. -->

# Frontend Guide: Home Search

Part of the [Frontend Guide](Frontend_Guide.md), alongside the [Home page](Frontend_Home_Page.md).

## Phone sheet

At widths up to 700 px, Home's existing 44 px end slot contains a magnifier.
Opening it shows a labelled modal dialog beneath the measured sticky bar,
with 16 px side gutters and a maximum height of 80dvh. Results scroll inside
the sheet. The shared search input receives focus; input and close targets
are 44 px. Home's scroller uses the drawer lock while its content is inert.
Tab and Shift+Tab loop inside the sheet; an outside focus attempt returns to
the input. Closing restores Home's position and focus to the magnifier.
Explicit application theme tokens style both themes independently of OS theme.
All sheet styles live in `front_page_search_sheet.css`.

The phone layout mounts the search only after creating its end slot. Removal
of that slot tears down the sheet, including on resize, navigation and session
replacement. Above 700 px it creates no search controls or listeners.

## Desktop field and panel (D1)

Above the tablet band (> 1200 px), Home reserves a 280 × 44 px search
field after the dataset tabs and any top-row article buttons, before the end
actions. At 701–1200 px that same slot reserves a 44 × 44 px magnifier.
At ≤ 700 px the desktop host is removed and the phone sheet above
keeps its existing behaviour. These viewport bands come from `LAYOUT_BREAKPOINTS.tablet`
and `LAYOUT_BREAKPOINTS.phone` in `ui_config.js`, independently of menu width.
`front_page_desktop_search_controller.js` owns
this desktop lifecycle; `front_page_desktop_search.css` owns its styles.

The slot is a fixed flex sibling in the existing row. Tabs consume the
remaining width, so the unchanged navigation fitter measures their reduced
space and hides complete trailing destinations; those destinations remain
in the menu. A docked menu or long translated labels can wrap the row;
the compact Home link keeps its existing minimum target width while wrapping.
Search never floats over the tabs or changes the hero's geometry.

Typing two characters in the visible field opens a labelled nonmodal dialog,
8 px below it. The button instead opens that dialog with the same input in
its header and focuses it. The panel is portalled outside the clipping row,
end-aligned to its trigger, at most 640 px wide, and clamped to 16 px gutters
inside both Home and the viewport. Resize, row/menu geometry changes and
scroll remeasure it. Its results scroll within the smaller of 80% viewport
height and the actual space below the trigger.

Both desktop modes call the phone's `createFrontPageSearchRunner`, so copy,
300 ms pause, cancellation, request bounds, thumbnails, excerpts, grouped
results and Show all navigation have one implementation. No new language
keys or seed rows are required. The field is labelled and exposes dialog
controls/expanded state; live status is polite and targets are 44 px.
All new surfaces use application theme variables, including explicit light
over an OS dark preference and explicit dark over an OS light preference.

Close, Escape and an outside click return focus to the initiating
field or button. Moving keyboard focus to another control closes without taking
focus from that destination. Arrow Down reaches the first result; Tab moves
from the field to close, then through results and back to Home's end actions.
Shift+Tab reverses the order; desktop never traps focus or locks Home.
Crossing a mode boundary closes the panel and transfers search focus to the
new trigger. Back/Forward and teardown dispose it. Desktop neither pushes
a history entry nor calls `history.back()`; phone history remains separate.

Desktop controls, dialog, header and results use their own classes; the shared
runner's placeholder slots are the only `front-page-search-sheet__*` classes
inside the desktop panel. Scoped desktop rules own their placeholder height
and busy border. Phone component rules stay independent at every width, and
the shared `.dataset-search-panel` reset does not match this desktop surface.

## Search scope and bounds

The runner uses `getMainDatasetTabs()`: the accepted readable dataset list
also used by Home's tabs and the navbar. It searches app datasets in that
order, excluding Users and About. A guest uses their own accepted list and
session, with no additional permission or AI endpoint.

Typing at least two characters starts one round after 300 ms without another
input event. Each ordinary `/api/get-results` request carries `search`,
`dataset`, `limit=3`, `view_key=card`, `include_card_support=1` and the reader's
language. The shared supplemental-search queue allows at most two unsettled
requests, even across replacements. Changing input immediately aborts the
previous round; generation and abort checks discard late replies.

The optional server `limit` accepts one positive decimal integer, rejects
empty, duplicate, fractional, negative and overflowing values, and caps valid
values at 10 before building the SQL page. Omission preserves the existing
configured page size and all permission checks remain in force.

One placeholder per dataset reserves its tab position while replies arrive.
Results use `createSupplementalDatasetGroup` with thumbnails and three rows.
The live status announces searching, one no-results line when all datasets
are empty, or a failure if a transport could not complete. A denied dataset
shows no label or results. Show all links use the canonical dataset path and
the same `search` parameter. Row activation follows the shared dataset-then-
article navigation after the sheet's history pop has completed.

## Back and reload

Opening calls `writeHistoryEntry` with the same address and `homeSearch: true`,
giving that entry its own identity. The navigation history handler consults
the search owner before hydration, view restoration or address rewriting.
Back closes the sheet and consumes the return to its original Home entry.
Close, Escape and backdrop gestures share exactly one `history.back()` call.

Reload and Forward never reopen a retained search entry. That inert marker
does not intercept a later Back to an ordinary destination. Ordinary navigation
also removes the marker when replacing an entry, so it cannot suppress future
dataset restoration.

## Verification

The colocated runner and sheet unit tests cover rights, bounds, out-of-order
responses, cancellation, focus, desktop and history. `G17_home_phone_search`
uses response-only Home policy and dataset fixtures at 390 px in both themes,
including real PNG thumbnails, navigation, close gestures and Back identity
polling; it also checks the absent phone control at 1440 px. Guest scope is proved
in unit tests because the native 8082 target requires sign-in to browse.

The desktop controller tests cover 1201/1200 and 701/700, close/focus/history,
viewport/docked bounds, keyboard/link activation, fitter space and delegation
to the real phone runner. A computed-style regression checks both desktop modes
with the phone's base-level component rules and shared search styles loaded.
`G19_home_desktop_search` covers both explicit themes
against the opposite OS preference at 1440, 1201, 1200, 1000, 701, 700 and
390 px, including response-only long site/tab labels and a docked menu.
It inherits signed-in storageState and aborts every non-GET; no settings,
datasets, accounts or language keys are persisted. Listing a spec proves
collection only; its browser results must be recorded separately.
