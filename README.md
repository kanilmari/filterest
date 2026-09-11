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
checkout or a same-version folder copied without Git. The first start creates
the five operator directories, generates protected settings in
`keys/docker.env`, creates the local TLS identity under `keys/tls/`, builds the
application and PostgreSQL images, and waits until both are healthy. Generated
secrets are never printed.

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
administrator's sign-in verification method; then create the administrator
username, email address, and password. Email verification uses Postmark and
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
the sanitized-header snippet in the application `location` before setting
`EASELECT_TRUSTED_PROXY_PEER_IPS` to nginx's one exact Docker-gateway or host
address. The setting accepts IP literals only, never a subnet or CIDR. Keep it
blank when no additional proxy peer has been proven.

For native installation, `config/filterest.paths` records the portable relative
homes for projects, protected keys, and runtime data. Relative paths start at
the outer installation root. The standard standalone contract keeps them in
the five operator-owned sibling directories shown above.

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

A Gitless copy can be installed and run normally, but it cannot use this
Git-verified updater. Upgrade it from a complete reviewed release folder and
carry forward only the five operator-owned directories after taking a backup.

## Development

```bash
./filterest setup --profile development  # one-time toolchain and database setup
./filterest start     # build and run the local application
./filterest test-unit           # run frontend unit tests
(cd app && go test ./...)      # run Go tests
./filterest build               # build frontend assets
./filterest qa                  # run the broader project QA suite
./queen status        # inspect the built-in persistent agent runtime
./db_report workline board  # inspect the canonical workline observatory state
./db_task list        # inspect database-backed development tasks
./worker_agent --help # inspect the optional local AI-worker command
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

Queen, database-backed tasks, and the browser Workline Observatory are part of
Filterest's development and administration surface. Their durable records stay
in the installation database. Queen sessions and worker output use ignored
local runtime directories; copying the source does not copy another
installation's workline data or credentials. The worker command requires a
separately installed and authenticated supported AI command-line client.

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

Validate the local Linux release-packaging inputs from this repository with:

```bash
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
