# Filterest 9.6.1

This release gathers the 43 commits since 9.6.0: clearer Home and dataset
controls, saved Home-box queries, more consistent phone layouts and image
frames, reliable table copying, and stricter delivery of withheld fields.

Database **9.13.0 → 9.13.4** is applied on the first start of 9.6.1. The database
minimum and target are both **9.13.4**.

## Before you update

- **Back up and rehearse the database transition.** Nine migration files
  implement four batches, each ending with its own database release record:
  - **9.13.1:** extends saved Home boxes with translated titles, category and
    sort queries, and category-link limits. A dataset can have several boxes;
    existing boxes keep their identities. Explicit saved lists, including an
    intentionally empty list, remain distinct from inherited defaults. The
    default number of rows per box becomes three.
  - **9.13.2:** replaces exact automatic English sort-key defaults in Finnish
    and English and four exact legacy Finnish sort labels in both translation
    stores. Site-authored wording, blanks and other languages are preserved.
  - **9.13.3:** adds the site-wide top-bar Home setting, off by default, with
    Finnish and English editor labels. Existing administrator choices and
    nonblank translations are preserved on replay.
  - **9.13.4:** adds the site-wide category-button width setting, defaulting to
    row-filling buttons with centred labels; replay preserves existing choices.
- **The Home button leaves the top bar by default on every site.** Home stays
  in the menu. To restore the top-bar button, an administrator must enable
  **Show the Home button in the top bar on wide screens** in **Admin → Site
  settings → Home settings** and save. It appears only above 700 px while Home
  is enabled; phones keep the menu entry.
- **Plan rollback with the database backup.** Rolling back to 9.6.0 requires
  restoring the **9.13.0 database** under a write freeze; do not run 9.6.0
  against the upgraded database. The Home-box schema arrived in **9.13.1**;
  going below 9.13.1 requires the pre-migration backup. The current Home editor
  leaves the new box fields inert until the box editor ships, but this is not
  a database downgrade. Restoring a backup loses subsequent database changes.
- **Existing image sizes need an explicit backfill.** New image uploads retain
  displayed dimensions. Administrators can inspect and then apply guarded
  batches through `POST /api/admin/image-dimensions-backfill`; requests default
  to a dry run. This is not a startup migration. Unsupported structural galleries
  are counted even when they have no matching public dataset name.
- **Native restore checks can opt into named legacy extensions.** Repeat
  `--allow-extension` for `pgcrypto` and/or `unaccent`, or use the recovery
  profile's `DATABASE_RECOVERY_ALLOW_EXTENSIONS`. Results and private evidence
  record the effective opt-ins; default extension and language guards remain.

## Home, navigation and trees

Administrators can save Home boxes with their own translated titles, categories
and sorting through the API. Visitors' normal read rules still apply. A box
whose saved categories or sorting the visitor cannot use is omitted instead of
showing a broader result, and administrators receive a repair hint. Sites
without a saved list show three rows per box. Box validation, metadata, row
reads, lifecycle admission and connection waits respect Home's remaining time
budget while keeping the request transaction usable.

Home search opens over the site name in the phone bar and the 701–1200 px top
row, with results below. Crossing a phone or tablet breakpoint while search
is open or focused keeps keyboard focus on the search trigger.

On phones, Home's dataset boxes use one full-width layer with text on the
hero's 16 px edge. Contact and other article buttons fit their labels, wrap
long text, follow the hero's alignment and retain 54 px touch targets. Home's
left- or right-aligned desktop boxes use the text block's horizontal inset
while retaining their own 800 px maximum width.

Trees remember explicit open and closed folder choices across reloads.
Defaults, search expansion and current-path reveals remain temporary, and
polluted legacy expansion lists are discarded once. Visitors who are not
signed in see the About tab when the site permits guest reads. Administrators
can check releases again as soon as the waiting period ends.

## Categories, search tools and table copying

A new site-wide text setting, `category_filter_button_width_mode`, chooses
row-filling centred category buttons (`fill_row_with_centered_label`, the
default) or content-width buttons (`fit_to_label`). Empty selection badges
occupy no space. Values open largest-count first, retain administrator order
for ties and keep their order while the popup stays open.

