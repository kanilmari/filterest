<!-- Filterest_Project_Model.md -->
<!-- Defines Filterest projects, their two supported data shapes, and ownership boundaries. -->
<!-- Inventories the safe public-first transition from the private Easelect source tree. -->
<!-- Exists so project source, runtime data, secrets, and product code cannot drift together. -->

# Filterest Project Model

## Status and decision scope

This is the target architecture for projects in the public-first Filterest
product. It is normative for new design work and descriptive where it inventories
the current implementation. A requirement marked **missing** is not implemented
merely because it appears here.

This document does not authorize database, media, credential, or unrelated
Git-history moves. The owner-selected source-authority model A authorizes the
controlled product-source move described below: maintained public core moves
with Git history into the ordinary `easelect/filterest/app/` implementation
tree plus its thin public install-root controls, while the
public `filterest/filterest` repository receives the accepted subtree as an
exact root-level mirror with fresh public-safe Git history. The public mirror
preserves the `app/` level; it does not flatten application contents into its
root. The Easelect subtree is not a nested repository or submodule. Every move
batch still needs an explicit scope, verification, and rollback point; private
Easelect history must never be merged into the public mirror.

### Canonical one-folder product layout

The Easelect workspace has exactly three top-level source owners:

| Source owner | Durable responsibility |
| --- | --- |
| `filterest/` | One public Filterest repository and installation folder. Its immutable maintained implementation is under `app/`; its root provides thin commands and control/governance files. |
| `filterest_private/` | All permanent Easelect-only source, private composition, documentation, tests, publication, operations tooling, and instance management. It may depend on public Filterest; Filterest may not depend back on it. |
| `filterest_candidates/` | Independent incubation for code that may later move into Filterest. Neither Filterest nor Easelect runtime may require it. |

A standalone Filterest checkout and the public GitHub mirror use this same
shape:

```text
filterest/                    # repository and installation root
├── app/                      # immutable maintained source and build inputs
│   ├── backend/
│   ├── frontend/
│   ├── server_tools/
│   ├── docs/
│   ├── testing/
│   └── docker/
├── filterest, ctl, ...       # thin stable commands
├── compose.yml               # root control/governance contract
├── config/                   # generated operator configuration; no Git
├── keys/                     # protected credentials; no Git
├── projects/                 # installation-owned projects; no Git
├── data/                     # database/media/runtime state; no Git
└── backups/                  # recovery material; no Git
```

Copying the complete outer folder is therefore the supported Gitless transfer
shape: the immutable `app/` location stays stable, while the administrator can
keep configuration, credentials, projects, live data, and backups together in
one Filterest-owned directory. Updates and source-mirror checks operate only on
tracked root contracts and immutable `app/`; they must preserve mutable
siblings.

The native Easelect development runtime composes `filterest/app/` with
`filterest_private/`, but this source move deliberately leaves its established
outer storage, protected keys, and canonical development database in place.
Those live paths require a separate snapshot, rollback plan, and acceptance
before migration; nesting source must never silently replace them.

## Executive definition

A **Filterest project** is an owned product-and-data boundary that Filterest can
browse and administer. It has a stable identity and lifecycle, but it does not
need a custom user interface or a domain name.

Filterest supports two project forms:

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
target catalog may extend that root metadata so it can also represent custom
projects, but it must not create a competing filesystem, domain, or deployment
registry. The exact schema extension requires a migration design before
implementation.

## External project source layout

The source collection must live outside immutable Filterest `app/` and must not
be tracked as product source. A standalone installation defaults the
configurable project home (`projects_home`) to the Git-ignored root sibling
`filterest/projects/`; the collection may itself be a separate Git workspace
or may be redirected to a safe external location. The Easelect native
composition retains its established external `filterest-projects` home. Each
layout has one owned subdirectory for every custom project and every
source-bearing native project:

```text
projects/                             # projects_home; outside immutable app/
├── apps/
│   ├── regfetch/                     # one project-owned directory
│   │   ├── project.toml              # future non-secret identity/capability manifest
│   │   ├── backend/                  # optional custom service or adapter
│   │   ├── frontend/                 # optional custom user interface
│   │   ├── bootstrap/                # project-owned, repeatable initialization
│   │   ├── migrations/               # only for this custom project's database
│   │   ├── tests/
│   │   └── docs/
│   └── tukisuu/
├── templates/                        # audited starters, not active projects
└── README.md
```

The canonical source layout is now `<projects_home>/apps/<slug>`. On 17 August
2026, all six existing project directories were moved there only after the
resolver and import bridges supported the new layout. The old
`<projects_home>/<slug>` lookup remains a read-only compatibility fallback for
older installations; it is not the active local layout.

### Collection naming decision

