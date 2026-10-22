<!-- README.md: Python suite execution and coverage policy. -->
<!-- Connects the project interpreter, pytest categories and changed-path planning. -->
<!-- Keeps ordinary batches small while retaining nightly lifecycle coverage. -->
<!-- Classification reasons and path patterns live in python_test_tiers.py. -->

# Python Test Tiers and Categories

Run these commands from the repository root with the project's Python
environment. The two execution tiers partition every collected test:

- `ordinary`: application features, feature-specific migrations and language
  seeds, release assembly/publication, API helpers, agent workflows and remaining
  platform tooling.
- `heavy-installation`: installation, setup, update verification and execution,
  rollback, backup, restore/recovery, public launchers, native/Docker lifecycle,
  installation paths/dependencies and whole-bootstrap migration evidence.

```bash
data/runtime/python/venv/bin/python -m pytest app/testing/python --category ordinary
data/runtime/python/venv/bin/python -m pytest app/testing/python --category heavy-installation
data/runtime/python/venv/bin/python -m pytest app/testing/python
```

Use pytest-xdist to distribute either tier across the development machine:

```bash
data/runtime/python/venv/bin/python -m pytest -n auto --dist loadgroup --category ordinary app/testing/python
FILTEREST_TEST_DISPOSABLE_POSTGRES=1 data/runtime/python/venv/bin/python -m pytest -n auto --dist loadgroup --category heavy-installation app/testing/python
```

The test requirements pin pytest-xdist to 3.8.0. `auto` detects the worker count;
set `PYTEST_XDIST_AUTO_NUM_WORKERS=12` before either command to use all twelve
threads on the owner's development host (some environments detect physical
cores instead). The serial commands above retain their original behavior.
`--dist loadgroup` keeps the six `ReleaseManifestContractTests` together in
the named `release-manifest-parser` group, preserving one class-owned Go parser
build. Other tests distribute individually; grouping never skips tests or
prevents unrelated groups from running at the same time. This is fixture reuse,
not a requirement to serialize the installation tier.

Disposable socket-server fixtures share [disposable_postgres.py](disposable_postgres.py).
Worker `gwN` leases ports from `20000 + N * 256` through `20255 + N * 256`,
checking local availability and avoiding nested-cluster leases in that process.
Each cluster has a unique temporary folder with its worker name, containing
private data, socket and log paths. Concurrent test runs also have distinct
random folder names. PostgreSQL remains Unix-socket-only; recovery transports
use the assigned port. Serial fixtures keep ports 15458/15461/15471/15476/15483
and their original folder prefixes. Before removing any paths, cleanup confirms
the owned postmaster's exit, including after a partially failed start. Bounded
fast (SIGINT), immediate (SIGQUIT) and last-resort (SIGKILL) signals all use the
captured Linux process handle, each followed by a bounded exit wait through that
same handle. Shutdown never rereads the PID file or invokes `pg_ctl stop`.
An unavailable handle or already exited process receives no signal; without a
handle, only exit observed during capture permits removal. If identity or exit cannot
be confirmed, all data/socket/log folders remain and a cleanup error names the
kept path and PID (or an unknown PID). The process-local port lease is released
in all cases. Missing PID files alone never prove exit. The single-user
PostgreSQL fixture already uses worker-isolated pytest temporary paths and needs
no socket port. No shared PostgreSQL suite lock is required.

Tests patch environment/caches inside their own worker process and restore the
patches; mutable installation, release and process fixtures use unique temporary
roots. The test harness exposes only this checkout's `app/` on the import path,
so a neighbouring checkout named `filterest` cannot redirect tool imports.
Go's own concurrency-safe module/build caches can remain shared. Category
summaries copy one worker's complete collection counts to the controller,
so parallel execution does not multiply counts or report zero.
`--collect-only -n auto` remains a collection check: xdist 3.8.0 disables worker
execution in collect-only mode. Allocator and cleanup tests run without any
PostgreSQL binary or socket access in [test_disposable_postgres.py](test_disposable_postgres.py).

The relevant-check planner below selects `ordinary` as conservative fast Python
coverage and adds `heavy-installation` for installation or recovery changes.
Run whole tiers for integration and nightly confirmation; their schedule never
defers relevant checks required by the Constitution. No category option
continues to mean the full suite; add `--collect-only -q` to each command to
inspect its selected test IDs without executing tests. The ordinary and heavy
sets are disjoint and their union is the full collection. Tests keep their
existing assertions and PostgreSQL opt-ins in both tiers.

