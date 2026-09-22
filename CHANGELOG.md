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

Database compatibility moves from 9.8.0 to 9.8.1.

- **The container image builds as Alpine moves on** — The image pinned Alpine packages to exact builds, and Alpine deletes a build as soon as it replaces it, which made two releases impossible to install. Packages are now constrained only by the base image's Alpine release branch, which still receives security fixes, and a test keeps it that way.
- **`./filterest test-unit <target>` runs only the target** — With a leading `--`, as the Developer Guide showed, the target was ignored and the whole suite ran. A target is now honoured with or without `--`, written relative to `app/` or to the repository root, and a target that matches no test fails instead of running everything.
- **Only the application creates tables** — A database that began on PostgreSQL 14 or older, or was restored from one, let every database role create tables in the public schema, including the read-only, guest and ordinary-user roles. The migration withdraws that right from everyone except the application's own role; a new installation already starts that way. Who may create a dataset is still decided by Filterest's own table-creation permissions; this closes the way around them at the database level.
- **Searching keeps browsing in every view** — Switching view during a search, returning from an article to the card list, or opening a match beyond the first page no longer drops back to a single page: the search stays a condition of the dataset's own listing, scrolling continues, and the article's side list keeps every loaded match.
- **AI suggestions never repeat the dataset's own matches** — The AI group left out only the search's ten best text matches, so a row further down could appear twice, and two rows with the same title could hide each other. The AI group now holds only rows the dataset's own search does not match, and the first match opened for a search is always the dataset's own.
- **Inspection and data tools at the repository root** — `./db` inspects the database read-only and `./api_crud` maintains datasets, columns and rows through the API. Both work from a fresh clone with the installation's own credentials.
- **The read-only inspection tool is read-only** — It accepted two statements in one query, such as a read followed by an update, and committed any statement that returned no rows. It now accepts exactly one statement, finds forbidden words through comments and strings, runs in a read-only transaction and always rolls back.
- **`./filterest release verify`** — A checkout verifies itself before a release: source boundaries, root files, release ledger, app/database compatibility, bootstrap and demo media. The release build runs the same checks, so a root file and its entry in the root-file list travel in one commit.
- **A long link in a card is no longer cut through its letters** — The two-line limit on card values counted the value's own padding, so a URL that wrapped showed its second line only halfway. Two lines now fit completely, and links no longer carry a clipping box of their own.
- **Dialog content no longer disappears under an empty band** — Every dialog kept a fixed empty band between its title line and its content, and around its sides, and the content scrolled under it and was cut off. The margins now scroll with the content like the margins of a page, the title row reaches the dialog's edges, and the frame is a 2 px border in the theme's border colour with a shadow that is slightly stronger in the dark theme.

## [9.3.16] - 2026-09-21