Use **`projects`** as the child name inside a standalone Filterest installation
and **`filterest-projects`** for the Easelect native external collection; do not
introduce `easelect-apps`. Filterest is the final product name, so a new
Easelect name would make the intended public-first boundary look temporary
again. The broader “projects” name is also accurate: the collection owns
source-bearing custom and native projects plus reusable project templates,
while only active project packages belong in its `apps/` child. Calling the
entire collection an apps repository would blur that distinction and would
leave no clear home for templates or future project manifests.

This naming decision does not rename legacy compatibility identifiers. Existing
commands, environment variables, service names, database markers, and history
continue to use their migration-safe names until each has an upgrade-safe
replacement.

The future non-secret project manifest records identity, form, declared
capabilities, entry points, and compatibility. It must contain references to
protected connection material, never passwords, tokens, private keys, database
connection strings, or customer data. Directory presence alone must never
activate routes, permissions, background work, or deployments.

Native projects without custom source need no directory. If a native project
later gains custom source, its directory uses the same convention while its data
continues to belong to the canonical Filterest data plane. A custom project
cannot omit this directory because its custom application is part of the form's
definition.

## Ownership and lifecycle boundaries

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

- The canonical native project hierarchy already lives in
  `system_table_folders` and `system_db_tables`; the configured filesystem is
  not treated as a second project registry.
- `filterest.paths.example` and the shared Python, Go, Node, and shell path
  readers resolve separate project, protected-key, runtime-data, private
  maintainer-tool, and private operations homes. The readers reject overlap,
  checkout-root targets, Git-metadata targets, unsafe patterns, and inherited
  calculated defaults masquerading as operator choices.
- The project-source resolver prefers `<projects_home>/apps/<slug>` and keeps
  `<projects_home>/<slug>` as a read-only transition alias. The reconciliation
  report identifies canonical and legacy locations and reports target/legacy
  conflicts; the report itself does not move, copy, delete, or link anything.
- All six existing source-bearing projects now live under the external
  `<projects_home>/apps/` collection. RegFetch and Tukisuu appear at their
  historical private import locations through regenerated Git-ignored links
  that target the canonical collection.
- The backend application registry can register startup hooks, routes, and route
  permission profiles explicitly.
- Local and deployment tooling already distinguish active storage,
  recoverable-deleted storage, and backups in several runtime paths.
- The public-slice allowlist and audits are usable seed evidence for assigning a
  permanent owner to every public-first path.

### Missing before the two forms are complete

| Gap | Business consequence | Required implementation direction |
| --- | --- | --- |
| Stable cross-environment project identity and form metadata | Rename, restore, and deployment can otherwise create ambiguous ownership. | Extend the singular project catalog through a migration; do not add a second registry. |
| Project manifest and compatibility contract | External source is discovered today through conventions and private compile-time bridges. | Add a schema-validated, non-secret manifest and explicit activation process. |
| External database adapter | Filterest cannot yet browse an arbitrary project-owned database through the native catalog experience. | Add connection-provider, metadata, query, mutation, transaction, and health contracts with least-privilege tests. |
| Project-scoped storage resolver | A protected runtime-data home now exists, but storage is still primarily instance-scoped rather than uniformly project-scoped. | Add stable-project storage subpath resolution and route all file operations through it before moving files. |
| External permission translation | A custom database connection does not yet preserve Filterest field/row boundaries by contract. | Make authorization context mandatory in every adapter call and prove deny-by-default behavior. |
| First-class domain binding | Domain and deployment inventories exist, but they are not one canonical project lifecycle surface. | Add a catalog reference to private operations bindings without copying private host data into the public catalog. |
| Project-owned bootstrap/deploy/backup contracts | Current tooling is mainly product- or instance-oriented. | Add explicit project hooks, evidence formats, recovery boundaries, and failure reporting. |
| Public extension boundary | Private routes are still compiled through `filterest_private/apps/register/register.go`. | Replace hard-coded private imports with a versioned external boundary before removing the bridge. |
| Complete path ownership manifest | The export allowlist says what is copied, not the durable owner and confidentiality class of every source path. | Introduce an exhaustive public-first ownership manifest and fail on unclassified tracked paths. |

## Exact `apps/` relocation map

The relocation inventory started with 146 tracked files and several different
products under `apps/`. The site template (23 files), agent network (65 files),
instance control panel (45 files), cloud-management boundary README (one file),
and Agent Tools implementation (9 files) have now gained independent owners.
The two-file private project registry and its transition README subsequently
moved together into `filterest_private/apps/`, retiring the root `apps/` tree.

The extraction removed 143 formerly tracked paths under `apps/`. The remaining
three tracked transition files now live under `filterest_private/apps/`, and
the old root `apps/` source path is retired. Ignored compatibility links may
still appear locally beside the transition registry. The original
146-file inventory is accounted for as follows. This is the committed
source-ownership map; remaining compatibility links and the private extension
registry still have their own retirement gates.

