<!-- runtime_contract.md -->
<!-- Describes the runtime resource and lifecycle contract implemented today. -->
<!-- Connects the public CLI, configuration resolvers and backend startup. -->
<!-- Prevents configured resources from being mistaken for verified live state. -->

# Filterest runtime contract

This document describes the current public implementation. Native startup and
Docker Compose already share Filterest application source and database behavior.
It does not introduce a new adapter framework or change installation defaults.

## Inspect configuration without connecting

From the installation root:

```bash
./filterest status --runtime-only
./filterest status --runtime-only --json
```

The direct Python entrypoint is
`app/server_tools/agent_tools/dev_status.py --runtime-only`. It resolves source
paths from its own location, independently of the working directory. The public
launcher selects the installed Python environment.

The runtime report reads configuration and checks whether resolved paths exist.
It creates no homes and makes no database, SSH or HTTP connection. A missing
home is reported, not repaired. The existing Python launcher may maintain
bytecode caches under its configured runtime cache; this is not initialization
of application data or protected homes.

`profile.configured` contains a recognized `FILTEREST_INSTALL_PROFILE`:
`admin`, `development` or `docker`. An absent setting is `not_configured`;
an unrecognized value is `unknown` and is not echoed. A DB host named `db`
does not establish a Docker profile. This is configuration evidence, not proof
of which process, container or database is currently serving requests.

`--json` and `--strict` retain their meanings. Exit codes are 0 for a completed
check without a blocking error, 1 for an error and 2 for warnings with
`--strict`. Missing paths or an unknown configured profile produce warnings;
`not_checked` readiness alone is not a failure. Configuration errors are
reported without echoing protected values.

Normal `./filterest status` still performs its existing app/DB compatibility
inspection and optional shared-development storage check. It now includes a
`runtime_contract` section; only `--runtime-only` skips those live probes.
Existing normal-status fields, checks, warnings and exit codes are preserved.

## Resources and precedence

The report reuses
[dev_status_path_resolver.py](../../server_tools/lib/dev_status_path_resolver.py)
and [filterest_paths.py](../../server_tools/lib/filterest_paths.py).
Do not duplicate their layout detection or protected-home checks.

| Resource | Current source of truth |
| --- | --- |
| Application source | Resolved canonical `app/` directory |
| Installation/project | Existing nested/flat/embedded layout resolver; explicit `FILTEREST_PROJECT_ROOT_OVERRIDE` when used |
| Projects | `FILTEREST_PROJECTS_HOME` / `projects_home` |
| Protected keys | `FILTEREST_KEYS_HOME` / `keys_home` |
| Runtime data | `FILTEREST_RUNTIME_DATA_HOME` / `runtime_data_home` |
| Media and deleted media | Existing layout-aware storage resolver; nested installation `data/storage` and `data/storage_deleted` |

The report labels these paths `tooling_and_layout_configuration`. In particular,
`runtime_data_home` is a **tooling home**, not a universal backend relocation
setting. The Go backend's `runtimepaths.Resolve` currently derives its own
runtime root from the installation layout: `data/runtime` for a nested public
installation and `runtime` for the legacy/private layout. An Easelect tooling
home may instead resolve to `data/runtime-data`. The backend storage and other
runtime roots retain their existing layout rules; setting a HOME value does not
claim to relocate all backend state. No second Go path resolver is implemented
by the status command.

The established path files are `filterest.paths`, `filterest.paths.local` and,
for nested installations, `config/filterest.paths`. The resolver applies those
in order and then explicit HOME environment overrides, including its existing
`*_HOME_CONFIGURED` distinction. Existing maintainer/operations homes and
`EASELECT_*` compatibility rules remain unchanged.

The status environment merges the protected runtime env file, then the
development env file, then process environment. Protected env/TLS locations
remain owned by
[easelect_private_paths.py](../../server_tools/lib/easelect_private_paths.py).
The existing launcher selects installed startup profiles from its env files;
a status process override describes the status configuration, not a verified
running process or a change to launcher selection.

