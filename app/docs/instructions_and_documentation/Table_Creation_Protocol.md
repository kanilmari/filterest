# Table Creation Protocol

New datasets follow a versioned kind contract and intentional registration.
Historical datasets use explicit compatibility contracts; a missing historical
timestamp is not permission to invent one or bulk-convert a working table.
Unregistered physical helpers must be owned by a registered host/factory.

## 1. Naming Conventions

Every table must belong to one of the following categories and use the corresponding prefix:

*   **`system_`**: Core platform tables (metadata, configuration).
*   **`app_`**: Application-specific data (e.g., `app_service_catalog`).
*   **`dev_`**: Development and task tracking data (e.g., `dev_agent_tasks`, `dev_milestones`).

## 2. Required Schema Structure

Canonical new kinds use an automatically generated primary key and maintained
timestamps. Ordinary content and locations use the following base (an equivalent
integer identity key is also valid):

```sql
id SERIAL PRIMARY KEY
created TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
updated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
```

*   **`created`**: Timestamp of row creation. Never null.
*   **`updated`**: Timestamp of last modification. Never null. Must be updated via trigger.

Platform-managed tables store instants as `timestamptz`. WL167 migration
`20261009000080` interprets historical naive values with `AT TIME ZONE
'Europe/Helsinki'`, independent of the upgrade session's timezone. Its explicit
scope follows public source ownership, including restricted tables and managed
hosts' language embedding children. A `system_` prefix alone does not establish
ownership. Site-created datasets and showcases are the separate batch 3b.
PostgreSQL chooses the standard-time occurrence for an ambiguous autumn clock;
nonexistent spring clocks normalize forward. The migration preserves nulls and
already zoned columns. Ordinary dependent views retain owners, effective grants,
options, comments, column defaults, rules and triggers. Materialized views,
security labels, delegated grant chains, inheritance and other uncaptured
dependencies refuse the transaction; they must be reviewed before retrying.

Fresh-bootstrap prevention has two checks. The generator's
[`timestamp_schema_validator.py`](../../server_tools/public_bootstrap/timestamp_schema_validator.py)
is a fast early refusal for the static spellings it knows, including Unicode
escapes in quoted identifiers and types after SETOF or inside RETURNS TABLE.
It skips SQL bodies. The authoritative check for every spelling is
[`test_managed_timestamp_catalog_postgres.py`](../../testing/python/test_managed_timestamp_catalog_postgres.py),
run with `FILTEREST_TEST_DISPOSABLE_POSTGRES=1` under the shared PostgreSQL suite
lock. It loads a freshly generated bootstrap into a disposable cluster and
checks resolved catalog types in all application schemas: table, view,
materialized-view and composite columns; recursive domains and arrays; the
arguments and results of functions, procedures, aggregates and window functions,
including SETOF and TABLE outputs. Its only
exclusions name the 11 deferred site-owned columns explicitly. An injected-source
positive control proves detection beyond the static validator's parsing scope.

Listing and search JSON retain the existing row/column response shape. Zoned
values use UTC RFC3339 strings; the shared display and editor formatters use the
browser's local zone, so valid Helsinki wall clocks keep their displayed time.
DATE remains a calendar value. Updates to zoned fields require an explicit
RFC3339 offset; the editor supplies it. CSV keeps its existing headers and
RFC3339Nano cells and PostgreSQL honors their offsets on import. Older CSV
exports of naive timestamps may contain a synthetic `Z` from the driver's
wall-clock representation: a file alone cannot distinguish that from a real
instant. Such archives need their original column types to interpret them as
Helsinki clocks before restoration; do not silently reinterpret all `Z` values.

When an existing zoned value is edited within the same autumn overlap hour,
table and article editors retain its starting occurrence. With no starting
occurrence in that hour, ambiguous local input selects the earlier occurrence.
Nonexistent spring input normalizes forward by the gap: Helsinki
`2026-03-29 03:30` saves as `01:30 UTC` and immediately displays `04:30`.
Naive timestamp fields continue to keep the entered wall clock. Metadata type
repair suspends metadata triggers even when its own clocks are already zoned,
then restores their definitions, comments and original enabled states.

The authority is the embedded
[kind catalogue](../../backend/core_components/dataset_kinds/kind_contract_catalogue.json)
and its [validator](../../backend/core_components/dataset_kinds/kind_contract_validator.go).
Registration stores `table_kind`, `kind_version` and `kind_config` against the
stable dataset key (`table_uid`). Relationship configuration refers to another
dataset's key and real typed foreign-key columns, never a table-name convention.

