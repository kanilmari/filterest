<!-- CHANGELOG.md: the cumulative release history of the Filterest product. -->
<!-- It connects a reader of this repository with what each released version changed. -->
<!-- It travels with source installations and public releases. -->
<!-- Keep entries limited to product behaviour; installation-specific operations belong elsewhere. -->

# Changelog

All notable changes to Filterest are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Where this history starts.** Filterest has been released from this repository
since 9.3.3, and that is where this file begins. Earlier versions were released
from the shared version line of the private maintenance shell, and their history
stays there. Each entry below is the product part of that release; the newest
release is also described in
[RELEASE_NOTES.md](app/docs/publication/RELEASE_NOTES.md), which every release
overwrites.

Dates are the local (Europe/Helsinki) date on which the version was published.

## [Unreleased]

Database compatibility moves from 9.7.15 to 9.7.16.

- **Dataset text search works again** — A search address whose route already carried a parameter of its own lost the dataset name, so the server refused every text search as a permission problem. Erasing the search field now also returns the dataset to its ordinary results immediately.
- **A JSON column no longer breaks adding a row** — An empty JSON field is stored as missing data, a structured value is encoded, and a value that is not JSON is reported by column name instead of failing the whole row with a database message.
- **A new dataset is immediately usable by administrators** — Creating a dataset grants administrators every dataset-specific route in use, instead of a hand-kept list that had fallen behind.
- **A decimal column can finally be chosen** — Creating and editing a dataset offer the same column types, including a decimal number with its total digits and decimal places.
- **Images can be attached to an assistant question** — An administrator can attach screenshots for the site assistant to look at, directly from the chat. Each image is discarded within 45 minutes and the browser only ever handles an opaque reference.
- **Site assistant in the dataset chat** — An administrator can ask the chat's assistant to work on the site itself, through the site's own API with the asking person's rights. Every change it prepares waits in the chat for approval, showing what it would do and its exact request.
- **A newly added column is editable at once** — The article view no longer waits for a cached catalog to expire before a column added moments ago can be filled in.

## [9.3.13] - 2026-09-17

