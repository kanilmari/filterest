<!-- DEV_GUIDE.md -->
<!-- Defines shared development rules and commands for Filterest. -->
<!-- Connects maintained source, local verification and release contracts. -->
<!-- Exists so ordinary development uses one public handbook without a private repository. -->

# Filterest Developer Guide

This is the shared implementation handbook for Filterest. The
[Constitution](../constitution/constitution.md) owns product principles;
this guide owns common development conventions and verification.
The [Filterest Dictionary](Dictionary.md) owns shared English product and
interface terms, including disclosure and multiselect.
Installation-specific composition and maintenance instructions may supplement
it, without duplicating or replacing its product rules.

## Completion scope and workflow phases

A workline tracks one finite, agreed scope. Its phase describes that entire
scope, not the most advanced feature or a percentage of completed tasks.
Phases 1–2 orient and plan; Phase 3 implements. Testing individual changes during
Phase 3 is expected, but the workline enters Phase 4 only when all agreed
implementation and required data changes are complete. Phase 4 verifies the
whole result, Phase 5 captures knowledge and review, and Phase 6 closes the
complete scope and prepares or completes its authorized commit/push.

If a missing requirement or implementation defect is found, return the workline
to Phase 3 even when earlier parts have passed tests or been published.
Record completed parts and remaining work separately. A genuinely new follow-up
has its own standalone workline and explicit scope; never silently remove
unfinished agreed work to make the original line look complete. Ordinary future
maintenance is not an unfinished feature of an already completed workline.
Worklines and tickets remain distinct primary concepts; technical links between
them do not create sub-worklines or another kind of ticket.

### Agent-task todos: identifier phrases

When creating or updating `dev_agent_task_todos` rows, `todo_text` must carry a
technical title and, when the human already described the item, their own
identifying wording. This is mandatory agent practice.

1. Extract the human’s own identifying wording / everyday problem description
   from their messages.
2. Compress it into a short identifier phrase.
3. Write `todo_text` with a newline: line 1 is the technical title; line 2 and
   later are the identifier phrase. The article todo checkbox UI already splits
   on that newline and shows the phrase as a muted second line.
4. Do not leave only a technical label when the human already described the
   item in their own words.
5. Do not add a new database column. The newline inside `todo_text` is the
   contract.

Example:

```text
Restore article scroll after related todos settle
Stay open after F5
```

A single-line value is acceptable only when no human wording exists to preserve.
The UI splitter is `splitTaskTodoText` in
[row_article_task_todo_status.js](../../frontend/core_components/table_views/card_view/row_article_task_todo_status.js).
The [Dictionary](Dictionary.md) names the ticket-todo term; keep the writing
rule here.

## 1. Source and development environment

Paths and commands below start at the Filterest installation root.
See the [runtime contract](runtime_contract.md) for current resources, lifecycle and local-only status.

- `app/` owns maintained backend, frontend, tests, docs, tools, Docker source
  and version contracts. Commit product changes in this repository.
- Root commands are thin launchers. Never regenerate or replace an authoritative
  checkout from a parent repository, release copy or another working folder.
  The root holds only the files in
  [public_root_files.txt](../../server_tools/release/public_root_files.txt); add a
  new root file and its entry in one commit, as `./filterest release verify` checks it.
- `config/`, `keys/`, `projects/`, `data/` and `backups/` are operator-owned
  mutable siblings of `app/`. Preserve them across source changes.
  A source checkout is not a database or media backup.
- `config/filterest.paths` records installation paths; the tracked template is
  [filterest.paths.example](../../filterest.paths.example). Credentials, TLS
  keys, browser state and downloaded dependencies remain outside Git and app/.
- Existing module names and `EASELECT_*` compatibility identifiers remain
  contracts until deliberately migrated; do not mass-rename them.
- `core_components` owns application behavior; `reusable_components` owns
  portable behavior and must not import from `core_components`.

