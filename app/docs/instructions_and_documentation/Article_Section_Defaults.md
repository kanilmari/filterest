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
identities and independent image-first permission routes. The Page pilot now renders only explicit row links and Home buttons carrying
`view: "image_first_page_view"`, reusing IFAV with an opt-in contained-image layout.
The combined editor is implemented; the browser contract keeps Page `reserved:true`
so it does not enter ordinary opener choices or activate dataset opener policy.
`permission_route` records the approved independent route for each key;
`current_permission_route` explicitly preserves IFAV's existing Article gate.
Page requests its canonical Details default; compatibility readers still request `classic` and `image_first`;
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
for missing IFAV, and IFAV for missing Page-sized IFAV. Thus an upgraded target
without an authored Page projection initially gets its effective IFAV fields and
widths (or Article/metadata through that fallback chain). Authored image-first values
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

<a id="k388-compatibility-before-list"></a>

## K388 compatibility reports and approval gate

K388 uses a read-only BEFORE snapshot from the pre-upgrade database and an
AFTER snapshot from its upgraded copy. The offline difference command produces
the owner's complete settings-difference list. Approval identifies the JSON
list's SHA256 digest. The stop rule is an **operational gate after the upgrade**:
an unlisted or approved-but-missing difference requires rollback. It is not a
check inside migration 12; migrations 10–12 are unchanged.

### Read-only exports

Supply a connection securely in an environment variable, then explicitly name
that variable. Neither command loads installation credentials, starts Filterest,
or runs migrations. Both enforce one PostgreSQL `REPEATABLE READ, READ ONLY`
transaction, issue read queries, create no temporary objects, and always roll
back. AFTER reads the already materialized members; no migration SQL is replayed
or copied into a temporary table. JSON output begins only after the complete
snapshot succeeds. Database errors never print the connection or driver message.
The optional `--timeout 10m` bounds the complete snapshot.

```bash
cd app
# Before upgrade, on a database copy (and Tuesday on production read-only):
go run ./backend/tools/article_presentation_baseline \
  --dsn-env FILTEREST_BASELINE_DSN > before.json

# On the same copy after the release binary's first start runs migrations 10–12:
go run ./backend/tools/article_presentation_after \
  --dsn-env FILTEREST_AFTER_DSN > after.json
```

The distinct AFTER command makes database phase explicit. BEFORE refuses any
database with the article-bundle schema, including one with only migration 10
applied, with a message directing the operator to AFTER. Keep a pre-upgrade copy
for BEFORE; an upgraded database cannot reconstruct that evidence. AFTER requires
the completed materialization marker and a clean existing bundle invariant check.
Both commands accept a SELECT-only role with access to public presentation,
principal and permission tables and information schema; AFTER also needs SELECT
on repair records and EXECUTE on the read-only bundle checker.

Both exports use **format version 2**, contract version 1. Version 1 BEFORE
files lack Page evidence and must be exported again from a pre-upgrade copy.
The schema is shared with the offline comparison, without runtime/database
imports in that comparison. Datasets are ordered by UID, principals by ID,
targets metadata/site/group/personal by ID, and IFAV opening sources by view key
then history restoration. Field arrays retain their effective order; JSON object
keys are sorted by the exporter. There are no timestamps or connection details.

Each dataset reports the effective saved Article, configured IFAV, and Page
projection per target and reader: ordered field UID/name, effective width,
nullable stored width, `card_element`, `co_number`, and row-visibility flags.
A null UID records information-schema fallback rather than inventing an identity.
Page was reserved before upgrade; its BEFORE projection records the configured
assignment or metadata fallback, **not an existing rendered Page surface**.
AFTER reads visible `presentation_values` from the selected materialized bundle;
metadata remains a separately reported fallback. Personal settings win over
groups, then site and metadata; priority and group-ID ties follow the uncached
resolver. Account 1 receives neither personal nor group field preferences.

IFAV remains source-dependent in this upgrade. Its configured projection does
not describe every opening: the report also records supplied-row sources and
Article history restoration, applying the legacy role/positive-order sorter to
server JSON keys. `additional_row_keys`, `different_from_article` and
`source_dependent` retain that evidence on both sides. Empty values, ownership,
relations, media, suffix sorting and reader column grants still need separate
rendered-row/browser proof; these reports do not approve those behaviors.

`stored_blocks`, parsed `blocks` and `block_read_error` preserve raw presence,
explicit/absent booleans, effective initial-open values and malformed-object
fallback evidence. Migration normalization from legacy to canonical keys is
listed even when effective open states are equal. The Article route audience
retains every grant, nullable schema/dataset scope, disabled/specific-table flag,
browser/tableless/access-control/dataset-scoped group sets, and named-guests
bootstrap result. Each reader's three route checks are also compared. These are
Article-route settings, not dataset, row, column, media or login-to-browse rights;
startup administrator safety-net grants are not simulated.