[GitHub release](https://github.com/kanilmari/filterest/releases/tag/v9.3.16) · Database compatibility moves from 9.7.15 to 9.8.0. Two earlier numbers carry no usable release: the 9.3.14 candidate was superseded before promotion, and 9.3.15 was published but its container image could not be built, because it pinned a certificate bundle Alpine had already replaced and removed. 9.3.16 carries their changes.
- **Queen retired** — The unused multi-agent chat has been removed from the Workline Observatory, administrator navigation and server. Its browser view, eight Queen routes, process launcher, permission and broken Bee message address are gone, so no Queen address is exposed even on installations configured as development environments.
- **Searching a dataset is browsing it** — A search used to answer with a separate list of ten best matches. It is now an ordinary condition of the dataset's own listing, so the counter shows the real number of matches, endless scrolling loads the rest exactly as without a search, and sorting, filtering and the view switch keep working. A dataset whose search index has not been built yet is searched by the same words through the row itself, and a search that is a plain number also finds that row by its identifier.
- **Both dataset forms offer the same settings** — Creating and editing a dataset were two different forms that had drifted apart. They now share one definition of column types, symbols, folders, relations, group read access, images and deletion protection, so a setting available in one is available in the other.
- **Starting the application no longer deletes permission settings** — Startup used to remove permission grants it considered stale, silently and with no record of what they were; the administrator's own access was restored immediately afterwards, so only other groups noticed, later. Startup now reports what it would remove and removes nothing unless an operator approves that run explicitly.
- **A renamed handler no longer strands an address's permissions** — A route's database row was identified only by the name of the Go function serving it. Renaming the function made startup add a second row for the same address and leave every permission grant on the old one, so access disappeared without anyone touching the permission settings. Startup now keeps the existing row when the address identifies it unambiguously, and explains in the log every case where it does not.
- **A dataset is described in one place** — The article view, the table view and the editing controls each read the dataset's shape from a different source, and a stale catalogue could make a column uneditable or hide a control. One builder now produces that description and a test holds every reader to it.
- **Language text is served as written** — Interface text is stored in two places that had to agree by hand, and the query read only one of them, so translations written through the interface did not appear. Both are now filled together, the rule is documented, and the cleanup that retires unused keys no longer removes one that is still in use.
- **An approved change can no longer be spent on a different target** — The site assistant recorded an approval as a method, an address and the content of the request. The dataset travels in the address's query, so two changes to two different datasets could look identical, merge into one waiting entry, and an approval given for one could run the other. The same held for tickets, tasks and comments. An approval now names exactly one target.
- **A failed change no longer takes the untried ones with it** — Running a set of approved changes stopped at the first failure and discarded the rest, then offered to try again — for work that no longer existed. What was not attempted is kept and can be approved again without repeating what already succeeded.
- **The chat says which agent it is about to run** — One choice ran either an agent that may edit the code workspace or one that may only call the site's own interface, depending on the environment, while the waiting text promised the first in both cases. Someone authorising work on their live site is no longer told it will edit code.
- **Searching a dataset counts that dataset** — A search showed the number of hits found in other datasets while hiding the matches in the one being searched. The count now means the dataset in front of you, its own matches appear first, and results from elsewhere follow as a short extract around the words that matched instead of the opening of each document.
- **A price can be left empty** — Adding a row to a dataset with a decimal column failed outright when the field was blank. An empty field is missing data, as it already was for dates, whole numbers and structured values. A comma is read as a decimal point.
- **A new dataset has readable names** — A dataset created through the interface showed raw column names such as `re_examine_date`. Creating one now names it and its columns in the languages the installation uses.
- **Every address states which requests it answers** — This was written out by hand in sixty-one places and in four of them forgotten, which is how a read request reached code that changes data. It is now part of defining the address, and checked in one place.
- **Developer ticket and workline tools work from the public repository** — The shipped `db_task` and `db_report` commands needed database tables that existed only in the private maintenance shell, so they failed in a fresh clone. Those 16 tables are now part of the product with their generic statuses and groups, and no installation's tickets, reports or credentials travel with them. Every new installation receives the tables; existing ones keep their rows.
- **Site assistant in the dataset chat** — An administrator can ask the chat's coding agent to work on the site itself. The job reads live data through the site's own API with the asking person's rights, and any change it prepares waits in the chat: each one shows what it would do and its exact request, and one button approves and runs them. A refused or failed change is reported as such, and nothing after it is run. The assistant engine is configuration, so another engine can be added without code changes.
- **Assistant jobs act as the asking administrator** — A site assistant job exchanges a one-time code for a short-lived session of the administrator who asked, so it reads with that person's own rights and every existing security check still applies. Such a session may write only calls the administrator has approved, matched by method, address and exact content, and each approval runs once. The credentials live in the running application only and expire within 45 minutes.
- **API catalog for the site assistant** — Administrators can read `/api/admin/site-assistant/api-catalog`, an up-to-date description of the installation's API generated from the running route registry, access profiles and handler comments, with request shapes for core row and language-key operations. Tests keep it in step with the code.
- **Dataset text search works again** — A search address whose route already carried a parameter of its own lost the dataset name, so the server refused every text search as a permission problem. Searching a dataset works again, and erasing the search field now returns the dataset to its ordinary results immediately, the same as pressing the clear cross.
- **A JSON column no longer breaks adding a row** — An empty JSON field is stored as missing data, a structured value is encoded, and a value that is not JSON is reported by column name instead of failing the whole row with a database message.
- **A decimal column can finally be chosen** — Creating and editing a dataset now offer the same column types, including a decimal number with its total digits and decimal places. Previously creation offered eight types and editing five, while the database accepted sixteen, so a price had to be stored as structured data.
- **Images can be attached to an assistant question** — An administrator can attach screenshots for the site assistant to look at, directly from the chat. Attached images appear as removable chips beside the question, a file that is not a supported image is refused before any upload, four may wait at a time, and each image is discarded within 45 minutes. The image stays on the server under an opaque reference that the browser cannot turn into a path.
- **A new dataset is immediately usable by administrators** — Creating a dataset grants administrators every dataset-specific route in use, instead of a hand-kept list that had fallen behind, so newly added features such as the dataset chat work on a new dataset without waiting for a restart.
- **Reproducible Codex workers** — Worker runs accept explicit Codex model and reasoning-effort choices, verify the installed CLI against an exact version before dispatch, and record those choices for foreground and background runs. They no longer resolve or download Codex through npm at run time.
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
