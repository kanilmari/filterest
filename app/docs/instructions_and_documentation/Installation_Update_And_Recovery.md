<!-- Installation_Update_And_Recovery.md -->
<!-- Describes public installation updates and authenticated database recovery. -->
<!-- Connects the README command overview with the shipped updater and recovery interfaces. -->
<!-- Keeps detailed recovery guarantees in one maintained guide; commands start at the installation root. -->

# Installation Update And Recovery

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

The same command updates a Docker installation in the
[portable folder layout](../../../README.md#one-portable-filterest-folder), recognized by `FILTEREST_INSTALL_PROFILE=docker` in `keys/docker.env`.
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

#### Roll back a Docker update

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

#### Updating older Docker releases

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
