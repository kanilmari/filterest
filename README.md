<!-- README.md: product README for the maintained Filterest repository. -->
<!-- It connects users and developers with the platform, setup path, and public project boundaries. -->
<!-- It travels with source installations and public releases. -->
<!-- Keep claims limited to capabilities and workflows that Filterest currently ships. -->

# Filterest

Filterest is a multilingual application platform built around a robust,
unified PostgreSQL data-management core. Define datasets, fields, relations,
permissions, and media once, then use the same data through ready-made browser
applications or purpose-built custom applications.

## From Data To Applications

### Quick Start

```bash
./filterest docker start   # First start and later starts
./filterest docker status  # Show application and database status
./filterest docker stop    # Stop while preserving data
```

Every dataset can become a usable application without a separate frontend:

- **Table view** is for scanning, comparing, selecting, and editing records.
- **Card view** presents the same records as visual, media-friendly items.
- **Article view** opens one record as a full page with fields, relations,
  images, and attachments.

These views share the same search, filters, permissions, relations, and
multilingual data. Changing the presentation does not create another copy of
the data or another administration system.

When a workflow needs more than the built-in views, Filterest can be extended
with compiled custom application modules that use its authentication,
permissions, routing, dataset APIs, translations, and file handling. The
current Filterest release does not yet provide a drop-in runtime plug-in loader.

```text
projects/
└── my_project/
    └── project-owned files
```

The configurable `projects_home` is the portable gathering point for those
project-owned files. Directory presence does not register a project or grant
access; the database folder hierarchy remains authoritative.

## Core Capabilities

- PostgreSQL-backed datasets, fields, foreign-key relations, and metadata.
- Browser-based create, read, update, delete, search, filter, and sort flows.
- Table, card, article, and other data-driven views selected per dataset.
- Related records, image galleries, file attachments, and inline PDF previews.
- Multilingual interface text and multilingual field values.
- Group, capability, and dataset permissions for public and authenticated use.
- Hierarchical projects and folders for organizing datasets.
- PostGIS-backed point locations with a built-in OpenStreetMap-based Map view.
- Optional semantic search and AI integrations through separately configured
  provider credentials.

### Semantic-search privacy boundary

Semantic search is optional and ordinary dataset views work without AI
credentials. Outbound row content is fail-closed: no field is sent to the
configured Google or OpenAI embedding service until an administrator explicitly
allows that current text field in the embedding management view. Missing or
stale metadata never falls back to all queryable text fields.

New rows and edits to allowed fields create content-free, durable refresh jobs
in the installation's own database. A leased background worker calls the
external provider after the business transaction commits, retries temporary
failures, and rejects stale results before storing vectors. Queue rows contain
identifiers and retry state, not source text or provider responses.

Administrators must still review the provider's processing terms and their own
data-protection obligations before allowing personal or otherwise sensitive
fields. Cost preview and provider-specific policy guidance remain future work.

## Geospatial Data With PostGIS

Filterest uses PostGIS for location-aware datasets. The built-in **Map view**
plots point records on OpenStreetMap tiles and can recognize PostGIS WKT/EWKB
point values as well as conventional `latitude`/`longitude`, `lat`/`lng`, and
similar coordinate-column pairs.

The current database-backed map contract is a WGS 84 point column:

```sql
position postgis.geometry(Point, 4326)
```

For example, Helsinki can be represented as `POINT(24.9384 60.1699)` — WKT
uses longitude before latitude. A read-only inspection can extract the values
without changing the dataset:

```sql
SELECT
    postgis.ST_X(position) AS longitude,
    postgis.ST_Y(position) AS latitude
FROM your_location_dataset
WHERE position IS NOT NULL;
```

The current Map view claim is deliberately limited to point locations; line
and polygon rendering are not yet part of this documented contract.

## Current Status

This repository contains the Filterest application platform. Releases remain
subject to the compatibility and upgrade policy documented in this repository;
review release notes and backups before upgrading important installations.

