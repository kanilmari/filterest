# Filterest 9.4.0

This release brings a general Chart view, separate appearance choices for each
dataset, a Home layout palette, clearer phone navigation, and more reliable
search and listing updates. Administrators gain stronger dataset naming and
permission safeguards, automatic log retention, and offline installation and
recovery checks. It includes the changes since 9.3.23 and requires database
9.11.0, upgraded from production database 9.10.1.

## Before you update

- **Back up and rehearse the database upgrade.** The 27 migrations in this
  batch add system tables and metadata, migrate appearance choices, protect
  dataset names, convert platform timestamps, and record database 9.11.0 last.
  They run at startup where SQL migrations are enabled. New system tables make
  this a database minor release; 9.4.0 requires the completed 9.11.0 schema.
- **Chart access must be granted to each reader group.** Chart is now staged
  through the group permission `/ui/view/price_chart`. Administrators retain
  access. Other readers lose Chart after the update until their group receives
  an explicit grant, even when it was the dataset's saved default. Review groups
  before rollout. Existing `price_chart` addresses keep working for authorized
  readers; unsuitable datasets or denied defaults use an allowed view.
- **Appearance and Home defaults change.** Existing explicit card style and
  column-count choices become per-dataset overrides. Unset choices inherit site
  defaults. Home without a saved layout now places its text block in the centre
  with left-aligned lines, and the light theme shows background media more
  clearly. Check important pages in both themes after rehearsal.
- **Conflicting aliases are disabled, with their records preserved.** The
  upgrade gives real dataset names precedence, retains alias timestamps, and
  reports conflicts to administrators. Review affected public links; former
  primary names are not yet retained automatically after a rename.
- **Platform clocks retain their Helsinki meaning.** Platform-owned timestamps
  become timezone-aware using Europe/Helsinki. Site-owned datasets are outside
  this conversion and need their separate reconciliation. Rehearse installations
  with custom dependent views, rules or triggers; unsupported captured states
  refuse conversion before removing objects.
- **Routine logs older than 90 days are deleted automatically.** Unless an
  operator has already set `automatic_data_retention_enabled`, the upgrade turns
  automatic retention on. Its first round runs 90 seconds after startup and then
  every 24 hours, deleting rows older than 90 days from `system_audit_log`,
  `system_transaction_log`, `system_log`, `dev_agent_task_runs` (completed runs
  only), `ai_usage_logs` and `mcp_query_log`, at most 100,000 rows per table and
  round, so a long history disappears over the first few days. If those older
  rows must be kept, back up the tables, or before updating add
  `automatic_data_retention_enabled` with the value false (or a longer policy in
  `data_retention_policies`) to the Settings dataset; the upgrade keeps existing
  operator choices (see the retention controls in the
  [runtime contract](../instructions_and_documentation/runtime_contract.md)).
  Upgrades add missing policies while keeping disabled policies and custom
  durations. Ambiguous or malformed policy settings stay unchanged with a
  notice and need administrator review. Active agent work and deletion
  tombstones remain protected; successful routine reads create fewer audit rows.
- **Unresolved migration failures stop startup.** New migration records retain
  source hashes and execution outcomes. Failed or interrupted self-managed
  migrations require the documented operator reconciliation before startup,
  even if their source files are removed. Historical records remain unverified;
  a fresh-installation baseline does not claim old migrations executed.
- **The site operator still performs updates.** Site information now shows one
  release-facts table and Check releases. The duplicate update preview is
  removed. Update requests and administrator decisions have guarded storage,
  but execution remains disabled and there is no one-click installation action.
  Unsigned releases use the existing site-by-site operator procedure; managed
  signed-update verification still requires independently configured trust.

## Browsing and presentation

- **Choose Chart's axes.** Chart replaces the price-only label for datasets
  with typed time and numeric fields, including numeric identifiers. Readers
  share their axis choices in the address; administrators can save dataset
  defaults through the existing view-field settings. If one selected field
  becomes inaccessible, the other valid choice survives.
