# Python Test Categories

`python -m pytest app/testing/python` collects automated tests only. The category
summary printed at the end explains what those tests belong to:

- `release-artifact`: Filterest generation/publication, public bootstrap, and
  release-evidence contracts.
- `agent-workflow`: an extension category for downstream maintainer suites; a
  plain Filterest checkout may collect zero tests in this category.
- `platform-tooling`: the remaining local platform, migration,
  shell-compatibility, and validation helpers.

Run one category with:

```bash
python -m pytest app/testing/python --python-category release-artifact
python -m pytest app/testing/python --python-category agent-workflow
python -m pytest app/testing/python --python-category platform-tooling
```

These are ownership/reporting categories, not claims about process isolation.
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