| Current path | Current role | Target owner and location | Prerequisite before removal from the product tree |
| --- | --- | --- | --- |
| `apps/agent_network/` (65 tracked files before extraction) | Internal agent orchestration, prompts, benchmarks, and development experiments. | Extracted to private `filterest-maintainer-tools/agent_network/`; the ignored old path is a temporary relative compatibility link. | Completed locally: all 65 tracked and 587 total local files were preserved, the path resolver selects the external home, and both the canonical external module command and compatibility command load successfully in the project Python environment. Remove the link only after remaining active documentation and archived callers use the resolver. |
| `apps/agent_tools/` (9 tracked files before relocation) | Generic DB-backed task, run, todo, group, and agent-message HTTP implementation. | Relocated to public `app/backend/core_components/agent_tools/`; the implementation is present in Filterest core but dormant until `agent_tools.Register()` is called by an explicit activation owner. | Completed in source: the old package is deleted, default-off behavior and route/profile parity have a focused test, and the transition registry invokes the public activation function. A later site-admin capability toggle remains a separate product decision. |
| `apps/cloud_management/` (one tracked README before extraction) | Transitional operations namespace; active cloud code also exists elsewhere. | Extracted to private `filterest-operations/cloud_management/`; the ignored old path is a temporary relative compatibility link. | Completed locally for the document owner only. The active Go control-plane source is separately owned under `filterest_private/instances_and_cloud/` until its public/private API boundary is decided. |
| `apps/instance_control_panel/` (45 tracked files before extraction) | Standalone Flask operations control plane, service definitions, and operator tests. | Extracted to private `filterest-operations/instance_control_panel/`; the ignored old path is a temporary relative compatibility link. | Completed locally: all 45 tracked and 1,232 total local files were preserved; an explicit validated `FILTEREST_PRODUCT_ROOT` replaces path guessing; 139 standalone tests, shell syntax, and CSS lint pass from the external home. Existing `/opt/easelect/current/apps/...` service/deploy paths remain a documented compatibility layer pending an approved host-installation cutover. |
| `apps/register/` (2 tracked files) | Private compile-time registry for RegFetch, Tukisuu, operations routes, and the temporary Agent Tools activation call. | Transition-only; replaced by authenticated service discovery plus private manifests. It has no final sibling copy as a monolithic registry. | Project-specific startup hooks, routes, payment callback, request-size rule, audit filter, and operations routes need explicit service owners and parity tests. |
| `apps/site-template/` (23 tracked files before extraction) | Astro project starter/example, not Filterest core. | Extracted to `filterest-projects/templates/site/`; publication remains a separate content and dependency decision. | Completed locally: the external copy installed from its lockfile, reported zero npm vulnerabilities, built three static routes, and the old tracked/generated copy was removed. |
| `apps/regfetch` and `apps/tukisuu` | Git-ignored absolute links to external projects. | Target `<projects_home>/apps/regfetch/` and `<projects_home>/apps/tukisuu/`; no source copy in Filterest. | Completed locally: the resolver prefers the canonical collection, both bridges were regenerated, the legacy roots are absent, and path/reconciliation/bridge tests pass. |
| `filterest_private/apps/apps_readme.md` | Transitional boundary explanation. | Retire after this document and the external project/extension guides cover the final state. | Update remaining references and pass documentation-link checks. |

Ignored local environments, caches, logs, generated builds, and credentials
visible below these paths are not public source inputs. The agent-network
extraction preserved its ignored local files in the private maintainer home to
avoid accidental loss; they remain excluded from Filterest Git. Other ignored
state is recreated or moved only through its explicit runtime/secret procedure,
never added to a sibling repository by a recursive public-source copy.

### Remaining `apps/` registration dependencies — 20 August 2026

This is the current read-only dependency inventory after the external project
collection was normalized to `<projects_home>/apps/<slug>`. It covers the
transition checkout only; it does not authorize removing a bridge, changing an
external project, or retiring an operator service path.

The short result is that project source has moved, but private Filterest is
still assembled through a compile-time overlay. Four tracked transition files
remain: the runtime overlay (`filterest_private/cmd/easelect/private_apps.go` and
`filterest_private/apps/register/register.go`), its focused test, and the boundary README. Five
ignored links can also appear below `filterest_private/apps/`, but they have three different
owners and must not be retired as one unit.

#### Current dependency chain

```text
native/private build
  -> filterest_private/cmd/easelect/private_apps.go
  -> filterest_private/apps/register/register.go
     -> filterest_private/apps/regfetch and filterest_private/apps/tukisuu
        (generated links to projects_home)
     -> filterest/app/backend/core_components/agent_tools (public core, explicitly activated)
     -> filterest_private/instances_and_cloud/backend/cloud_management
        (private control plane)
  -> filterest/app/backend/core_components/app_registry
     -> startup hooks + HTTP routes
     -> route security profiles + request-size/audit/payment registrations
```