This repository is the maintained source for Filterest and its development
tools. Application code, migrations, tests and product documentation live under
`app/`; the installation root contains the portable launchers. Make product
changes in this repository and retain its existing public history.

[The Filterest Constitution](app/docs/constitution/constitution.md) defines the
product principles. Suggestions and reproducible reports are best opened as
[GitHub Issues](https://github.com/kanilmari/filterest/issues); see
[CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidance.

## One Portable Filterest Folder

A Filterest installation is one directory that can be moved or copied as a
unit. Maintained application source stays under `app/`; the installation root
provides stable launchers and the Compose bridge. Exactly five sibling
directories belong to the operator and remain outside maintained application
source:

```text
filterest/
├── app/        maintained application source, versions, migrations, and tests
├── config/     installation path contracts and non-secret configuration
├── keys/       protected settings, credentials, and local TLS identity
├── projects/   project-owned files
├── data/       database, uploaded files, runtime output, caches, and test output
├── backups/    installation-owned backups
├── filterest   primary root launcher
├── ctl         compatibility control launcher
└── compose.yml root bridge to app/docker/docker-compose.yml
```

Run commands from the outer `filterest/` directory. The root launchers validate
`app/`, pass the absolute installation root to the runtime, and then delegate to
the maintained tools inside `app/`. No sibling repository or parent-directory
helper is required.

The complete folder works without `.git`: copying it preserves the same root
commands, native installation, and Docker installation. Do not copy an existing
operator's `keys/`, `data/`, or `backups/` into a different security boundary
unless that transfer is intentional and protected. Git metadata is required
only for the automated fast-forward update command described below.

## Installation Options

The recommended portable path uses Docker. It works the same from a GitHub
checkout or a same-version folder copied without Git. By default, the first start creates
the five operator directories, generates protected settings in
`keys/docker.env`, creates the local TLS identity under `keys/tls/`, builds the
application and PostgreSQL images, and waits until both are healthy. Generated
secrets are never printed.

Docker Engine/Desktop with Docker Compose **2.20.0 or newer** and Python 3 is
required. Compose's [recursive `include` support](https://docs.docker.com/compose/how-tos/multiple-compose-files/include/)
sets that minimum; the deployment fragments use interpolated include paths and
`extends: file:`. Default and host-proxy installations were started with Docker
29.8.2 and Compose v5.6.0, and the default configuration renders identically
with Compose 2.40.3.
For inspection, use `docker compose --env-file keys/docker.env config`.
`config --no-interpolate` cannot resolve the selected include paths and fails;
normal `config` can display secrets, so keep its output protected.

The current Docker stack uses installation-owned bind mounts, not named
volumes. It mounts `config/`, `keys/tls/`, `keys/filterest_runtime/`, `projects/`,
`data/storage/`, `data/storage_deleted/`, `data/runtime/`, `data/postgres/`, and
`backups/` into the appropriate application or database container paths. The
application image and its `/filterest/app` source are read-only at runtime.
Docker Compose reads its generated database and session secrets from
`keys/docker.env`; an OpenAI key saved by an administrator lives in the
write-limited `keys/filterest_runtime/runtime_environment.env` file so it
survives a container rebuild without making source writable. Setup moves an
existing OpenAI key from `keys/docker.env` there once and clears the old copy.
The old root `.env` location remains only a guarded one-time migration input.

Native Linux setup remains available through two profiles:

The setup command asks which kind of installation you need:

- **Browser administration** is the recommended choice for normal use. It
  installs PostgreSQL 16, PostGIS, pgvector, and a checksum-verified Filterest
  binary. The binary uses the supported host's glibc 2.34-or-newer C runtime;
  no glibc or compiler runtime is copied into the release asset. It does not
  install Go, Node.js, npm packages, or browser-test tools.
- **Development and administration** installs the same runtime plus Go 1.26.5,
  Node.js 24, source dependencies, and the Chromium browser used by the
  automated UI tests.

Automatic host setup currently targets Ubuntu 22.04 or newer, Debian 12 or
newer, and compatible APT-based Linux distributions. It requests `sudo` only
when host packages or the initial PostgreSQL administrator role are missing.
Normal Filterest use after installation runs as the current user and does not
require `sudo`.

## Installation And First Start

```bash
git clone https://github.com/kanilmari/filterest.git
cd filterest

# This same command is used after copying the filterest folder without Git.
./filterest docker start
```

Open `https://localhost:8100/first-run`. The local certificate is self-signed,
so the browser may ask you to accept it once. `./filterest docker stop` preserves
the database, uploaded files, runtime state, and backups in their bind-mounted
directories inside the same outer `filterest/` folder.

For native installation on a supported APT-based Linux system, start with
`./filterest start` and choose a profile, or use the explicit setup commands
`./filterest setup --profile admin --yes` or
`./filterest setup --profile development --yes` for an explicit unattended
profile choice. Both native profiles use the same browser address. The admin
binary retains production-only routes while using direct local TLS for secure
browser sessions. Its verified binary, setup markers, and logs live under
`data/runtime/`; protected native environment and TLS files live under
`keys/filterest_runtime/`. Source, templates, versions, and database bootstrap
inputs continue to come from `app/`.

On first browser access, Filterest opens a two-section form. First choose the
visible development, testing, quality-assurance, or production purpose and the first
administrator's sign-in verification method; choose whether ordinary users may
use the same sign-in and public name, then create the administrator login name,
display name, email address, and password. Both name suggestions are editable;
administrator names always differ. Email verification uses Postmark and
requires a free external Postmark account. Password-only, fixed-PIN, and
standard TOTP authenticator sign-in do not require an email provider.

The form is available only while the server-owned first-run setting is pending
and no login-ready admin exists. A successful submission saves the environment
purpose, verification factor, account, and first-run closure as one
transaction; later visits go to normal login. A DEV/TEST/QA purpose changes the
visible label but cannot downgrade the security boundary of the production-
locked admin binary.

The bundled public seed contains synthetic multilingual example datasets and
media only. See `app/server_tools/public_bootstrap/README.md` for the seed and
first-administrator boundaries.

If an installation later loses access to its administrator accounts, `SECURITY.md`
describes the operator-only command that restores an existing administrator and,
when none is usable, creates a new one.

### Behind your own web server

The default Docker installation continues to serve local HTTPS at
`https://localhost:8100`, publish PostgreSQL at `127.0.0.1:5433`, generate an
installation identity, and let Docker allocate its network. The settings below
are optional. They use the same public setup/start commands and folder layout.

For a host nginx or another host web server that terminates public HTTPS,
create a protected settings file before the first setup. Replace the example
identity, public URL, port and network with your own values; no domain-specific
configuration belongs in application source:

```bash
mkdir -p keys
chmod 700 keys
(umask 077; cat > keys/docker.env <<'ENV'
FILTEREST_EDGE=host-proxy
COMPOSE_PROJECT_NAME=my-site
INSTANCE_NAME=my-site
APP_PORT=18100
BASE_URL=https://example.invalid
FILTEREST_PUBLISH_DB_PORT=false
FILTEREST_NETWORK_SUBNET=172.30.99.0/24
FILTEREST_NETWORK_GATEWAY=172.30.99.1
ENV
)
./filterest docker setup
./filterest docker start
```

For an existing installation, edit its `keys/docker.env` instead of replacing
it; preserve the database/session secrets and both identities. Setup fills
missing secrets, keeps explicit identities and public URLs, and preserves those
values on later starts. You can also supply `--project-name` and
`--instance-name` to setup, or the same two identity environment variables; a
conflicting existing identity is refused. Compose project names start with a
lowercase letter or digit and use lowercase letters, digits, `_` and `-`.
New instance names start with a letter or digit and use letters, digits, `.`, `_`
and `-`. New public URLs must be absolute HTTP/HTTPS URLs without credentials,
whitespace, query strings, fragments or `$` interpolation. Established Docker
installations retain their stored instance names and public URLs under the older
runner's rules. A missing instance name takes the project's name only before
first setup. An established installation with an empty or missing instance name
keeps its effective `filterest-local` cookie identity, written explicitly.
The installation marker (`FILTEREST_INSTALL_PROFILE=docker`) also distinguishes
an established `filterest-local` project from a template placeholder; setup
generates a unique name for the placeholder even in a pre-created settings file.
Before starting, the runner inspects running and stopped containers and networks
and refuses a project whose working-directory label names another installation
folder. Failed or incomplete Docker inspection also refuses the start.

Host-proxy mode keeps the application on plain HTTP at `127.0.0.1:<APP_PORT>`
and requires that loopback binding. It sets local TLS off and generates no
self-signed certificate; existing local certificates remain in place. Configure
your host web server to proxy to `http://127.0.0.1:18100` in this example.
`BASE_URL` is the public browser address and must be HTTPS: production session
cookies are always Secure. Without a public URL, setup derives
`http://localhost:<APP_PORT>` and warns that it cannot support public secure
sessions; host-proxy setup also warns about any non-HTTPS or loopback URL. Readiness
checks use the application's local HTTP address, independently of that public
URL. Set `FILTEREST_EDGE=local-tls` or remove the setting to return to local
HTTPS, with certificate generation when needed.

`APP_PORT` or `--app-port` chooses the application loopback port; `BASE_URL` or
`--base-url` chooses its public HTTP/HTTPS URL. Changing the port preserves a
custom public URL. `DB_PORT` or `--db-port` chooses the PostgreSQL host port
when published. Set `FILTEREST_PUBLISH_DB_PORT=false` to omit that host port
entirely; the application still connects to PostgreSQL through the internal
network. Omit that setting or set it to `true` for the existing published-port
behaviour.

Omit both network settings to let Docker allocate the project network. To pin
it, provide a canonical IPv4 CIDR subnet with at least six usable addresses;
the gateway defaults to its first
usable address or may be set explicitly to another usable address in the subnet.
Loopback, multicast, link-local and other special-use/reserved ranges are refused;
use a free RFC 1918 private range. Public ranges produce a routing warning.
Pinned setup requires a running Docker daemon: setup and start
refuse ranges overlapping any existing Docker network, while allowing this
project's unchanged default network. Changing an existing project's subnet or
gateway, or switching between pinned and automatic allocation in either direction,
requires `./filterest docker stop` first so its old network no longer exists.
No network or
container is deleted by the collision check. Setup maintains the internal
Compose fragment selectors in `keys/docker.env`; configure the settings above
instead of editing those selectors.

Host web-server configuration, public certificates and renewal are operator
responsibilities. The header boundary below is required before trusting an
additional proxy peer; nginx/ACME provisioning and existing-site adoption are
separate work.

### Reverse-proxy client identity

When Filterest runs behind a host reverse proxy, client-IP headers are trusted
only from built-in Cloudflare ranges, loopback, and operator-configured exact
proxy peer addresses. Do not configure the protected trusted-proxy peer setting
until the edge overwrites forwarded client identity instead of appending or
passing through request-supplied headers.

The repository ships the two canonical nginx boundaries:

- `app/server_tools/nginx/filterest_cloudflare_real_ip.conf` accepts
  `CF-Connecting-IP` only from official Cloudflare source networks.
- `app/server_tools/nginx/filterest_sanitized_proxy_headers.conf` clears incoming
  client-identity headers and sends one verified address in `X-Real-IP` and
  `X-Forwarded-For`.

Install the Cloudflare source snippet in the nginx HTTP or server context and
the sanitized-header snippet in the application `location` before trusting an
additional proxy peer. With the host-proxy Docker binding, nginx reaches the
application from the Docker network gateway, rather than loopback. Pin a free
private subnet and gateway as above, then set `EASELECT_TRUSTED_PROXY_PEER_IPS`
in `keys/docker.env` to that exact `FILTEREST_NETWORK_GATEWAY` address (for the
example, `172.30.99.1`). Without that trust, visitors share the gateway's address
for rate limiting and login throttling. An automatically allocated gateway can
change when Docker recreates the network and invalidate the trusted-peer setting.
The setting accepts IP literals only, never a subnet or CIDR. Keep it blank when
no additional proxy peer has been proven to sanitize incoming headers.

For native installation, `config/filterest.paths` records the portable relative
homes for projects, protected keys, and runtime data. Relative paths start at
the outer installation root. The standard standalone contract keeps them in
the five operator-owned sibling directories shown above.

### Reconcile a self-managed migration

Before running any migration, startup checks the whole evidence-aware ledger and names
all failed or interrupted self-managed files. Removed/renamed files, source directories
removed from configuration and filename allowlists cannot bypass this refusal.
Stop every application process using this database and disable automatic restarts;
back up the database, inspect the SQL's effects and confirm no migration is still running.
Internal commits may have preserved part of the work even after a later rollback.

1. Read and archive the marker's `filename`, `applied_at`, `content_sha256`, `outcome`
   and `provenance` from `public.system_schema_migrations`, plus your inspection/decision.
   Use `./db --local "SELECT * FROM public.system_schema_migrations WHERE filename='FILE.sql'"`.
2. Choose `applied` only when every intended effect is complete: the command retains
   the filename/timestamp and clears evidence to unverified history. Choose `retry`
   after correcting the file and checking that reexecution is safe: it removes the marker.
3. Run the guarded SQL below from the installation root with the database owner's
   connection (replace the target placeholders; use protected libpq credentials or a password prompt).
   Set the expected hash and outcome from the archived marker, never from today's file.

```bash
psql -X --host=YOUR_DB_HOST --port=YOUR_DB_PORT --username=YOUR_OWNER_ROLE --dbname=YOUR_DATABASE \
  --set=filename=FILE.sql --set=expected_hash=MARKER_HASH \
  --set=expected_outcome=failed_self_managed --set=decision=retry \
  --file=app/server_tools/scripts/reconcile_self_managed_migration.sql
```

Use `interrupted_self_managed` for an interruption marker, and `decision=applied`
for completed effects. The command locks and checks exactly one unresolved runner row;
changed/missing evidence aborts. It never creates an execution hash. Verify the resulting
ledger, then start Filterest normally. Successful retries record their actual new bytes.

## Offline Installation Conformance

```bash
./filterest conform --snapshot saved-site.json --parameters deployment.json
```

This command compares saved, redacted evidence with the shipped public Compose
layout. It reads no installation settings, credentials or database, writes no
cache/log/temporary/settings files, and uses only `docker compose config`.
The Docker Compose CLI must be installed and support the shipped `include`
contract; a missing or failed CLI produces exit 2. No Docker engine is needed.
Inherited deployment, credential, proxy and Compose settings are discarded;
required credentials are synthetic and an empty environment file is explicit.

A deployment file is a JSON object containing an explicit absolute installation
root and Compose project identity, for example:

```json
{
  "installation_root": "/srv/example-installation",
  "COMPOSE_PROJECT_NAME": "example-installation",
  "INSTANCE_NAME": "Example.site",
  "FILTEREST_EDGE": "host-proxy",
  "APP_PORT": 18123,
  "BASE_URL": "https://example.invalid",
  "FILTEREST_PUBLISH_DB_PORT": false
}
```

Other allowed parameters are `DB_PORT`, `APP_BIND_HOST`, `DB_BIND_HOST`,
`FILTEREST_NETWORK_SUBNET`, `FILTEREST_NETWORK_GATEWAY`, `SITE_NAME` and
`SITE_SLUG`. Omitted options use public Compose defaults; instance identity
falls back to `filterest-local`. Names, paths and ports are compared exactly,
including an installation's established instance name. Pinned ranges and
fragment selection use the same policy as Docker setup. Credentials and direct
fragment/file selectors are refused. Keep input files outside `keys/`.

The saved snapshot uses site-shape schema 1: `schema`, a timezone-aware
`collected_at`, source identity (`domain` and `ssh_target`, reported only as a digest),
and `sections` containing `{ "exit": 0, "text": "JSON..." }`.
Required sections are `app_inspect`, `db_inspect`, `compose_shape`, and one
`network/<name>` inspection. The two container sections use the redacted
collector fields `mounts`, `host_config`, `networks`, `labels` and `env_keys`.
The Compose shape describes resolved service environment **keys**, and the
network declarations. Raw environment values and unrelated saved sections are
never printed. Extra image-inherited keys are allowed; missing declared runtime
keys and unsupported Compose declarations differ.

`application_identity` is an optional section holding the non-secret
`INSTANCE_NAME`, `SESSION_COOKIE_MODE` and `SESSION_COOKIE_NAME` settings;
only their combined digest is reported. `effective_configuration` is an optional
section with `algorithm: "filterest-conformance-facts-v1"` and `sha256`: the
SHA-256 of canonical redacted contract facts (sorted JSON keys, compact separators,
ASCII escaping), as returned by the standard renderer's `standard_facts` before
adding the effective-configuration check. This is a redacted shape digest,
independent of secret values, rather than Docker's secret-dependent config hash.
Automatic-network shape records allocation mode with an empty configured IPAM;
the actual allocated subnet, gateway and container addresses are checked separately.
Old snapshots without these optional sections remain **unknown**, never passing.
This command adds no collector; capturing resolved declarations and these digests
is a later evidence-collection step.

One deterministic JSON verdict reports observation time, source/input digests,
numbered checks, expected/observed facts, unknowns and exclusions. Checks cover
application/database mounts and access, ports, network authority/range/gateway,
Compose project/service/file ownership, application hardening, environment-key
coverage and identity/configuration digests. Exit 0 requires every check to match;
exit 1 means differences; exit 2 means invalid or incomplete evidence, while
retaining independent findings. Duplicate JSON keys are invalid, including in
section text. Every verdict has `execution_ready=false`: matching shape grants
no update authorization and proves no recovery, freshness, image identity,
directory ownership, nginx forwarding, certificates or backup consistency.
Operator-typed values remain outside the key-disclosure promise.

## Updating A Git Checkout

```bash
./filterest update --dry-run  # verify the published target without changing files
./filterest update            # back up, fast-forward, reinstall, and restart
```

The updater requires a published stable release, matching build identity and a
clean tracked checkout. It preserves the five operator-owned directories.
Read [Installation Update And Recovery](app/docs/instructions_and_documentation/Installation_Update_And_Recovery.md)
for prerequisites, refusals and the complete recovery procedure before updating.

### Docker installations

The [Docker update procedure](app/docs/instructions_and_documentation/Installation_Update_And_Recovery.md#docker-installations)
covers older releases; [roll back a Docker update](app/docs/instructions_and_documentation/Installation_Update_And_Recovery.md#roll-back-a-docker-update)
with its exact command block after an unsuccessful update.

### Database recovery backups (Docker and native)

The [database recovery guide](app/docs/instructions_and_documentation/Installation_Update_And_Recovery.md#database-recovery-backups-docker-and-native)
owns packet contents, supported interfaces, authentication/key-disclosure limits,
replacement restore and legacy recovery. Keep the authentication key separately backed up.

## Development

Read the [Developer Guide](app/docs/instructions_and_documentation/DEV_GUIDE.md)
for shared coding conventions, QA and verification.

```bash
./filterest setup --profile development  # one-time toolchain and database setup
./filterest start     # build and run the local application
./filterest test-unit           # run frontend unit tests
(cd app && go test ./...)      # run Go tests
./filterest build               # build frontend assets
./filterest qa                  # run the broader project QA suite
./db_report workline board  # inspect the canonical workline observatory state
./db_task list        # inspect database-backed development tasks
./db --local "SELECT 1"  # read-only database inspection (same as ./filterest database)
./api_crud list-datasets  # dataset maintenance through the API (same as ./filterest data)
./worker_agent --help # inspect the optional local AI-worker command
./worker_agent --routine --list  # list reusable multi-step worker routines
./filterest asset-linking status  # inspect shared media-linking readiness
```

For an existing installation, install or refresh development dependencies
without reconfiguring its database, credentials or running services:

```bash
./filterest setup --profile development --dependencies-only --yes
```

This mode installs the declared Node and Go packages, the Python maintenance and
test environment, and Playwright Chromium. Python tool dependencies are maintained
in `app/server_tools/requirements.txt`, which the Python test requirements include.
Commands such as `./filterest database --local "SELECT 1"` use this installed
interpreter automatically; no manual virtual-environment activation is needed.
This mode does not mark database setup complete. Use `./ctl`
with an already configured runtime; a new installation uses full setup above.
The host needs Python virtual-environment support and Chromium's system libraries;
full development setup installs these host prerequisites too.

Track Filterest-owned tools and the dependency definitions (`package.json`,
`package-lock.json`, `go.mod`, `go.sum`, and Python requirements). Downloaded
third-party repositories, packages, virtual environments, toolchains, browser
binaries and caches remain outside Git. Internal Filterest tools are maintained
in `app/`; do not install another copy of this repository as a dependency.

The development profile installs Node dependencies under `data/runtime/node/`,
Go caches under `data/runtime/go/`, Python tools and tests under `data/runtime/python/`,
and browser binaries under `data/runtime/playwright/`. The root commands bind Vite, Vitest, Playwright, and the
other Node tools to that mutable location without creating a compatibility link
or cache below immutable `app/`. The browser-administration profile does not
install or use the source-development dependency tree.

Database-backed tasks and the browser Workline Observatory are part of
Filterest's development and administration surface. Their durable records stay
in the installation database. Worker output uses ignored local runtime
directories; copying the source does not copy another installation's workline
data or credentials. The worker command requires a
separately installed and authenticated supported AI command-line client.

For Codex, install the exact CLI version declared by `DEFAULT_CODEX_VERSION` in
`app/server_tools/agent_tools/worker_agent_defaults.sh`, then run `codex login`.
The worker launches the installed `codex` executable directly and verifies its
version before starting; it never downloads a package during a run.
`WORKER_CODEX_BIN` can select an explicit executable path, and
`WORKER_CODEX_VERSION` can select another deliberately installed exact version.
A missing executable or version mismatch stops the run.

A worker run bills the client's signed-in subscription unless it passes `--api`.
Before starting, the worker requires `codex login status` to report a ChatGPT
sign-in, or `claude auth status` a claude.ai sign-in, and it starts the client
without `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_USE_BEDROCK`,
`CLAUDE_CODE_USE_VERTEX`, `OPENAI_API_KEY` and `CODEX_API_KEY`. A client signed
in any other way stops the run; it never falls back to an API key. `--api`
keeps the environment and is refused when the backend has no key.
`run_status.txt` and the worker log record the billing mode.

A `--background` run leads its own process group, so it needs `setsid`; without
it the worker refuses `--background` and the foreground still works. The worker
reports success once the run's `worker.pid` names a running process or the run
has already finished successfully, and failure when the run recorded a failure
or ended without a result. If neither happens within 15 seconds, it reports the
start as unconfirmed and exits non-zero without sending any signal: the run may
still start, so check it with `--status` and stop it with `--stop`.

`--stop` ends the run's process group: TERM, then KILL after a grace, then a
check that the group is gone. Before every signal it confirms that the group is
still the run's: a process holding the leader's pid must have the start time
recorded at launch, otherwise nothing more is sent. A process that leaves the
group by starting its own session is outside this guarantee, and a run started
before process groups were recorded is stopped by its recorded pid only.

Reusable product routines live beside the worker implementation under
`app/server_tools/agent_tools/worker_agent/routines/`. A downstream composition
may set `FILTEREST_WORKER_ROUTINES_DIR` to add installation-specific routines;
those definitions are searched first, so a same-named private routine can
override the product default without hiding unrelated product routines.

Select both the model and reasoning effort when the result must be attributable
to a specific configuration (`xhigh` is Extra high):

```bash
./worker_agent family=codex --codex-model gpt-5.6-sol --codex-reasoning-effort xhigh "Review the change"
./worker_agent family=codex --codex-model gpt-6-astra --codex-reasoning-effort xhigh "Review the change"
```

`WORKER_CODEX_MODEL` and `WORKER_CODEX_REASONING_EFFORT` provide process defaults;
the corresponding CLI options take precedence. Omitting them retains Codex's
own configuration defaults. The wrapper records the requested settings and
verified CLI path/version in the log and `run_status.txt`, including background
runs. Check Codex's startup header in `worker_log_*.txt` for the effective model
and effort before attributing a review. The chosen account/model must support
the requested effort; errors are not silently retried with another model.

Local API maintenance commands default to `https://localhost:8100` and read the
protected account values from `keys/filterest_runtime/`. Deliberate process-level
overrides use `FILTEREST_API_BASE_URL`, `FILTEREST_API_USERNAME`,
`FILTEREST_API_PASSWORD`, and `FILTEREST_API_OTP_CODE`; `db_task` additionally
accepts its tool-specific `DB_TASK_BASE_URL`. Legacy `EASELECT_API_*` and ambient
`DEV_*` / `LOGIN_OTP_CODE` values are compatibility inputs only when the same
public implementation is structurally embedded in a private host-product source
checkout, so a standalone Filterest command cannot drift to the host's local
runtime or credentials merely because they exist in the caller's shell.

Keep user-facing features multilingual. Use the existing translation and
language-key workflows instead of hardcoding one-language UI text.

Product source and development tools are maintained directly in this repository.
The root launchers use this installation's own dependencies and configuration;
they do not require a parent or sibling development repository. A development
installation needs its own completed dependency setup before build and test
commands can run. PostgreSQL may be managed by the host or another service;
its location is an installation setting, not a source-repository dependency.

Run the release source checks, then validate the local Linux release-packaging
inputs, from this repository with:

```bash
./filterest release verify
./filterest release build --output-dir /tmp/filterest-release-build --check-only
```

The maintained builder and binary-license verifier live under
`app/server_tools/release/`. For the clean-source requirement, supported build
toolchains and actual package assembly, see
[Building Linux release assets](app/server_tools/release/BUILDING_LINUX_ASSETS.md).
The [release workflow](app/docs/publication/PUBLISHING.md) also provides
standalone candidate preparation, promotion and GitHub publication commands.
Each metadata or publication command plans by default and requires explicit
apply mode for writes. Product release and site deployment remain separate
operations.

The product principles, technical guides, design proposals, and release records
live under `app/docs/`; see [the documentation index](app/docs/README.md).

## Project And Contribution Model

Filterest is owner-led open source. Public issues can be used for reproducible
bugs, setup problems, documentation corrections, and focused feedback. Public
pull requests are not the routine operating model unless a maintainer requests
one.

Contributors can clone this repository normally for a new working checkout.
Once a checkout is the project's authoritative working repository, develop and
commit there. Never regenerate it from another repository or replace it with a
fresh clone, an old checkout, or a release copy. Bring reviewed changes through
Git while preserving its history and local work.

Ordinary source commits and pushes are separate from publishing a versioned
release or deploying a site. Maintainer release automation is still being
adapted to this directly maintained repository; see
[Publishing Filterest](app/docs/publication/PUBLISHING.md). Credentials,
customer data, runtime project files, deployment records, and database-backed
development records remain outside the tracked public source.

See `CONTRIBUTING.md` for the contribution boundary and `SECURITY.md` for the
private vulnerability-reporting channel.

## License

Filterest is licensed under the GNU General Public License version 2 or, at
your option, any later version (`GPL-2.0-or-later`). See `LICENSE` and
`app/docs/publication/PUBLICATION_CHECKLIST.md`. The source license does not grant
trademark rights in the `FILTEREST` name or logo.
