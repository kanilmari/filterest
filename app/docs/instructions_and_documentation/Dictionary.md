<!-- Dictionary.md -->
<!-- Defines shared English product, interface and compatibility vocabulary. -->
<!-- Connects public implementation identifiers with development and user-facing terms. -->
<!-- Exists so terminology has one public authority without a private repository. -->
# Filterest Dictionary

This is the shared English vocabulary for Filterest. Read the
[Developer Guide](DEV_GUIDE.md) for implementation rules and the
[Constitution](../constitution/constitution.md) for product principles.
Installation-specific and translated conversation aliases may link to these
definitions; they do not create another product dictionary. Existing Easelect
identifiers remain compatibility names unless a documented migration changes them.

## Technical terms

### Keys and Attributes
-   **EASELECT_RUNTIME_MODE** – Internal process setting that tells the protected administrator information box whether the running app uses a Docker image. Reviewed Docker images set the value to `docker`; a normal host process without the setting is shown as a native/ordinary run. The endpoint returns only the normalized values `docker` or `native`, never the raw environment value.
-   **data-lang-key** – HTML attribute marking UI text for translation; includes English fallback inside the element.
-   **data-dataset** – DOM attribute indicating the dataset (table) name shown to users.
-   **sco_number (sco)** – "Sort column order" value stored in `system_column_details` to control column order in sort menus.
-   **dataset** – In product, UI, and developer workflow language, a dataset is the full user-facing data surface: the base database table plus related, joined, derived, or display metadata shown with it. Use **table** only when referring to the physical PostgreSQL table or schema object itself.
-   **project** – A direct child of the database `apps` folder in `system_table_folders`; its descendants and the datasets placed through `system_db_tables.folder_id` form one database project. This hierarchy is the project-identity authority.
-   **current project** – The one project root marked with `system_table_folders.is_current_project`. It selects source/export context; it is not a filesystem app registry or domain binding.
-   **custom project source** – An optional normalized counterpart under the configured `projects_home/apps/<slug>/` collection that adds project-specific backend or frontend behavior. A private compiled checkout may expose it through a Git-ignored `filterest_private/apps/<slug>/` bridge. A database project does not require one, and directory presence alone does not register a project or route.
-   **portable project package** – An optional normalized counterpart below the configured `projects_home`. It gathers project-owned files and can later carry a portable database portion, but it is not a second project registry: `system_table_folders` remains authoritative.
-   **project runtime** – An optional domain/instance/cloud service and its nodes. Runtime topology is managed separately from project identity; the runtime database carries the selected project context.

### Tables
-   **system_column_details (SCD)** – Holds per-column configuration for datasets, such as card roles, visibility and localized field metadata. **SCD** is the shared technical abbreviation for this table.
-   **system_db_tables (SDT)** – Catalog of datasets and their physical tables, with table-level metadata such as `multi_lang_embeddings`. **SDT** is the shared technical abbreviation for this table.
-   **system_db_table_aliases** – Stores explicit public URL aliases for datasets. `app_` datasets may still expose a stripped alias automatically when available, but stripped `system_` aliases stay raw until an admin explicitly saves one here.
-   **system_functions** – Registers backend routes and indicates if they relate to a specific table.
-   **root_file_groups** – GUI-managed grouping taxonomy for repository-root entries. The `root_` prefix means this table describes the project root domain, not the database system layer.
-   **root_files** – Scanned project-root file/directory inventory with Git metadata, on-disk presence, manual grouping, and notes.
-   **row group** – A reusable multilingual classification attached to settings or content rows through `system_row_group_memberships`. It organizes data and does not grant access. This is distinct from a user group, which is an authorization principal.