The reviewed heavy-file list and each file's exercised behavior are defined in
[`HEAVY_INSTALLATION_FILES`](python_test_tiers.py). Every other file is ordinary.
Review new test files there by what they exercise: a login password recovery or
article-state restore test remains ordinary, while a cold database restore or
launcher interpreter-selection test needs the heavy tier. A feature migration
test remains ordinary even when it imports a bootstrap fixture.

For changed-path planning, use the side-effect-free selector:

```bash
data/runtime/python/venv/bin/python app/testing/python/python_test_tiers.py app/frontend/main.js
# ordinary
data/runtime/python/venv/bin/python app/testing/python/python_test_tiers.py app/server_tools/update_filterest.sh
# heavy-installation
```

It prints one tier and exits successfully; `heavy-installation` means the batch
needs installation/recovery coverage as well as ordinary coverage. Pass repository-relative changed
paths, including deleted files and both paths of renames. It accepts `./` and
Windows separators, normalizes internal `..`, and rejects absolute or escaping
paths with exit status 2. No paths means an empty batch and prints `ordinary`.

The single pattern list, [`HEAVY_PATH_PATTERNS`](python_test_tiers.py), covers
installation/setup/update, backup/recovery, launchers, Docker/Compose,
bootstrap, migration runners and contracts, and the tier tooling/fixtures.
Shared lifecycle shell libraries are deliberately conservative triggers.
Changing an ordinary file that supplies a heavy suite's cluster fixture also
requires heavy coverage. Matchers use repository-relative, case-sensitive
`fnmatch` globs, where `*` includes nested directories; they inspect names,
not filesystem existence. Keep representative paths and classification
boundaries covered by [selector tests](test_python_test_tiers.py).

The existing ownership categories remain available alongside the tiers. The
summary reports both ownership and tier counts **before category deselection**;
the selected choice is labelled. `--python-category` is retained as an alias of
`--category`, and either spelling accepts ownership categories or tiers.

The ownership categories explain which product area owns the tests:

- `release-artifact`: Filterest generation/publication, public bootstrap, and
  release-evidence contracts.
- `agent-workflow`: developer task and worker-agent tools; downstream maintainer
  suites can use the same category support.
- `platform-tooling`: the remaining local platform, migration,
  shell-compatibility, and validation helpers.

Run one category with:

```bash
data/runtime/python/venv/bin/python -m pytest app/testing/python --category release-artifact
data/runtime/python/venv/bin/python -m pytest app/testing/python --category agent-workflow
data/runtime/python/venv/bin/python -m pytest app/testing/python --category platform-tooling
```

Ownership categories can include heavy tests; use `ordinary` for ordinary batch
coverage. Neither categories nor tiers claim process isolation.
Some automated tests use temporary subprocesses, Git repositories, or files,
but the default collection does not start the real Filterest backend, frontend,
or database. Opt-in PostgreSQL tests start disposable local clusters only.
Operator-invoked scripts that may start services or write through
live APIs have separate dependencies and do not belong to this collection.

Bootstrap tests compare generated schema bytes with the snapshot selected by
`app/VERSION_DB`; fixed older snapshots belong to historical upgrade checks.
`test_row_actor_support.py` remains the collecting entry point for its support
checks and exports the fixtures used by other suites. Their implementations in
`row_actor_support_contracts.py` are imported there, preserving test addresses
without duplicate collection. Its schema-byte comparison runs without PostgreSQL.
Use `bootstrap_contract_assertions.assert_bootstrap_baseline` to check a folded-in
migration's filename, exact source hash, `bootstrap_baseline` outcome and
`bootstrap` provenance in the acceptance ledger. A baseline is not proof that
the historical migration executed. Contract-type checks scope retired fields
to their owning response: the shared appearance setting may still exist.

The ledger assertion counts every place where its name reaches PostgreSQL's
parser as an identifier under default lexing. It also reads every decoded
string constant and dollar-quoted body as potential code; an unterminated
construct ends that inner scan, while top-level seed lexing stays strict.
Run-time assembly from separate values (concatenation, `format()`, `quote_ident`,
regclass casts, catalog updates through a value) stays out of scope; a constant
whose whole decoded content is a single bare name is a value, not code.
Top-level psql backslashes outside quoted constructs/comments and static
`COPY ... FROM STDIN` are refused. Any static mention of
`standard_conforming_strings` or `client_encoding` in decoded code or constants
is refused, regardless of casts, grouping, subqueries or argument position,
including bare-name values and text past a lenient inner scan's early stop.
The current seed mentions neither name. `SET/RESET NAMES`, `RESET ALL` and
`ALTER ... SET/RESET` retain their parser-setting refusal. Other settings and
backslashes in string or dollar-quoted values remain allowed.

