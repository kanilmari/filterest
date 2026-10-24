<!-- Frontend_Home_Search.md -->
<!-- Documents phone Home's ordinary cross-dataset text search. -->
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
polling; it also checks the absent control at 1440 px. Guest scope is proved
in unit tests because the native 8082 target requires sign-in to browse.
