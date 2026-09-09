<!-- Filterest_Project_Model.md -->
<!-- Defines native/custom project design and public ownership boundaries. -->
<!-- Connects the database project catalog, project files, runtime state and extensions. -->
<!-- Keeps future project proposals separate from implemented product behavior. -->

# Filterest Project Model

## Status and decision scope

Filterest is developed directly in its own Git repository. Its source and
runtime do not require a parent or sibling development repository.

This document combines the existing native project foundations with a target
architecture for custom projects, adapters, centralized site configuration, and
project lifecycle tools. Items marked **planned** or **missing** are design
work, not claims that those features ship today. The exact project-home schema,
engine grouping, project-name reference, and coordinated rename tool remain
plans; this document does not create their directories or change the database.

Reading or approving this design does not authorize moving existing databases,
media, credentials, project histories, or live deployment settings. Preserve
the existing database project catalog unless implementation evidence requires
a reviewed extension.

### Canonical one-folder product layout

```text
filterest/                    # repository and installation root
├── app/                      # maintained source and build inputs
│   ├── backend/
│   ├── frontend/
│   ├── server_tools/
│   ├── docs/
│   ├── testing/
│   └── docker/
├── filterest, ctl, ...       # thin stable commands
├── compose.yml               # root control contract
├── config/                   # operator configuration; no Git
├── keys/                     # protected credentials; no Git
├── projects/                 # installation-owned projects; no Git
├── data/                     # database/media/runtime state; no Git
└── backups/                  # recovery material; no Git
```

The `app/` boundary separates maintained implementation from operator state; it
does not prevent source edits in a development checkout. Make product changes
in this repository and keep its existing public history. New contributors can
clone GitHub normally. An established authoritative checkout must never be
regenerated or replaced from another repository, old folder, or release copy.

A deliberate whole-folder transfer can preserve a Gitless installation. Source
updates operate on tracked root contracts and `app/`; they preserve the five
operator directories. A folder copy without a current database backup does not
prove complete recovery.

## Executive definition

A **Filterest project** is an owned product-and-data boundary that Filterest can
browse and administer. It has a stable identity and lifecycle, but it does not
need a custom user interface or a domain name.

The target model distinguishes two project forms:

| Form | Data and files | How Filterest presents it |
| --- | --- | --- |
| **Custom project** | A custom application, its own database, and its own media/file storage. All three belong to this project form. | Filterest uses an explicit project data-source adapter and presents the project through the same catalog, table, record, permission, and media concepts as native data. The custom application can also run independently. |
| **Native project** | One dataset or a related set of datasets in the canonical Filterest database, plus project-owned files in the canonical Filterest storage. Custom source is optional. | Filterest reads the canonical database and storage directly. No remote data-source adapter or separate application process is required. |

“Native” describes ownership by the canonical Filterest data plane; it does not
mean that every dataset is a separate project. One native project can own one
dataset, a dataset tree, or a deliberately related set of datasets.

Both forms are first-class. Either form remains a project without a domain or
deployment. Only a native project can exist without custom source; a custom
project always owns custom application source, its own database, and its own
storage.

## One identity, two data shapes

Every project requires these durable properties:

| Property | Meaning and authority |
| --- | --- |
| Stable project identity | Assigned once and retained across renames, deployments, restores, and source-folder moves. A display name or folder slug must not be the only identity. |
| Display name | Human-facing name; may change without moving or recreating data. |
| Project slug | Normalized path and URL hint; unique within one project home, but not an authorization decision. |
| Project form | `native` or `custom`. Changing form is a migration, not a display setting. |
| Owner | The person or organization accountable for the data and lifecycle. This is not automatically the same as the infrastructure operator. |
| Lifecycle | At minimum `draft`, `active`, `suspended`, `archived`, or `decommissioned`. Decommissioning requires an explicit retention and deletion decision. |
| Optional domain binding | Zero or more host names and at most one primary host name. A domain is a deployment binding, not project identity. |
| Data and storage references | Native projects refer to canonical Filterest resources. Custom projects refer to protected connection and storage definitions without storing credentials in the catalog. |