Database connections currently use `DB_HOST`, `DB_PORT`, `DB_NAME` and
`DB_SSLMODE`. SSL defaults to `disable` for `ENVIRONMENT_TYPE=dev` and
`require` otherwise. The new runtime section reports unset host/port/name as
null rather than asserting an active target. A URI/DSN pasted into a target
field is redacted instead of exposing embedded credentials.

The backend uses five roles: `admin`, `readonly`, `confidential`, `basic` and
`guest`, configured through `DB_<ROLE>_USER` and `DB_<ROLE>_PASSWORD`.
The runtime section exposes only `user_present` and `password_present` booleans,
never their values. Presence does not prove authentication or permissions.
No `DATABASE_URL`, `CONFIG_DIR` or new generic directory aliases are implemented
by this change.

## Lifecycle and live health

Existing public commands remain the entrypoints:

- `./filterest setup --profile admin` installs for prebuilt administration.
- `./filterest setup --profile development` prepares development dependencies.
- `./filterest start` dispatches through the installed profile.
- `./filterest docker start|stop|status|logs` manages the Docker Compose stack.
- `./ctl` remains the established native compatibility entrypoint.

The application startup path can run migration and bootstrap work, permission
synchronization and deferred metadata refresh. Startup is therefore not a pure
`serve` operation. Explicit independent `migrate`, `bootstrap` and `serve`
commands are a proposal, not an available contract.

`GET /health` is liveness. Protected `/system/ready` checks readiness, including
database/schema state; successful liveness alone does not establish readiness.
The runtime-only report labels both `not_checked` and does not claim a running
identity. Readiness protections and existing version compatibility checks are
unchanged.

Implementation anchors:
[public CLI](../../filterest),
[database roles](../../backend/core_components/database.go),
[startup](../../backend/core_components/application_runtime/application_runner.go),
[runtime roots](../../backend/core_components/runtimepaths/runtime_paths.go),
[health/readiness](../../backend/core_components/router/health_handler.go).

## Log maintenance and automatic retention

Fresh installations enable automatic retention. Public migration
`20261009000083_add_automatic_log_retention.sql` adds missing configuration on
upgrades, including installations previously configured by a private migration.
It preserves existing settings, including an explicit automatic opt-out, and
adds a default only when the policy array is canonical and the log table has no
policy already. Table identity ignores case and surrounding Unicode whitespace,
just as the policy reader does; disabled policies and custom durations are
preserved. Generated policy names gain an unused numeric suffix when an existing
name is taken. The reader
refuses multiple policies for the same normalized table before deleting any rows.

**When defaults are not added:** the stored setting must be a JSON array of
objects using only these exact canonical member names: `name`, `enabled`,
`table_name`, `timestamp_column`, `filter_column`, `filter_value`, `mode`,
`keep_years`, `keep_days`, `description`. Alternate spellings such as `Name`
or `TABLE_NAME` (which the reader still accepts), extra members, a non-array
value (including JSON or SQL null), or a non-object array entry cause the entire
stored setting to remain byte-for-byte untouched. The migration emits a NOTICE
containing “default log policies were not added”; existing retention continues
for any configuration the reader already accepted. This is a member/shape
check, not full policy validation; invalid canonical policies still need repair
through Settings. Replaying the migration preserves these rules.

To add the skipped defaults by hand, open the retention policy setting
(`data_retention_policies`) in **Settings** using the normal interface or
permission-checked application API. Preserve every existing policy and append
the example below with `keep_days` set to **90** once for each missing table
in this list; replace its `table_name` and `timestamp_column` accordingly:

| Log table | Timestamp column |
| --- | --- |
| `system_audit_log` | `created_at` |
| `system_transaction_log` | `created_at` |
| `system_log` | `created` |
| `dev_agent_task_runs` | `started_at` |
| `ai_usage_logs` | `created_at` |
| `mcp_query_log` | `created_at` |

Run `./filterest maintenance data preview` first to see the existing normalized
table and policy names. The reader accepts case-insensitive member spellings
and normalizes case/Unicode whitespace in table values. Keep disabled and custom
policies; add only tables absent from that preview. Give each addition a unique
`name` (`log-retention-<table>` with an unused numeric suffix if needed), ignoring name
case and surrounding whitespace when checking uniqueness. Repair a non-array
or invalid policy setting through Settings first, retaining its intended rules;
then preview with the command below before enabling automatic deletion. No
server restart is required.