The authoritative install check, `test_bootstrap_ledger_postgres.py`, generates
both bootstrap SQL files and installs them in a fresh database through the
existing Unix-socket-only disposable PostgreSQL harness. It compares every
installed ledger row with the public migration files' current byte hashes,
requires exactly one `bootstrap_baseline`/`bootstrap` row per file and no other
rows, and checks that the sole database version equals `app/VERSION_DB`.
These checks do not depend on the static scanner recognizing SQL spellings.
Use the same opt-in as other disposable PostgreSQL tests; PostgreSQL 16 binaries
default to `/usr/lib/postgresql/16/bin` (`PG_TEST_BIN` overrides this). From
`app/testing/python`, run the install check with one command:

```bash
FILTEREST_TEST_DISPOSABLE_POSTGRES=1 ../../../data/runtime/python/venv/bin/python -m pytest -n auto --dist loadgroup test_bootstrap_ledger_postgres.py
```

Disposable clusters have isolated ports and paths; do not wrap these commands
in the old `/tmp/filterest_pg_suites.lock` suite lock. Without the opt-in or test
binaries, PostgreSQL checks keep their existing skip behavior.

## Relevant check planning

The [Constitution](../../docs/constitution/constitution.md#3-make-changes-traceable-and-verify-the-actual-result)
owns check timing, sandbox responsibility and map lifecycle. The offline planner
prints commands; it never runs checks, starts services or accesses a database:

```bash
python3 app/testing/python/relevant_checks.py app/frontend/core_components/infinite_scroll/infinite_scroll_handler.js
python3 app/testing/python/relevant_checks.py --range HEAD~1..HEAD
python3 app/testing/python/relevant_checks.py --json --range main...HEAD
python3 app/testing/python/relevant_checks.py --compare-plan data/runtime/check_plan.json --json
python3 app/testing/python/relevant_checks.py --nightly-cross-cutting --range HEAD~1..HEAD
```

Paths are relative to the repository root. Include deletions and both rename
names; Git ranges include them automatically. Explicit paths and a range can
be combined. An empty batch prints empty groups. Invalid paths or a stale map
fail with exit status 2. `--json` includes every file and discovered Go test
name. `--python /path/to/python` changes the interpreter in printed pytest
commands when a worktree uses an existing local test environment. Empty and
option-like interpreter values are refused; commands quote the interpreter and
end `env` option parsing before it.

Plans add `evidence` without changing `fast`, `heavy`, `kind` or `targets`.
Evidence records the map version and exact-byte SHA256, the interpreter, every
check's stable ID and targets, and its projects (including the unnamed default
project of a separate config). A clean checkout uses `git rev-parse HEAD^{tree}`;
a dirty checkout hashes HEAD's tree, staged and unstaged binary diffs, and
nonignored untracked file contents. Non-Git fixture/source trees use an app-content
digest. Ignored runtime artifacts do not change evidence, so save plans there.
`--compare-plan FILE` recomputes the complete saved JSON, reusing its paths and
interpreter unless supplied explicitly. Identical inputs produce identical plans;
a changed map, source tree, input or selection fails with exit status 2 and the
mismatch fields. Always recompute after rebasing.

`--nightly-cross-cutting` prints matching input paths, preserving input order and
duplicates (`--json` prints an array). Its `nightly_cross_cutting_prefixes` map
list preserves the former nightly regex exactly, including partial-name prefixes
such as `lang_` and `state` and the required slash after `shared/`. This mode
does not select or execute checks. The external nightly caller can replace its
regex with this interface; policy/pipeline scripts are maintained separately.

**Fast:** the map guards, existing file-length guard in its normal warning-only
mode, Go unit tests in
touched packages and direct local importers (plus the backend-wide session
guards), frontend Vitest tests and paired tests reached through literal imports,
re-exports, dynamic imports and CSS imports, and ESLint for existing touched
JavaScript files. Deleted modules still select their surviving importers.
Embedded package assets also select Go consumers. Python files use the tier
selector's partition: all ordinary files stay in fast coverage because that
selector supplies no safer file-level application mapping. PostgreSQL opt-in is
removed from fast Go/Python commands so proofs belong to the heavy group.
Curated `python_guards` also print focused ordinary-tier commands for their
source paths. The provenance guard checks every recorded asset/source hash and
browser-license document in the reviewed registers; missing or changed files
require re-review and an updated entry. Its map test requires all registered
files to remain covered as the registers grow.
Strict whole-repository length enforcement is a separate maintenance check;
unrelated over-limit files cannot fail a change's fast group.