The authoritative project catalog must remain singular. The current native
authority is a project-root row under the database `apps` folder in
`system_table_folders`; its descendant folders and
`system_db_tables.folder_id` assignments define native project contents. The
target catalog may extend that root metadata if a demonstrated capability needs
it, but it must not create a competing filesystem, domain, or deployment
registry. Do not assume a database change is needed merely to reorganize project
files. Any schema extension requires a reviewed migration design.

## External project source layout

Project-owned files live outside immutable application inputs and are not
tracked as Filterest product source. The public default project home
(`projects_home`) is the ignored root sibling `projects/`; an operator may
configure another safe location. A project may have its own Git history.

The collection needs to accommodate native sites, custom applications, and
reusable engines or templates. The exact subdirectory schema is **planned**:
it must make repeated engines visible without forcing unrelated projects into
one application. A native site can need a configuration directory even when it
has no custom source. A native dataset-only project need not invent files that
serve no purpose.

A proposed project descriptor should refer to the authoritative database
project and contain non-secret configuration or protected connection
references. Its filename, fields, validation, and rename behavior need a
reviewed contract; a proposed `PROJECT` name reference is not a second project
catalog. Directory presence must never activate routes, permissions,
background work, or deployments.

Renaming should coordinate the database display name and filesystem references
without changing stable ownership, silently recreating a project, or leaving
conflicting configurations. Preserve existing project paths until consumers,
backup/restore, and rollback behavior have been verified. Do not prescribe an
old maintainer collection layout as the public product's final schema.

## Ownership and lifecycle boundaries

These rules describe the intended project boundary; the gaps below identify
capabilities that still require implementation.

### Database

- A native project owns its project root and assigned datasets inside the one
  canonical Filterest database. Normal application updates migrate this
  long-lived database in place; they do not replace it with an older bundled
  database.
- A custom project owns a separate database or database service. Filterest
  receives a least-privilege connection through a data-source adapter. The
  canonical catalog stores only a protected connection reference.
- Cross-project joins are not implicit. A feature that combines projects must
  declare the participating projects, permission semantics, failure behavior,
  and backup consistency boundary.
- Direct database mutations outside application migrations remain forbidden.

### File and media storage

- A native project's files belong to project-scoped paths in canonical
  Filterest storage. Database metadata and file ownership must use the stable
  project identity, not merely a mutable slug.
- A custom project owns separate storage. Filterest accesses it only through a
  scoped storage adapter or a deliberately mounted project root.
- Active files, recoverable deleted files, backups, logs, and caches have
  different retention rules and must not be collapsed into one directory.
- Runtime storage is never product source and must not be tracked by Git.

### Domain and deployment

- A project can have no domain, one domain, or several domains. Domains route to
  a deployment; they do not create projects or grant data permissions.
- A native project can be served by the shared Filterest runtime or a dedicated
  deployment. A custom project can run independently while remaining browsable
  through Filterest.
- Environment-specific host names, server addresses, certificates, and rollout
  state belong to private operations storage, not the public product repository
  or project manifest.

### Permissions and privacy

- Filterest remains responsible for authentication and for evaluating the
  requested project, dataset, row, field, and action before presenting data.
- A custom project adapter must translate that decision into a least-privilege
  external query. A connection that can read an entire external database is not
  evidence that the current user may do so.
- Field-private content, search indexes, embeddings, previews, exports, logs,
  caches, and background jobs inherit the source field's access boundary.
- Project filesystem names, domains, and adapter names are never permission
  authorities.

### Bootstrap, migration, and extension

- Product bootstrap initializes only public Filterest system data and synthetic
  examples. It must not install a real project, restore a maintainer database,
  or copy protected media.
- Native schema changes use Filterest migrations. A custom project's migrations
  remain in that project's own source directory and run under its own release
  process.
- External source can declare a data-source adapter, a storage adapter, a
  standalone service, or a user-interface entry point. The public core must not
  import private projects through hard-coded Go package paths.
- Extension activation is explicit, versioned, auditable, and deny-by-default.
  Unknown capabilities, incompatible versions, or missing protected references
  fail closed.

### Backup, restore, and retirement

- A native project backup is a tested recovery set containing the canonical
  database state and the matching project-scoped file state.
