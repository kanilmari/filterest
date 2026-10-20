<!-- Article_Section_Defaults.md -->
<!-- Defines dataset-level initial states for article collapsible blocks. -->
<!-- Connects the existing field-settings administrator and article renderers. -->
<!-- Keeps initial defaults independent of field visibility and reading-time choices. -->

# Article collapsible-block defaults

In **View field settings**, select a dataset and **Article presentations**. One
five-column table contains field name and UID, Article, Image-first article,
Page-sized image-first article and computed Select all. Fields share an order;
Details, Images, Attachments, Related items and Task progress are fixed block rows.
Article supports all five blocks; both image-first columns support Details only.
Unsupported cells show an explained dash. The block cells mean **Open at start**.

The group picker normally resolves all selected groups to the site. Mixed real
values or orders retain explicit group targets. Blocks are editable only for an
actual site save; group and personal contexts label them dataset-wide and read-only.
Fields and opening blocks commit together through one administrator Save. Group
priority and name changes belong to that same draft. Restore defaults stages explicit
visible/open values; Cancel discards the draft. Zero visible fields are allowed in
each article projection. Neither field choices nor block values grant access.
The informational warning checks all three registered presentation rights from one
permission snapshot and links to Permissions when a selected group lacks access.

Each target retains its original widths, order, name and priority until an explicit
intent changes that property. Different orders are explained; only a move adopts
one order for all selected targets. Mixed cells cycle visible, hidden, unchanged.
Recovery is bound to actor, dataset UID, exact targets and baseline revisions.
Changed revisions leave the draft pending, never silently replayed. Context switches
preserve drafts, including after a failed save or verification.

`GET /api/admin/view-field-settings/article-presentations?dataset=<name>&targets=site`
returns complete targets; groups use `group:8,group:9`. POST to the same administrator
route sends dataset UID, family `article`, ordered UID members with all three
visibility/width maps, assignment links/names/priorities, revisions, and site-only
blocks. The dataset row lock covers revision comparison and every target mutation;
any failure rolls back. Stale revisions return 409 `article_revision_conflict`.
After commit all three projection caches are invalidated. The editor accepts the
new baseline only after a matching GET verifies every value, assignment and revision.
A committed write with failed verification keeps the draft and requires fresh state.
The opener policy is untouched. Personal targets have the same adapter contract;
a personal editor is not mounted here.

Readers can still open or close blocks normally; these actions do not save
administrator settings. A media refresh preserves current disclosure state.
The horizontal table scroller keeps its identity column visible on phones;
vertical scrolling stays with the page. Controls are at least 44 pixels.

The canonical storage is
`system_db_tables.article_section_initial_open`, a JSON object containing
`article_view`, `image_first_view` and `image_first_page_view`. All five Article
booleans and each image-first presentation's `details` boolean are explicit.
The old `classic` and `image_first` names are request compatibility aliases;
responses retain the requested presentation identity. The supported API is:

- `GET /api/view-field-settings/article-section-defaults?dataset=<name>&presentation_key=<canonical-key-or-classic-or-image_first>`
- `POST /api/admin/view-field-settings/article-section-defaults`, containing
`dataset`, `presentation_key` (canonical key or compatibility alias), and either a nonempty `initial_open` boolean
  patch or `reset_to_defaults: true`.

Reads require permission to read the dataset. Mutations require administrator
access and the normal CSRF protection. Each patch/reset is transactional and
preserves other presentation keys. The response separates raw `overrides` from
effective `initial_open` values. The compatibility reader resolves old absent
values as open; every write stores the complete canonical object.


## Shared article-presentation contract and storage (database 9.12.0)

The source-owned [article contract](../../frontend/shared/article_presentations/contract.json)
uses the existing shared-JSON pattern: the browser imports it through
`contract_reader.js`, and Go embeds that same file through `contract_reader.go`.
It owns presentation keys, compatibility aliases, opener-role defaults, block
keys and support, and permission routes. Browser and server drift tests retain
existing constants and check them against this source.

