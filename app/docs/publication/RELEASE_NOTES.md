# Filterest 9.6.0

This release gathers the 53 commits since 9.5.1: a redesigned Home and site
search, a first view in the visitor's chosen language, stronger sign-in and
storage protection, immediate visibility changes in cached results, and more
consistent search and dataset surfaces.

Database **9.12.0 → 9.13.0** is applied on the first start of 9.6.0. The database
minimum and target are both **9.13.0**.

## Before you update

- **Check both session keys before starting the upgrade.** An installation
  outside development (`ENVIRONMENT_TYPE=dev`) must have real values for
  `SESSION_SECRET_KEY`, which encrypts sessions, and `SESSION_KEY`, which signs
  them. An empty or example-placeholder value now stops startup before any
  database access. Check the installation's protected configuration and retain
  existing valid keys. Installers generate fresh keys for new installations.
- **Rehearse the database transition on a backup.** The first migration adds
  Finnish and English Home-search labels and search-status messages to both
  translation stores, preserving existing site-authored text. The second
  records database 9.13.0 after the batch succeeds. This batch adds wording and
  a release record, rather than changing business-data tables.
- **API clients need a new CSRF token after every successful sign-in.** Fetch
  it from `/api/csrf-token` before the next write. In-page sign-in refreshes
  the browser client's token before continuing.
- **Protected storage needs the complete browser binding.** Signed-in reads
  require the session's matching device and fingerprint cookies. A signed-in
  request with neither cookie or only part of the binding receives the same
  answer as an anonymous request. Check clients that fetch protected files
  using only a sign-in cookie. Public storage and its caching are unaffected.
- **Plan rollback with the database backup.** Rolling back to 9.5.1 requires
  restoring database 9.12.0; do not run it against the upgraded database.
  Home settings also have stricter versioned readers: before reusing settings
  saved by 9.6.0 with 9.5.1, set the phone story size to **15 px**, set phone
  alignment to **As elsewhere** (as on desktop), and save. This removes the
  newer v5/v4 storage forms and stores v3 or lower. Restoring an earlier backup
  also restores that backup's settings and loses subsequent database changes.

## Home redesign and site search

On phones up to 700 px, Home's navigation and content scroll together beneath
a small sticky bar containing the menu and site name. Opening the menu keeps
the page in place. Its search button opens a focused search sheet across the
visitor's readable application datasets, showing up to three matches per
dataset; closing it or using Back returns to Home.

On desktop, Home offers a site-search field above 1200 px and a compact search
button at 701–1200 px. Results are grouped by dataset beneath the control,
without adding a browser-history entry.

Home's dataset boxes stack in one centred column at every width, with small
images or letter fallbacks and one keyboard stop for each clickable row.
Boxes are rounder, the top bar has a theme-aware edge, and spacing between the
story, boxes and bottom of the page is more consistent, including phone safe
areas. Home and cross-dataset-search thumbnails follow each dataset's card
image presentation and focal point, with stronger blurred backdrops.

Home text alignment follows language direction. Phones can inherit desktop
alignment or use their own start/centre choice. The Serif story palette offers
phone text sizes from 12 to 18 px, defaulting to 15 px, with a long-slogan lead
one pixel larger. Desktop text remains unchanged. The rollback steps above
matter when retaining these settings with an older release.

Home's icon follows the dark theme with a dark background and light lettering.
With a background image or video, top tab buttons stay rounded while the side
menu's buttons and connector use opaque, square shapes. This media-dependent
navigation is correct from the first view, including while language loading
finishes. Back immediately followed by Forward during Home loading retries
the load correctly; a dataset's initial history entry is replaced rather than
duplicated, preserving ordinary Back and Forward navigation.

## The first view uses the chosen language

Home and dataset navigation use the visitor's Finnish or English translations
on their first render. The page stays behind its loading screen until the
chosen language is applied, preventing the initial flash of English controls.
Once the page's assets can be shown, that wait is capped at about **4.5 visible
seconds**; a page whose startup never reports ready is then revealed.

## Sign-in, sessions and storage

Guests no longer receive browser-binding checks or the device and fingerprint
security cookies; obsolete guest bindings are cleared. Signed-in protection
continues, and protected file reads now enforce the full binding described
above. This does not remove functional session state such as language or CSRF.

Every successful sign-in creates a new CSRF token, including when signing in
again. The unused post-login return address is no longer kept in the session.

Sign-in and account recovery share translated, accessible code screens with
guidance appropriate to the verification method. Email-code resend works in
the login modal. PIN entry is a one-time-code text field with a revealable
visual mask, keeping saved-password suggestions out of it. Screen readers may
read typed PIN digits aloud, as with other text fields.

## Result caches and visibility

Saving field visibility removes newly hidden and server-only fields from
cached answers for all users and views immediately. Success waits for commit
and cache invalidation, and an older metadata read cannot restore stale
entries. Changes to a column's row-visibility gate also take effect for cached
readers after commit, preserving owners' access to their own rows.

The Workline Observatory keeps scroll and focus when startup reapplies the
same language, when its tab's classes change without a visibility change, or
when an unchanged search is announced. Actual language changes and reopening
the tab still redraw it.

## Filter bar, cards and articles

- Phone dataset text search is visible above the search tools for every
  reader; the top-bar search button remains available after scrolling. The
  selected-filter row again aligns with the full width of the tools.
- Search controls share a soft corner radius in both themes. Input-mode
  buttons also open a collapsed filter section and keep remembered open
  sections consistent. Dataset headers and compact toolbars keep the panel
  button last while preserving responsive label fitting.
- Category popups have a compact header and match settings behind a gear.
  Shared multiselects grow to the available width, up to 600 px, remember
  viewer height, and follow their buttons while the page scrolls.
- Dataset top bars, filter heroes and status bars retain their painted
  background in the dark theme.
- Stacked card photos and phone/tablet article photos lose the thin decorative
  frame; normal wide cards retain it. Logo, contrast and SVG frames, corners
  and image sizing keep their existing rules. Details lists have straight
  edges on stacked cards, while wide cards retain their original frame.
  Show more uses the category-button radius.
- Page-sized image-first articles have taller desktop images and steadier
  title-to-text spacing. They pause Home's background video until closing;
  phone image sizing remains unchanged.

## Tooling, tests and documentation

Administrators' Site information API reports the built commit, whether the
build included uncommitted changes, and its UTC build time.

The relevant-check planner covers production files, rejects unmapped changes
and unclaimed browser specifications, binds saved selections to the source
tree and check map, and exposes nightly frontend selection prefixes.
Visual Guardian offers opt-in, report-only observations beside screenshots,
with reviewed expectations, allowances and fixture checks.

Installation test fixtures derive their copied helpers from the scripts they
exercise, with regressions for omitted helpers and Python imports. Browser
test fixtures name temporary tables so an interrupted run's leftovers can be
cleaned on the next run; navigation, language readiness, dataset cleanup and
parallel-run checks follow current behavior. Offline card tests serve JSON
modules correctly. These test changes and removal of unused permission-view
styles add no separate runtime feature.

Documentation now places listings embedded in other websites among future
features; this release does not introduce that capability.
