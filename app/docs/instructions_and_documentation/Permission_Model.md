<!--
Permission_Model.md
Defines Filterest's current and target authorization model.
Connects route, dataset, scope, row, field, SSO, and RLS concepts into one permission architecture.
Exists so future permission work extends one coherent model instead of adding table-specific exceptions.
-->
# Permission Model

This document describes how Filterest should reason about permissions as the platform grows from route and dataset rights into scoped, row-level, field-level, and SSO-backed authorization.

It is a design contract, not a claim that every layer already exists. Current implementation details are called out explicitly so future work can migrate deliberately instead of treating pilots as general infrastructure.

## 1. Current State

Filterest currently has a useful but incomplete permission model.

### Principals

The main principal is a `system_users` row. Group membership comes from `system_user_group_memberships`. Anonymous public browsing is represented by the guest user, conventionally `user_id=1`, when `login_to_browse=false`.

SSO, LDAP, OIDC, SAML, and AD are not yet a full identity-provider layer in the permission model. When implemented, they should map external identities and external groups into internal Filterest users and groups rather than creating a parallel authorization system.

### Account Names And Account Maintenance

Each credentialed account has a private **login name** in
`restricted.users_restricted.login_name` and a public **display name** in
`system_users.username`. Sign-in compares login names without case sensitivity;
password recovery accepts that name or the account's email. Public profiles,
account lists, search and new actor records use the display name. Permissions
and browser-test identity use the account id, so changing either name does not
create a new principal or transfer rights. Sessions carry ids and security
state, with neither a display name nor a login name.

Ordinary users choose both names during registration. The site setting
**Display name may equal login name** (`display_name_may_equal_login_name`) is
true by default, including on existing sites; First Run asks with yes selected.
An administrator can change it in Settings. When false, a name change or a new
account must leave the names different, ignoring case and edge spaces.
Existing equal pairs survive until a name actually changes: tightening the
setting does not rename users, prevent sign-in, or reject unrelated profile,
membership or flag edits. The setting's description records the date and the
count of ordinary accounts with equal names when its value changes. A user who
chooses equal names has also chosen to publish that value as their display name.

Administrators' names always differ, under either setting value. New
administrators normally receive the smallest available `admin_<n>` display
name; First Run lets the owner edit its suggestion. Promotion allocates a new
name when the existing names are equal. Automation administrators receive
`auto_<n>` and have fixed private names; see [Program Accounts](Program_Accounts.md).
New human login names cannot use `admin_<digits>`, `auto_<digits>` or the
reserved program/development identities. Each name has its own
case-insensitive uniqueness check.

Ordinary users maintain their own display name, email, website and biography
through the Account profile. Sensitive edits require their current password.
The profile's **Change login name** action also requires it, accepts at most
three attempts in five minutes, and leaves the current sign-in valid while
ending other sign-ins on their next request. **Sign out other devices** uses
the same password confirmation and session effect without changing a name.
The acting browser stays signed in even if a request it already had in flight
finishes afterwards and writes back its earlier session cookie. A copy of that
same sign-in is the same sign-in: to end it as well, sign out, which ends this
sign-in everywhere.
Fixed program/development login names cannot be changed through these actions.
Only a current administrator may edit the five account/rights datasets through
generic row tools, even if another group has been granted editor rights.
An administrator can change another account's login name through the dedicated
account API; all the target's sign-ins end. Administrators use their own profile
for their own login-name changes. The server's operator recovery tool can
replace a forgotten administrator login name without a browser sign-in; see
[SECURITY.md](../../../SECURITY.md).

The upgrade copies every existing credentialed account's old public username
unchanged into its login name. Existing administrators receive `admin_<n>`
display names in account-id order, or `auto_<n>` for API-only administrators,
skipping names already used as a display or login name. Matching full names
follow the rename, stale account search vectors are cleared, and renamed
administrators must sign in again with their unchanged login and password.
Invalid or ambiguous names stop the atomic migration before any partial change.
Ordinary accounts keep their display names and their existing sign-in names.

Owner-directed welcome, reset and name-change email may contain the private
name; forms may contain the value the owner typed, and protected operator
credential handoffs contain it. Account responses, new cookies and new log or
audit records do not return a separate private name. The upgrade preserves old,
already public names in history, discussions and existing search/embedding
copies; it does not promise to erase them. An old cookie may retain its holder's
former name until its first session save, which drops the retired fields.
The separate administrator sign-in address is future slice-4 work; the current
account-name separation uses the existing sign-in routes.

### Capability and Dataset Permissions

The core permission tables are:

- `system_functions` for registered backend routes, UI-only functions, and whether the function is dataset-specific.
- `system_group_table_func_rights` for granting a user group access to a function either table-independently or for one `target_table_uid`.

Backend enforcement currently runs mainly through `filterest/app/backend/pipeline/access_control/access_control.go`. Frontend visibility mirrors the backend through `filterest/app/frontend/core_components/route_permission_checker.js` and the `/api/user-permissions`, `/api/check-table-right`, `/api/check-table-rights`, and `/api/check-table-rights-multi` endpoints.

The read-only MCP relay also uses the same route/table permission helper before executing a tool call. Filterbar AI planned dataset reads use the same helper before each canonical delegate call, and the planner workspace catalog is permission-filtered when the request actor is known. This keeps AI/tool execution aligned with the existing capability and dataset-action rows instead of relying only on the inner HTTP handler pipeline.

This means the current model is closest to:

- table-independent function rights
- dataset-specific route/action rights
- UI affordance hiding based on those rights
- AI/tool execution checks that reuse the same route/table permission rows

### Runtime Database Grant Audit