The [README](../../../README.md#development) owns installation instructions:

```bash
./filterest setup --profile development
./filterest setup --profile development --dependencies-only --yes
```

Use the first command for a new installation and the second to refresh declared
dependencies while preserving configuration, databases and running services.
Use the Go version declared in `app/go.mod`. The shared Python environment is
`data/runtime/python/venv/`; the layout-aware helper is
[project_python_venv.sh](../../server_tools/lib/project_python_venv.sh).
Do not create component-local environments without an actual isolation need.

### Build and run

```bash
./filterest start                         # Build and run locally
./ctl                                    # Public lifecycle entrypoint
./ctl --stop                             # Stop this installation's local runtime
./ctl agent status|start|stop|check       # The chat's coding-agent runner (Coding_Agent.md)
./filterest build                         # Frontend compilation only
(cd app && go build ./...)                # Go compilation only
./filterest test-unit                     # Frontend unit tests
(cd app && go test ./backend/... -count=1)
data/runtime/python/venv/bin/python -m pytest app/testing/python
```

Standalone native defaults are `https://localhost:8100` and Vite/HMR port `9100`.
Read the actual target and readiness output; a default does not prove a running
service. Preserve configured data, credentials and session identity on restart.

The maintained lifecycle code is
[ctl_main.sh](../../server_tools/ctl/ctl_main.sh), reached through
[root ctl](../../../ctl) and [app/ctl](../../ctl). Native and the public
[Docker stack](../../docker/docker-compose.yml) need no private repository.
Legacy `ctl --instance` operations additionally expect an embedding product's
instance Compose definitions; those templates are not a shipped standalone
Filterest multi-instance deployment contract.

The instance-owned `FILTEREST_FRONTEND_ASSET_MODE=source|dist` setting controls
frontend delivery. Source mode uses editable assets and Vite/HMR; verify both
backend and HMR responses before claiming live reload works. An HMR warning
alone does not mean the backend failed. Dist mode requires current hashed
bundles and skips HMR; non-development runtimes always serve dist.
[Vite](../../frontend/vite.config.mjs) handles development Go-template substitution.
Do not edit generated `app/frontend/dist/` or rewrite template hashes manually;
the backend selects the current bundles.

After backend changes, rebuild/restart the intended instance and verify its
readiness before handoff. Browser-facing work needs a verified result URL and
refresh instruction; distinguish delivered source from actual browser proof.
Keep the editor pointed at the runtime's real source, preserving open editors,
unsaved buffers and settings. Source visibility does not require upgrading or
restarting the editor application.

### Frontend organization proposal — planning only

Organize frontend source around visible product responsibilities. Keep a
component's JavaScript, styles and focused tests together; file type is not an
ownership boundary. This section is a proposal under owner review, not an
authorization to move the current frontend or a new automated release gate.
Refine the plan before approving any dependency-aware migration batch.

The intended shape is responsibility first, recursively:

```text
frontend/
  menu_bar/
  content/
    views/
      card/
      article/
      table/
      common/
  filterbar/
    header/
    toolboxes/
      filtering/
      content_management/
      view_selection/
      visible_fields/
    chat/
    status_bar/
    common/
  common/
    navigation/
    endpoints/
    theme/
    ui/
      disclosure/
      multiselect/
      tree/
```

This is an ownership example, not an additional source tree or a mandate to
rename existing public paths immediately. The actual view implementations belong to
`content/views/` because their visible effect and responsibility live in the
content area, even if selection currently happens only in the filterbar. The
filterbar's `toolboxes/view_selection/` owns only the selection controls, their
styles and choice-handling logic.

Shortcuts in that selector, the frontend root or other useful locations may
point to `content/views/` and other owning directories. Choose the portable
shortcut mechanism during plan review (for example editor navigation or a
documentation link); do not introduce another source copy or proxy implementation.

The proposed `common/` directory exception applies at each level **only** to named capabilities
actually used by two or more sibling responsibilities. Give each shared
capability its own descriptive module or subdirectory and document its consumers
and dependency direction. Shared runtime services, such as navigation and the
endpoint router, remain separate from portable UI libraries. Preserve the
existing rule that portable reusable UI must not import application policy.
Keep theme tokens and their shared styles in one owning theme component; store
mutable presentation settings through the validated configuration contracts,
not arbitrary CSS fragments spread across tables or modules.

An unclear file never belongs in `common/`. Keep it visible at its nearest
owning directory root until its responsibility is understood. At every level,
prefer named parts plus a justified `common/`, with entrypoints and configuration
files as explicit exceptions. Structural review should flag unexplained
root-level leftovers and unjustified shared placement as advisory quality
deductions. Those deductions do not block a release by themselves; broken
imports, dependency cycles, permission regressions and duplicate authorities
still do. This is the proposed review philosophy, not a new ticket, an active
refactoring instruction or a claim that an automated structure score exists.

A later approved move should demonstrate a concrete ownership improvement.
Review both incoming and outgoing imports, lazy entrypoints, CSS imports,
tests and documentation links; build and exercise the resulting feature.
Keep compatibility at a deliberate boundary and remove it when its consumers
have moved, rather than accumulating permanent parallel paths.

## 2. Naming Conventions

### Table vs Dataset
- **table** = Internal. Database tables, Go structs, private JS variables.
- **dataset** = Public. URL segments, JSON keys, HTML data-attributes.

**Decision Flow:**
- Is it .js/.go AND will it leave the bundle/binary? -> **dataset**
- Else -> **table**

### Database Project vs Custom App

A database project is a direct child of the database `apps` folder in
`system_table_folders`, including descendants. Optional matching custom source
or a portable directory is not project registration and grants no permissions.
See the [project model](Filterest_Project_Model.md).

## 3. Coding Standards

### General
- **File Headers**: Use a 4-5 line English header
  for new or materially edited, human-maintained files that support comments:
  filename, What, Between what, Why. Existing untouched files are
  grandfathered; generated, vendored, binary, lock, and comment-forbidding
  formats are exempt. Public/exported functions, security/data boundaries, and
  non-obvious workflows need idiomatic What/Between/Why comments; trivial
  accessors, callbacks, and self-explanatory private helpers do not. This
  remains primarily a review standard plus periodic normalization work.
- **Length**: Keep files at or below 700 lines, functions below 600 lines. Refactor if larger. Only file length has automated enforcement today; function length is still a review rule.
- **Naming**: Prefer long, descriptive names over short ones. When a variable, function, file, or folder exists mainly to handle a UI event or workflow action, name it after that event/action where practical, for example `mouse_click_listener`, `tree_node_drop_handler`, or `filter_toggle_button`. Avoid bare vague names such as `handler`, `helpers`, or `logic` when the concrete interaction can fit in the name.

### Cross-Language Naming Contract

Apply the same meaning-first rule to every new or renamed human-maintained
source file, test, stylesheet, script, configuration file, document, package,
and folder:

- **Use an open vocabulary, not a fixed dictionary.** A new subject, role,
  action, or artifact word is valid when it describes one coherent purpose
  more accurately than the existing vocabulary and a non-specialist can
  explain the name in one sentence. Repeated useful patterns should be added to
  the relevant guide instead of being forced into an inaccurate old label.
- **Follow the native shape of the artifact.** Subject-plus-agent-role works
  well for production modules; action-oriented names can be clearer for
  commands; component names fit stylesheets and templates; and topic or
  artifact names fit configuration and documentation. Do not add a role suffix
  merely to satisfy a pattern when the ecosystem or artifact type communicates
  purpose more clearly another way.
- **Keep generic collections exceptional.** Subject-qualified `helpers`,
  `utils`, and `common` are discouraged but allowed when they contain a small,
  cohesive set for that one subject, no dominant responsibility deserves a
  more exact name, and splitting would reduce clarity. Bare names such as
  `helpers`, `utils`, and `common` remain prohibited by the current naming rule.
  The planning-only frontend proposal above considers a narrowly defined
  structural `common/` exception; it does not authorize directory moves yet.
  `misc` is prohibited because it explicitly permits unrelated contents.
- **Demand evidence from broad architecture words.** Prefer a precise name over
  `factory`, `store`, `service`, or `manager`; use one only when the
  subject-qualified name describes a real, bounded responsibility.
- **Respect reserved and paired names.** Toolchain names, entrypoints,
  generated or vendored files, migration ordering prefixes, and paired test or
  component basenames keep their required form. These are structural
  exceptions, not permission to use vague names elsewhere.
- **Do not mass-rename for cosmetic conformity.** Existing names are
  grandfathered until the file is materially changed or a dependency-aware
  rename batch is approved. A rename must improve meaning and preserve imports,
  tooling, release paths, and historical evidence.

The open vocabulary applies to descriptive words, not to machine-enforced
namespaces or protocols. Database prefixes such as `system_`, `app_`, and
`dev_`, migration ordering, public API fields, environment keys, release
artifacts, and toolchain-reserved filenames remain controlled contracts.

### Go (Backend)
- **Error Messages**: Print in red, start with lowercase. `log.Printf("\033[31merror: %v\033[0m", err)`
- **Transactions**: New code should use `WithLazyTransaction` (alias `WithLazyTx`) — opens a connection only on first `dbutils.RequireTx(ctx)` / `dbutils.GetTx(ctx)`. `WithTransaction` is kept as a backward-compat alias and now delegates to `WithLazyTransaction`; do not introduce new callers.
- **Routing**: Register core handlers in `app/backend/core_components/router/router.go` with their allowed `net/http` methods and a security profile in `app/backend/pipeline/route_profiles.go`. The router enforces the declaration before the handler runs, automatically includes `HEAD` with `GET`, and publishes the same declaration in the generated route manifest. Do not add handler-local method guards. Optional application compositions use the existing `app_registry.RegisterRoute` and `pipeline.RegisterRouteProfile` extension points and must supply the same method declaration. See [Pipeline_Architecture.md](Pipeline_Architecture.md).
- **Dual DB Connections**: The app uses two database connections:
  - `backend.Db` — for the `public` schema (tables like `system_users`, `app_*`).
  - `backend.DbConfidential` — for the `restricted` schema (tables like `users_restricted` containing passwords, emails). **Never query `restricted.*` tables via `backend.Db`** — it lacks the permissions. See `user_profile_handlers.go` for a working example.
- **External HTTP calls**: NEVER use `http.Get()`, `http.Post()` or `&http.Client{}` without a timeout. Always use `&http.Client{Timeout: 10 * time.Second}` or similar. Unbounded calls can block request handling for minutes.
- **DNS / Reverse DNS**: NEVER call `net.LookupAddr` synchronously in request handlers. Use async lookups with short timeouts or caching (see `firewall_handler.go` `cachedReverseDNS` for reference).
- **File Naming Convention**: Human-maintained production modules normally use
  `[subject]_[role].go`. The current 13 roles (`_handler`, `_checker`,
  `_builder`, `_reader`, `_saver`, `_printer`, `_fetcher`, `_remover`,
  `_editor`, `_creator`, `_validator`, `_formatter`, `_granter`) are a core
  palette, not a closed whitelist. A precise role such as `_resolver`,
  `_router`, `_registry`, `_adapter`, or `_subscriber` is allowed when it names
  the real bounded responsibility better. Subject-qualified `_helpers`,
  `_utils`, and `_common` follow the constrained exception in the
  cross-language contract; `_misc` remains prohibited. `_factory`, `_store`,
  `_service`, and `_manager` require the same evidence as any other broad role.
  Use lowercase `snake_case`. Go-specific structural exceptions include
  toolchain-reserved `_test.go`, entrypoints, and package-level files such as
  `database.go` and `models.go`. Existing mismatches are grandfathered; apply
  the target to new and renamed files.
- **`system_config` reads**: The `system_config` table stores runtime toggles (booleans, ints, JSON). The canonical readers live in `app/backend/core_components/middlewares/check_*.go` (login_to_browse, registration_enabled, use_minified_js_css_in_dev_env, transaction_console_logs). Other packages (pipeline, lang, dtt, ai_features) also read system_config directly where the value is consumed locally. When adding a new system_config key: if multiple packages need it, add a reader function in `middlewares/` and import it; if only one package uses it, a local query is fine.
- **Testing Policy (Go)**:
  - New or changed backend behavior must include meaningful tests in `_test.go` files (same package unless black-box testing requires external package tests).
  - Bug fixes must include a regression test that fails before the fix and passes after it.
  - Exception: purely mechanical/refactor-only edits with no behavior change may skip new tests, but this must be explicitly noted in the ticket/PR summary.
  - Long-term target: every active backend package should have at least one meaningful test to avoid zero-test packages.

### JavaScript (Frontend)
- **No Frameworks**: Use existing vanilla JS libraries.
- **File Naming Convention**: Human-maintained production modules target
  `[subject]_[role].js` and the open, evidence-based role palette above. Subject words are freely descriptive; the core role
  list may be extended with a precise responsibility. Subject-qualified
  `_helpers`, `_utils`, and `_common` are discouraged exceptions for small,
  cohesive same-subject functions; bare generic names and `_misc` remain
  prohibited.
  Existing mismatches are migration debt to normalize in reviewed,
  dependency-aware batches. Generated/bundled/vendor files, tests that mirror a
  production basename as `.test.js`, pure data/config, and required entrypoint
  or package names are exempt.
- **Routing**: Register generic/dynamic callers in `app/frontend/core_components/endpoints/endpoint_router.js`. For the typed stable API island, add or update wrappers in `app/frontend/core_components/endpoints/stable_endpoint_router.js` and keep `stable_api_inventory.js` aligned.
- **Visibility**: Handle via `app/frontend/core_components/route_permission_checker.js` (`applyPermission`, `hasRoutePermission`, `hasDatasetPermission`, `clearPermissionCache`).
- **HTML Generation**: Assign unique, descriptive classes (e.g., `sort-database-results-button`).
- **Localization**: Route user-visible copy through the existing language-key or component-copy mechanism. A changed multilingual component must be exercised with representative non-English copy before handoff; English-only rendering is not sufficient verification.
- **CSS**:
    - Be careful with `display: grid`. Ensure layout stability when adding elements dynamically.
    - **Theming**: All components must support both light and dark themes. Use CSS variables from `variables.css`.
    - **Theme verification**: Exercise every changed component in both explicit application themes. Include the case where the operating-system preference is dark but the application is forced to light, because root-level derived variables can otherwise retain the wrong theme value.
    - **Colors**: Use the current brand- and theme-derived CSS variables. Respect the selected dynamic brand hue; do not hardcode a hue or replace the configured palette with fixed colors.
    - **Backgrounds**: Ensure content areas such as the filter bar panel (`.filterbar-panel`) have appropriate background colors for the active theme (e.g., light background in light theme).
    - **Geometry-stable interactions**: Hover, press, focus, and selection must not move or resize a control or its neighbours. Do not change `transform`, position, margin, padding, border width, or font weight to signal those states. Use the shared brand-derived interaction variables for background, shadow, filter, and focus-ring feedback. See the existing theme variables and [style sample](../reference_implementations/golden_sample_styles.css.md).

### Other Human-Maintained File Types

- **Python and shell:** Name library modules for their subject and bounded
  responsibility. Name executable commands for the concrete operation when an
  action-oriented form is clearer. Preserve reserved test and package forms
  such as `test_*.py` and `__init__.py`.
- **CSS and HTML:** Name a stylesheet or template for the component, page, or
  surface it owns. Paired implementation, style, and template files should
  share a recognizable subject basename; they do not need an artificial agent
  role.
- **SQL migrations:** Preserve the migration runner's ordering/version format
  and use the descriptive portion to state the schema change. Migration
  ownership markers and globally unique filenames follow the runner and
  [migration sample](../reference_implementations/golden_sample_migration.sql.md).
- **Configuration, schemas, and data:** Name the governed object and artifact
  purpose. Required ecosystem names and explicit version markers take
  precedence over the subject/role shape.
- **Documentation and folders:** Name the topic or owned capability, following
  the established casing of the containing collection. The open vocabulary and
  constrained generic-name rules still apply; they do not require renaming
  historical documents.

### Pipeline Exceptions
- All API calls must flow through the routed pipeline path: `endpoint_router` (or `stable_endpoint_router`, which delegates into it) -> `runApiPipeline`.
- Any intentional direct `fetch()`/`XMLHttpRequest` must include `// PIPELINE_EXCEPTION: <reason>` and be listed in [PIPELINE_EXCEPTIONS.md](PIPELINE_EXCEPTIONS.md).
- Protocols that do not fit the request/response pipeline (e.g., SSE/EventSource) should be documented as edge cases in that registry.

## 4. Data, authentication and releases

Application data changes use supported permission-checked APIs. Direct SQL
inspection is read-only: no ad hoc DML, grants or deletes instead of an API
repair or reviewed migration. Existing workflows are described in
[API CRUD examples](API_CRUD_Examples.md) and [core workflows](Core_Workflows.md).

Inspect with `./db --local "SELECT ..."` (the same tool as `./filterest database`).
It accepts one `SELECT`/`WITH` statement, runs it in a read-only transaction
that is always rolled back, and connects as the installation's read-only
database role. Maintain datasets, columns and rows with `./api_crud` (the
same tool as `./filterest data`). Their default targets and credential sources
are described in the [README](../../../README.md#development).

To see what this installation's API actually offers, browse the `system_functions`
dataset: its `url_route_endpoint` column holds every registered address, and a
text search for `api` lists the API routes because addresses are indexed word by
word. An administrator can also read the same inventory, with access levels,
methods and handler descriptions, from
`/api/admin/site-assistant/api-catalog`, or as prompt text with `?format=markdown`.

Shared migrations live in `app/server_tools/migrations/` with globally unique
timestamped filenames and explicit ownership/version conventions; use the
[migration sample](../reference_implementations/golden_sample_migration.sql.md).
Execution requires `ENABLE_SQL_MIGRATIONS=true`. A downstream composition may
register additional sources, but standalone Filterest reads its public source;
duplicate filenames must fail. Prefer `INSERT ... SELECT ... WHERE NOT EXISTS`
over `ON CONFLICT`.

Filterest owns `app/VERSION_APP` and `app/VERSION_DB`. Ordinary source commits
do not independently advance a release number. At release preparation align
the application/DB compatibility record, schema snapshot and matching bootstrap
package with accepted migration source. Keep full recovery dumps separate from
the public bootstrap. Follow [Publishing Filterest](../publication/PUBLISHING.md)
for candidate preparation, build, promotion, final rebuild and publication.
Do not create another release ledger or rewrite published tags.

Reuse the supported API client or [E2E helpers](E2E_Testing_Guide.md) for
authentication. Fetch CSRF through `/api/csrf-token` and send `X-CSRF-Token`
with the same authenticated session when the route profile requires it.
A CSRF token is not a cookie. Use purpose-bound reserved development fixtures
and ignored auth state, never real user content or credentials.

Cookie identity is instance-scoped: preserve `INSTANCE_NAME`, session mode and
keys through ordinary iterations. Replica-pool mode is only for nodes sharing
one database with explicit shared identity/keys. Do not weaken authentication
for tests or print/commit passwords, cookies or protected environment files.

Browsers do **not** isolate cookies by port. Cookies for `Domain=localhost`
(or any other shared host) are visible to every port on that host, so
`https://localhost:8082` and `https://localhost:8090` overwrite each other's
`session_*`, `device_id_*`, and `fingerprint_*` cookies in DevTools and in the
browser cookie jar. CSRF tokens live in the session cookie, so they follow the
same name.

When `port_number_in_cookies` is on, those cookie names include the actual HTTP
listen port the process is bound to (not an unused default). Local `dev` and
`test` environments enable this by default; production leaves cookie names
unchanged. Set `PORT_NUMBER_IN_COOKIES=1` or `0` to override the default. Login,
logout, session refresh, OTP, and password-reset pre-auth cookies use the same
naming helpers, so readers and writers stay on one family per listen port.

## 5. Verification

Use the lightest checks that prove the changed behavior. Small mechanical CSS
or wording changes may use diff review, narrow lint/import checks and direct
inspection. Avoid permanent tests that merely freeze an incidental pixel value.
Logic, permissions, persistence, localization and lifecycle boundaries need
meaningful regressions; record the reason for intentional test omissions.

| Changed surface | First check | Further evidence when affected |
|---|---|---|
| Go behavior | Targeted package tests | API, permissions and data in the intended runtime |
| Frontend logic | `./filterest test-unit <test-path>` | Navigation, state, cancellation and focus |
| Layout/themes | Narrow CSS/import checks | Viewports, explicit themes and screenshots |
| Imports/source moves | Caller/import review and frontend build | Runtime and lazy-loaded paths |
| Release/bootstrap/tooling | Relevant public Python tests | Artifact, upgrade and restore evidence |
| Documentation | Relative links and source agreement | Document link; no app build solely for a URL |

Run frontend tests through `npm test` in app/ or `./filterest test-unit`, not
bare `npx vitest`. The repository runner preserves Node options and bounded
worker defaults. A given target always limits the run: write it relative to
app/ (`frontend/core_components/...`) or to the repository root
(`app/frontend/...`), with or without a leading `--`. A target that matches no
test file fails with "No test files found" rather than running the whole
suite. The [Python test guide](../../testing/python/README.md)
defines categories and isolation limits; use the declared shared environment.

[Playwright config](../../playwright.config.ts) and the
[E2E guide](E2E_Testing_Guide.md) own the current matrix, credentials, storage
state and helpers. E2E covers navigation, view changes, auth, CRUD, modal and
responsive workflows; unit tests complement it rather than proving a browser
flow. Visual Guardian complements both: `npm run guardian` captures,
`guardian:full` captures/analyzes, `guardian:analyze` uses existing captures.
Use the existing noninteractive test launcher; do not open HTML report servers
during unattended runs. Test changed multilingual components with non-English
copy and with both explicit application themes, including forced light over
an OS dark preference.

### Page-load network waste

When changing catalog/login media, bootstrap GETs, or login-shell imports,
re-measure a cold load instead of relying on request counts from a warm
browser. LNCD serves many unbundled modules; production uses `main.*.min.js`.
Compare waste that remains in both (duplicate APIs, oversized originals,
cancelled image retries, 404s), not raw script counts.

From the product root, with Playwright pointing at the LNCD origin:

```bash
FILTEREST_E2E_BASE_URL=https://localhost:8082 PLAYWRIGHT_HTML_OPEN=never \
  ./filterest test testing/e2e --project=desktop-card -g "network" --workers=1
```

If no dedicated spec exists, capture one cold Playwright page load:

```js
const responses = [];
page.on('response', (response) => responses.push(response));
await page.goto(url, { waitUntil: 'networkidle' });
```

Record request count, transferred bytes (`response.headers()['content-length']`
sum where present), cancelled/aborted image URLs, and HTTP 404s. Repeat for
`/` (or the service catalog landing path) and `/login`.

Baseline from 2026-09-14 (before LNCD #888):

| Surface | Requests | Transferred | Notable waste |
|---|---|---|---|
| LNCD home → service_catalog | ~536 | ~6.6 MB | `/api/translations?lang=en` ×2, `/api/datasets` ×2, background `original` ~1.8 MB |
| LNCD `/login` | ~408 | ~3.9 MB | retired Queen chat bundle ~147 KB (historical measurement) |
| Production filterest.com | — | ~3.87 MB | three ~1.1 MB catalog PNGs plus `NS_BINDING_ABORTED` retries; `codex-querydataset=dokumentaatio` 404 |

Do not close #837 from this measurement; that ticket is thumbnail product
scope. This check is network waste only. LNCD #890 follows #888: catalog/home
display slots request `300`/`1000`/`2160`, and a missing derivative must try a
sibling sized file before `original`. On-demand variants are written atomically,
and a source that already fits the requested size is stored unchanged instead of
being upscaled. Startup maintenance replaces any stored `300`/`1000`/`2160` variant
that is larger than its original with a copy of the original (row assets, dataset
cover/background media and the media library); the scan reads image headers only and
is safe to repeat. Count those URLs with
`testing/e2e/helpers/storage-media-requests.ts` (see `C11_network_media_variants`).


### Unified QA

`./filterest qa` (or `npm run qa` in app/) checks source without automatic
repairs. `./filterest qa --fix` explicitly enables ESLint, JS/CSS import and
gitignore-report changes. Run fixes only in the intended change scope and
review the resulting diff. `--help` lists supported arguments.

[qa.sh](../../server_tools/scripts/qa.sh) reports `QA PASS` for completed
checks and `QA PARTIAL` when browser tests are skipped, including the reason.
Missing test credentials or an unhealthy selected runtime skip E2E and retain
exit 0; PARTIAL is not complete browser or release verification. A failing
executed check returns nonzero. Build and coverage output use temporary
locations outside source. An optional `FILTEREST_ADDITIONAL_QA_SCRIPT`
keeps its existing caller contract and is not sandboxed; the no-source-repair
guarantee applies to the built-in checks, not arbitrary extensions.

The target follows the local target resolver, including an explicit local
`FILTEREST_E2E_BASE_URL`. Default smoke uses `smoke.spec.ts` and
`L_auth/L1_login.spec.ts` with `QA_PLAYWRIGHT_PROJECT=desktop-card`;
`QA_PLAYWRIGHT_FULL=1` selects the full matrix. Neither mode replaces targeted
tests required by a changed behavior. Frontend unit, Python and Visual Guardian
checks run separately; do not claim unified QA ran them.

### Logging and generated code

Guard noncritical `console.log` with `IS_DEV_MODE`. Keep meaningful warnings
and errors; never log credentials or personal data. Vite's build-time removal
of debug calls complements the source-mode guard. Do not manually edit generated
bundles or contract files: update their source and run the relevant generator
and its check mode.

## 6. Change scope and documentation

### Documentation Mismatch Triage

Do not automatically rewrite documentation to match the current implementation.
A mismatch can mean the implementation bypassed an intended design when time or
token limits were tight. Classify the document before changing either side:

- **Normative specification** describes the intended contract or architecture.
  Treat a mismatch as a possible implementation defect and resolve the design
  authority before editing the specification.
- **Descriptive guidance** explains how the current system actually works.
  Update it when verified behavior has intentionally changed.
- **Historical evidence** records an earlier decision, release, or proof.
  Preserve its original scope and dates; add current context elsewhere instead
  of rewriting history.

When ownership is unclear, record the discrepancy and the evidence on both
sides. Do not “fix” the document or the code merely to make them agree.

### Change Scope: Narrow Slice vs Larger Refactor

**Current assessment:** Filterest is currently better described as **toimivasti kytkeytynyt** than fully **hyvin saumoitettu**.

That means the repo already has some real seams, but many durable contracts still cross several layers together. Good examples of existing seams include the backend pipeline (`app/backend/pipeline/route_profiles.go`), the frontend navigation pipeline (`app/frontend/core_components/pipeline/navigation_pipeline.js`), and the centralized endpoint routers (`app/frontend/core_components/endpoints/endpoint_router.js`, `stable_endpoint_router.js`). The tighter coupling still shows most clearly around dataset identity: the same raw dataset name currently flows through URL handling, SPA restore logic, permission checks, metadata reads, backend routing, and SEO helpers.

**Default rule for this repo:** Prefer a **narrow slice by default** when a change crosses multiple layers or touches a durable contract. Prefer a **larger refactor** only when the seam already exists and the work stays mostly inside that seam.

Use a **narrow slice** when one or more of these are true:
- The change crosses frontend, backend, routing, permissions, or DB metadata boundaries.
- You are not yet sure where the true seam is.
- The new design must coexist with a legacy path during rollout, or you are collapsing already-proven migration scaffolding.
- The change introduces a new canonical source of truth.
- The change touches user-visible URLs, public API shapes, auth flows, or permission semantics.
- The blast radius is hard to estimate before the first working vertical slice.

Use a **larger refactor** when most of these are true:
- The boundary is already clear and stable.
- The work stays mostly within one module or subsystem.
- External behavior can remain unchanged.
- Existing behavior is already protected by tests.
- The refactor removes duplication without adding a parallel contract.
- You are collapsing already-proven migration scaffolding rather than inventing a new direction.

A useful slice establishes one real seam and one canonical policy, with tests
and a clear continuation. Avoid duplicated mappings, parallel quasi-canonical
paths and unrelated cleanup. Prefer one verifiable vertical change before a
wider rollout when the blast radius is uncertain.

### Callers, moves and review

Before changing a shared function or contract, inspect current callers,
permissions and tests. Use available impact tools, but verify that their index
points to current source; an archive match is not current impact evidence.
For a moved JS/CSS module check callers, imports inside the moved file, and CSS
imports. A one-directional boundary checker does not prove the full graph:
run the frontend build.

Use [reference implementations](../reference_implementations/) rather than
arbitrary legacy patterns. Order source clearly (imports, constants, types,
public and private functions); separate business logic from presentation,
use explicit types/JSDoc, guard clauses and named constants, and remove dead
commented-out code. Prefer existing vanilla JS/Go facilities and justify new
dependencies by a concrete need.

Exact values, defaults and registries belong in the canonical source that uses
them. Guides explain purpose, ownership and constraints and link to existing
topic guides instead of restating volatile data. Update documentation in the
same change as intentional behavior changes. Keep lasting rules in one place
and historical evidence in its original scope.

Review the owning repository's diff and run `git diff --check`. Preserve
existing work, ignored operator state and recovery history. Use the
[publication guide](../publication/PUBLISHING.md) for source/release boundaries
and [CONTRIBUTING](../../../CONTRIBUTING.md) for submissions.