| Kind | Canonical version 1 | Version 0 compatibility |
| --- | --- | --- |
| Ordinary | Generated integer identity, timestamps, protected creator/owner references for content | Unknown/custom shapes retain generic browsing; existing inline `embedding_vector` and flag-backed, structurally verified embedding children remain discoverable |
| Embeddings | Base identity/timestamps, typed `host_row_id` with cascade, required language, vector/hash, unique host/language, declared vector model/dimensions | Historical children may omit ID, creation time and uniqueness, use nullable host/language and a naive timestamp; new factory timestamps are zoned, and a real typed host FK is still required |
| Locations | Ordinary content base, nullable `postgis.geometry(Point,4326)` position, title/address | Point locations without timestamps and typed historical coordinate pairs; existing typed location children keep host Map support, even when empty |
| Chat messages | BIGINT identity/timestamps, conversation/sequence, participant and sender-name snapshot, text/question/answer payload fields, client request ID, reply/answer/supersession references and sequencing/idempotency uniqueness | None: names or chat-like columns never grant Chat |
| Chat settings | BIGINT identity/timestamps, title, message-dataset UID, mode, creator, archive/revision/configuration | None |

Slice 1 supplies the catalogue and structural resolver. The current general
creation route and embedding factory still use their existing compatibility
schemas. Fixed kind selection/creation is the next slice; declaring version 1
requires validating the complete contract rather than changing a label.
Question payload validation and same-conversation reference checks belong to
the chat writer, not schema inference.

The resolver reads schema evidence without reading records. It validates types,
nullability, generated keys, uniqueness, typed FKs, update maintenance, geometry
subtype/SRID and declared vector dimensions. Canonical hosts need explicit
relationships for semantic/Map support. Legacy discovery preserves working
shapes and does not change rights, default views or provider consent. Drift
disables the affected specialized capability; generic browsing remains available.

Authorized navigation, row/count, related, vector and intelligent-search responses
may carry `kind_capabilities`. Navigation requires the enabled ordinary row-read
grant before attaching them; hidden non-administrator count responses omit them.
An evidence-query or decoding failure logs the problem and preserves the previous
response without capabilities, including related responses. Capabilities describe
structural support, not permission, and do not replace the existing view registry
or enable a renderer.

Scoped evidence covers requested datasets, configured or incoming storage children,
and referenced key shapes needed by their contracts. Evidence snapshots and their
once-computed fingerprints share the row reader's schema metadata cache contract:
a five-minute TTL and explicit invalidation after committed application changes
through `InvalidateSchemaCache` or `dataset_kinds.InvalidateAll`. Rollbacks retain
warm evidence. External DDL appears within the same TTL as column metadata.
The evidence cache retains at most 256 dataset entries and 256 name aliases;
replacement and expiry retire previous aliases. Database queries and fingerprint
computation run outside the cache mutex. Cold callers share in-flight reads per
key and generation; related datasets share one deduplicated query for cold entries
per request. First-time name/UID discovery may wait for the opposite identity
form before retrying the lookup. Missing or expired aliases leave names unresolved;
their flights use the schema-qualified name, while UID flights use the UID.
Readers validate each discovered root against the requested UID or qualified name
before accepting evidence. A mismatch retries the correctly keyed lookup; shared
results are published only under their own discovered identity. Warm reads do not
repeat the catalogue query or fingerprint computation. Invalidation briefly clears
maps and advances the generation without waiting for in-flight queries. New requests cannot join old
generations, and old queries cannot publish into the current cache. Database
recovery stops the process; startup clears evidence after migrations and metadata
discovery before readiness.
HTTP writers register after-commit hooks. Transaction-only helpers cannot prove a
commit; their caller must clear evidence after its own successful commit. Missing
hook contexts never fall back to clearing caches inside an uncommitted transaction.

Chat is planned for conforming message datasets and authenticated administrators
in the first version. Settings datasets never receive the message Chat view.
Several conversations share one provisioned message dataset; conversation
membership is the privacy boundary, and administrator oversight must be a
separate visible action. Messages and attachments remain until separately
authorized deletion, with no automatic expiry or cascading history deletion.
Later ordinary users may start conversations in administrator-prepared message
datasets. Classification grants none of these rights; creation and API slices
must enforce them independently.

## 3. Automation & Triggers

Every canonical version-one table must have an enabled, unconditional, row-level
BEFORE UPDATE trigger that maintains `updated` on all updates. Version-zero
compatibility does not add missing historical columns or triggers. Application
writes use supported APIs; shared schema changes use versioned migrations.

### Naming Standard
*   **Function**: `set_<table_name>_updated_timestamp()`
*   **Trigger**: `update_<table_name>_timestamp`

### SQL Template
```sql
CREATE OR REPLACE FUNCTION set_my_table_updated_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_my_table_timestamp
BEFORE UPDATE ON my_table
FOR EACH ROW
EXECUTE FUNCTION set_my_table_updated_timestamp();
```

## 4. System Registration

A table is not considered "valid" until it is registered in the platform's metadata.

1.  **`system_table_folders`**: The table must belong to a logical folder.
2.  **`system_db_tables`**: The dataset must have a row linking it to a folder,
    with kind intent/version and validated relationship configuration. Existing
    rows default to ordinary/version 0 without rewriting historical structures.
3.  **`system_column_details`**: Column metadata is required by generic column-permission checks as well as UI rendering. Every physical column needs a row; intentionally protected columns retain their permission flags.