Canonical presentation keys are `article_view`, `image_first_view`, and the
`image_first_page_view`. The storage batch registers all three database view
identities and independent image-first permission routes. Page-sized rendering
and opener activation remain later batches; the combined editor is implemented; the browser
contract's reserved flag and current permission routes still describe that boundary.
`permission_route` records the approved independent route for each key;
`current_permission_route` explicitly preserves IFAV's existing Article gate.
Compatibility block readers may still request `classic` and `image_first`;
`legacy_section_key` records that boundary. The combined editor uses canonical keys. Stored block keys are canonical.

The role catalogue describes the later central opener policy. Ordinary image
roles default to IFAV; body/title/summary, Home and field links default to
Article. Product and free-layout media have distinct roles defaulting to
Article to preserve their current behavior. Merely reading this contract
neither emits role attributes nor activates a resolver or a new opener.

Each active dataset/target has one collection (`system_column_field_sets.article_family`)
and exactly three assignment links with identical group priority. A bundle cannot
serve another target or listing view. Legacy collections remain intact; active
settings are cloned. Members have one order and a `presentation_values` object:
each canonical key contains `visible: boolean` and `width_px: integer|null`.
Widths are independent; null means automatic, with no inheritance path. Empty
projections are supported. Foreign keys remove deleted fields; new deliverable
fields are visible at the site and unchecked in personal/group bundles. Restricting
a field's delivery clears its visibility while retaining order and widths.

The dataset registry row, identified by stable table UID, owns the complete
`article_opener_policy` role map. Defaults match the shared contract, including
Article for product/free-layout images. This batch stores the policy without
changing opener behavior. Dataset creation initializes explicit site bundles,
sections and policy; it creates no personal/group targets or audience grants.

The shared SQL mutation service locks the dataset, updates only the requested
projection and writes all three links. Legacy collection selection copies that
projection into the target's bundle and preserves sibling values. Database guards
refuse direct changes to article collections, members, assignments and opener policy,
including otherwise valid values. The service has function-local mutation scope;
reset, collection deletion and opener-policy saves use the same boundary. Initial
materialization and lifecycle cascades remain permitted. Deferred checks reject
incomplete links, incompatible families, cross-target reuse, forbidden visible
fields and incomplete sections. The scope grants no additional table privileges.
All three projection caches are invalidated after successful endpoint commits.
Named saves retain a separate collection for each name; new names clone the current
sibling values before changing the requested projection. Detached saved collections
remain available. Selecting a collection copies into a working bundle rather than
rewriting the previously active named choice. Reset removes personal/group links
and retains saved choices; site Restore writes metadata defaults into the existing
explicit site bundle. It preserves sibling values and widths.
The runtime and portable-restore SQL-path reviews pin all twenty helper bodies,
their catalogue settings, the six owner-run function identities and each trigger's
exact protected-table attachment. Trigger functions have owner-only execution;
the publicly callable owner-run helper only locks a registry row. Limited preference
writers receive neither registry UPDATE nor repair-history SELECT through this feature.
Portable dumps omit execution grants; restore reapplies owner-only execution to
exact reviewed article triggers before verifying their complete helper closure and
attachments. Unreviewed functions still refuse restoration. The bootstrap generator
drains only `public.article_bundle_invariant` events before each release data
migration's DDL, then restores deferral for atomic bundle writes. These boundaries
belong to the generator, so regeneration retains them without changing released
migrations or other constraints' modes. Before materialization the completion-marker
guard skips validation while the boundary clears queued events. Materialization
asserts the final state before writing its marker; commit checks later queued events.
The fresh/upgrade proof imports schema and seed in separate complete transactions;
the package-import proof also runs the shared shell importer through `psql`.

The one-time migration `20261015000012_materialize_article_bundles.sql` locks the
registry, assignments, members, metadata and audiences in one transaction. It
copies each exact Article target's ordered UIDs/widths, uses that target's Article
for missing IFAV, and IFAV for missing Page-sized IFAV. Authored image-first values
are preserved. Targets without Article use unfiltered-by-reader metadata ordered
by `co_number NULLS LAST, column_uid`; every dataset receives a site target.
Compatible authored orders are merged while retaining each projection's relative
order; cyclic order or differing priorities refuse the whole upgrade. Forbidden
legacy selections and malformed/conflicting block objects also refuse it.