Directory presence is not activation. The blank import in `filterest_private/cmd/easelect/private_apps.go` is
the current activation decision; `filterest_private/apps/register/register.go` then registers one
Tukisuu startup hook, 24 direct private HTTP routes, their security profiles,
one upload-size exception, one audit-noise exception, one payment-callback
target, and the Agent Tools capability with its own startup hook and five
routes. Removing only the files or links would therefore remove behavior
without a startup error that explains the missing product capability.

| Surface | Current dependency | Target state | Retirement gate |
| --- | --- | --- | --- |
| Native Go build | The Easelect-only resolver wrapper runs `filterest_private/server_tools/lib/project_bridges.sh` on private wrapper startup. It creates `filterest_private/apps/regfetch` and `filterest_private/apps/tukisuu`, because the private registry imports their `easelect-private/filterest_private/apps/...` package paths. The canonical Filterest resolver has no private bridge reference. | The product build imports no project package. A schema-validated, versioned manifest activates an authenticated out-of-process service boundary; `projects_home` remains the source-location contract. | RegFetch and Tukisuu route, startup, payment, request-size, audit, and permission parity pass without either link. |
| Private Docker build | Compose supplies only the three required Go package directories from canonical `projects_home/apps/<slug>/` locations as named build contexts. This avoids transferring unrelated projects, caches, or credentials into the Docker build. | Remove the additional contexts entirely when project services no longer compile into the Filterest binary. | The service-boundary image build passes without project source in its build contexts. |
| Agent Tools | Public core stays disabled until the private registry calls `agent_tools.Register()`. | Activate through an explicit administrator/deployment capability owned by Filterest core, not through a private project registry. | Default-off, authorized-on, route-profile, startup, and public-build tests pass. |
| Cloud management | The private registry imports `filterest_private/instances_and_cloud/backend/cloud_management` and registers 13 routes as administrator-only. Stable method contracts also name those handlers in core. | Decide one owner: generic management-instance capability in public core, or a private operations extension. Real topology and host credentials always remain in `operations_home`. | Application/domain instances prove the controls absent; a management instance proves route/method/profile parity. |
| RegFetch and Tukisuu | Their Go handlers compile into the main binary through the two source links. Tukisuu also owns two exact public asset routes and a startup hook; RegFetch owns MCP routes and one audit exception. | Run project logic as project-owned services behind a narrow gateway. The manifest declares capabilities and route metadata, while protected endpoint credentials are referenced from the key home rather than embedded in the manifest. | Public webhooks preserve raw-body/signature, size-limit, retry, and idempotency behavior; authenticated routes preserve user and permission context; health failure is fail-closed. |
| Reconciliation report | `project_reconciliation_report.py` scans `filterest_private/apps/`, recognizes links, and parses the private registry imports/routes as transition evidence. | Read external project manifests and the singular database project catalog instead of treating a source link as activation evidence. | Canonical/legacy source conflicts are still reported, while no result depends on an in-checkout project link. |
| Public candidate generator | The private bridge library is structurally outside the canonical Filterest source and the generator no longer deletes it or rewrites the public resolver. The generator still removes private Docker copies/contexts and asserts that `apps/`, `filterest_private/cmd/easelect/private_apps.go`, and private route names are absent. | Shared source already has no private build dependency; the generator stops reconstructing the remaining boundaries with text rewrites. The deny checks remain useful until direct public-first development replaces the exporter. | Source-side ownership and fresh-clone builds pass before the remaining rewrite/removal branches are simplified. |
| `/apps/` HTTP path | Core keeps a fail-closed 404 handler. Private public assets must be registered as exact routes. The now-unused `localAppsDir` assignment still describes an old static-directory model. | Keep the fail-closed reserved namespace or replace it only with an equally narrow extension-asset gateway; remove the unused filesystem-directory variable separately. | Source/configuration paths remain unreachable, and exact asset-route tests pass. |
| Operations compatibility links | `filterest_private/apps/agent_network` and `filterest_private/apps/cloud_management` have no current product build import. `filterest_private/apps/instance_control_panel` remains a local fallback configuration path in the Go control plane; production packaging reads the source from `operations_home` but writes the release copy below `apps/`. | Active commands read the maintainer/operations homes directly. Panel configuration is explicit, and any release artifact uses an operations-owned path rather than the project-source namespace. | Host/service inventory proves no unit, deploy script, config fallback, or active documentation needs a compatibility link or release path. |

The temporary Docker contract has one confirmed inconsistency: its focused test
currently asserts the old root-level copy paths, so the test passes while
protecting a layout that no longer matches the normalized external collection.
This must be corrected before Docker success is used as evidence for the final
extension cutover.

#### Safe replacement and removal order

