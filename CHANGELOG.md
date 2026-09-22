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

- **Signing in works the same way in every environment** — A development server accepted a sign-in without the browser's identity check, giving every such session the same fixed device binding, and it kept an older, weaker form sign-in alive beside the current one. Both are gone: the identity check is always required, and the old form sign-in is refused everywhere, as production already refused it.
- **Creating a payment always requires its service token** — With no token configured, a development server authorized every caller, which is exactly the state a half-configured installation is in. It now refuses.
- **What development relaxes stays on the developer's own machine** — Automatic approval of a newly registered account, the exemption from the failed-sign-in limit, and the browser error log's write address now require both explicit development mode and a request from the machine itself; a development server reached over the network behaves like production. The insecure-proxy switch is ignored outside development, so session cookies keep their Secure flag. The error-log address also bounds what it accepts and strips control characters, so a caller cannot forge log lines.
- **A worker asks for full access instead of receiving it** — Codex workers run in the workspace sandbox by default, without the database, the network or the rest of the file system; full access is now an explicit choice per run.

## [9.3.17] - 2026-09-22

[GitHub release](https://github.com/kanilmari/filterest/releases/tag/v9.3.17) · Database compatibility moves from 9.8.0 to 9.8.1.
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
- **The dataset forms list columns in one table** — Creating a dataset and managing its columns repeated "Column name", "Data type" and "Card role" on every row. Both now draw the columns through one shared table whose header names each field once and stays at the top while the columns scroll; on a narrow screen the rows stack with their field names. Both forms are the same width and are styled by one set of rules.
- **Saving a dataset definition again repeats nothing** — When the columns were saved but a later setting failed, saving again resent the additions and renames already made, and the refusal took the remaining settings with it. The form now treats accepted column changes as saved at once.
- **"No symbol" removes the symbol** — Choosing "No symbol" left the dataset's symbol in place and reported success, and a failed symbol save could close the form as saved. The stored symbol is now the starting point, so clearing it removes it, and a failure keeps the form open with the reason beside the control, in both forms.
- **A failed request is reported once, in the reader's language** — A failed request showed a hardcoded Finnish "Palvelinvirhe (500)" with the request address to everyone, often beside a second, technical notice or the screen's own translated error, and "too many requests" existed only in Finnish. The request pipeline now owns the notice for its requests: a server error, an unavailable service, too many requests, any other refusal and a lost connection each show exactly one notice from language keys in every interface language, with the status code; a refusal the server explains with a language key shows that explanation, and a screen that reports the failure itself gets no second notice. A request the page cancels, or a page being left, shows nothing. The address and the server's own text go to the console. The dataset form's folder hint shows its real guidance instead of a placeholder.
- **Parallel browser test runs leave each other alone** — The browser test harness ended every browser that appeared during its run, including another run's. It now ends only the browsers it started itself, finds Playwright from the installation's own dependencies, and a language key added by a database migration during a run no longer leaves a stale test record behind.
- **A development server no longer creates datasets for anyone who asks** — Development mode made dataset creation, index creation, comments and translation generation public and skipped their permission checks, so any page open in the developer's browser, or anything that could reach the port, could create datasets. These routes now keep their normal login, CSRF, permission and administrator checks in every environment. Production builds were never affected.
- **Dialogs read cleanly on every screen and in every language** — Forms inside dialogs no longer draw a second framed panel, messages start at the dialog's own margin, action buttons line up at the content edge, and no dialog touches the screen edges on a phone. Twenty-three confirmation prompts showed their language key turned into words, such as "Confirm delete folder", instead of the message; they now read in every language, and the foreign-key form is translated.
- **The foreign-keys page opens for administrators** — It asked for permission on every physical table at once, including two internal tables that can never carry a permission, so every administrator got "403 Forbidden". It now lists only catalogued datasets.
- **Creating and editing a dataset is one form** — The creation page and the Manage table dialog now build the same form in two modes, with one set of setting controls, one text source and one column table; the edit dialog's retry after a partial save is kept. The old builders are gone, over a thousand lines of them.
- **A new dataset appears in the site's navigation** — A new dataset used to land in "database / other_tables" by default, outside the navigation, with nothing saying so. It now goes to the current project's folder, the notice names the folder and warns when the dataset will not be listed, "Open dataset" opens it, and the site tabs refresh at once. A new folder's name and parent sit behind "New folder…", and a parent without a name cannot be sent.
- **AI suggestions search every language** — The reader's interface language used to restrict the AI search to one language's embeddings, which on some sites came from a different model than the query, so Finnish searches found no suggestions at all. The language now only gives a modest preference; matching spans all stored languages, and closeness is measured by cosine distance with a cut-off per embedding model, so an unrelated row no longer slips through.
- **The embeddings page shows what is embedded** — The refresh page now lists, per dataset, whether it is embedded, rows with and without an embedding, stale rows, languages, embeddings of deleted rows, vectors from another model, the last refresh and whether a row change re-embeds automatically, with the provider and model above.
- **One coding agent with two named modes** — The dataset chat's coding agent is one runner and one Codex engine with explicit modes. "Code workspace" edits the local checkout and exists on development machines only; "Site assistant" works through the site's own API and waits for approval before any change. The chat names the mode while waiting and under the answer. Codex no longer receives the web server's secrets, jobs survive server restarts and page reloads, `./ctl agent` manages the runner and `./ctl` starts it, and every Codex path, the worker included, runs one pinned version.
- **A dropdown inside a dialog can be used** — Its option list opened behind the dialog, so nothing could be picked, for example in the foreign-key form's table and column pickers, in asset linking and in the dataset header settings. The list now opens on the dialog's own layer, stacked dialogs included; dropdowns on ordinary pages are unchanged.
- **The unused project banner is gone** — Administrators could upload a project banner in the dataset header settings, but nothing on the site showed it: the only code that drew it had no caller, and saving could still lose the picture in four ways. The upload card, its server logic, the page's banner address and the drawing code are removed. An installation that already has an uploaded banner keeps the file on disk, but `/storage/project_logo.*` now answers 404.
- **Dataset header settings save only what they loaded** — After a failed load, or while a slower load for another dataset was still arriving, Save could write an empty or wrong form over a dataset's texts. Save now works only for the dataset whose settings are shown, says why when it is off, and choosing the dataset again retries. The screen's text comes from language keys in four languages, and it no longer repeats a failed request's notice in raw Finnish.
- **Every installation records deletions** — The deletion log that the delete path writes to came from a private maintenance-shell migration, so no public installation had it, fintravel.fi included. A migration creates it where it is missing, with the same shape, and lets the application's administrator and ordinary-user roles write to it.
- **Readers of a dataset can use its filters** — Groups that could read fintravel.fi's travel datasets lacked the one right that loads the filter bar's options. A migration grants it to every group that already holds all of a dataset's other reader rights, without naming any dataset or group; narrower rights stay narrow, and new datasets already received it.
- **The 9.8.1 interface texts are in the database** — The texts added this release (dialogs, the dataset form, the foreign-keys page, the coding agent, AI search and the embeddings page, dataset header settings, request notices) are seeded in four languages from the same copy the screens fall back to. A text an administrator has already reviewed is never overwritten; only an untouched earlier wording is replaced.
- **The dataset chat reports a failed request in the reader's language** — A failed chat request put the technical message in the chat, with the request's internal name and the server's raw reply, and in Finnish on every page. The chat now shows the same translated sentence as the request notice, with the status code.
- **The Google key stays out of logs and error messages** — The Google embedding request carried its API key in the request address, and a failed request's error repeats its address, so a timeout could write the key to the server log and show it in the administrator's browser. The key now travels in a request header, and a test proves a failed request never repeats it. No production site used a Google key yet.

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