`classic` becomes `article_view`, with its five absent booleans filled with true;
`image_first` becomes `image_first_view`, with absent Details true; Page Details
starts from IFAV. Authored canonical values are retained, and contradictory
legacy/canonical values are refused. No legacy keys remain after the data step.

Article's actual group grant tuples and nullable scopes on enabled Article-route
functions (including authored aliases) are copied to IFAV once; disabled source
functions do not become a new audience. Existing disabled grants remain untouched;
that initial IFAV audience is copied to Page. Authored grants survive and null-safe
duplicate checks prevent duplicate global rights. There is no invented users/guests
grant. Startup has no default reader grant for these routes; its existing
administrator recovery grants remain an exception. Independent rights activate
only in the later opener batch; today IFAV still uses the Article gate.
The grant uniqueness key includes both nullable schema and dataset scopes, so
copying a distinct scope cannot silently collide with an authored grant.
The repair record `(migration,action)=('article_bundle_materialization','completed')`
is written only after order/width, grant and invariant assertions. A completed
replay performs no copy or grant, including after deliberate revocation. Bootstrap
runs the identical data file after user/group/view seeds and checks the same marker.

Operational rollback restores the paired pre-upgrade database/application recovery
snapshot. Keep before/after settings and audience evidence with that backup. After
new edits prefer a forward repair; deleting explicit values cannot reconstruct old
fallback behavior. The current bootstrap schema snapshot follows `VERSION_DB`;
historical snapshots are never rewritten to satisfy a current-schema check.

## Existing field-settings consumers

The compatibility field-set endpoints remain available to older callers. A uniform group
save returns `field_set_id` for older callers plus `group_variants` with every
selected group's actual `field_set_id`, priority and ordered fields. Its readback
checks those exact IDs, fields and priorities, and rejects unintended targets.
The ordinary GET retains real target identities. Site Restore succeeds when its
explicit site projection equals the ordered `metadata_visible_columns`; other
views still require the site assignment to disappear. No assignment is hidden.

Production readers/writers under `app/frontend` (located with recursive `rg -n`
for the endpoint names and field/assignment response keys; generated `dist/` and
test files excluded) are:

| Consumer | Expected contract retained |
| --- | --- |
| `core_components/admin_tools/view_field_assignments_view.js` | Reads dataset/view, permissions, available columns, groups and site collections; writes uniform/mixed saves and shared resets, then verifies a fresh GET. Uniform saves pass all returned group identities to the existing verifier. |
| `core_components/admin_tools/view_field_assignments_state.js` | Builds exact-target and mixed payloads; resolves real shared collection IDs; verifies every group's saved ID, priority and ordered fields. Site Restore verifies explicit Article defaults, including empty projections. |
| `core_components/filterbar/filter_list/column_view_preset_builder.js` | Reads named `field_sets`, active/personal/site IDs, scope, available/effective fields and edit permissions. Saves each name independently; assigns by ID, resets personal preferences, and deletes collections. Save/delete/reset reload GET; assignment applies the chosen fields and refreshes the dataset. Saved choices survive assignment/reset. |
| `core_components/table_views/price_chart_view/chart_configuration.js` | Reads a shared site collection and ordered axes, then saves by ID/name and checks status. Uses `price_chart`, outside Article handling. |
| `core_components/endpoints/stable_endpoint_router.js` | Forwards GET and all eight save/assign/reset/delete request/response objects without reshaping them. |
| `core_components/endpoints/stable_api_inventory.js`, `core_components/pipeline/api_pipeline.js` | Register the same handlers for GET and all eight mutations; neither reads nor rewrites response contents. |

`filterbar_section_order_handler.js` uses `field_sets` only as a toolbar section
name, not as an API reader. The PostgreSQL consumer proofs serialize actual
mutation/readback objects into the production JavaScript state functions, while
Vitest also checks missing IDs, stale fields/priorities, and accidental targets.

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