- A custom project backup is owned by that project. Filterest can report or
  orchestrate it only through an explicit adapter contract; it must not imply a
  successful backup after copying only catalog metadata.
- Restore rehearsals use disposable destinations and verify database/file
  consistency, permissions, and project identity.
- Archiving is reversible retention. Decommissioning is a separately approved
  deletion workflow covering database, files, backups, domains, credentials,
  indexes, and deployments.

## Current implementation inventory

### Foundations already present

- The native project hierarchy lives in `system_table_folders` and
  `system_db_tables`; a filesystem directory does not create a second project
  registry.
- `app/filterest.paths.example` and the public Python, Go, Node, and shell
  readers resolve operator-owned storage independently of maintained source.
  Paths are validated against overlap, source roots, Git metadata, and unsafe
  path patterns.
- The backend application registry provides explicit startup, route, and
  permission registration. It does not provide a drop-in runtime plugin loader.
- Native views, permissions, media, and the public development tools are part
  of this repository. Their data belongs to the installation database/storage.
- Active files, recoverable-deleted files, backups, and runtime caches have
  separate purposes and retention boundaries.

### Missing before the target model is complete

| Gap | Consequence | Planned direction |
| --- | --- | --- |
| Stable cross-environment project identity and form metadata | Rename, restore, and deployment can create ambiguous ownership. | Reuse the singular project catalog; extend it only for a demonstrated gap. |
| Common project-home schema and project-name reference | Site configuration can be scattered or duplicated. | Define a versioned file schema, native/custom grouping, engine ownership, and coordinated rename behavior. |
| Project manifest and activation contract | External capabilities cannot be enabled through a uniform runtime contract. | Add a validated, non-secret descriptor and explicit activation process. |
| External database adapter | An arbitrary project-owned database is not yet browsable through the native catalog experience. | Define connection-provider, metadata, query, mutation, transaction, and health contracts with least privilege. |
| Project-scoped storage resolver | Storage remains primarily instance-scoped. | Define stable project subpaths and route file operations through them before moving files. |
| External permission translation | A custom connection alone does not preserve field/row restrictions. | Make authorization context mandatory and prove deny-by-default behavior. |
| Unified domain and deployment bindings | Host routing and project lifecycle settings are not one management surface. | Reference operator-owned deployment settings from the singular project identity without publishing secrets. |
| Project-owned bootstrap, automation, deployment and backup contracts | Existing tools are mainly product- or instance-oriented. | Define project hooks, evidence, recovery boundaries, and failure reporting. |

## Canonical development and installation data boundaries

“Canonical” means authoritative long-lived data, not a bundled seed or a source
file. Native application upgrades migrate the working database in place and
preserve its data. Mutable files stay outside `app/` and Git, normally in the
operator directories shown above.

If PostgreSQL is managed by the operating system or another database service,
its physical data directory remains with that service. The protected settings
hold the connection definition. Sharing a PostgreSQL service with another
application is a deployment choice, not a source dependency; removing that
service or its data requires a separate verified database migration.

The public path contract supports `projects_home`, `keys_home`,
`runtime_data_home`, `maintainer_tools_home`, and `operations_home`. Setup writes
its public path configuration to `config/filterest.paths`. Optional external
tool or operations homes do not become mandatory sibling repositories.
Credentials belong in protected settings or a secret provider, never source or
public project descriptors.

## Public source and release boundary

Each maintained component must have one source owner. Public product source and
generic development tools belong to this repository. Project-specific source,
installation configuration, private operational records, live data, and secrets
remain outside the tracked product tree. Public code must not import packages
or require files from another repository merely because it is nearby.

The public Go module, backend, frontend, lifecycle commands, Docker inputs,
documentation, tests, and version manifests live under `app/`. Root launchers
bind them to this installation and its own runtime dependencies. Legacy module
names do not change that filesystem or dependency boundary.

Ordinary commits and pushes preserve this public history. Publishing a versioned
release additionally binds an exact reviewed commit to compatibility records,
built files, checksums, licenses, and runtime evidence. Build output is derived
from this repository; the repository itself is never a generated output.
[Publishing Filterest](../publication/PUBLISHING.md) describes the current
separation between development and maintainer release automation.