The standalone runtime database grant audit is available with `(cd app && go run ./server_tools/runtime_grant_audit)`. Select the database and an independently provisioned audit identity with PostgreSQL's `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSFILE` and `PGSSLMODE` environment. Supply the four configured application role names through `DB_BASIC_USER`, `DB_GUEST_USER`, `DB_READONLY_USER` and `DB_CONFIDENTIAL_USER`; application passwords are not read. The audit identity needs permission-metadata reads and catalogue visibility, and must have no write, ownership, inherited-role or elevated capability. PUBLIC writes also make that identity writable and cause refusal. Each run uses one repeatable-read, read-only transaction and prints JSON metadata findings only. Exit 1 means the audit could not run; exit 2 means policy blockers were found; exit 0 means the comparison completed, including any reported grant differences. Metadata rows without the table identities required by the application's joins are skipped with one `preserved_outside_scope` finding per row, naming its registry or relation table and row key; no grant follows. Set identities missing from the snapshot become identified blockers. The audit keeps collecting other metadata, SQL-path and privilege findings in that run. The pure policy still refuses a snapshot with blockers; evaluating valid rows for comparison never applies grants. Each unclassified active table route produces its own blocker with the function row ID and route, including routes without rights. Diagnostic comparison omits only those routes and their rights and continues checking the reviewed routes. Classification/dependency failures, including individual unclassified sequences, retain unrelated effective/direct-ACL comparisons; only unknown objects' checks are omitted. Findings remain sorted and deduplicated. The dataset AI query requires its canonical read right separately and grants no reads by itself; canonical delegates supply label and embedding dependencies. Chat capabilities and administrator-backed conversation storage grant no dataset access. The administrator-only coding-agent probe adds a basic read only for the existing service-catalog pilot. Its declared rights may authorize an administrator through any group, but never add reads to the guest pool. Assistant approvals manage in-memory delegations and dispatch separate API requests as the asking administrator, without granting runtime dataset writes. Direct uploads select their configuration by source UID alone. A usable upload configuration on a registered source with NULL target UID also produces a blocker: omitting its filename update could under-grant that reachable path. The upload identity contract needs review before such a row can be considered entirely unused. Unconfigured main-row uploads need narrow filename UPDATE with the add right; configured caches need narrow SELECT on the validated predicate column. Reader failures include their reader name and database/scan error, with configured role identities anonymized. Content rows and configuration values are not output.

Personal administrator tool favorites use `/api/favorites` with the full admin profile.
The owner comes from the session, and the server resolves a granted route to a `system_functions` row; reads hide targets whose route is no longer granted.
`system_favorites` is a dedicated-API table, like visual preferences: it cannot receive generic row writes. Administrators can inspect the registered system dataset, including other administrators' rows.
The runtime grant policy classifies its SELECT/INSERT/DELETE as operational metadata access; the dedicated route adds no generic dataset grant. Future target types must supply their own server resolver and read-permission checks.
Each bootstrap binds personal shortcuts to the verified Account profile (`user_id`); GET/POST/DELETE return the session's `owner_user_id`. Results require that owner, connected elements and the current render generation; a mismatch hides the list/stars even with login sync off. Optional loading never blocks tabs or login-modal closing.