1. **Repair the temporary Docker input path.** Change both private Dockerfiles
   and their focused contract test to use `apps/regfetch/` and `apps/tukisuu/`
   within the named project context. Run both project-specific offline builds
   and the affected private Filterest image builds. This is a compatibility
   repair, not the final extension design.
2. **Freeze behavioral parity.** Convert every current registration into a
   machine-readable expected contract: route and method, security profile,
   startup owner, body limit, audit treatment, payment callback, public asset,
   health behavior, and failure mode. Keep the current registry active while
   these tests are added.
3. **Separate the three activation owners.** Give Agent Tools a Filterest-owned
   default-off capability; decide public-core versus private-operations
   ownership for cloud management; and give RegFetch/Tukisuu project-owned
   service entry points. Do not make one replacement monolithic registry.
4. **Introduce the versioned extension manifest and gateway.** Validate a
   non-secret manifest before startup, allow only supported capability types and
   route prefixes, obtain secrets through protected references, authenticate
   service traffic, propagate the user authorization context where required,
   and reject unknown versions or duplicate routes. A directory alone still
   does nothing.
5. **Prove one owner at a time.** Switch Agent Tools first because its source is
   already core; cloud management second after role gating; then RegFetch and
   Tukisuu through their service boundary. Prevent dual startup/background jobs
   and double payment/webhook processing during each comparison window.
6. **Remove the compile-time project imports.** Only after parity, remove the
   RegFetch/Tukisuu imports from `filterest_private/apps/register`; then remove
   `filterest_private/cmd/easelect/private_apps.go`, the transition registry/test, the two Go build links,
   `project_bridges.sh`, and its resolver call. Remove private Docker project
   contexts and update `.dockerignore`, reconciliation logic, focused tests, and
   root inventory in the same dependency-aware batch.
7. **Retire operations links separately.** Remove the instance-panel fallback
   paths and move its packaged release location before retiring that link.
   Remove the agent-network and cloud-management compatibility links only after
   a host-visible caller inventory confirms their external paths. These steps
   must not be bundled with project-service activation.
8. **Simplify transition tooling last.** Update the path-ownership manifest,
   retire `filterest_private/apps/apps_readme.md`, and simplify exporter rewrites only after the
   source tree itself proves the public/private boundary. Keep the public
   candidate deny checks through the final generated-versus-direct parity run.

The final verification set must include native and private Docker builds,
external project offline tests, focused route/profile/method/startup tests,
public fresh-clone build/runtime proof, source and candidate private-boundary
audits, management-role negative tests on ordinary domains, and a rollback
rehearsal that can restore the last compile-time assembly without changing live
project data.

### Relocation verification snapshot — 18 August 2026

The in-product 143-file extraction is completely traceable from the current
Git revision `5faaf0f97873fcd763e0c81d7617748f312a5b30`: every former
tracked file has a destination, and no source file is missing from that
destination. The agent-network copy preserves all 65 tracked files byte for
byte. Agent Tools preserves all 9 former implementation files byte for byte in
public core and adds two registration/contract files. The site template
preserves 21 files byte for byte and deliberately updates its two location
documents. The instance control panel preserves 37 files byte for byte and
updates eight files for its external product-root contract and Filterest
naming. The cloud-management README is present with its external operations
path updated.

The separate `filterest-projects` workspace completed a second, independent
move from revision `faadc1652e9fa7d59b7f3acdf9eadd955c4e825f` in commit
`771df561b0b713b9abba598da4e1a4fd9f184ba5`. All 283 files tracked at its six
former repository-root project paths now live under `apps/<slug>`: 212 are
byte-for-byte equal, 62 Git LFS objects match the hash recorded by their
pointer, and 9 documentation files contain reviewed path adjustments. The
per-project accounting in the committed tree is:

| Project | Tracked source paths | Byte-equal | Git LFS content-equal | Adjusted text/configuration | Missing |
| --- | ---: | ---: | ---: | ---: | ---: |
| `ai-chatbot` | 18 | 17 | 0 | 1 | 0 |
| `digikalustettu` | 74 | 42 | 30 | 2 | 0 |
| `dronekuva` | 80 | 48 | 32 | 0 | 0 |
| `regfetch` | 72 | 67 | 0 | 5 | 0 |
| `translator` | 19 | 18 | 0 | 1 | 0 |
| `tukisuu` | 20 | 20 | 0 | 0 | 0 |

That external move is durable in its own Git history: local `main` and
`origin/main` both point to `771df561`, the working tree is clean, no former
root-level project directory remains tracked, and `templates/site` contains its
23 intended tracked files. The 9 adjusted project documents change only example
or descriptive paths from `<projects_home>/<slug>` to
`<projects_home>/apps/<slug>`; a source-tree scan finds no remaining old
`filterest-projects/<slug>` project path. Project-specific builds and tests must
still be rerun whenever source changes after this reviewed rename commit.

## Canonical development and installation data boundaries