**Heavy:** Go tests whose declared names contain `Postgres`, discovered directly
from each affected package's source; installation Python files selected by the
existing tier policy; migration-specific Go packages and Python test files found
by literal migration filenames and imported fixtures; and the bootstrap ledger
proof for migration/bootstrap changes. Bootstrap-generator changes select every
referenced migration proof. Changed Python PostgreSQL tests and tests importing
changed fixtures/helpers also receive opt-in commands, even without a migration
change. Discovery reads literal PostgreSQL opt-ins in executable Python code and
follows fixture/helper imports through re-exports; filenames and quoted examples
alone do not declare a PostgreSQL requirement. Opt-in commands keep the shared
PostgreSQL lock, which the Go PostgreSQL tests still use; the Python harness
above no longer requires it.
Curated browser areas supply specs and explicit projects to the existing
noninteractive launcher, including phone/tablet/desktop card projects.
Commands selecting any `testing/e2e/setup/` spec also set
`PLAYWRIGHT_INCLUDE_SETUP=1`, including direct spec changes and mixed selections.
The [collection guard](test_relevant_checks_setup.py) uses only Playwright
`--list` to prove the emitted setup command collects both specs in all six
projects and every mapped matrix spec/project pair collects at least one test.
It uses installed development dependencies, stays offline, and runs no hooks,
browsers or application/database services.

The only reviewed policy is [relevant_check_map.json](relevant_check_map.json):
grouped component paths with browser proofs or explicit `none` reasons, the
backend session guard, focused Python source guards, the bootstrap ledger proof
and the existing length guard.
Exact paths are checked, without wildcard entries that survive file moves.
The [guard tests](test_relevant_checks.py) require every component area to have
an entry and every mapped path, spec and project to exist. Update the map with
the source move/removal; new PostgreSQL declarations require no map edit.

The [coverage guards](test_relevant_checks_coverage.py) also walk every tracked
production file in `app/frontend/` and `app/backend/`, including tree-root files,
static assets, generated code and configuration. Named coverage resolves by the
longest matching exact file/directory prefix; ties retain all named proofs.
Browser areas with specs, a Go file's own package with declared `_test.go` tests
(including its PostgreSQL proofs), source guards, focused Python guards, or
`nightly_only: [{paths: [...], reason: "..."}]` count. Browser `none` alone,
generic lint, the file-length guard, the ordinary tier and whole Vitest do not.
Guards can declare `coverage_paths` to certify fewer paths than their conservative
selection triggers; empty coverage paths keep a scanner selected without treating
it as a behavioural proof for every file it scans. No existing selection is
narrowed by this resolution; the broad importer and ancestor selections remain.

An existing unmapped production file makes both the API and CLI refuse selection,
naming every unmapped changed file and how to map it. Existing untracked additions
are checked too, before staging. Exemptions only affect this coverage requirement:
missing/deleted names still select surviving consumers; files outside the two
production trees keep their current discovery. Documentation means a
case-insensitive `.md`/`.rst` extension, or the entire extensionless name
`README`/`CHANGELOG` (case-insensitive). A name prefix alone never exempts code or legacy `.txt`
notes; those notes have explicit nightly mappings. Test exemptions follow the
case-sensitive `_test.go` suffix reserved by Go and the configured frontend
Vitest pattern `.test.js` outside `dist`. Other `.test.*`/`.spec.*` suffixes do
not establish test ownership in the production trees. Fixture markers
`testdata`, `__tests__` and `__snapshots__` must be exact parent-directory
components, never the leaf filename or a similar name. Direct test changes
retain their existing selection. Every `.spec.ts` in the six-project config's
literal testDir, including opt-in setup specs, must belong to a browser area. The manual manifest
and `manual_specs` directories are excluded; Visual Guardian, cookie isolation
and the explicit native manual config are separate suites, outside this matrix.

`exceptions` starts empty. An unavoidable temporary exception requires exactly
`{scope: "exact/existing/file", reason: "...", owner: "...", expires: "YYYY-MM-DD"}`.
Directories, globs, duplicate scopes, missing/blank fields, malformed dates and
expired entries fail validation. Expiry is inclusive through the stated day.
Exceptions waive only that exact file and must be reviewed by the gate.
Inheritance is not branch coverage: a review names the assertion for each new
route, exported behaviour or changed branch, or requires a new check.

