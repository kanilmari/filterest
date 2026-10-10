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

## Updating A Git Checkout

```bash
./filterest update --dry-run  # verify the published target without changing files
./filterest update            # back up, fast-forward, reinstall, and restart
```

The automated updater accepts only a published stable release with matching
Filterest build identity, required `app/` markers, a clean tracked checkout,
and a target commit that is a fast-forward from the installed revision. Before
the fast-forward it backs up the database and file storage under `backups/`.
It rejects any release commit that tracks content below `config/`, `keys/`,
`projects/`, `data/`, or `backups/`, so the application update cannot silently
claim operator-owned state. The tracked `app/` source and root bridges advance
together while those five mutable sibling directories remain in place.

Native development updates currently refuse source rebuilds before shutdown or
checkout changes: compiler caches and the workstation runner cannot yet use the
recovery content scanner. Before anything stops, administration updates check
that the host packages required by the verified target release are installed
(using the installed release's list for older targets without a package list).
Install missing packages with ordinary setup first. Docker update preflight
also refuses unmigrated legacy named volumes before anything stops; run an
ordinary `./filterest docker start` first to migrate them. These prerequisite
refusals leave the installation untouched. Recovery does not download missing
toolchains, refresh development dependencies, or generate automated-preview
credential handoff files; the preview switch is also refused before shutdown.
These checks keep unscanned archives and retained files out of recovery paths.

### Docker installations

The same command updates a Docker installation in the folder layout shown
above, recognized by `FILTEREST_INSTALL_PROFILE=docker` in `keys/docker.env`.
It stops only the application container, dumps the database through the
running database container and reads the dump back, and also backs up
`keys/`, `config/`, and `projects/`. Each `backups/update_*` folder is complete
only once its `update.backup.json` authenticates the database packet, manifest
and every installation archive with the separately retained installation key;
the manifest records the previous commit as `source_commit`. Docker installation
directories remain real directories, unchanged since 9.0.0: setup and start
refuse symbolic links. Archive preflight also refuses any linked archive root
before shutdown, so an update cannot stop a site it could not restart.
Native media and settings roots (`data/storage`, `data/storage_deleted`, `keys`,
`config`, `projects`) may be symbolic links to real operator-owned directories.
In both profiles, `data/bootstrap` must be a real directory, never a symbolic
link. Root targets must not overlap one another.
It resolves each root once and refuses every symbolic link below it (including in-tree links), hard-linked file and special
file before shutdown. Media/bootstrap targets must stay outside the resolved
`keys/` directory and cannot contain the signing-key file. Archives keep logical
paths such as `data/storage/...` and exclude the signing-key file. Copy-time
and verification scans refuse the representations listed below in file contents
and member names, including path components. Rollback staging and retained
replaced contents exclude the key file too; the live key stays in place.
The updater then fast-forwards, rebuilds the images with
the release's pending migrations enabled, and reports success only when
`/system/ready` shows the new version ready for this installation
(`--ready-timeout SECONDS`, default 600). An installation that has both a
native setup marker and Docker settings, or a shell variable that would
override a `keys/docker.env` value in Docker Compose, is refused before anything
changes.

If the new version does not become ready, the updater stops its application
container and leaves the database container running. To return to the backed-up
version, fill in the update folder and run this block from the installation
folder. It stops at the first failing command. It restores the checkout, the
settings, the stored files, and the database together, and moves what the new
version left behind into a `backups/replaced_*` folder instead of deleting it:

**Opt-in Docker installations cannot safely use this block to roll back across
the introduction of host-proxy, private database ports or pinned networks.**
The older runner re-enables local TLS (a host nginx HTTP upstream then receives
HTTPS and answers 502), publishes PostgreSQL on port 5433 again, and recreates
the pinned network with automatic allocation. Review the older deployment
configuration and restore an equivalent transport, port and network contract
before starting it; the block below does not preserve those options.

The first command verifies a private snapshot of the whole update packet and
returns its authenticated previous source commit on stdout, with progress and
diagnostics on stderr. Rollback uses only that returned commit, never a later
read of the original manifest. The command checks
the installation key, private modes, digests, authentication codes and every
archive member. The packet and live installation stay unchanged, and a refusal
leaves the application running. Verification and extraction need temporary free
space for a full private packet copy, plus the larger of 10% or 64 MiB; set
`TMPDIR` before running the command to choose another temporary location.
The capacity check precedes snapshot writes. Failed or refused captures remove
dump/archive copies and retain only small checked evidence in the announced
private diagnostics folder; the original packet stays unchanged in its folder.
Extraction captures and authenticates its own
private snapshot and stages regular files and directories only:
settings below `keys/`, `config/`, `projects/`; media below `data/storage` and
`data/storage_deleted`; bootstrap below `data/bootstrap`. Absolute paths, `..`,
links, devices and extra roots are refused before any extraction write. The
verifier also checks live root targets and contents before shutdown. The
`--restore-roots` extraction option retains replaced contents beside its staging
folder and restores into existing root directories, preserving supported native root links and
the separate signing key. It never writes through a link below a root.

Only for a packet you know a genuinely older updater made, set
`restore_options=(--legacy)` for individual extraction and database recovery
commands. The automated block requires an authenticated previous commit and
refuses a legacy manifest; recover the matching source independently from trusted
source history before using those individual commands. **Legacy recovery accepts unauthenticated
archives and manifest: you personally trust their origin and contents, including
credentials and project code.** Member restrictions still apply. A missing final
seal on a current authenticated database packet cannot use this legacy choice;
recover the complete original packet. Keep the separately backed-up key for new
packets. Dump-only recovery uses `restore-database`, as documented below.

```bash
(
set -euo pipefail
backup=backups/<update folder>
aside="backups/replaced_$(date -u +%Y%m%dT%H%M%SZ)"
restore_options=()
previous_commit="$(./filterest verify-update-backup --backup "$backup" --print-source-commit ${restore_options[@]+"${restore_options[@]}"})"
[[ "$previous_commit" =~ ^[0-9a-f]{40}([0-9a-f]{24})?$ ]] || {
  echo 'Rollback refused: recover the original previous source commit first.' >&2
  exit 1
}
./filterest docker stop
mkdir -m 700 "$aside"
./filterest extract-update-backup --backup "$backup" --destination "$aside/restored" --restore-roots ${restore_options[@]+"${restore_options[@]}"}
docker compose --env-file keys/docker.env up --detach --wait db
# Use the current recovery helper before returning to older source that lacks it.
./filterest restore-database --backup "$backup" --yes ${restore_options[@]+"${restore_options[@]}"}
git reset --hard "$previous_commit"
./filterest docker start
)
```

Docker installations from releases whose updater predates Docker support move
to the first release with it by hand, once. Confirm on GitHub that
`v<version>` is a published stable release, fill in the version, and run this
block from the installation folder. It stops at the first failing command, and
if the new version does not report ready, it stops the application again:

```bash
(
set -euo pipefail
umask 077
version=<version>
backup="backups/manual_update_$(date -u +%Y%m%dT%H%M%SZ)"
git fetch origin tag "v$version"
git show "v$version:app/BUILD_IDENTITY.json" | grep -F '"product":"filterest"' | grep -F '"channel":"stable"' \
  | grep -F '"artifact_type":"runtime"' | grep -F "\"app_version\":\"$version\"" > /dev/null
git merge-base --is-ancestor HEAD "v$version"
docker compose --env-file keys/docker.env stop app
mkdir "$backup"
docker compose --env-file keys/docker.env exec -T db sh -c \
  'pg_dump --format=custom --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$backup/database.dump"
docker compose --env-file keys/docker.env exec -T db pg_restore --list < "$backup/database.dump" > /dev/null
tar --exclude=database_recovery.hmac.key -czf "$backup/files.tar.gz" data/storage data/storage_deleted data/bootstrap keys config projects
git merge --ff-only "v$version"
ENABLE_SQL_MIGRATIONS=true EASELECT_MIGRATION_FILE_ALLOWLIST= ./filterest docker start --for-update &&
  ./filterest docker ready-check --expect-version "$version" ||
  { ./filterest docker stop-app; exit 1; }
)
```

This one-time block uses the older release's legacy dump format without owners
or a roles export. Keep it for same-installation rollback; it is not a complete
production recovery packet. Later updates use `./filterest update` and the paired
backup below.

A Gitless copy can be installed and run normally, but it cannot use this
Git-verified updater. Upgrade it from a complete reviewed release folder and
carry forward only the five operator-owned directories after taking a backup.

### Database recovery backups (Docker and native)

Update backups preserve object owners, grants, default privileges and database
properties: owner, access restrictions, connection limit, database settings and
per-role settings. Native installations can use a shared PostgreSQL cluster;
a dedicated cluster is recommended. Packets contain only this installation's
configured database roles, object owners/grantees and their membership roles.
No statement creates or alters the cluster's bootstrap superuser; it may appear
as the grantor of a membership. Role verifiers
are collected only for the selected roles; `pg_dumpall --no-role-passwords`
supplies role attributes without collecting other applications' passwords.

The packet folder must be mode 0700 and owned by the operator. Files are mode
0600 from creation. Copies that lose these modes are refused: run `chmod 700`
on the copied folder and `chmod 600` on its files, and retain operator ownership.
Restore also accepts a private read-only folder (0500) or read-only mount; it
writes diagnostics to a separate temporary directory.

```text
backups/update_<time>_<old version>_to_<new version>/
├── database.dump
├── database.roles.sql                installation roles, memberships and verifiers
├── database.properties.json          database configuration and object counts
├── database.settings.tar.gz          protected settings; authentication key excluded
├── database.sha256                   artifact digests
├── database.backup.json              authenticated database completion record
├── database-tool-*.log               private backup-tool diagnostics
├── installation_settings.tar.gz      keys, config and projects; authentication key excluded
├── storage.tar.gz                    when media directories exist
├── bootstrap.tar.gz                  when bootstrap state exists
├── manifest.txt                      version, profile and previous source commit
└── update.backup.json                whole-update authenticated record, written last
```

Each new packet has an HMAC-SHA256 authenticating its canonical completion
record, including every packet artifact's digest. Recomputing checksums cannot
make an edited packet authentic. Setup generates a dedicated random 256-bit key
if missing; existing installations generate it during backup preflight. The
owner-only key lives in `keys/database_recovery.hmac.key` in both profiles. It is
never archived or retained in packet, staging or replaced-content trees: anyone
with it can authenticate a packet. The recovery guarantee applies **exactly** to
these operator interfaces and the recovery invocations listed here:

| Supported entrypoint | Recovery invocations |
| --- | --- |
| Root `./filterest` and direct `./app/filterest` | `update`, `restore-database`, `verify-update-backup`, `extract-update-backup`; `start` or `ctl` with a control recovery selector below; `docker` with a runner recovery invocation below |
| Root `./ctl`, direct `./app/ctl` and direct `./app/server_tools/ctl/ctl_main.sh` | Control arguments containing `--backup`, `--restore`, `--restore-db` or `backup-all`, in the applicable control mode |
| Direct `./app/server_tools/run_filterest_docker.sh` | `dump-database`, `restore-database`; finite recovery helpers `profile`, `update-preflight`, `app-image-id`, `stop-app`, `ready-check`; `start` with `--for-update`, `--backup`, `--restore` or `--restore-db` |
| Direct `./app/server_tools/update_filterest.sh` | All updater invocations, including help and parser refusals |
| `python3 app/server_tools/lib/database_recovery.py` | `backup`, `verify`, `restore`, `preflight`, `setup-key`, including help and parser refusals |
| `python3 app/server_tools/lib/database_recovery_update.py` | `preflight`, `archive`, `manifest`, `seal`, `verify`, `extract`, including help and parser refusals |

Paths in this table are relative to the installation root; an installed Python
interpreter may replace `python3`. Internal modules and libraries invoked another
way (imports, sourcing, shell functions, interpreter `-c`/`-m` or other scripts)
are not operator interfaces and are **outside this promise**. Other command
invocations, including ordinary lifecycle commands and live log streaming, are
also outside it. The table does not expand the deployment modes that Filterest
ships; legacy instance operations still require the embedding instance templates.

Within the listed recovery invocations it covers the packet, archive, staged,
retained and diagnostic contents and names those commands produce,
and their diagnostics, including parser errors, usage and help. Contents and names are checked for raw key
bytes; hexadecimal in any letter case; standard and URL-safe Base64 at all three
byte alignments (the characters determined only by the key), with or without
padding; and UTF-16LE/UTF-16BE hexadecimal text in any letter case. The same checks
cover copied settings, generated metadata, tool streams, logs and temporary
recovery files, including matches across chunks. Gzip recovery archives are also
scanned after decoding. Other encodings, arbitrary compressed content and encrypted
copies are outside these detection guarantees. Diagnostics redact detected representations
and key-bearing path components before printing. Utility error explanations are
preserved through the scanner, which joins adjacent single-quoted (`'...'`),
ANSI-C (`$'...'`), double-quoted (`"..."`), backslash-escaped and Bash locale-quoted
(`$"..."`) segments in a nonexecuting decoded shadow. It checks octal (`\nnn`),
hexadecimal (`\xHH`), Unicode (`\uHHHH`, `\UHHHHHHHH`) and named control escapes,
including an outer GNU/Bash filename-quoting layer and matches across input chunks.
For diagnostics, complete hexadecimal and Base64 forms are also matched in
shadows keeping only each representation's alphabet from the printed text and
each decoded shadow (including NUL for UTF-16 hexadecimal). Any intervening
non-alphabet characters are ignored; the original span from the first to the
last contributing character is redacted. Raw key bytes still use exact matching.
The original printed text changes only at redacted spans; operator-facing stdout
and stderr retain their separate destinations and command status. Legacy instance
backup/restore lookup refusals and candidate lists use this same scan; accepted
instance names are checked before being passed to recovery.
Every listed entrypoint encloses its entire application process: all stdout and
stderr pass through the scanner before reaching the operator, including implicit
shell/interpreter diagnostics (unbound variables, syntax errors, missing or
unreadable helpers, import errors and uncaught tracebacks). This applies both to
direct invocation and dispatch through a root launcher. Separate output streams
and the original status are retained; the boundary waits for the child and the
complete scan before returning. Shell reentry requires the supervisor's exact
interpreter command, native source call frame and nonexported readonly process
state; the reentry interpreter discards inherited Bash startup hooks. Python reentry uses
in-memory interpreter state. Inherited flags cannot disable the boundary.
Before this boundary/scanner can load, startup and Python import failures use
fixed path-free refusals. Parser errors also use fixed text before a key is
known; required option values are checked before access. Usage and help use
fixed text and a fixed program name. The fixed restore confirmation prompt stays
visible on original stderr before input; it contains no supplied values. Scanned
restore target context, the update plan and update confirmation stay visible on
original stdout before input through their dedicated descriptor.
Existing helper scans still drain synchronously before returning to their caller.
Shell dry runs scan raw arguments before quoting them. Mixed-installation
refusals omit the operator's paths. Shell scanner/bootstrap paths and environment
travel through private descriptors, with an empty inherited scanner environment.
If the scanner cannot run or its redaction fails, output is withheld (fail-closed).
Representation checks require a safely readable installation key; recovery without
it cannot identify copies of its bytes. Diagnostic output shown to the operator is
**not** promised to withhold values the operator supplied: arguments and option
values, typed paths and names, and the location and folder names of the
installation itself, as well as the operator's own command lines and shell history
(including the process list) and values typed elsewhere. The operator already holds
these values, and a key typed into one of them has already left its file; the
scanner still checks them as an additional safeguard. This exception never extends
to packet, archive, staged or retained contents and names, which stay fully
covered. Other encodings, arbitrary compression and encryption are outside these
guarantees. Keep the key
only at `keys/database_recovery.hmac.key` and in the owner's separate safe backup,
away from recovery packets. Recovery on a new host requires that separate
copy, installed at the same path with mode 0600. A packet holder must never
receive the authentication key through the packet itself.

Native updates archive `keys/`, `config/` and `projects/`; protected settings
outside these logical installation roots are refused before stopping the
application. Native media and settings root links may relocate them to
operator-owned directories; bootstrap may not be a link. Resolved
native settings paths must map back into those roots. Arbitrary external native
homes remain unsupported for portable update recovery.
Preflight also exports and strictly validates this installation's roles before
shutdown; unrelated cluster roles and their unsupported syntax are omitted.
The tools run locally for native installations and inside the database container
for Docker. A standalone `./filterest docker dump-database --output
backups/<new private folder>/database.dump` requires a folder created with
`mkdir -m 700`. Stop the application before taking a recovery snapshot. Failed
exports leave private diagnostic logs; they never publish a completion record.
A remaining `.database-backup.partial.*` directory means an interrupted packet.

**Restore the same installation's database access and identity settings.** Move
current operator files aside and restore protected settings from
`installation_settings.tar.gz` or `database.settings.tar.gz`. Preserve the current
recovery key, or retrieve it from its separate safe backup. Keep them private.
For a whole-update packet, first run `./filterest verify-update-backup --backup
backups/<update folder>` and stage its archives with
`./filterest extract-update-backup --backup backups/<update folder> --destination
backups/<new staging folder>`. These commands use the installation key and member
restrictions above and authenticate private snapshots before consuming them;
verification leaves the packet and live installation unchanged. A standalone database
packet does not need a whole-update record and continues to use the database
recovery command below.
The packet binds effective database connection credentials and
installation/session identity. Provider keys and other runtime preferences are
archived but may change without blocking recovery. Restore matching media,
bootstrap and project files as needed, and use the matching application version.
Docker's published database port and bind address may change as well; the tools
connect inside the database container.

```bash
./filterest restore-database --backup backups/<backup folder> --yes
# Equivalent for Docker: ./filterest docker restore-database --backup ... --yes
```

Recovery first copies every packet artifact through descriptor-based reads into
a private snapshot (0700 directory, 0600 files). Before creating that folder or
stopping the application, it requires free space in the system temporary folder
for the packet's total size plus the larger of 10% or 64 MiB. An optional external
settings archive is included in this requirement. Set `TMPDIR` to an existing
directory on a larger disk to choose another location, for example:
`TMPDIR=/path/to/private-temp ./filterest restore-database --backup backups/<backup folder> --yes`.
Insufficient space is refused with the location, needed and free bytes before
snapshot writes or shutdown. It authenticates those exact
bytes, validates the exact roles-only SQL text it will import, checks
access/identity settings and reads the captured custom archive before shutdown.
Role import, database restore, settings and property checks then use only that
snapshot; the original packet is never reopened after authentication.
It then stops the application, imports only installation roles, creates an empty
`<database>_restore_<UTC>` database with the original encoding/locale and connection
limit zero, and restores
into it with owners and grants. It requires the Filterest catalogue, checks
object counts against the backup, excluding extension-member objects whose
number may change with the server's default extension version, and replays/verifies the saved database
properties using the same implementation as instance recovery. Only then does
one transaction rename the original to `<database>_before_restore_<UTC>` and
install the verified replacement and restore the saved connection limit.
Restore brings extensions to the server's default version (for example, pg_trgm 1.3 becomes 1.6).
Long database names use a shortened prefix and the UTC stamp uses lowercase letters.
The original is never dropped. A failure before the swap leaves its data and
name intact; the application remains stopped after shutdown. Role changes are
cluster-wide, so imported installation roles may have been changed if a later
step fails. The command prints the retained name and a removal command; run that
only after starting the matching source and verifying readiness. Each failed
tool names a mode-0600 log in the private temporary directory (0700) announced
on failure; role SQL/verifiers are withheld and known credentials are redacted
from recovery diagnostics, including key-bearing path components added by
Python wrappers and shell messages when the protected installation key is readable.
The representation and operator-input limits above apply to all these messages.
Successful verification and restore remove their snapshots and temporary
diagnostics. Failed or refused attempts remove snapshot copies of the dump and
all archives, keeping only small checked completion records, checksums, roles,
properties, manifests and tool logs in the announced private folder. Retained
evidence is limited to 1 MiB per file and 8 MiB per attempt; larger evidence files
are omitted, and metadata takes precedence over logs. The original packet stays
unchanged in its folder. These space and cleanup rules also apply to whole-update
verification, extraction and sealing. Sealing intentionally publishes a completion
record; a later sealing failure does not undo an already published record.
Remove a failed run's retained directory after inspecting the result.

Unauthenticated packets from earlier versions require explicit `--legacy` in
addition to `--yes`. Old folders without a completion record also require an
`update_*` name and a private `manifest.txt` naming this installation's exact
profile (`docker`, `admin` or `development`). Unmarked arbitrary folders are
refused. Older native update packets without `profile=` are accepted with a
completed native setup marker, all five release-metadata fields in their
manifest, a database dump, and no Docker installation-settings archive.
Dump-only legacy backups use existing roles and `--no-owner`, recover
database-level properties from the current original, and still retain the
original database. Partial new packets never fall back to legacy mode.

If the separate key cannot be recovered, the explicit
`--allow-unauthenticated-restore` flag permits recovery of a complete packet while
printing a prominent warning. Its checksums cannot establish authenticity;
review the packet's provenance before authorizing this mode. `--legacy` alone
never bypasses authentication of a new packet. Archives containing the
authentication key are refused; create a new safe packet from a trusted
installation.

Scheduling, retention and off-host copies remain operator responsibilities.
Packets, authentication keys and role verifiers must never enter source or
public releases.

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