“Canonical” means authoritative long-lived data, not a bundled database file
or maintained application source. In a standalone Filterest installation,
mutable data is outside immutable `app/` and outside Git, but remains inside
the one transferable installation root by default:

```text
filterest/
├── app/                      # maintained source; replaceable as one immutable unit
├── config/                   # generated path and runtime configuration
├── keys/                     # credentials and connection definitions
├── projects/                 # installation-owned project material
├── data/                     # media, deleted media, logs, and runtime state
└── backups/                  # database and storage recovery material
```

The Easelect native producer runtime is an explicit compatibility exception.
It uses the same public `filterest/app/` source but retains the established
external development-data layout below until a separate live-data migration is
approved and verified:

```text
GitHub/
├── easelect/                           # producer checkout; public app is filterest/app/
├── filterest-projects/                # project source; its own Git workspace
├── filterest-operations/              # private deployments and topology
├── filterest-maintainer-tools/        # private development/agent tools
├── filterest_keys/                    # no Git: credentials and connection definitions
└── filterest-runtime-data/            # no Git: canonical native runtime data
    ├── storage/
    ├── storage_deleted/
    ├── backups/
    ├── logs/
    └── database/                      # only when Filterest owns the database data directory
```

If PostgreSQL is managed by the operating system or another database service,
its physical data directory remains with that service. The protected key home
holds the connection definition, and `filterest-runtime-data` holds only
Filterest-owned runtime files and backups. Database credentials never belong in
the runtime-data tree.

The path contract has `projects_home`, `keys_home`, `runtime_data_home`,
`maintainer_tools_home`, and `operations_home`. A standalone nested install
writes its public paths to `config/filterest.paths` and defaults projects,
keys, and runtime data to root siblings of `app/`; private maintainer and
operations homes are not public runtime dependencies. The Easelect native
composition continues to resolve its established sibling project,
protected-key, runtime-data, maintainer, and operations homes through its
compatibility locator. A future multi-environment host may add an
environment/instance level without changing the five-home contract.

The first maintainer-tool extraction is also complete locally:

- `agent_network` is physically owned by
  `filterest-maintainer-tools/agent_network/`, outside the product checkout.
- The old `apps/agent_network` path is an ignored relative compatibility link;
  it does not restore the tool to the public Git tree.
- The canonical command resolves `maintainer_tools_home` and imports the
  `agent_network` package from that home. The compatibility command continues
  to work while existing instructions and archived tools are migrated.
- The external home has its own boundary README. It is intentionally not yet a
  published repository; repository ownership and publication are separate
  human decisions.

The first operations extraction is complete locally as well:

- `instance_control_panel` is physically owned by
  `filterest-operations/instance_control_panel/`, outside the product checkout.
- The old `apps/instance_control_panel` path is an ignored relative
  compatibility link for existing local, deployment, and service paths.
- The panel no longer derives the managed product checkout from its own file
  location. It requires and validates the absolute `FILTEREST_PRODUCT_ROOT`
  pointer when external, while retaining only a guarded in-repository fallback.
- The external panel passes all 139 standalone tests from its new home. Its
  CSS is linted with the Filterest style policy during transition; Filterest's
  own CSS command no longer imports this private operations source.

The first physical runtime extraction is complete but still in its rollback
window:

- PostgreSQL already stores the canonical development database outside Git at
  the operating-system-managed `/var/lib/postgresql/16/main` data directory.
- The active and recoverable-deleted media trees were copied with ownership and
  checksums to `filterest-runtime-data/storage/` and
  `filterest-runtime-data/storage_deleted/` (773 files at cutover).
- The checkout's legacy `storage` paths are ignored relative symlinks to those
  external trees, so existing file routes keep their current path contract.
- The original in-checkout directories remain as explicitly named local
  rollback copies until the restarted native app proves media read, upload,
  delete, restore, and backup behavior.
- Empty external `backups/` and `logs/` owners exist, but legacy
  `data/db_backups` and log writers have not yet moved; they require explicit
  path consumers and their own verification.

The remaining order is:

1. Keep the completed `runtime_data_home` schema, resolver, overlap,
   Docker-context protection, and diagnostic checks as the non-moving gate.
2. Replace the local storage compatibility links with direct runtime-home
   resolution only after all file routes use the central resolver.
3. Route backup and log writers into their explicit external subpaths and prove
   recovery from a disposable destination.
4. Start the native development instance, verify schema compatibility, media
   reads/writes/deletes, backup, and restore rehearsal, then retire only the old
   runtime locations. Ordinary application upgrades continue migrating the
   same canonical database in place.

No database rows were changed during this file cutover. The rollback copies are
deleted only after runtime acceptance; until then the external tree is the
active copy and the named in-checkout directories are recovery evidence.

## Public-first path ownership

Every tracked path must have exactly one durable class. The nested public
layout changes path placement, not this ownership requirement:

| Class | Final home |
| --- | --- |
| `public_core` | Canonical tracked `easelect/filterest/` tree: immutable implementation in `app/` plus thin root commands and control/governance files, mirrored without flattening at public repository root. |
| `project_source` | Standalone default `filterest/projects/`, Git-ignored by the product and optionally its own Git workspace; Easelect native may retain its configured external project home. |
| `private_extension` | `easelect/filterest_private/` or a declared private extension repository: proprietary adapters and UI/business extensions. |
| `operations` | `easelect/filterest_private/` or an explicit private operations home: real instances, domains, servers, rollouts, and private recovery evidence. |
| `maintainer_tool` | `easelect/filterest_private/` or an explicit private maintainer home: agent orchestration, internal ticketing, benchmarks, and maintainer-only utilities. |
| `runtime_data` | Standalone non-Git `filterest/data/` and `filterest/backups/`; Easelect native retains its established external runtime locations until separately migrated. |
| `secret` | Standalone non-Git `filterest/keys/`, the Easelect protected key home, or an approved secret provider. |
| `transition_only` | Temporary exporter, import bridge, compatibility adapter, or parity test with a named retirement gate. |

The producer workspace's temporary public-export allowlist seeds the
`public_core` class, but absence from that allowlist does not establish the
correct private owner. Its exhaustive ownership manifest, deterministic audit,
move planner, and focused tests remain private maintainer tooling outside the
standalone Filterest source tree.

Each ownership rule also records a separate `public`, `private`, `runtime`, or
`secret` sensitivity. Public core must be public; runtime and secret sensitivity
can belong only to their matching non-public owner classes.

That smallest batch is accepted when every tracked path is covered by exactly
one rule, unknown/overlapping rules fail, symlink targets are read from Git and
checked lexically without following data outside the checkout, secret/runtime
classes cannot be public, and the current public allowlist cannot contradict
the ownership manifest. It classifies only; it does not copy, delete, publish,
or rename.

During the physical cutover, the producer workspace's read-only move planner
turned the accepted
`public_core` assignments into the single mapping
`<source> -> filterest/<source>`. It records the indexed Git object and mode for
every path, rejects destination and case-folding collisions, identifies the
required root-launcher bootstrap move, and emits a deterministic SHA-256 tree
fingerprint. `--require-clean` is the execution preflight: an uncommitted
working tree may be inspected, but it cannot be treated as an executable move
plan.

The historical execution plan partitioned the remaining mixed-root paths
into three non-overlapping groups:

| Group | Source ownership boundary |
| --- | --- |
| Public operational tooling | Remaining `cmd/**` and `server_tools/scripts/**` paths classified as `public_core` |
| Database evolution | Public `server_tools/migrations/**` history and its migration-focused contracts |
| Product verification | Remaining public `testing/python/**` contracts |

These groups classified the full remainder, but did not force a whole group to
move at once. Before each physical move, the cutover rule was to select the
smallest sub-prefix whose runtime, build, documentation, and test references
could all resolve from the canonical subtree or an explicit outer
compatibility adapter, then lock its exact
indexed contents with repeatable `--source-prefix` arguments and
`--expect-batch-sha256`, then move, verify, commit, and push that batch before
planning the next one. A smaller file count never overrides dependency closure.

### Canonical subtree and public mirror contract

The only maintained shared-source location is the outer Easelect repository's
ordinary `filterest/` directory. Publication reads that directory from one
accepted Easelect commit and materializes it at the public repository root. It
does not read uncommitted developer state, and developers do not maintain a
second source copy in the public checkout. Materialization preserves the
tracked root controls and the immutable `app/` directory at their exact paths.

For the same accepted release identity, a verified local materialization of
`easelect/filterest/` and a checkout downloaded from the public Filterest
repository must have the same relative paths, regular-file bytes, executable
bits, and reviewed symlink targets. A matching version label alone is not
proof. The mirror gate records both Git commits and fails if either tree has a
missing, extra, or changed release-owned path.

Mutable configuration, credentials, databases, media, logs, caches,
`app/node_modules/`, and build scratch space are excluded from Git and source
mirror equality. In a standalone install, the operator-owned
`config/`, `keys/`, `projects/`, `data/`, and `backups/` directories remain
siblings of `app/` under the one `filterest/` root. Publication and update
operations must preserve those siblings. This makes a complete Gitless copy of
an installed folder operationally portable without treating its mutable files
as public release source.

The public Go module, backend, frontend, public lifecycle implementation,
Docker source, documentation, tests, and version/package manifests live in
`filterest/app/`. Thin commands at `filterest/` establish the installation root
and delegate inward. The outer `go.work` workspace composes private Easelect
code around `filterest/app/backend/core_components/application_runtime.Run`;
the public executable uses the same runtime without importing private packages.