`opener_policy` is new AFTER-only evidence (null BEFORE); the difference lists
its materialization under **Other evidence**. IFAV/Page's independent future
route audience is not substituted for the explicitly reported Article audience.

### Owner list and exact approval

The offline command opens only the named files and writes three protected files
with permissions 0600. Keep the input reports and machine evidence with the
rehearsal backup: they contain principal IDs and configuration evidence.

```bash
# Rehearsal, after both exports (commands run from app/):
go run ./backend/tools/article_presentation_diff \
  --before before.json --after after.json --out proposed
# Review proposed.md and proposed.csv; owner approval names proposed.json's SHA256.
# Preserve that exact machine file as approved.json with the recorded approval.
```

Markdown and CSV contain one changed row per dataset/target/presentation, with
dataset name, target kind, group **name**, field counts, added/removed counts and
order/width/block/audience flags. **Other evidence** covers roles, row flags,
source provenance, IFAV paths, identities and opener policy. Unchanged surfaces
are omitted and counted. All readers become personal comparison surfaces,
including readers without a saved preference, so memberships and competing group
resolution remain covered. Personal rows sum only changed reader surfaces per
dataset/presentation and include a changed-target count; they contain no user IDs,
field names, row content or stored setting values. The CSV summary carries the
digest and unchanged count; configuration names are escaped for Markdown/CSV.

The machine list has deterministic dataset/target/presentation order and separate
before/after SHA256 hashes of each changed surface. Equal visible flags with a
different width, role, grant, or other evidence therefore cannot pass approval.
Field additions/removals match by UID (by name only when UID is null); the order
flag checks relative order of common fields, and width checks preserve null/zero.
IFAV's order/width flags also cover matched supplied-row/history projections;
its added/removed counts describe the configured projection. Blocks include all
stored/parsed evidence. Audience includes memberships and reader route results.
Group names used by targets or audience grants participate in comparison.

Every report field participates except these explicit bookkeeping exclusions:

- Format/contract versions and phase are validated, rather than listed as changes.
- `scope` and `limitations` are explanatory report text, not saved presentation.
- Source `assignment_id` and `field_set_id` are deliberately regenerated by
  materialization; source kind, priority, user and group identity are compared.
- Unreferenced group inventory entries have no presentation/audience counterpart.
  Reader IDs/memberships are compared through the personal surfaces. Duplicate
  explicit personal-target and reader projections must agree or input is invalid.

The digest covers compact JSON of the complete machine document with `sha256`
set to the empty string, including its normalized BEFORE digest, unchanged
count and ordered differences. Object keys and unordered inventories are
canonicalized; field order is preserved. The approved file's digest is verified
before checking. Unknown/missing fields, duplicate JSON keys/targets/fields,
unsupported versions and incomplete reader inventories are invalid input.

### Production operating steps

1. Rehearse on a copy: BEFORE, release binary first start (migrations 10–12),
   AFTER, then the offline owner list. Obtain approval of its digest.
2. Tuesday: export production BEFORE read-only and retain that exact file.
   The approved evidence must have been generated against this same BEFORE
   evidence; a different BEFORE is refused. Rehearse/approve again if needed.
3. Wednesday: upgrade production through the release binary's first start,
   then immediately export production AFTER read-only and run the gate offline:

```bash
go run ./backend/tools/article_presentation_after \
  --dsn-env FILTEREST_AFTER_DSN > production-after.json
# Use a built diff binary when the shell needs its exact exit status:
go build -o article-presentation-diff ./backend/tools/article_presentation_diff
./article-presentation-diff --before before.json --after production-after.json \
  --check approved.json
```

The diff binary exits **0** only for the exact approved difference set and
unchanged inventory; **1** reports unlisted and missing approved differences,
value-free, aggregating personal targets; **2** means invalid input/output,
including a corrupted approval or an approval for another BEFORE snapshot.
Treat every nonzero result as a failed operational gate. `go run` can wrap a
program's nonzero exit code, so use the built binary for exit-code automation.
The tool does not upgrade or roll back a database; the coordinator handles the
rollback on any gate failure.

The disposable `TestArticlePresentationUpgradePostgres` proof builds the legacy
fixture, exports BEFORE with a SELECT-only role, applies the real migrations
10–12, exports AFTER and verifies the expected differences, including the group
IFAV site-fallback change, repeat approval and phase refusal. No worker export
runs against production or another installation's database.


The Page get-results boundary independently requires its view right in the
catalogue's scope (global for this tableless route) plus the requested dataset's
get-results right, before projection or row reads. A dataset without a selected
Page bundle at runtime uses the existing metadata fallback in
`get_results_metadata.go` (after personal/group/site assignment resolution),
ordered by column metadata and intersected with readable columns. It does not
switch to another renderer or read dataset opener policy. See the
[backend row-read guide](../../backend/core_components/dynamic_table_tools/dtt_readme.md).