The default is **90 elapsed days** for `system_audit_log`,
`system_transaction_log`, `system_log`, `dev_agent_task_runs`, `ai_usage_logs`
and `mcp_query_log`. Missing optional tables are skipped. Only finished agent
runs with status `succeeded`, `failed` or `canceled` expire, and both their start
and finish must precede the cutoff; queued, running and awaiting-review work is
retained. Deletion records (`deletion_log`) remain outside automatic retention:
they prevent old exports from restoring intentionally deleted content.

The background round starts 90 seconds after server startup and repeats every
24 hours. It deletes only rows whose configured timestamp is **strictly before**
the cutoff; rows exactly at the cutoff, newer rows and null clocks survive.
Each log transaction removes at most 1,000 rows and commits before another
batch begins. A round attempts at most 100 batches per log policy (100,000 rows)
within a shared 20-second budget. Automatic batches skip locked rows; table-lock waits are
limited to 100 milliseconds, statements to 750 milliseconds and each batch to
one second. A busy table or backlog can therefore take later rounds to clear.
The existing allowlist limits deletion to configured tables and permitted clocks.

Administrators change retention in the **Settings** dataset (`system_config`),
using the normal permission-checked interface or application API. The boolean
setting `automatic_data_retention_enabled` switches the daily round on or off.
The JSON setting `data_retention_policies` is an array; edit the relevant entry
while preserving the others. For example, this entry keeps audit history for
180 days:

```json
{
  "name": "log-retention-system_audit_log",
  "enabled": true,
  "table_name": "system_audit_log",
  "timestamp_column": "created_at",
  "mode": "rolling_days",
  "keep_days": 180
}
```

Days must be positive whole numbers (at most 106,751); each day means 24 hours,
including across daylight-saving changes. Set an entry's `enabled` to `false`
to retain that table's history indefinitely. The existing `rolling_years` and
`calendar_years_plus_current` modes still use positive whole `keep_years`:
the former subtracts calendar years, the latter retains the current local year
plus the specified full years. Do not mix `keep_days` and `keep_years`.
Shortening a policy makes older rows eligible at the next round; lengthening it
cannot recover rows already deleted. Changing a setting needs no server restart.

Preview policies and explicitly request a log batch through the public CLI:

```bash
./filterest maintenance data preview
./filterest maintenance data prune --policies log-retention-system_audit_log --yes
```

Preview counts every matching row without deleting it; an explicit policy prune
deletes at most one log batch per policy, so repeat if needed. The separate
`./filterest maintenance logs` command remains available for explicit cutoff
pruning, including deletion records; it does not configure automatic retention.

Successful GET/HEAD reads of symbol assets (`/symbol-assets/<key>.svg`), the CSRF token
(`/api/csrf-token`), public languages (`/api/ui-languages`), product identity
(`/api/product-identity`) and the administrator notice stream
(`/api/admin/update-notice/stream`) no longer add routine audit rows. Matching
requires the exact registered handler and route; the symbol route covers only
one SVG asset key. For the notice stream, normal lifetime expiry is routine. An
initial snapshot/admission failure returns HTTP 503 before streaming; a later
snapshot or account-check error, a write error the server observes and an access
revocation keep the request's audit event with `success=false`, even when its
HTTP response has already started with 200. Two edge cases are not yet exact
(ticket #943): a client that disconnects while the server reads the snapshot or
the account can be recorded as unsuccessful, and a failure that appears only
while flushing buffered output is not detected.
Writes, administrative changes and authentication security events remain audited.

## Future portability work

A resource contract can make a later Apple container, Podman or Kubernetes
adapter smaller. These adapters, a generic runtime selection flag, a
`DATABASE_URL` connection contract, split migration/bootstrap/serve lifecycle,
and verified multi-architecture application **and database** OCI images remain
separate proposals. Existing Linux release assets do not prove that complete
OCI stack contract. Prefer a bounded extension of the present CLI and
resolvers when a concrete deployment requires it.