The standalone root `./filterest` and `./ctl` commands execute against their
own installation root and immutable `app/`. The outer Easelect `./ctl` composes
the same app with the private resolver and retains the existing native storage
and protected environment. Public Filterest therefore has no runtime reference
to `filterest_private/`; Easelect has no runtime reference to
`filterest_candidates/`.

## Phased implementation

| Phase | Deliverable | Exit gate |
| --- | --- | --- |
| **0. Definition and naming** | This project contract, current-gap inventory, and controlled product-name policy. | The two forms and all ownership boundaries are reviewable without moving data. |
| **1. Path ownership** | Exhaustive tracked-path manifest and local audit. | No unclassified or multiply classified tracked path; public allowlist agrees with it. |
| **2. External-home contracts** | Runtime-data and target-project path resolution plus read-only reconciliation are implemented; all six existing project sources were moved to `<projects_home>/apps/<slug>`. Project manifest schema and stable runtime subpaths remain. | Canonical paths resolve first, legacy roots remain supported as read-only compatibility aliases, and validation refuses overlaps, checkout roots, Git metadata, and secrets. |
| **3. Extract independent tools** | Site template, agent network, and instance control panel are extracted; remaining compatibility links and host service paths are retired only through their dedicated cutovers. | Each builds/tests from its own home; Filterest has no public runtime or test dependency on its old path. |
| **4. Project adapters** | Stable identity/form metadata, external database and storage adapters, and authorization translation. | A synthetic custom project and a native project pass the same browse/permission/media contract without shared credentials. |
| **5. Extension cutover** | Versioned activation replaces `filterest_private/apps/register/register.go`; remaining private modules leave the product tree. | Route/startup/profile parity passes and a clean public build imports no private project or maintainer package. |
| **6. Canonical subtree and public mirror** | Move audited `public_core` paths with Git history into immutable `easelect/filterest/app/` plus thin install-root controls, then create the public repository's clean root-plus-`app/` mirror commit. Develop shared product source only there. | The tracked subtree and public root pass exact-tree equality without flattening; a fresh public clone and a Gitless whole-folder copy build, start, upgrade, preserve mutable siblings, pass public/security/license/privacy gates, and contain no private Easelect history. |
| **7. Exporter retirement** | Replace the allowlist-based generator with the deterministic subtree-to-root mirror after a defined comparison period. | The canonical subtree and the last generated candidate have explained parity; releases and development builds no longer reconstruct public core from mixed-owner paths. |

The legacy generated Filterest repository remains a transition candidate until
Phase 6. It must not be merged wholesale into the new public-first history. Its
last accepted candidate can be retained as immutable release evidence; local
unpublished candidate commits are either regenerated from the final audited
subtree or discarded after their contents are reconciled there. A
`legacy_maintainer_export` identity must never become the identity of a direct
public-first build.

## Controlled Easelect-to-Filterest naming transition

Filterest is the product name for new and actively revised product prose. Do
not perform a repository-wide text replacement: some “Easelect” strings are
historical evidence or compatibility interfaces whose unplanned rename would
break builds, upgrades, sessions, integrations, or audit continuity.

Use this order:

1. New architecture, user, contributor, and product documentation says
   **Filterest**, with “formerly Easelect” only where migration context requires
   it. Update the Dictionary's current naming boundary in a coordinated batch.
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

- A project can be created without a domain or custom source and retains one
  stable identity through rename, deployment, backup, and restore.
- One native project and one synthetic custom project are browsable through the
  same Filterest concepts while keeping databases and storage separate.
- Project, dataset, row, field, media, background-job, search, and embedding
  permissions fail closed across both forms.
- Project source, product source, runtime data, operations, maintainer tools,
  and secrets each have one explicit owner and non-overlapping home.
- Bootstrap and upgrade never restore an older canonical database or use AI to
  reconstruct persistent product data that should have been migrated once.
- Backups prove a consistent database/file recovery point and restores use a
  disposable destination before production adoption.
- The public Filterest fresh clone builds and runs without the private Easelect
  checkout, private project source, private keys, or the public-slice exporter.
- A whole-folder Gitless copy retains thin root commands, immutable `app/`, and
  the operator's `config/`, `keys/`, `projects/`, `data/`, and `backups/`
  siblings without requiring paths outside the copied Filterest folder.
- Easelect native development builds from the nested public app while retaining
  its pre-existing canonical database and storage until a separate migration is
  explicitly accepted.
- Automated dependency checks reject public imports from siblings and reject
  candidate code as an Easelect or Filterest runtime dependency.
- For one accepted release identity, the canonical `easelect/filterest/` tree
  and the public repository root are exactly equal by path, content, executable
  mode, and reviewed symlink target, including the `app/` directory level.
- The public repository contains no private Easelect Git history, credentials,
  customer data, private deployment topology, or maintainer-only evidence.
