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

### Existing Row Visibility Rules

There are two row-visibility mechanisms today:

1. `must_be_true_unless_own`
2. the `app_service_catalog` RLS pilot

`must_be_true_unless_own` lives in `system_column_details` and is applied by Dynamic Table Tools for non-admin reads. The generic update and delete handlers also use the same condition as a compatibility-era request-start row-eligibility gate. If a table marks one or more columns with this flag, normal read paths add a condition equivalent to:

```text
(flag_column = TRUE OR owner_column = current_user_id)
```

The owner column now prefers explicit table metadata in `system_db_tables.row_policy_owner_column`. When that metadata is empty or names a missing column, legacy compatibility resolution still uses priority: `created_by`, then `user_id`, then `id`. The resolver records a shadow comparison between the explicit owner interpretation and the legacy fallback interpretation so mismatches can be observed without changing the SQL predicate built for the current request. When multiple flagged columns exist, all of them must pass. This behavior is implemented as Go-side SQL fragments in result queries, row counts, filter options, intelligent/vector row hydration, and related-row reads. Generic update/delete requests evaluate the policy for the complete ID set before side effects. Updates lock the admitted row; deletes repeat the predicate in the DML and roll back their savepoint on an exact-count mismatch.

The `id` fallback is a legacy convenience, not a good long-term security contract. Future row policies should require an explicit owner column in metadata, because a row's primary key is not normally the same concept as a user owner.

The RLS pilot is intentionally narrow. It applies to `app_service_catalog` and routes selected row reads and writes through a request-scoped transaction that sets:

- `app.user_id`
- `app.user_role`
- `app.is_admin`

The pilot has PostgreSQL policies for select, insert, update, and delete. Its write preflight follows the narrower admin-or-owner UPDATE/DELETE eligibility rather than the broader public SELECT policy. Non-pilot datasets still use the Go-side `must_be_true_unless_own` path.

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
- explicit owner-column metadata via `system_db_tables.row_policy_owner_column`, with the current owner-column resolution as a compatibility fallback
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
