# Filterest

Filterest is a multilingual application platform built around a robust,
unified PostgreSQL data-management core. Define datasets, fields, relations,
permissions, and media once, then use the same data through ready-made browser
applications or purpose-built custom applications.

## From Data To Applications

### Quick Start

```bash
./filterest start  # First start
./ctl              # Start again later
./ctl --stop       # Stop
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
filterest_projects/
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

This repository is the canonical public Filterest release source. Its history
starts with a reviewed Filterest release artifact and excludes non-public
maintainer-source history.

## Installation Profiles

The setup command asks which kind of installation you need:

- **Browser administration** is the recommended choice for normal use. It
  installs PostgreSQL 16, PostGIS, pgvector, and a checksum-verified Filterest
  binary. It does not install Go, Node.js, npm packages, or browser-test tools.
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

# Optional but recommended: keep projects and keys below this one checkout.
cp filterest.paths.example filterest.paths.local

# Start Filterest. On a fresh download this automatically opens the guided
# setup first, creates protected settings, initializes the example database,
# and then starts the application.
./filterest start
```

Both profiles open at `https://localhost:8100/first-run`. The local certificate
is self-signed, so the browser may ask you to accept it once. The admin binary
retains production-only routes while using direct local TLS for secure browser
sessions. Use the explicit setup commands
`./filterest setup --profile admin --yes` or
`./filterest setup --profile development --yes` for an explicit unattended
profile choice.

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
media only. See `server_tools/public_bootstrap/README.md` for the seed and
first-administrator boundaries.

The Git-ignored `filterest.paths.local` accepts arbitrary safe relative or
absolute `projects_home` and `keys_home` values. Relative values start at the
checkout root. Existing installations without an explicit `keys_home` retain
their root-local `.env`, `dev_env.txt`, and TLS paths for compatibility.

## Development

```bash
./filterest setup --profile development  # one-time toolchain and database setup
./filterest start     # build and run the local application
npm test              # run frontend unit tests
go test ./...         # run Go tests
npm run build         # build frontend assets
npm run qa            # run the broader project QA suite
```

Keep user-facing features multilingual. Use the existing translation and
language-key workflows instead of hardcoding one-language UI text.

The repository-specific setup and governance guides live at the repository
root. A deliberately limited set of technical documents shared byte-for-byte
with the non-public development source lives under `docs/`; see
`docs/README.md` for the naming and support boundary.

## Project And Contribution Model

Filterest is owner-led open source. Public issues can be used for reproducible
bugs, setup problems, documentation corrections, and focused feedback. Public
pull requests are not the routine operating model unless a maintainer requests
one.

This public repository is generated from a maintainer release source. Accepted
durable changes are incorporated there and exported into later public releases.
Private operational details, customer-specific apps, credentials, deployment
history, DB-native development records, and non-public data remain outside this
repository.

See `CONTRIBUTING.md` for the contribution boundary and `SECURITY.md` for the
private vulnerability-reporting channel.

## License

Filterest is licensed under the GNU General Public License version 2
(`GPL-2.0-only`). See `LICENSE` and
`docs/publication/PUBLICATION_CHECKLIST.md`. The source license does not grant
trademark rights in the `FILTEREST` name or logo.
