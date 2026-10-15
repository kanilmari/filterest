<!-- Article_Section_Defaults.md -->
<!-- Defines dataset-level initial states for article collapsible blocks. -->
<!-- Connects the existing field-settings administrator and article renderers. -->
<!-- Keeps initial defaults independent of field visibility and reading-time choices. -->

# Article collapsible-block defaults

In **View field settings**, select a dataset and the **Article** view. The
**Article collapsible blocks** panel has its own presentation selector, Save
button and Restore action. Its settings apply to every reader of that dataset;
the field-set user-group selection does not change this scope.

The **User groups** picker chooses fields and grants no view access. Selected
groups without the view's route right are listed beside the picker with an
**Open Permissions** link. Both article presentations require
`/ui/view/article_view`; changing collapsible-block defaults does not grant it.
See [Permission Model](Permission_Model.md#capability-and-dataset-permissions).

- **Traditional article** supports Details, Images, Attachments, Related rows
  and Task progress.
- **Image-first article (IFAV)** supports Details. This option never hides its
  article image or changes image-first navigation.
- A missing setting means **open**. An explicitly closed block keeps its
  heading and opening control visible.
- Cards, compact article lists and tables keep their current behavior.

Each new article opening reads the defaults for that dataset and presentation.
A reader can open or close a block normally; these reading actions do not save
administrator settings. A media refresh within the same article preserves its
current open/closed state. A newly opened article starts from the saved defaults.

The administrator's unsaved drafts are kept separately for each dataset and
presentation while that editor remains mounted. Language changes preserve the
draft. Save sends only changed section booleans, then verifies the exact API
readback before showing success. Restore removes only the selected
presentation's overrides, so its blocks again default to open. The other
presentation, dataset, field assignments and user groups are unchanged.

The canonical storage is
`system_db_tables.article_section_initial_open`, a JSON object with optional
`classic` and `image_first` objects. Only the supported section keys and boolean
values are accepted. The supported API is:

- `GET /api/view-field-settings/article-section-defaults?dataset=<name>&presentation_key=classic|image_first`
- `POST /api/admin/view-field-settings/article-section-defaults`, containing
  `dataset`, `presentation_key`, and either a nonempty `initial_open` boolean
  patch or `reset_to_defaults: true`.

Reads require permission to read the dataset. Mutations require administrator
access and the normal CSRF protection. Each patch/reset is transactional and
preserves other presentation keys. The response separates raw `overrides` from
effective `initial_open` values; absence is resolved as open on the server.


## Shared article-presentation contract (next-version groundwork)

The source-owned [article contract](../../frontend/shared/article_presentations/contract.json)
uses the existing shared-JSON pattern: the browser imports it through
`contract_reader.js`, and Go embeds that same file through `contract_reader.go`.
It owns presentation keys, compatibility aliases, opener-role defaults, block
keys and support, and permission routes. Browser and server drift tests retain
existing constants and check them against this source.

Canonical presentation keys are `article_view`, `image_first_view`, and the
reserved `image_first_page_view`. The reserved key is vocabulary only: this
batch adds no registration, selector, renderer, grant or API behavior for it.
`permission_route` records the approved independent route for each key;
`current_permission_route` explicitly preserves IFAV's existing Article gate.
The browser still reads and the server still accepts the legacy block objects
`classic` and `image_first`; `legacy_section_key` records that compatibility
boundary. Block support and absent-means-open semantics are unchanged.

The role catalogue describes the later central opener policy. Ordinary image
roles default to IFAV; body/title/summary, Home and field links default to
Article. Product and free-layout media have distinct roles defaulting to
Article to preserve their current behavior. Merely reading this contract
neither emits role attributes nor activates a resolver or a new opener.

This groundwork belongs to the next article-presentation version (K387, e.g.
application 9.5.0 / database 9.12.0), separately from the current-fix release.
It changes neither version files nor database structure.

## K388 compatibility before-list

The coordinator runs the read-only exporter on a database **copy**, with an
explicit connection supplied through an environment variable. It does not
load installation credentials or start application services:

```bash
# Supply FILTEREST_BASELINE_DSN securely for the chosen database copy first.
cd app
go run ./backend/tools/article_presentation_baseline > before.json
# Optional: --dsn-env NAME --timeout 10m
```

The exporter requests a PostgreSQL `REPEATABLE READ, READ ONLY` transaction,
uses SELECT queries and the existing uncached field-settings readers, and
always rolls back. No migration, setting, grant or row is written. Failure
returns a nonzero exit status; a successful database read must finish before
JSON output starts. A role with SELECT access to the public settings tables
and information schema suffices. No database-name or user-sensitive installation
configuration is included in the output; principal ids and group names are
intended evidence and should stay with the rehearsal backup.

Format version 1 sorts object keys, datasets by UID, principals by id, targets
as metadata/site/group/personal (ids ascending), and opener sources by view
key followed by history restoration. Field arrays retain the current SQL
order; group ties use group id, then collection id. Targets include the
metadata fallback, site layer, and the union of assigned group/personal
principals across views. Each target includes Article, the configured IFAV
projection, and IFAV's separate supplied-row/history sources. Every user also
has a resolved Article projection, IFAV sources and route checks, so competing
and tied memberships and guest preference handling are explicit. A personal
assignment wins over applicable groups; guests do not receive personal **or
group** field preferences because today's resolver uses a null preference
identity for account 1. Site/metadata still apply.

Fields carry UID, name, current width (`NULL` becomes zero), the nullable
stored width, role/order metadata and row-visibility flags. Metadata fallback
has no stored width. Information-schema-only fallback fields have a null UID;
this is evidence of missing metadata, not an invented stable field identity.
`stored_blocks` retains the original object, while `blocks` separates object
presence, explicit booleans and effective initial-open values. A null or
invalid object is reported with `block_read_error`; the browser then falls
back to open after the legacy API rejects it. Invalid overrides are never
silently applied in part.

IFAV's `source_dependent: true` is deliberate. Ordinary openings consume their
supplied row, not the configured IFAV assignment; restoration fetches Article.
`ordered_projection_fields` applies the current role/positive-order sorter to
server JSON keys for each registered source view, with aliases normalized.
It includes widths from that source, without pretending that a dormant IFAV
assignment controls those openings. `additional_row_keys` and top-level
`limitations` identify transport/media/generated keys and row-dependent
rendering that this settings-only report cannot prove. Description/Details
suffix sorting, empty values, ownership, expanded relations, column grants
and actual rendered rows need the later browser/reader proof. This report
must not be treated as a complete rendered-row compatibility approval.

Audience evidence retains every Article-route grant, including nullable
schema/dataset scopes and disabled flags. `group_ids` matches the signed-in
browser cache, which includes enabled grants at **any** dataset scope;
`tableless_group_ids` and `dataset_scoped_group_ids` distinguish the stricter
route checks. `access_control_group_ids` additionally reflects legacy
null-disabled acceptance. `guest_allowed` matches the anonymous bootstrap:
only enabled tableless grants of the group named `guests`, independently of
account-1 memberships. Reader checks expose these distinctions. Dataset,
row, column, media and login-to-browse rights remain separate; administrator
startup safety-net grants are not simulated.

Batch 2 can consume this versioned before-list, preserve assignment provenance,
width null/zero, explicit/absent blocks and grant scopes, and enumerate changes
against its new materialized model. It must add the after-list and diff, list
all differences for owner approval, and refuse unlisted differences (K388).
A source-dependent IFAV result or null field UID is never permission to
normalize silently. Use the disposable `TestArticleBaselinePostgres` proof;
no production baseline is run by a worker.