Its shared pure policy (`runtime_grants`) computes the basic pool's union over declared non-administrator groups, including empty groups, except the site's dedicated group named `guests`; that group's rights provision the guest pool independently of the creation form's users flag. Other ordinary groups still contribute to basic when anonymous account 1 also belongs to them; guest reads use the site's group named `guests` plus anonymous account 1's memberships, never a fixed group ID (the plan's bootstrap group-3 assumption is invalid on existing sites). Ordinary routes accept disabled false or NULL; dependencies with strict route checks require false. Reads are additive: excess content and embedding reads are `excess_read_reported`, and existing product operational reads are `preserved_outside_scope`. Reference labels require only the target key and display columns; actor marks imply no account-name disclosure. Writes follow individual actions and validated dependencies, subject to the account, dedicated-API, internal-registry, embedding, readonly and confidential boundaries. Unknown routes, tables, dependencies and unreviewed owner-run SQL paths produce blockers. Registered `system_about_assets` follows the same independent content rights as other registered asset children. Reviewed legacy lookup, compatibility, identity, cache-registry and log tables are product objects, never generic writers. Dormant assistant instructions, column-type notes, source inventory, log classes, row-view history and styles use the protected class and contribute no new basic or guest grants through obsolete rights; an active dependency on them blocks the policy instead of silently omitting a required grant. The readonly public-read contract and preservation of existing reads still apply. Active product/dedicated reference locks or gallery preview writes block; their administrator-only galleries are discovered without adding limited-pool writes. Additional schema USAGE follows required objects/dependencies, preserving the approved public/restricted contracts; empty/unused schemas add none. Shared-gallery mutations may preserve a picture with direct child INSERT/sequence and narrow supporting reads, including attachment siblings. Adoption executes no child callbacks or nested galleries; primary is read-only support and ordering UPDATE requires actual insert settlement. Physical automation inserts settle galleries but do not dispatch the destination's automations (`notification_triggers.go:449`); direct picture adoption does neither. The request dispatches its own source (`add_row_db.go:526`); automation metadata chains alone supply no transitive grants. The administrator foreign-key deletion route changes schema metadata and grants no content privileges. Exact reviewed invoker timestamp fingerprints are accepted for bodies that change their own row; unknown definer variants and cross-table writers remain blockers. The three legacy reviews described below are explicit exceptions with fixed identities and narrow side-effect contracts. Stale automation destinations remain blockers and must be corrected through the site's application. Reviewed read-only SECURITY DEFINER functions are accepted only when their identity and exact migration-body fingerprint match, their language is SQL, they are STABLE or IMMUTABLE, and their exact reviewed search-path configuration matches (`search_path=pg_catalog, public` for the row-access resolver). STABLE alone does not exclude writes through shadowed volatile callees. The audit remains read-only.

### Transactional runtime grant mutations (commit 2, parts A and B)

Rights POST replacement (including empty saves), PATCH and individual rights saves now share the request transaction with grant reconciliation. Dataset creation seeds application rights from its independent users/guests read flags and reconciles once after registration and configuration. The dedicated guests group never adds an unrequested basic-pool read; existing reads remain additive. Generic add, update, delete and CSV writes to policy metadata use the same boundary, retaining old targets before removal. Ordinary settings values are not policy inputs; relation/upload configuration is. The boundary takes the shared advisory transaction lock before row, reference or DDL locks, with a five-second local lock timeout and request cancellation. Multipart uploads are parsed before it. Fresh metadata derives the full basic/guest union, adding missing table, column, sequence and schema privileges, revoking managed excess writes and checking effective privileges before commit. Revoking table UPDATE is followed by a new comparison so required column UPDATE is restored. Reads are additive; outside-scope ACLs, owners, readonly/confidential roles, row-group contracts and actor marks are preserved. Directly unknown objects retain their ACLs and are reported. Objects protected only because they consume or follow an unknown object still receive every known privilege required by application rights; only revocations are skipped, including along old dependencies removed by the request. The request retains its required positive checks and verifies the effective grants after applying them. An excluded required check or a grant still missing at that postcheck refuses the request with 409, so an empty comparison cannot silently commit a rights, creation or asset-linking success. An HTTP mutation is refused with 409 whenever it introduces a blocker on a metadata row or catalogue object that was not blocked before the request, regardless of scope. Existing blockers refuse only requests whose datasets or old/new dependency closure contain them; role-identity safety failures remain structural refusals. Explicit dataset targets stay authoritative even when creation refreshes shared registry metadata. Row diagnostics attach to their dataset endpoints, not to every row in their storage registry; unrelated dangling rows and unclassified tables remain reported with their ACLs preserved, including a table incidentally registered by that refresh. Generic metadata changes without explicit dataset targets still derive their scope from old/new snapshots. Blocker changes compare the same stable metadata-row or catalogue identity as the HTTP gate, together with sorted, deduplicated resolved endpoints; diagnostic wording or endpoint order alone never widens request scope. Automation action-column diagnostics use sorted keys. Rights endpoints still do not accept HTTP DELETE. Privilege-view deletion refuses all four configured runtime identities with a reason key; other roles retain the existing deletion behaviour. Grant-changing operations opt into buffered status, headers and body before output. Success is released after commit; a failed commit returns an error, while ordinary reads, data operations and streams retain the forwarding recorder. Reconcile failure rolls back rights, DDL and ACLs together. CSV and live metadata import keep the existing scoped rule through `Mutation.KeepImportBlockerScope` in `importTableCSVTxWithContext`; transaction-only callers use `BeginTx`. Cold restore, start-up, install and default privileges use the boot transaction described below. Intermediate commits are not a deployable release.

Asset linking seeds the child's application rights once at first linking, including an existing plain relation. It no longer copies physical ACLs. An existing upload relation, repeated enable, another profile or a configuration edit keeps the child's independent stored rights. The request finishes configuration before reconciliation on every successful path. Image/attachment enable, update, disable and removal all use the same request transaction and completion boundary.

Automation creation, foreign-key add/delete, column changes and table deletion reconcile before request success. Table renames retain the stable dataset UID and physical OID; both tree renames and generic registry-name edits reconcile. The tree rename route now requires the administrator profile. Both rename paths update automation source and destination names and every stored upload-cache target name, including profile copies. Deletion removes automations touching the dataset and cache-target entries naming it in surviving relations before reconciliation, in the same transaction. Automation creation validates both registered physical endpoints before writing, with a clear 400 for a missing dataset. Installations without the optional legacy automation table skip that maintenance. Category-5 relation repairs delete only rows still referencing a missing registry table; valid or absent rows are logged as skipped and excluded from the fixed count. Consistency repairs reconcile the corrected snapshot while retaining old affected endpoints, so removing a dangling relation can repair its blocker; an unresolved blocker in the repaired scope still refuses the request. A failed item or reconciliation rolls back the complete repair request.

Ordinary and intelligent reads, including every streamed packet, check existing gallery-derived cached pictures regardless of `include_card_support`. Optional enrichment remains separate. Classification reads parent-bound gallery file references through the existing owning relation-metadata connection; these values never leave the server. It reuses K121's strict stored-file resolver in `dtt_card_picture`, retaining dataset and row coordinates while stripping supported query/fragment suffixes. Ownership is never inferred from a basename. The caller's canonical dataset read right, mandatory visibility flags and exact-row predicate decide the visible gallery set. A matching cache and its `cached_image_*` companions are removed when its gallery row is hidden or its gallery is denied; another picture is never substituted. External addresses, independently authorized media-library references, other-row files and other K121 kept values retain their existing authorization and remain unchanged when no own-gallery picture matches, including empty galleries. Pages without cached values skip classification. Gallery-content failures remove only proven gallery caches and never retry through the administrator connection. Parent-content and relation-metadata compatibility retries remain. Optional enrichment and the mandatory guard share discovered relation metadata and authorized image results, including failures, only within one response page or streamed packet; the guard also works independently. Refusals are seeded in Finnish and English by migration 20261005000075; existing authored values are preserved.

The legacy defining sources were reviewed in Easelect's private migrations (20260225 service locations and 20260301 username cache invalidation) and its db-9.7.13 schema snapshot, against the exact bodies already in `runtime_grants/testdata/legacy_trigger_bodies.sql`. No new private function body is shipped. Recognition requires the original public function identity, attachment, trigger return type, language and body fingerprint. A changed body refuses. Every reviewed invoker also requires no function-level search-path override and an owner that none of the four configured runtime roles (basic, guest, readonly or confidential) owns or can reach through role membership. Transitive membership counts even with NOINHERIT. A different trusted owner from the table owner is accepted; runtime ownership or membership is refused. This applies to reviewed own-row timestamp functions as well as legacy side-effect functions. Actual attachment events intersect the reviewed event set, and UPDATE OF attachments require a reachable write to a listed column, including auxiliary writes. Reachable location mutations add only parent `UPDATE(updated)` and `SELECT(id)` for `tg_location_touch_parent` (3dca2b659502c2291c1a908db58f9b38). The parent's own-row timestamp (bd0a0b3593213d52cad42ba53ae32e5c) remains reviewed; its reviewed search-vector helper (fd6c8fb19384174612fa2d2431b34683), if attached, adds only the location columns it reads and is followed recursively. `fn_sync_cached_username` (82e78c911a285ee6eb9d81ee00a96206) adds no limited-pool privilege because account writes remain denied. The privilege-view definer (9a87d4938809ea845f63e034ddffc75a) is accepted only on its protected public view, owned by that view's owner, with the original absence of a search-path override and no other attachment. Existing role-owner safety checks still apply; the view remains protected and this review adds no limited-pool privilege.

Request logging emits blockers and retained excess reads at INFO only for the request's scope and its combined old/new dependency closure, plus every blocker actually refusing the request (including a newly introduced blocker outside that closure). Complete catalogue findings remain available to audit callers and at DEBUG; unrelated findings are not repeated at INFO on every grant-changing request.

### Start-up, cold restore and default privileges (commit 3)

Before any migration, the actual pool identities must match configuration and pass the snapshot loader's safety checks. A dedicated administrator session then holds an exclusive lifecycle advisory lock (`filterest.runtime_startup_barrier`) through migrations, preserving metadata/foreign-key discovery, embedding helper creation, route/function synchronization, approved rights cleanup and administrator seeding. One `EnsureRuntimeRoleGrants` transaction follows, then confidential-dependent reserved-user maintenance. Workers and the HTTP listener start only after every required step succeeds. Required failures name their step and terminate start-up; unsafe-role refusals also name the configured identity so the operator can correct it. Audit findings retain anonymized role labels. Metadata discovery resolves restored OIDs by schema/name and preserves missing datasets and their rights; cleanup remains explicitly opt-in. Language-key and content maintenance remain optional after readiness.

Database consumers share one session lock per process through a separate two-slot lifecycle pool; administrator work connections remain available. Admission checks the database lock catalogue for an actual ungranted exclusive startup waiter, including other processes, with a 25ms polling interval while a cohort is active and a one-second server timeout per poll. Only that waiter seals admission; a cancelled writer reopens it. Without a waiting drain, a long database phase keeps admitting ordinary traffic. A sealed cohort drains before the next shared lock queues behind the writer, preserving writer fairness.

Work-pool SQL connectors acquire admission lazily for pooled reads (including legacy helpers without request contexts), prepared execution and transactions; they activate after required startup completes. Rows release on close and transactions on commit/rollback, before response/provider waits. HTTP middleware supplies lazy transaction admission and panic cleanup. Body reads, provider calls and network writes hold none unless an unfinished transaction still requires it. Administrator-notice snapshots/account checks and row/session stream checks reacquire per database phase. Retention prevents overlapping passes with a dedicated session lock, commits each policy independently and releases lifecycle admission between policies; failed unlocks discard that session. Embedding provider calls remain outside database phases. Lazy transactions use the request context for pool acquisition and lifetime. Infrastructure probes and static source have no eager request admission. The lifecycle lock precedes the policy lock (`filterest.runtime_role_write_revocations`); admitted contexts avoid reacquiring behind a writer. Admission waits at most five seconds, exclusive boot thirty. Cancelling a lock-catalogue poll never discards the session protecting other active consumers; failed final unlocks discard the physical session. External migration/import writers must stop **all** applications/workers sharing the database; arbitrary live SQL is unsupported.

Browsing metadata has explicit SELECT contracts for its consuming limited pools, independent of dataset rights; shared browsing uses basic/guest, while account favourites/preferences use basic. The inventory covers results/card/article column selection and layouts (`get_results_metadata.go`, `visible_columns.go`), descriptors/filters/search (`get_results.go`, `get_filter_options.go`, `build_joins_1m.go`), Home/navigation (`system_table_column_metadata.go` and the front-page facade), view variants (`view_field_set_resolution.go`), favourites (`favorites_store.go`) and row groups (`row_group_facet_fetcher.go`). The policy names registry/configuration, column/control/supported-view/preset metadata, table views/folders, child tabs, dataset view/media/sort settings, field sets/members/assignments, both relationship registries, languages/translations, permission functions/rights/groups/memberships, favourites/preferences, front-page blocks and row-group metadata. These added contracts supply reads only; existing dedicated write contracts stay independent. Comments, presentation media, sign-in state and privileged navigation queries that use the administrator/confidential pools do not justify additional limited-pool reads. Existing reads are retained until stage 2c.

Preserving discovery uses schema/name catalogue joins and filters relationships with NULL dataset names or NULL, empty or missing physical columns out of comparisons without deleting their rows. The final audit reports malformed source, target and bridge columns by metadata row identity.

Start-up applies the same known operation requirements as requests, for all four configured pools. Unrelated dangling metadata, unclassified objects and owner-run SQL findings are retained and reported; they do not prevent boot. Every known positive grant is applied and effectively checked, even on a dataset with a legacy blocker. Blocked objects and their consumers/downstream dependencies keep excess writes; unclassified objects remain untouched. A structural role or principal-registry failure stops before ACL writes. The single transaction also retains readonly public SELECT and confidential restricted CRUD/sequence access plus public identity-column reads. Reads on existing objects are never revoked. Start-up logs bounded counts only; use the read-only audit for the catalogue details. This is not permission to ignore legacy findings before rollout.

For every existing default-privilege creator, global and user-schema entries stop granting runtime writes, and basic/guest future table SELECT defaults are removed. Statement construction quotes creator, schema and role identifiers with the shared helper; PUBLIC remains a keyword and global entries omit the schema clause. Readonly SELECT and confidential restricted defaults remain. Owner-created future public tables receive readonly SELECT; required basic/guest grants are supplied when the application registers/configures a dataset. Safe classified PUBLIC write grants are removed, while uncertain ACLs remain findings. A default cleanup or effective grant postcheck failure rolls the complete ACL transaction back. Installation scripts no longer broadly grant basic/guest content access or confidential public writes.

`restore_instance` stops its application and imports the writer's portable plain or gzip SQL into an empty `template0` replacement with SQL errors fatal. Creation reproduces the original encoding, collation, ctype, locale provider/ICU options, collation version and tablespace. Before swapping names, it verifies the core catalogue and copies every matching function/procedure's owner and effective execution ACL, including PUBLIC revocations, grant options and grantors, by qualified routine identity. An unmatched SECURITY DEFINER routine refuses restore unless its exact body, identity and catalogue settings meet the runtime policy's shared reviewed-definer list. Security mismatches record `phase=function_security_failed`. Before the swap, database owner, connection limit, database ACL and every database-wide/per-role setting are copied and compared. PostgreSQL's current-value form preserves list settings such as `search_path = public, postgis`. Creation/configuration differences record `phase=database_settings_failed`. Backups still omit cluster-specific owners and ACLs; the original in this same cluster supplies them, and the administrator needs authority to reproduce them.

Only verified replacements are installed. A protected evidence file records database names and phases; the populated original remains under a recovery name with connections disabled, and neither database is dropped after failure. Remaining original sessions are terminated during the swap. Start-up then reconciles and `/health` must report `runtime_grants=reconciled` before success. Pre-swap import/verification/security/configuration failures leave the application stopped and the original unswapped; a swap failure preserves both databases for recovery, and readiness failure stops the application again. Recovery uses the retained names in `instances/<instance>/backups/restore_*.txt`: stop all consumers, rename the failed target aside, restore the original name and enable its connections, then restart/reconcile. This path requires an instance-owned database and administrator CREATEDB/ownership permissions; stop all other processes sharing it before restore. The embedded Docker restore still uses a cold database and checks health. Committed management bootstrap remains supported. Only development-seed clone/merge are gated as unverified, after profile dispatch and before seed access or mutation. CSV/live metadata imports keep commit 2's transaction, scoped blocker rule and buffered completion. Private recovery/deploy procedures must apply the same stop/import/start/reconcile sequence without coarse grants.

### Existing Row Visibility Rules

There are two row-visibility mechanisms today:

1. `must_be_true_unless_own`
2. the `app_service_catalog` RLS pilot

`must_be_true_unless_own` lives in `system_column_details` and is applied by Dynamic Table Tools for non-admin reads. The generic update and delete handlers also use the same condition as a compatibility-era request-start row-eligibility gate. If a table marks one or more columns with this flag, normal read paths add a condition equivalent to:

```text
(flag_column = TRUE OR owner_column = current_user_id)
```

The owner column must be proven, never inferred. It is the column named in `system_db_tables.row_policy_owner_column` when the system catalog (`pg_constraint`, not `information_schema`, which hides foreign keys from roles that do not own the table) shows it as a validated single-column foreign key to `system_users(id)`. Two owners are fixed in code instead: `system_users` owns itself through `id`, the only table allowed to, and the `app_service_catalog` pilot keeps `user_id`, which its database policies and write rule enforce although the column has no foreign key yet. Any other dataset has no own-row exception: its flags must be true for every non-admin, and the server log warns once per dataset and setting. The former `created_by`, then `user_id`, then `id` inference was removed because guessing `id` turned the rule into "flag OR row id = my user id". When multiple flagged columns exist, all of them must pass. This behavior is implemented as Go-side SQL fragments in result queries, row counts, filter options, intelligent/vector row hydration, and related-row reads. Generic update/delete requests evaluate the policy for the complete ID set before side effects. Updates lock the admitted row; deletes repeat the predicate in the DML and roll back their savepoint on an exact-count mismatch.

Results responses mark the proven owner column with `is_row_owner` in its column description. The article view uses that mark only to hide `hide_on_bg_crd_if_not_own` fields from anyone but the owner, and hides them when no column is marked. That is presentation, not a security boundary: the values are already in the response.

The RLS pilot is intentionally narrow. It applies to `app_service_catalog` and routes selected row reads and writes through a request-scoped transaction that sets:

- `app.user_id`
- `app.user_role`
- `app.is_admin`

The pilot has PostgreSQL policies for select, insert, update, and delete. Its write preflight follows the narrower admin-or-owner UPDATE/DELETE eligibility rather than the broader public SELECT policy. Non-pilot datasets still use the Go-side `must_be_true_unless_own` path.

### Row creators, owners and backup restore

New content datasets have permanent creator and owner marks in
`system_row_actor_columns`, keyed by `system_db_tables.table_uid` (never its
registry `id`). Ordinary inserts stamp both marked columns from the request's
user id; guest and system actors become NULL. Client-supplied actor values and
ordinary actor edits are refused, even for administrators or when column
metadata allows editing. The marked owner fixes the registry's compatibility
owner setting. Actor columns and their foreign keys cannot be removed, renamed
or retyped through the schema tools. Unmarked user references retain their
existing behavior; migration of existing datasets is a separate data step.

The administrator-only development CSV restore is an explicit exception to
new-row stamping: a newly restored row keeps its backup's creator and owner,
while conflict updates leave the existing row's actors unchanged. References
of 1 or less and references to missing users become NULL; the response counts
cleared creator and owner references. Omitted actor columns use the request
transaction's database defaults. Ordinary row editing is not an ownership
transfer mechanism.

During WL58 group A, generated actor-name labels are NULL for every viewer and
have no user-table join. Other user references keep their existing labels;
public display-name policy belongs to group B.

The operational read contract gives all four runtime pools SELECT on the public
actor-marks and repair-history tables, independent of dataset rights, so WL58's
runtime-role acceptance can read the marks and verify that history rows stay
hidden. Actor lookup functions read the marks; the actor checker inspects the
repair-history protections in the system catalog, and bootstrap acceptance reads
completion markers through the administrator connection. The existing owner-role
RLS policy hides repair-history rows from runtime pools. Neither table receives
runtime writes or sequence privileges, and this step revokes no existing reads.

### Category vocabulary and current counts

Category vocabulary comes from enabled values/headings attached to rows the current
reader may read in that dataset, before text, column or category narrowing. Both
selection resolution and vocabulary queries use the request's limited read querier,
including the RLS transaction. Privileged catalogue output cannot supply reader facets.
Unknown, disabled, foreign-dataset, orphan and denied-only values disappear alike;
mode-only headings also need readable vocabulary. Owner exceptions, exact-row denies
and the RLS policy stay in force. Zero-hit values are readable vocabulary whose
current count is zero, so displaying them discloses no denied-only classification.

Counts use distinct row IDs under current text/column narrowing and other selected
headings. ANY omits the candidate heading's selection; ALL requires its selected
values plus the candidate. The same required-heading predicate is applied before
listing/vector/intelligent ranking and again during intelligent hydration. ALL on a
readable single-valued heading is a typed 400 (`row_group_invalid_filters`); an ALL
preference without selections has no row-filter effect. First-page resolved selection
state is separate from the 200-value display cap, with selected values pinned.

## 2. Target Permission Layers

Filterest should use one vocabulary and one layered model for authorization. These layers are ordered from broadest to narrowest.

### 2.1 Capability Permissions

A capability permission grants access to a function, route, workflow, or UI area without binding the right to a dataset.

Examples:

- log in
- access an admin view
- use a translation workflow
- call a maintenance API

Current table-independent `system_group_table_func_rights` rows already cover much of this layer. Future work should keep the concept and name it clearly instead of describing it only as "tableless permission".

### 2.2 Dataset Action Permissions

A dataset action permission grants a group the right to perform an action against a dataset.

Examples:

- read tickets
- create risks
- update documentation articles
- delete service catalog rows
- export rows from a dataset

Filterest currently represents the action through `system_functions.url_route_endpoint` and the dataset through `target_table_uid`. That is workable, but the architecture should present the model as `dataset + action`, even if routes remain the implementation detail underneath.

### 2.3 Scope Permissions

A scope permission grants access to a specific authoritative subset of rows inside a dataset.

Examples:

- ticket queue
- documentation workspace
- organization
- tenant
- service category
- region

Scope permissions are the missing middle layer between dataset permissions and fully row-specific permissions. They should be used when many rows share a stable access boundary and each row belongs to one authoritative scope for that dimension.

Do not use ordinary fuzzy tags as permission scopes. Tags are often many-to-many, editorial, overlapping, or search-oriented. They are a poor default basis for access control unless the application explicitly defines one tag dimension as exclusive and security-relevant.

The target model should support per-dataset scope definitions such as:

```text
dataset: app_tickets
scope type: queue
scope column: queue_id
scope target dataset: app_ticket_queues
```

and group grants such as:

```text
group: Support Level 1
dataset: app_tickets
action: read
scope type: queue
scope id: first_line_queue
```

### 2.4 Row Policies

A row policy is a general rule that decides whether a principal can read, create, update, or delete a row.

Examples:

- owner can read and update their own draft rows
- a row is public when `published=true`
- a row is visible to groups listed in an `allowed_groups` relation
- a row is visible to users listed in an `allowed_users` relation
- a row is visible inside the user's organization
- a row inherits visibility from its queue/workspace/scope

Row policies must be generic. They should not be limited to `app_service_catalog`, and they should not be implemented as table-specific special cases scattered through read handlers.

The first target should be a metadata-driven policy engine that can produce a consistent read predicate for:

- normal dataset reads
- row counts
- filter option queries
- semantic/vector result hydration
- intelligent result fetches
- child-row fetches where the child inherits parent visibility

PostgreSQL RLS can then be added as a defense-in-depth execution backend for mature policy definitions, but the policy definition itself should live in Filterest metadata.

### 2.5 Field Permissions

A field permission limits which columns a principal can read or write.

Examples:

- everyone can see a ticket title, but only internal staff can see `internal_notes`
- owners can edit public profile fields, but not moderation flags
- support agents can change status, but not billing fields

Field permissions should be applied server-side before response serialization and before update/insert payload execution. Frontend hiding is useful, but it is not an authorization boundary.

### 2.6 Write Policies and Presets

Write policies constrain what values a principal may write.

Examples:

- a user may set status to `review_requested`, but not `approved`
- a queue member may move a ticket only into queues they can access
- a non-admin may update `description`, but not `admin_approved`

Presets are server-side values assigned during create or update.

Examples:

- `created_by=current_user`
- `user_id=current_user`
- `cached_username=current_user.username`
- `organization_id=current_user.organization_id`
- `queue_id=selected_scope_id`

Presets and write policies should be treated as part of authorization, not just UI defaults or form validation.

### 2.7 Context Policy Modifiers

Some constraints are not about the row itself.

Examples:

- IP or CIDR restriction for admin functions
- environment-specific dev bypasses
- public/guest browsing mode
- device/fingerprint checks
- maintenance mode

These should modify a permission decision without becoming the primary permission model. For example, an IP allowlist may further restrict admin access, but it should not replace group, dataset, scope, and row permissions.

## 3. Proposed Metadata Shape

This section uses descriptive names, not final schema promises. Exact table and column names should be finalized when implementation starts.

### Scope Definitions

A future `system_permission_scopes` table could describe which scope dimensions a dataset supports.

Useful fields:

- dataset/table UID
- scope key, such as `queue`, `workspace`, `organization`, or `service_category`
- local scope column, such as `queue_id`
- referenced scope dataset/table UID
- whether the scope is required for new rows
- whether each row may have only one scope value for this dimension
- optional display label and admin UI ordering

### Scope Grants

A future `system_group_scope_rights` table could grant group rights inside a scope.

Useful fields:

- user group
- dataset/table UID
- action/function
- scope key
- scope row ID
- optional valid-from/valid-to

This should extend, not replace, dataset permissions. A group should need the dataset action and the scope grant when a dataset declares that the action is scope-restricted.

### Row Policy Definitions

A future row policy registry could describe reusable predicates.

Useful policy primitives:

- explicit owner column equals current user
- public flag is true
- moderation flag is true
- organization column equals current user's organization
- scope column is in the user's allowed scopes
- explicit allowed users relation
- explicit allowed groups relation
- deny archived/deleted rows unless admin

The goal is not to invent a free-form scripting language first. A small catalog of typed primitives is safer, easier to audit, and easier to compile into SQL.

Each dataset policy should also declare a rollout mode:

- `legacy` — application code compiles and applies the predicate in Go-built SQL.
- `shadow` — application code still applies the legacy predicate, while the candidate RLS/policy backend is evaluated in tests or diagnostic paths for parity before cutover.
- `enforced` — the policy is enforced through the selected backend, such as PostgreSQL RLS, and legacy duplicated predicates are removed for that dataset.

### Field Rules

A future field-rule registry could attach read/write rules to `system_column_details` or a sibling table.

Useful fields:

- table UID
- column name
- action (`read`, `create`, `update`)
- required capability, dataset action, scope right, or row policy condition
- optional admin-only override

### Explicit Row Access Rules

Some products need an auditable exception for one exact row in addition to
typed owner, public, organization, and scope policies. A future
`system_row_access_rules` registry should use typed principal columns rather
than one ambiguous text field:

- dataset/table UID and integer row ID
- exactly one target: `user_id` or `group_id`
- normalized permission action, such as read, update, or delete
- effect: `allow` or `deny`
- optional validity window and required human-readable reason
- creator and normal timestamps

This is one reusable row-policy primitive, not the entire permission model.
Dataset action permission is still required. Any matching direct or inherited
deny wins over allows; an absent match denies access when the dataset declares
that explicit row access is required. A user-specific allow must not silently
override a deny inherited from one of the user's groups. Create normally stays
a dataset/scope action because the target row does not yet exist.

### Permission Actions

Create, read, update, and delete are a useful common action vocabulary, but
they are actions rather than the final groups shown in the administrator UI.
Their scopes are not identical:

- `create` belongs to a dataset, parent row, or scope because the new row does
  not have an ID yet;
- `read`, `update`, and `delete` can be granted or denied for an existing row;
- `export` should remain separate from read because bulk extraction has a
  different risk and audit profile;
- `manage_permissions` or `delegate` must be separate from ordinary update so
  editing a row never implicitly allows granting access to it;
- product workflows may add typed actions such as approve, publish, archive,
  transition, comment, or attach when those operations need distinct policy.

A future normalized action registry should provide stable action keys and
translatable labels while mapping current route-based permissions onto those
keys. Do not infer security semantics from HTTP methods or handler names.

### Bulk Row Access Administration

Table, card, article-card-list, and future views should publish selection into
one dataset-scoped row-selection service. Delete and row-access administration
are separate consumers of that service; neither may inspect or simulate the
other consumer's buttons. Selection controls are available when the actor has
at least one permitted bulk action, not only when the actor may delete rows.

The bulk row-access editor should receive immutable row IDs and show:

- the dataset and exact selected-row count;
- one target principal, either a user or a user group;
- applicable actions, normally read, update, and delete for existing rows;
- one explicit operation per action: no change, allow, deny, or remove the
  direct rule;
- a preview of the resulting changes before confirmation.

The backend must re-check that the caller may administer permissions for the
dataset and every selected row. It must validate the complete ID set before
writing, apply the batch in one transaction, require the affected count to
match, and produce an audit record. A mixed or stale selection fails closed;
the endpoint must not silently apply a partial subset. The browser should send
IDs, not trust its cached row objects as authorization evidence.

### Permission Categories

`system_user_groups` identifies who receives rights; it is not a taxonomy for
organizing the rights editor. Likewise, a backend package name is an
implementation detail, not a stable product category. A future
`system_permission_categories` registry should provide a stable category key,
translatable label and description keys, optional parent, display order, and
enabled state. The existing permission checkbox matrix can then render one
stacked table per category while retaining capability and dataset-action rows
inside each category.

Useful initial presentation categories are content operations, distribution,
workflow/governance, and administration. CRUD actions can appear within the
content category, but the category must not replace the stable action key used
by backend enforcement.

### View Presentation And Client Delivery

Column presentation, client data minimization, and field authorization are
separate decisions:

- a view field collection decides whether and where a column is rendered;
- `system_column_details.client_delivery_mode` decides whether an authorized
  field may enter ordinary client-facing projections (`include`) or must remain
  on the backend (`server_only`);
- field permission still decides whether the actor may read or write the value.

Effective group-aware presentation resolves in this order: personal assignment,
matching group assignment by explicit priority, site default, then metadata.
The site default means all current and future groups; it is not materialized as
one assignment row per currently known group. The read-only
`system_column_supported_views` dataset exposes the separate global capability
layer as one deterministic row for each registered column and view type. It is
derived from global column metadata and never stores personal, group, or site
field choices. Final presentation is the intersection of matrix support,
effective field collection, field permission, and client-delivery policy.

The conventional `id` field is a required transport key. It may be omitted from
renderer-visible columns but must remain available inside returned row objects
for navigation and row actions, and it may not be marked `server_only`.
Embeddings and search vectors should normally be `server_only`: backend search
may use them, while ordinary result rows, metadata, cards, exports, and field
selectors must not serialize them by accident.

## 4. Enforcement Contract

Permission enforcement must be server-owned. The frontend can hide buttons and reduce user confusion, but the backend must be authoritative.

Every data-returning path that can expose rows must use the same row-visibility decision. This includes:

- `/api/get-results`
- row count queries
- filter option queries
- article/card detail hydration
- semantic search hydration
- vector search hydration
- child-row and attachment reads
- export endpoints
- AI/tool endpoints that read rows on behalf of a user

Related-data endpoints must also bind every body-supplied parent dataset to the dataset already authorized by the route pipeline. Each discovered incoming or outgoing relation target needs its own dataset-action check before its name, metadata, count, or rows enter the response; parent access must not become a confused-deputy grant for child datasets.

Every data-mutating path must check:

- capability or dataset action permission
- scope permission when the row belongs to a scoped dataset
- row policy for updates/deletes
- field permission for each written column
- write policy for constrained values
- server presets before final persistence

The same permission engine should be callable from normal UI routes and AI/tool execution paths. Ticket #777 ("Permission Integration") is specifically about ensuring AI agents cannot see or execute tools beyond the user's normal permissions; it should consume this model once the core model exists.

### Handler Integration Matrix

Before a dataset moves from `legacy` to `shadow` or `enforced`, the permission engine must have known integration points for all row-exposing and row-mutating surfaces that apply to that dataset.

| Surface | Required permission-engine behavior |
|---|---|
| Normal result reads | Apply the same row predicate as every other read surface. |
| Row counts | Count only rows the actor can read; do not trust a client-supplied cached count as proof of visibility. |
| Filter options | Build option lists only from rows visible to the actor. |
| Article/card hydration | Re-check row visibility when opening one row directly. |
| Intelligent result fetches | Apply row policy when hydrating ranked IDs into row data. |
| Vector/semantic result hydration | Apply row policy after vector ranking and before returning rows. |
| Child rows and attachments | Apply the child dataset policy and any parent-inherited policy. |
| Exports | Export only rows and fields visible to the actor. |
| Generic creates | Apply dataset action permission, scope permission, field insertability, write policy, and presets. |
| Generic updates | Apply row eligibility, field updatability, write policy, and exact affected-row checks. |
| Generic deletes | Apply row eligibility and exact affected-row checks. |
| AI/tool execution | Offer and execute only tools the actor could use through normal UI/API permissions. |

## 5. How to Merge the Current Legacy and Pilot Paths

The current `must_be_true_unless_own` behavior should become a named row-policy primitive, not a permanent special column flag with custom query code.

Suggested policy primitive:

```text
all_flags_true_unless_owner(flags, owner_column)
```

That exactly captures the current behavior:

```text
(flag_a = TRUE OR owner_column = current_user_id)
AND (flag_b = TRUE OR owner_column = current_user_id)
```

The `app_service_catalog` RLS pilot should then be represented as a dataset row policy using the same primitives:

- owner is `user_id`
- public/moderation flags are `published`, `enabled`, `admin_reviewed`, and `admin_approved`
- admin bypass is allowed through the request actor
- owner write is allowed only for owner-safe fields

Once both mechanisms are expressed as metadata, the implementation can compile the same policy into:

- Go-side SQL predicates for immediate consistency across generic read paths
- optional PostgreSQL RLS policy SQL for defense-in-depth

That avoids the current split where one table uses DB-native RLS and every other dataset uses Go-side legacy fragments.

The app-specific PostgreSQL policy SQL should also stop repeating raw `current_setting('app.user_id', true)` parsing everywhere. A later migration can introduce stable SQL helper functions such as `app_current_user_id()` and `app_is_admin()` so generated or templated policies stay readable and consistent.

## 6. Implementation Slices

### Slice 1: Vocabulary and Inventory

Document the permission vocabulary and inventory current routes, dataset actions, legacy row flags, and RLS pilot behavior.

Output:

- [public permission glossary](Dictionary.md#permissions-and-authorization)
- this architecture document
- updated ticket #7 context for the legacy `must_be_true_unless_own` work

### Slice 2: Central Read Policy Compiler

Create one backend package that receives a request actor and dataset and returns the SQL predicate and arguments for row visibility.

Initial inputs:

- existing `must_be_true_unless_own` metadata
- explicit owner-column metadata via `system_db_tables.row_policy_owner_column`, accepted only as a validated foreign key to `system_users(id)`; there is no inferred fallback
- admin bypass
- guest principal

Initial consumers:

- normal result queries
- row counts
- intelligent row fetches
- vector/semantic hydration paths
- filter options

This slice should preserve current behavior before adding new concepts.

The current implementation has a first shadow/parity slice: `all_flags_true_unless_owner` carries the active owner column plus the legacy fallback owner column, and tests prove the shadow owner does not change the SQL predicate. Future work should add parity tests for every current read surface. Do not document vector/semantic paths as policy-complete until the code path has an explicit policy call or a test proving equivalent filtering.

### Slice 3: Scope Definitions and Scope Grants

Add metadata for scope dimensions and group grants.

Initial examples:

- ticket queue
- documentation workspace
- service category

The read policy compiler should learn the primitive:

```text
scope_column IN allowed_scopes(current_user, dataset, action, scope_key)
```

The admin UI can then add a scope-rights panel near existing dataset permissions.

### Slice 4: Row Policies Beyond Legacy Flags

Add typed row-policy primitives for owner, explicit user/group allowlists, organization/tenant boundaries, and public flags.

This is the point where the model becomes a general row-level authorization system for any dataset.

### Slice 5: Field Permissions, Write Policies, and Presets

Add field-level read/write checks and server-side presets.

This slice should cover both generic CRUD and special handlers that write dataset rows.

### Slice 6: Optional RLS Backend

Once the metadata model and read/write compiler are stable, add optional PostgreSQL RLS generation for datasets that are ready for DB-level enforcement.

Rules:

- Do not hand-write one-off table policies as the normal path.
- Generate or template RLS from the same metadata used by the application layer.
- Fail closed when request-scoped actor settings are required but unavailable.
- Route row-data queries through a policy-aware runtime pool so privileged admin or local-dev pools do not silently bypass RLS.
- Keep operator/read-only inspection requirements explicit.
- Model helper-table and sequence grants together with the main row policy so create/update paths do not fail after the main table policy succeeds.

Rollout should happen dataset by dataset:

1. `legacy`: current Go-side predicate is the source of truth.
2. `shadow`: generated/templated policy is compared against legacy behavior in tests and diagnostics.
3. `enforced`: RLS or another backend enforces row access, and duplicated Go-side predicates are removed for that dataset.

The optional global configuration should be named for the backend mechanism,
for example `postgresql_rls_backend_enabled`; it must never mean that row
authorization is disabled when false. Application-layer policies remain
mandatory. When enabled, only datasets already in `enforced` rollout mode may
depend on RLS, and readiness must fail closed if policies, actor context,
least-privilege runtime roles, helper-table privileges, or required sequences
are incomplete. PostgreSQL's own `ENABLE/DISABLE ROW LEVEL SECURITY` state is a
migration concern, not a request-time feature switch.

### Slice 7: SSO and External Group Mapping

Add identity provider support without creating a parallel authorization model.

Recommended flow:

1. Authenticate through OIDC/SAML for AD/Entra-style SSO where possible.
2. Use LDAP primarily when the deployment truly needs directory bind/sync instead of browser SSO.
3. Store external identities in an internal identity mapping table.
4. Map external groups to `system_user_groups`.
5. Evaluate all app permissions through the normal Filterest permission engine.

## 7. Ticket Mapping

Existing relevant tickets:

- `#7 Fix must_be_true_unless_own` is directly related to the legacy row-visibility primitive and should be updated whenever work moves from documentation into implementation.
- `#777 Req: Permission Integration` is related to AI/tool execution boundaries. It should consume the permission engine, but it is not the core permission-model implementation ticket.

If implementation begins, the work should probably become an epic or a small set of tickets rather than being squeezed entirely into ticket #7. Ticket #7 can remain the legacy compatibility/migration slice.

## 8. Known Risks and Non-Goals

- Do not treat PostgreSQL `ENABLE ROW LEVEL SECURITY` as sufficient by itself; privileged roles and table owners can still bypass policies unless the chosen role and `FORCE ROW LEVEL SECURITY` posture are deliberately designed.
- Do not let admin/superuser connection pools become accidental RLS bypasses for row-data routes.
- Do not rely on a client-supplied row count as an authorization fact.
- Do not use ordinary many-to-many tags as security scopes unless a product explicitly makes one tag dimension exclusive and security-relevant.
- Do not let child rows, attachment rows, helper tables, embedding rows, or sequence grants sit outside the policy design.
- Do not make SSO groups grant direct database power; map them into internal Filterest groups and evaluate normal permissions.
- Do not expose fields just because a row is visible; row visibility and field visibility are separate layers.
- Do not treat view hiding or `client_delivery_mode=server_only` as field authorization; presentation, data minimization, and authorization are independent layers.
- Do not let a false RLS-backend feature flag bypass application row policies.
- Do not make RLS policy SQL the only source of truth. The application needs the same decision model for UI affordances, API errors, AI/tool filtering, tests, and explanations.

## 9. Design Principles

- Server-side enforcement is mandatory; frontend hiding is advisory.
- Dataset permissions answer "may this actor use this action on this dataset?"
- Scope permissions answer "which partition of this dataset may this actor use?"
- Row policies answer "does this actor have access to this exact row?"
- Field permissions answer "which values may this actor see or modify?"
- Presets and write policies are authorization, not just form convenience.
- RLS is a backend enforcement tool, not the permission model itself.
- SSO supplies identity and groups; Filterest still owns authorization.
- Tags are not permission scopes unless the product explicitly makes them exclusive and security-relevant.