Feature directories under `app/components/<name>/` participate in the same Go,
frontend import, language-source, permission and route-doc discovery. Each needs
its own browser-area entry with specs or a justified `none`. Central Python and
browser test locations stay unchanged. Pass both paths of component renames.
The scanners tolerate an absent inventory root in fixtures and older layouts.
QA's Go package pattern requires the checked-in `app/components/.gitkeep` until
a component or the contract README preserves that directory; individual
component entries must exist.

The [import checker](import_boundary_checker.py) uses the planner's Go and
frontend resolvers through the unchanged `check_import_boundaries.sh [--strict]`
entry point. Cross-component dependencies are public entries listed as
`- components/<name>` under `## Dependencies` in the owning README. Computed
imports need explicit targets and a reason in
[component_import_registry.json](component_import_registry.json), keyed by
`repository-relative-source:line`; those targets still receive every boundary
check. The eight accepted Go tree imports in three files are exact pins, even
in strict mode, and cannot grow. The tree migration removes them.
JS/TS imports come from `es-module-lexer` through
[`frontend_import_lexer.mjs`](../../server_tools/scripts/frontend_import_lexer.mjs),
with one Node process for the complete source batch per guard or planner run.
The shared Node dependency loader honors an absolute `FILTEREST_NODE_MODULES_ROOT`;
direct Python invocations need the same installed development packages as Node
tools. Missing Node/packages, parse errors and incomplete helper responses fail
discovery instead of returning an empty scan. `import.meta` is not an import edge.
Template text, comments, ordinary strings and regex bodies are ignored; every
`${…}` expression remains code, including nested templates and regexes after
blocks. CommonJS calls retain their existing coverage through a same-width
`require`-to-`import` copy parsed by the lexer. For lexer 2.3.1's commented keyword
property/division bug, the existing ESLint parser identifies property names for
same-width normalization before retrying the lexer; no custom JS tokenizer is used.
CSS keeps its own comment/string rules: `//` in an unquoted URL is not a line comment,
so later same-line `@import` rules remain visible to guards and test selection.

**Guarantees and boundaries.** Discovery guarantees every import reported by
`es-module-lexer` for JS/TS and every CSS `@import` per CSS Syntax Level 3,
including decoded identifier/path escapes, ASCII case-insensitive names,
comments and trailing layer/supports/media lists. Out of scope are source that
the project's own parsers or linters reject, imports assembled at runtime beyond
the computed-import registry rule, and code built deliberately to evade a
developer guard. The import rules are a developer aid; review remains the backstop.

The [temporary canary](../fixtures/component_canary.json) is shared by Python
and Go tests: it exercises source discovery and detects skipped tests, orphaned
keys, missing browser coverage and forbidden imports. It never installs a real
component or registers an application route.

Each shared browser component has one canonical area rule whose `drivers`
record regular expressions for its selectors, test IDs and helper calls. Include
every spec that drives it in that rule's `specs`, even when another area also
selects the spec. The map's static guard scans nested browser specs, ignores
comments, recognizes named helper aliases (including browser callbacks), and
excludes setup and manual-only proofs; a new consumer or a removed mapping fails
with a spec and line number.
Record new selectors or helper wrappers in the owning rule when they are added:
category panel IDs, headings, test IDs and category helpers belong to filtering;
body mode-class writes, color-scheme emulation used for theme checks and visual
theme helpers belong to themes. Mode-class reads and media emulation solely for
unrelated checks do not establish theme coverage; record such decisions with
file:line evidence.
Authentication includes login-helper callers because an unavailable saved
session can send them through the sign-in UI; this is explicit consumer coverage.

Discovery does not evaluate computed import names or assembled migration
filenames. Keep their coverage in the owning browser area or add a literal
reference in the proof; whole-tier integration remains confirmation. The map
does not claim that an explicit `none` area has browser coverage.

Step 1 needs no worktree-instance tool. A capable supervisor must use this
worktree's source and a verified matching native test target for printed browser
commands; set `FILTEREST_E2E_BASE_URL` explicitly when needed. The planner neither
provisions that target nor proves its identity. When a worker cannot bind sockets,
record the heavy commands as pending and have the supervisor run them before
review. Never count a PostgreSQL opt-in skip or an unavailable browser fixture
as a pass; full integration/nightly commands remain available above.

After changing bootstrap generation, its ledger or a generated contract's
allowlist, run the whole `app/testing/python` suite above, in addition to focused
tests. In a configured native checkout the interpreter is
`data/runtime/python/venv/bin/python`; database replay remains opt-in.