[GitHub release](https://github.com/kanilmari/filterest/releases/tag/v9.3.13) · Database compatibility 9.7.15, no migration.
- **Lighter card images** — Cards choose the 300 px or 1000 px image from the width the image is actually drawn at, including stacked cards limited by window height, and no longer swap an already loaded image, which caused cancelled image requests. Display JPEGs are saved at quality 85, a resized image that would be heavier than its original stores the original instead, and startup maintenance replaces existing variants that outweigh their original.
- **Compatibility check inside other repositories' hooks** — The app/DB compatibility check no longer reports tracked schema snapshots as untracked when it runs from another repository's `git commit -a` hook.

## [9.3.12] - 2026-09-17

[GitHub release](https://github.com/kanilmari/filterest/releases/tag/v9.3.12) · Database compatibility 9.7.15, no migration. Carries all 9.3.11 candidate changes.
- **Existing oversized images repaired** — On startup, Filterest replaces stored display images that earlier versions enlarged beyond their original with a copy of the original, so existing sites serve lighter images without manual maintenance.
- **Docker image build fix** — The production image installs the currently available Alpine time-zone data package; the 9.3.11 candidate could not be built after Alpine replaced the pinned version.

## [9.3.11] - 2026-09-16

Prepared as a release candidate but never published; its Docker image could not be built and its changes shipped in 9.3.12
([candidate release notes](https://github.com/kanilmari/filterest/blob/808cc036396867b4ab237e4a1ba4964f472e0cba/app/docs/publication/RELEASE_NOTES.md)).
Database compatibility 9.7.15, no migration.
- **Sized images instead of originals** — Catalog, list, cover and background images request display-sized files. A missing sized file falls back to another sized file before the original, display files are written completely before they are served, and an image that already fits is stored unchanged instead of being enlarged.
- **Less page-load network work** — Duplicate stylesheet, image and translation requests are avoided, and guest startup reuses dataset lists it has already loaded.
- **No toolbar flash for guests** — Filter bar tool and view sections appear only after the user's dataset rights are known, so guests no longer see sections that then disappear.
- **Article position across reloads** — Article view keeps its scroll position, open related-rows section, and selected child tab after a page reload.
- **Ticket todo checklist** — Ticket articles show agent-task todos as a checkbox list. One click toggles between todo and done and updates the progress bar. A second line in the todo text appears as a muted identifier phrase.
- **Presentation refinements** — Refines hero tabs, the dataset cover palette, and the site presentation interface.
- **English password recovery** — The send-code button in English login recovery follows the selected language.
- **Separate local sessions per port** — In development and test instances, the session, device, and fingerprint cookie names include the listening port, so instances on different localhost ports no longer overwrite each other's login. Production behavior is unchanged unless explicitly configured.
- **Claude CLI discovery** — The worker-agent runner finds the Claude CLI under VS Code Remote/WSL and VS Code Insiders extension folders.

## [9.3.10] - 2026-09-15

[GitHub release](https://github.com/kanilmari/filterest/releases/tag/v9.3.10) · Database compatibility 9.7.15, no migration.
- **Article navigation and images** — Result counts stay above the result list, article sidebars keep loading and reuse already-loaded rows, and returning to the list preserves its rows and position. Article images share navigation controls with image-first presentation, and captions can be placed over or below images.
- **Faster, sturdier first paint** — Theme and navigation initialization arrive with the page HTML, and login forms stay usable when optional password icons fail to load.
- **Administrator-created users** — Verified administrators can create ordinary users through the existing registration API while public signup stays disabled.

## [9.3.9] - 2026-09-14

[GitHub release](https://github.com/kanilmari/filterest/releases/tag/v9.3.9) · Database compatibility 9.7.15, no migration.
- **Dataset default views** — Fresh dataset pages open in their configured default view, including for readers without the administrator navigation tree.
- **Coding agent availability** — The administrator Coding agent selector waits for the server's capability answer instead of hiding early, and the optional external runner cleans up and safely recovers its Unix socket across restarts.

## [9.3.8] - 2026-09-14

[GitHub release](https://github.com/kanilmari/filterest/releases/tag/v9.3.8) · Database 9.7.15; installations must run the reviewed migrations.
- **Shared card renderer and palettes** — Cards use one renderer with ordinary and glowy styles, with separate site-default and per-dataset palette controls.
- **Explicit article navigation state** — Classic and image-first articles keep list URLs and scroll positions, and administrators can configure the initially open article sections per dataset.
- **Administrator-only coding agent and API-only automation accounts** — The coding-agent entry is administrator-only and disabled in production by default. Automation uses a protected API-only account flag and a signed session channel.
- **Integrated corrections** — Workline numbers in the Workline Observatory, dataset creation and removal guards, shared field settings, supplemental search, theme contrast, and orchestrator-neutral runtime status.

## [9.3.7] - 2026-09-11

[GitHub release](https://github.com/kanilmari/filterest/releases/tag/v9.3.7) · Database compatibility 9.7.13, no migration.
- **Docker build fix** — The production Docker build includes the shared card-role catalogue, fixing the 9.3.6 image build failure. Carries all 9.3.6 improvements.

## [9.3.6] - 2026-09-11

[GitHub release](https://github.com/kanilmari/filterest/releases/tag/v9.3.6) · Database compatibility 9.7.13, no migration.
- **Card roles in dataset creation** — Dataset creation includes a translated card-role selector per column, sharing one role catalogue with the card-field editor.
- **Cover image modes** — Site administrators can choose cropped cover, complete image, or complete image over a blurred, theme-tinted copy.
- **Layout and article polish** — Sidebar opening buttons stay reachable, search inputs share one visual treatment, image-first articles close from the empty background without closing on text selection, and very wide screens no longer get extra outer borders.

## [9.3.5] - 2026-09-11

[GitHub release](https://github.com/kanilmari/filterest/releases/tag/v9.3.5) · Database compatibility 9.7.13, no migration.
- **Photo credits** — Both article layouts show clickable photographer and provider credits linking to the original photo page.
- **Live language switching** — The field-selection panel and appearance palette update their labels when the interface language changes without losing unsaved state.
- **Includes 9.3.4** — Carries the unpublished 9.3.4 candidate improvements.

## [9.3.4] - 2026-09-11

Prepared as a release candidate but never published on GitHub; its changes shipped in 9.3.5
([candidate release notes](https://github.com/kanilmari/filterest/blob/fb2b482759fb8bf434ea3593ae47ec797b513399/app/docs/publication/RELEASE_NOTES.md)).
Database compatibility 9.7.13, no migration.
- **Expired sessions** — Expired sessions open the localized sign-in flow, while ordinary permission denials keep the current guest view.
- **Independent release tooling** — Filterest gains its own candidate preparation, Linux asset building, promotion and GitHub publication commands, with byte-level release verification and baseline processor requirements for Linux builds.

## [9.3.3] - 2026-09-09

[GitHub release](https://github.com/kanilmari/filterest/releases/tag/v9.3.3) · Database compatibility 9.7.13, no migration.
- **Standalone Filterest repository** — Filterest is maintained in its own repository and installs its development dependencies (Node, Go, Python test tools, Playwright 1.60.0) without a parent workspace, including a dependencies-only setup mode for configured hosts.