- **Each dataset keeps its appearance.** The palette opens on This tab for
  cover/background and card, article and header overrides. All datasets edits
  shared defaults, while site-wide values keep their own scope. Inheritance is
  explicit, drafts survive scope changes and closing, and revision checks refuse
  stale saves. Card, tab and site permissions remain separate. Phone controls
  stay reachable, and changing language keeps focus and drafts.
- **Home has its own palette.** Place the title, slogan and description using
  a nine-position grid, margins, maximum width and line alignment. Preview and
  reset share the dataset palette's movable, resizable panel. Light and dark
  themes have separate media opacity and colour wash; slogan and description
  may each be empty.
- **Navigation fits the screen.** Trailing dataset buttons hide when space
  runs out, with every destination still in the menu. Phones have a search
  button that opens a focused field without moving the toolbar or results.
  Dataset settings, theme, language and palette controls are gathered in the
  collapsible Style and color settings section.
- **Search results stay current.** Category changes replace results once while
  keeping previous rows visible until the replacement is ready. Older replies
  cannot overwrite newer selections. Product cards now replace and append the
  committed results, including empty searches, without duplicate rows. Tree,
  calendar, Chart and settings views also receive refreshed rows; map row-update
  consolidation remains later work.
- **Listing controls behave predictably.** Selected filters stay centred with
  compact desktop chips and usable phone targets. Clear all keeps keyboard focus,
  dropdown controls remain visible, finished listings stop paging, and newly
  opened dataset/view surfaces start at the top. Retained history returns keep
  their position. Late sorting defaults cannot change a page already left.
- **Copy list cells by touch.** Holding a cell opens the existing translated
  copy menu without interfering with scrolling or ordinary taps. Replaced
  lists release their menus and listeners; workline menus stay on screen when
  translated help wraps.
- **Passwords and PINs have distinct browser hints.** Registration and password
  changes identify account passwords correctly for password managers. Masked
  numeric PINs use verification-code hints. Account creation has a plain
  translated notice with the existing sign-in link.

## Administration and installation

- **Readable datasets share one catalogue.** Navigation, aliases, document
  metadata and public sitemap entries use the same dataset identity and read
  permission. Equal names in different schemas stay separate. The sitemap
  exposes only datasets a signed-out visitor can open, and raw database views
  require administrator access.
- **Concurrent management changes can wait safely.** Dataset creation, removal
  and permission changes wait up to ten seconds for earlier permission work.
  A timeout rolls back and gives a translated retry message. Dataset creation
  no longer repairs unrelated missing metadata, and failed deletion completion
  rolls back the whole change before logging success.
- **Dataset kinds report real capabilities.** Ordinary, embeddings and location
  contracts use schema evidence without converting historical datasets or
  granting new rights. Naming a dataset does not activate Chat. View requests
  let the server provide permitted picture and geometry support; legacy API
  support flags remain accepted. The service-catalogue visibility pilot keeps
  its application guard unless matching database protection is verified.
- **Publications show plans and results.** The Workline Observatory's release
  decisions now carry a target date, version, reader-facing description and
  publication state, with revision-protected edits and translated guidance.
- **Offline checks and recovery have stronger evidence.** Saved installation
  snapshots can be compared with the standard layout and schema without changing
  a database. Schema reports separate renames, reviewed equivalences, column
  order, ownership and grants. Recovery authenticates backup packets, restores
  into a verified replacement and keeps the original database available;
  legacy unauthenticated recovery requires an explicit operator choice.
- **Release and development evidence is reproducible.** Release bundles bind
  reviewed source, migration bytes and exact native/image assets. Publication
  accepts the owner's recorded approval in chat; signing remains optional.
  Local check planning and parallel Python tiers improve verification without
  making future row policies, field permissions or style-package storage
  available in this release.

New installations call the About dataset About (Tietoa in Finnish); existing
sites retain their authored names and translations. See [CHANGELOG.md](../../../CHANGELOG.md)
for the complete change history and the installation update and recovery guide
for the supported operator procedures.