The runtime creation handler registers the single physical relation it just created,
including its OID and chosen folder, and refreshes only that dataset’s columns.
It keeps DDL, metadata, requested rights and grant reconciliation in the same
policy-locked transaction. Whole-catalogue discovery, orphan cleanup and column
refresh belong to startup or explicit maintenance; creation does not repair
unrelated datasets.

Fresh bootstrap and upgrades complete missing column rows for registered physical
relations through `20261009000082_complete_registered_column_metadata.sql`.
Existing metadata and permission flags are preserved, and the registry reference
key remains uneditable. Creation must not be used to initialize another dataset's
permission metadata. An automatic refresh's no-op proof requires a current
catalogue: a dangling legacy registry row is drift, and explicit maintenance can
still refuse when its changed scope reaches that row's old policy blocker.

The shared creation/editing form reads folders through the existing navigation
tree request (`GET /api/tree_data`), which never takes the policy lock. While
that request is pending it shows translated loading text and hides the choice;
a settled success exposes the folders. A refusal, malformed/empty answer or
ten-second request timeout leaves a disabled choice with translated failure
text. A cached tree cannot conceal a refusal. The shared form copy owns these
messages and follows the application’s language and theme.

### Runtime Safety Nets

Filterest now has two startup/runtime safety nets that reduce the risk of half-registered tables:

1. **Column metadata sync**
   - `UpdateColumnMetadata()` backfills missing `system_column_details` rows for registered tables.
   - New or backfilled rows get a default `card_element = 'details'` so card/admin UIs do not start from null metadata.
2. **Admin permission backfill**
   - `EnsureAdminTablePermissions()` grants the admin group any missing table-specific function permissions for all registered tables.
   - This means a newly registered table should not remain invisible to admins just because a migration forgot explicit permission rows.

These safety nets are a fallback, not a substitute for intentional metadata in migrations.
Migration authors should still set the right folder, display labels, FK display column, and any non-default card roles on purpose.

## 5. Creation Methods

### Method A: Dynamic Table Tools (Preferred)
Use the Filterest UI or the `dtt_3_table_create` Go component.
*   **Pros**: Automatically handles triggers, registration, and column metadata.
*   **When to use**: Runtime creation of app tables.
*   **Code Reference**: `filterest/app/backend/core_components/dynamic_table_tools/dtt_3_table_crud/dtt_3_table_create/create_table.go`
    *   `CreateTableInDatabase`: Handles table creation and trigger setup.
    *   `InsertNewTables`: Handles registration in `system_db_tables`.
*   **Folder**: The dataset form (`general_tables/dataset_form/`, one form for
    creating and editing) and `/api/create_dataset` put a new dataset in the
    current project's folder (`system_table_folders.is_current_project`) unless
    another folder, or a named new folder, is chosen. Without a current project
    the default is `database / other_tables`. The site navigation lists only the
    datasets directly in the current project's folder, so the create response
    reports `folder_path` and `in_site_navigation`, and a new folder with a
    parent but no name is refused.

New content datasets receive `created_by` and `owner_id` after every requested
ordinary column. Their SQL support functions run after general column metadata
synchronization, then register hidden, non-insertable, non-editable defaults
against the new dataset's `table_uid`. Explicit column-list roles and settings
are applied afterward. A reserved declaration accepts only INTEGER or BIGINT
without defaults, NOT NULL or sorting. Creator roles are hidden/details; owner
roles are hidden/username; an empty role keeps the hidden default. Only
`owner_id` may request the username role. An explicit actor foreign key must
reference `system_users(id)`; the support function supplies its SET NULL rule.

Side tables are classified by `app_row_actor_side_table_reason` and receive no
actor columns. A side-table request declaring a reserved actor name is refused
before creation. Managed asset-child creation remains separate. The shared
`InternalRegistryTables` list excludes internal registries from dataset
registration, consistency repair and dataset deletion.

### Method B: SQL Migrations (Manual)
Use this for core system tables or permanent dev tools.
*   **Requirement**: You must manually write the SQL for **ALL** steps above (Table, Trigger, Registration).
*   **Warning**: Failing to register the table will make it invisible to the frontend and AI agents.
*   **Important**: Even though startup now backfills baseline `system_column_details` and admin table permissions, migrations should still explicitly define any important UI metadata instead of relying on fallback defaults.

## Checklist for Manual Creation
- [ ] Table has `dev_`, `app_`, or `system_` prefix.
- [ ] Selected canonical kind/version and verified the whole contract (or documented an explicit existing compatibility shape).
- [ ] Canonical table has generated ID and `created`/`updated` (NOT NULL).
- [ ] Trigger function created (`set_...`).
- [ ] Trigger assigned (`update_...`).
- [ ] Inserted row into `system_db_tables`.
- [ ] Added or verified `system_column_details` rows for the table.
- [ ] Chosen intentional `card_element` values where `'details'` is not good enough.
- [ ] Verified admin group can see/use the table without manual permission repair.
- [ ] Verified specialized capabilities after creation, and unchanged saved defaults/rights on upgrades.