### Permissions and Authorization
-   **permission principal** – The actor whose rights are evaluated. Today this is usually a `system_users` row plus its `system_user_group_memberships`; anonymous browsing uses the guest principal (`user_id=1`). Future SSO/LDAP/OIDC/SAML identity providers should map external users and groups into these internal principals instead of bypassing the Filterest permission model.
-   **capability permission** – A table-independent right to use a function, route, workflow, or UI area. In the current schema this is represented by a `system_group_table_func_rights` row whose `target_table_uid` is `NULL`.
-   **dataset action permission** – A dataset-specific right to perform an action such as read, create, update, delete, export, or administer. In the current implementation the action is still usually represented by a route in `system_functions`, and the dataset by `target_table_uid`.
-   **scope permission** – A right limited to a named subset of rows inside one dataset, such as a ticket queue, documentation workspace, organization, tenant, or service category. Use this only for explicit partition-like fields where each row belongs to one authoritative scope for that dimension. Do not treat fuzzy many-to-many tags as permission scopes unless the product explicitly makes a tag the authoritative access boundary.
-   **row policy** – A general row-level visibility or write rule that can be attached to any dataset. Examples include owner-only rows, explicit `allowed_users` or `allowed_groups`, organization boundaries, public flags with owner exception, or scope-derived access. The long-term goal is a metadata-driven policy engine for all datasets, not a one-table RLS special case.
-   **field permission** – A column-level read or write rule. Example: a user may read a risk title and status but not `internal_notes`, or may update a public description but not moderation fields.
-   **write policy** – A permission rule for allowed write values, not just allowed write targets. Example: a handler may allow a user to move a ticket to `review_requested` but not directly to `approved`.
-   **permission preset** – A value the server sets during create or update because of the current actor or scope. Examples: `created_by=current_user`, `user_id=current_user`, `organization_id=current_user.organization_id`, or `queue_id=the selected queue`.
-   **RLS** – PostgreSQL Row Level Security. Filterest currently uses it only as a narrow `app_service_catalog` pilot. Future row-level authorization should first be defined in the generic Filterest permission model, and RLS can then be used as a defense-in-depth backend for tables that have been migrated to the generic model.
-   **SSO group mapping** – The process of mapping external identity-provider groups from AD, LDAP, OIDC, SAML, or OAuth into internal Filterest user groups. External groups should grant permissions only through this mapping layer, so the rest of the application can keep using the same capability, dataset, scope, row, and field permission model.

