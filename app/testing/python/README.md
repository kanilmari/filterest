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

Ordinary publication batches run `ordinary`. Run `heavy-installation` once per
night. Before every batch that changes installation or recovery areas, the
supervisor runs the **full suite**, using the third command. No category option
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
needs the full pre-publication check above. Pass repository-relative changed
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
FILTEREST_TEST_DISPOSABLE_POSTGRES=1 flock /tmp/filterest_pg_suites.lock ../../../data/runtime/python/venv/bin/python -m pytest test_bootstrap_ledger_postgres.py
```

Keep disposable PostgreSQL suites under that lock: their harnesses use fixed
ports and must run one at a time. Without the opt-in or test binaries, they skip.

After changing bootstrap generation, its ledger or a generated contract's
allowlist, run the whole `app/testing/python` suite above, in addition to focused
tests. In a configured native checkout the interpreter is
`data/runtime/python/venv/bin/python`; database replay remains opt-in.
