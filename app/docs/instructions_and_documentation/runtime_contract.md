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

## Future portability work

A resource contract can make a later Apple container, Podman or Kubernetes
adapter smaller. These adapters, a generic runtime selection flag, a
`DATABASE_URL` connection contract, split migration/bootstrap/serve lifecycle,
and verified multi-architecture application **and database** OCI images remain
separate proposals. Existing Linux release assets do not prove that complete
OCI stack contract. Prefer a bounded extension of the present CLI and
resolvers when a concrete deployment requires it.