### Filterest Lineage and Legacy Identifiers
-   **Naming boundary** – **Filterest** is the product, source, runtime, and public-repository name. `Easelect` remains only where an existing command, environment variable, package path, database value, release record, or historical document requires compatibility. New and actively revised product prose uses Filterest; technical identifiers are renamed only with an upgrade-safe alias or migration.
-   **Filterest canonical development database** – The long-lived database selected for development in the installation configuration. Hostnames, ports and connection details come from that configuration and the [Developer Guide](DEV_GUIDE.md), not this term. Normal application-version changes migrate this database in place; they do not restore an older seed, dump or bootstrap over it. Bootstrap packages initialize new/empty installations, while full dumps support backup, recovery and machine handover. An existing Easelect composition may retain the compatibility marker `instance_kind=easelect_source`; `overwrite_possible=false` protects an established database from replacement.
-   **workline** – A stable stream of work with a database identity `WL<n>`, lifecycle status, and exact current phase. A ticket describes a target; a workline carries continuing state. `CHAT-ONLY/<stable-topic>` is a temporary identity before persistence and follows the same reporting and ownership rules.
-   **ticket todo** (`dev_agent_task_todos`) – A structured checklist row on a database-backed development ticket. Agents must write `todo_text` as a technical title, a newline, and a short identifier phrase taken from the human’s own wording; the article checkbox UI shows that phrase as the muted second line. The mandatory writing rule lives in the [Developer Guide](DEV_GUIDE.md#agent-task-todos-identifier-phrases).
-   **workline report** – An immutable structured checkpoint for one stable development workline. It records Context, Plain language, Technical, a next step when the line remains open, phase/status snapshot data, and Git paths attributable only to that workline. Presentation and ownership rules belong to the operating workflow; they do not change these report fields.
-   **handover report** – The canonical chat-closing continuation report. It is an ordered manifest of the latest exact workline report versions for every workline in the chat and is rendered as one self-contained Markdown account for the next chat.
-   **canonical source** – The authoritative public Git repository containing maintained implementation in `app/`. Paths in this dictionary are relative to that repository root unless stated otherwise. Product changes are edited and committed there. In an Easelect composition only, the checkout can be the direct sibling `../filterest/`, reached through the `filterest -> ../filterest` compatibility link. That composition owns neither another public source copy nor its history. Private source history and operator state do not cross the public boundary.
-   **private composition source** (`filterest_private/` compatibility directory) – Remaining Easelect-shell extension, maintenance and operations source. Capabilities are assessed for transfer into Filterest or retirement, rather than assumed to remain a permanent parallel implementation. The private shell may compose Filterest, while Filterest may not require it. Secrets and runtime state are not tracked source.
-   **candidate source** (`filterest_candidates/` compatibility directory) – Optional incubation source for a capability intended for possible later movement into canonical Filterest. Every candidate must identify its intended public path and promotion or removal conditions. Neither Filterest nor the Easelect runtime may require the folder to exist.
-   **Filterest source mirror** – Historical term for the previously generated public copy. The current Filterest repository is the authoritative source, not a replaceable mirror. Old generated copies are release/recovery evidence and must not overwrite it.
-   **Filterest publication channel** – A named release maturity and its public repository and artifacts. The current public `kanilmari/filterest` repository continues with its existing history. Moving a local checkout creates no successor repository or new root history; `filterest-beta` remains read-only historical material.
-   **Runtime release channel** – The build stream shown by the running app: `development`, `stable`, or `unknown`. Version 1 deliberately has no nightly stream. The channel does not by itself prove publication or database compatibility.
-   **Release ledger** – The append-only, hash-chained `app/server_tools/versioning/release_ledger.v1.jsonl` history. It is the durable authority for each Filterest build's version, channel, artifact type, maturity, source commit, and database range; changing a root version marker cannot rewrite this history.
-   **Build identity** – The generated `BUILD_IDENTITY.json` bound to exactly one validated release-ledger row. A valid identity can classify a build as a development snapshot, stable candidate, or published stable runtime. Legacy root markers remain unverified fallbacks.
-   **Artifact purpose** – A narrow compatibility value. `developer_backup` is emitted only for a validated backup; `public_release` only for a validated stable/runtime/published build. Candidate or legacy marker state remains `unknown` instead of making a stronger publication claim.
-   **Stable update awareness** – The administrator-only, notification-only comparison between the running semantic version and the newest published non-draft, non-prerelease Filterest version. `available`, `current`, `ahead_of_stable`, and `unavailable` describe the comparison result; none authorizes automatic installation or replaces signed release evidence.
-   **Active publication target** – The existing public `kanilmari/filterest` repository, maintained from its authoritative checkout on `main`. Build and preview from that repository root; never regenerate the checkout itself. The old Easelect-composition export path `dist-public/filterest/` and `filterest-beta` are historical evidence, not alternative edit locations.
-   **Artifact traceability contract** – Evidence linking a built artifact to its exact public source commit, application and database versions, dependency inventory and tests. Preserve existing ledger/proof history; record new evidence for new artifacts without rebuilding a private-source mirror.
-   **Generated Filterest** – Historical description of the old export workflow. Filterest is now its own authoritative source repository. In Easelect-composition documentation, **Filterest-sibling** describes that repository located next to the private checkout; the layout never authorizes source or database replacement.
-   **bootstrap database** – A synthetic initialization dataset for a new empty installation. It is not an existing development or preview database, nor a backup of their data. Bootstrap changes belong to the authoritative product source; existing populated databases retain their state through migrations and authorized API operations.
-   **live database** – The real runtime database used by a domain. If users or integrations can write data there, it is no longer just a replaceable artifact; changes must preserve live data through migrations, API routes, or application administration flows. Recommended config: `instance_kind=filterest_domain`, `overwrite_possible=false`.
-   **domain instance** – A domain plus its deployed Filterest app, live database, and storage. Recommended config: `instance_kind=filterest_domain`, `overwrite_possible=false`.
-   **instance_kind** – Recommended `system_config` text value describing what role the current database belongs to. Use a small controlled set: `easelect_source`, `filterest_sibling`, or `filterest_domain`. This answers "what is this?", not "may this be overwritten?"
-   **easelect_instance_role** – Legacy-compatible `system_config` key describing which technical role this running Filterest instance serves. Use `application` for normal application/domain and native development instances; use `management` only for a dedicated management instance that owns cloud/instance-management surfaces. The persisted key keeps its old name until an upgrade-safe alias migration exists; the product is still presented as Filterest.
-   **overwrite_possible** – Recommended `system_config` boolean describing whether the current database may be regenerated or overwritten by upstream tooling. It answers "is destructive regeneration allowed?" and should be the value agents and tools check before overwrite/reset/bootstrap workflows. It is an operational guardrail, not a replacement for migrations, backups, or human review. Existing/live databases should default to `false`; only fresh generated Filterest bootstrap or preview databases should use `true`.

### Prefixes and Modules
-   **dtt_*** – Prefix for Go packages under `app/backend/core_components/dynamic_table_tools/` handling table-specific logic.
-   **root_*** – Prefix for repository-root inventory and grouping metadata. Use this when the subject is the filesystem root of the project; keep `system_` for database/platform internals such as `system_config`, `system_db_tables`, and `system_functions`.
-   **route_permission_checker.js** – Frontend helper at `app/frontend/core_components/route_permission_checker.js` exporting `applyPermission`, `hasRoutePermission`, `hasDatasetPermission`, and `clearPermissionCache` to manage UI visibility based on user rights. (The older `app/frontend/reusable_components/ui_permissions.js` has been removed.)
-   **WithLazyTransaction** – Middleware in `app/backend/core_components/middlewares/with_transaction.go` (alias `WithLazyTx` in `app/backend/pipeline/lazy_transaction/with_lazy_transaction.go`). Opens a transaction lazily on first `dbutils.RequireTx(ctx)` / `dbutils.GetTx(ctx)` call and commits on success. `WithTransaction` is kept as a deprecated alias that delegates to `WithLazyTransaction`.
-   **card_element** – Column in `system_column_details` defining how a value is rendered on card views (e.g., `header`, `image`, `description`).
-   **card_detail_icon_key** – Column in `system_column_details` storing a named frontend icon registry key for a card-detail field.
-   **card_detail_capitalization** – Column in `system_column_details`; when true, card detail values get a capitalized first visible letter in card detail renderers.
-   **card_style_variant** – Column in `system_db_tables` selecting the small-card visual variant, currently `standard` or `modern`.
-   **row_policy_owner_column** – Column in `system_db_tables` storing the explicit owner column for generic row policies such as `all_flags_true_unless_owner`; legacy `created_by -> user_id -> id` inference remains compatibility-only when this metadata is empty or invalid.

## Interface terms

### Menu bar
The navigation surface at the left of the viewport (`#navbar`). It may be
shown beside the dataset content or opened over it on narrow screens.

### Dataset content area
The primary working area inside `.tab_parts_container` containing the active
table, cards, article, tree or other dataset presentation. Menus and filter
controls share its viewport space according to the current responsive layout.

### Filter bar
The right-hand filter surface (`.filterbar-panel`). In code, `filterbar` is the
compact identifier; in English product prose, use **filter bar**. The shared
search panel can appear inside it, in the hero, or above the dataset content.

### Search panel
A shared search and overview surface. Instances reuse the same dataset query
state; they are not independent search systems. Current hosts include the
filter bar, `.dataset-shared-topbar` and the content hero.

### Article view
The full-detail row presentation. The ordinary article view and Image First
Article View are distinct presentation paths; neither is the result-card view.
Existing `big_card` names are internal compatibility identifiers. Prefer
**article view** in product prose, and use an exact identifier only when needed
to locate implementation. A terminology change alone does not rename code.

### Image First Article View
**IFAV** means Image First Article View. **IFA view** is a shorter name for the
same presentation, not a separate product object. Its image stage and article
content are distinct from the ordinary article view and from an image-only
preview. Planned history or animation changes are not implied by this name.

### Result card
The ordinary dataset result card. Existing `small_card` identifiers refer to
this same card, including its compact form in the article navigation rail.
The rail is not a separate mini-card data model. Existing visibility settings
apply to the card in both layouts unless a setting explicitly says otherwise.

## Interface components

### Disclosure
A titled content block that opens or closes while its heading remains available.
Use **disclosure** or **collapsible section** for the component; **accordion**
describes a group and does not imply that only one block may be open.
The shared implementation is `animated_disclosure`; article sections use
`buildRowArticleDisclosureSection`. Open/closed state is not field visibility,
permission or deletion. English prose does not require a new abbreviation.

### Multiselect
A control that selects several values from one available set. A **multiselect
dropdown** presents those choices in an opening menu; its parent disclosure only
controls whether the block is open. Current shared controls live under
`app/frontend/reusable_components/multiselect_dropdown/`. Use **multiselect** in
English prose without introducing another abbreviation.