## Planned implementation sequence

The following sequence covers unfinished project capabilities, not a request
to repeat completed source moves or run a migration now.

| Step | Planned deliverable | Verification |
| --- | --- | --- |
| Project inventory | Reconcile database identity, project files, deployment references, and any duplicates. | One authoritative owner per value; no state changes during inventory. |
| Project-home schema | Specify native/custom grouping, reusable engines, descriptors and rename rules. | Representative existing projects fit the schema without losing identity or operational settings. |
| Storage and configuration consumers | Route supported consumers through the reviewed project and path contracts. | No secret exposure, source-state overlap, or ambiguous fallback. |
| Project adapters | Define external database/storage access and permission translation. | Synthetic custom and native projects satisfy the same browsing/permission contract. |
| Explicit extension activation | Implement versioned capabilities and service boundaries where needed. | Unsupported capabilities fail closed; routes, jobs, webhooks and lifecycle behavior remain correct. |
| Verified adoption | Migrate one reviewed project boundary at a time. | Current backup, rollback, relevant runtime checks and restored identity precede retirement of old state. |

## Legacy technical identifiers

Filterest is the product name for new and actively revised product prose. Do
not perform a repository-wide text replacement: some “Easelect” strings are
historical evidence or compatibility interfaces whose unplanned rename would
break builds, upgrades, sessions, integrations, or audit continuity.

Use this order:

1. New architecture, user, contributor, and product documentation says
   **Filterest**. Mention an older name only when explaining an actual
   compatibility or migration requirement.
2. Update public UI copy, diagrams, examples, and non-historical comments with
   translation coverage and screenshot/documentation checks.
3. Rename source paths, commands, service names, and package/module identities
   only with compatibility aliases, impact analysis, fresh-install proof, and
   upgrade proof.
4. Rename database or persisted browser/session identifiers only through an
   explicit data migration and rollback plan. Historical release and audit
   records remain immutable.

Protect these technical identifier classes until their own migration is
approved and tested:

- the Go module/import prefix `easelect` and code package identifiers;
- application/version compatibility files such as `VERSION_EASELECT` and all
  append-only release identities;
- existing `EASELECT_*` environment variables, including the protected local
  key-root contract `EASELECT_KEY_ROOT`;
- database roles, schema/table/column/function identifiers, migrations, and
  compatibility manifest values containing the old name;
- API fields, cookies, local/session-storage keys, Docker resources, systemd
  units, executable names, and filesystem paths used by existing installs;
- Git tags, commit history, audit evidence, license notices, external URLs, and
  quotations that describe historical Easelect releases.

New public identifiers should use Filterest. Old identifiers may remain as
documented compatibility aliases for as long as supported upgrades need them.
The naming transition is complete only when a fresh install and an in-place
upgrade both work, not when a text search returns zero matches.

## Acceptance checklist for the complete model

- A project retains stable ownership through rename, deployment, backup, and
  restore, with or without a domain or custom frontend.
- Native and synthetic custom projects follow the same Filterest browsing,
  permissions, and media concepts while preserving their database/storage
  boundaries.
- Dataset, row, field, media, background-job, search, and embedding permissions
  fail closed across supported project forms.
- Project files, product source, runtime data, deployment configuration, and
  secrets each have an explicit, non-overlapping owner.
- Project-name changes have a defined coordinated workflow; folder names and
  domain strings never become independent authorization authorities.
- Bootstrap and upgrades do not replace a working database with an older seed
  or reconstruct persistent data that should be migrated.
- Recovery proves a consistent database/file point, permissions, and project
  identity in a disposable destination before live adoption.
- A normal new public checkout builds and runs using its own supported
  development dependencies, configured database, and operator settings.
- An established authoritative checkout retains local work and public history;
  testing and release tools cannot regenerate or replace it from another copy.
- A deliberate Gitless whole-folder transfer retains root commands, `app/`, and
  operator directories, with an explicit connection/recovery plan for any
  externally hosted database or storage.
- Distributed source contains no private histories, credentials, customer data,
  private deployment topology, or maintainer-only evidence.