Dataset hero tools have a rule before Categories and decorative icons for
search, filtering, resetting and expanding. Finnish and English sort labels
omit “Sort” while preserving administrator edits. On phones, filter and reset
buttons share their row evenly so icons no longer split their labels.
Dataset top-bar search becomes a button before shortening the dataset name,
and opens over the name in the same row on phones and measured button layouts.

Copying and keyboard navigation use the chosen row even after infinite
scrolling loads more rows. Grid copy omits hidden fields and their headers,
treats whitespace-only cells as empty and preserves selected empty cells in
their positions. Ctrl+C copies the selected cell range while preserving
copying from focused controls and native text selections.

## Field visibility, reads and row saves

Map views, map-support API responses and intelligent search no longer receive
hidden or server-only geometry as map support. Geometry metadata follows the
same boundary, so a map cannot plot a point using that withheld geometry.
Generated linked-row labels are null when the target display field is hidden,
server-only or unregistered, including for guests. The underlying relation key
is not replaced by that label. Saving visibility refreshes map and linked-label
projections immediately.

Ordinary collection and vector queries sort and filter only on known columns
the viewer may read. If the viewer cannot read the chosen sort column, results
use a readable creation or ID column in the requested direction; semantic vector
searches keep their similarity order. A filter on a withheld column is ignored
instead of failing the request. Vector responses
also omit columns without the viewer's read grant. Administrators and readers
with SELECT on every column retain the same delivered fields and similarity
order; a view's displayed field selection is not a vector projection rule.

Signed-in row saves succeed even when the provenance display-name lookup fails,
times out or returns an empty name, recording “unknown” while retaining the
user's id. Startup stops adding another copy of a foreign-key relation that
has no registry entry.

## Images, articles and phone forms

Stacked card photos use their stored displayed dimensions from the first paint,
within the 4:5 frame limit and 80% of viewport height. Images without usable
stored dimensions keep a square frame. Existing pictures gain this behavior
when their dimensions are backfilled. Resizing retains the fixed 300×300 wide
frame. Article image controls share a 1200 ms idle timer; disabled arrows keep
their theme skin at 28% opacity at every width.

Article views use the row title as their single main heading and omit an
exactly matching first content heading only in the same known language,
including related-label fallbacks and saved translations. Editors receive
advice about a repeated title without changing stored text.

Phone login and page forms use one full-width layer with fields inset 16 px;
headings clear the floating menu button. Dataset heroes, tools and article
titles share 16 px phone edges. Registration returns PIN validation messages
beneath their fields in the server response and keeps one translated inline
message after loading. Profile email/password codes and PIN/authenticator
setup share translated labels, hints and inline errors; PIN setup adds an
accessible reveal control while retaining the existing form actions.

## Optional instance badge and maintenance

Only instances with the instance-info runtime flag
(`FILTEREST_INSTANCE_INFO_FILE`) pointing to a record load the bottom-left
badge, including on sign-in pages. It shows code source and data backup time;
expanding it shows commits, data source and refresh time in Europe/Helsinki,
and minimising it leaves a dot. Production sites without the flag see nothing
new, and the read-only `/api/instance-info` endpoint does not exist there.

Language-key source scans write changed and day-old evidence in bounded
batches, avoiding repeat same-day rewrites while preserving daily freshness
and maintenance gates. Writes lock rows in identity order and retry deadlocks
up to three times. Successful scans writing at least 10,000 source rows run a
best-effort VACUUM (ANALYZE) after releasing the scan lock. Logs include write
totals, retries, duration and the VACUUM result; a VACUUM failure only warns.

## Tooling and tests

Browser tooling removes identical project runs by default; the full six-project
matrix remains available through `FILTEREST_E2E_MATRIX=full` for weekends and
site releases. Shared view-switch helpers now honor their fixed waits and
record readiness during them for nightly reporting. Permissions tests read
listing pages in bounded parallel groups, retry drifting listings and avoid
unsupported phone pointer checks. Home test teardown restores settings and
removes owned datasets after failures. Slow-load waits and a card-builder test
stub follow the current implementation. These changes add no runtime feature.
