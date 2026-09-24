# Preparing candidate release metadata

`./filterest release prepare` prepares the next application version from the
standalone Filterest repository. It uses the public dependency inventory and
immutable release-ledger contracts. It does not need another repository,
installation credentials, or a running database.

Prepare reviewed release notes outside maintained source first. From the
Filterest installation root, inspect a plan using the exact source commit:

```bash
./filterest release prepare \
  --version 9.3.4 --expect-current-version 9.3.3 \
  --source-commit "$(git rev-parse HEAD)" \
  --release-notes /tmp/filterest-release-notes.md \
  --manifest-notes 'Describe the reviewed changes and database compatibility.' \
  --json
```

These versions are an example; read `app/VERSION_APP` before choosing the next
patch, minor, or major version. `--bump patch|minor|major` can replace `--version`.
`--created-at YYYY-MM-DDTHH:MM:SSZ` fixes the timestamp for a reproducible plan.
The default is the current UTC time. `--dry-run` explicitly selects the default
plan behavior. Long option names must be written in full.

A plan collects actual dependency and asset information, validates the existing
identity and bootstrap hashes, and reports every changed path and new content
hash. It writes generated notice documents only to a temporary directory.
Go metadata collection uses read-only module manifests and disables workspaces;
it may populate the installation's ignored dependency caches. Missing dependency
metadata or stale provenance stops preparation. Development setup must already
provide the Go and npm dependencies and the reviewed browser build inputs.

Preparation builds the minified browser bundle from the reviewed source into a
temporary directory and stages the result, so a candidate always ships the
interface its own code produces and nobody has to rebuild it by hand. A build
that cannot run stops preparation instead of leaving the previous bundle in
place. The dependency notices read the bundle that was just built, so their
evidence describes the bytes this candidate ships.

An unfinished working tree may be inspected as a plan. Its `source_clean` and
`ready_to_apply` fields are false, and its bytes are not represented as a reviewed
release. To apply, first review and commit the intended source changes, then rerun
with that commit, the expected current version, and `--apply`. The command requires
a clean standalone Git root, verifies HEAD again after inventory collection,
and refuses an overlapping preparation for the same target.

## Changed files and preserved history

Preparation changes only:

- `app/VERSION_APP` and the active application/database compatibility row;
- one appended release-ledger record and its derived `app/BUILD_IDENTITY.json`;
- the bootstrap manifest's application version;
- `app/docs/publication/RELEASE_NOTES.md` from the supplied reviewed text;
- `THIRD_PARTY_NOTICES.md` and the regenerated `THIRD_PARTY_LICENSES/` documents;
- the rebuilt browser bundle in `app/frontend/dist/`, whose content-hashed
  filenames change with the frontend source; files the build no longer produces
  are removed rather than left beside their replacements.

The new identity is always **stable/runtime candidate**. Existing ledger bytes
remain unchanged, including published history. The old active compatibility row
becomes historical. Without an explicit database transition, the existing database minimum,
target and schema snapshot remain the same. Preparation never generates or
modifies migrations, schema, seed, snapshots or the database version marker.
These inputs must be reviewed and committed first. Product packages currently have no npm version field,
so no package version is invented. Private shell versions and feature registries
are outside this command's scope.

Each changed file is replaced using an atomic rename on its own filesystem. A
write failure rolls back the touched files to their original bytes. This is a
recoverable group of file replacements, not a filesystem-wide transaction:
process termination, power loss, or a storage failure that also prevents rollback
requires inspecting Git status and the retained release evidence before retrying.
Do not run other source editors while applying. Release metadata input/output
symlinks are refused.

## Preparing a reviewed database transition

When application code requires a new database schema, first commit source S with
the new `app/VERSION_DB`, reviewed migrations, regenerated public bootstrap
schema/seed/manifest and the matching tracked
`app/server_tools/versioning/schema_snapshots/db-VERSION.sql`. The new snapshot
must contain the exact reviewed bootstrap schema bytes. Keep the previous
published `BUILD_IDENTITY.json`, ledger, application version and compatibility
rows unchanged in S; do not assign the old published app version a new DB identity.
A normal compatibility check may reject this deliberate pre-candidate state.
It is reviewed source, not an eligible published runtime.

Then explicitly acknowledge the previous published database target:

```bash
./filterest release prepare \
  --version 9.3.8 --expect-current-version 9.3.7 \
  --source-commit "$(git rev-parse HEAD)" \
  --db-transition-from 9.7.13 \
  --release-notes /tmp/filterest-release-notes.md \
  --manifest-notes 'Reviewed DB 9.7.15 migration and bootstrap; minimum 9.7.15.' \
  --json
```

These values are an example. `--db-transition-from` must exactly match the
previous identity and active compatibility target. The new source DB version
must be greater, and the new candidate's minimum **equals its new target**;
this path cannot claim compatibility with an older schema. Omitting the flag
for a DB change, using it without a DB increase, a missing/untracked snapshot,
or mismatched schema/hash evidence stops preparation.

Only the unchanged history is internally validated against its previous
published DB target. The normal validator and candidate/published identities
remain strict. The plan lists the same metadata outputs as an app-only release.
Review it, rerun with `--apply`, and commit candidate C. The old active
compatibility row becomes historical and the new app version receives the new
DB pairing and canonical snapshot. All previous ledger bytes and snapshot
files remain unchanged. Promotion rechecks this exact S→C contract from Git
history; it does not need the preparation flag again.

## Verification and later publication

`publication_ready` is always false. Candidate preparation does not build a
binary, prove browser behavior, promote a candidate to published, create a Git
commit or tag, upload files, or deploy a site. `./filterest release verify`
rebuilds the browser bundle once more and refuses a candidate whose tracked
bundle differs, so a release cut by hand is held to the same rule.

Review the resulting diff, run the
[release checklist](../../docs/publication/PUBLICATION_CHECKLIST.md), and commit
only the intended derived metadata. The existing [Linux asset builder](BUILDING_LINUX_ASSETS.md)
then requires clean source and verifies the binary dependency and ABI contracts.
Candidate promotion and publication remain separate work.

The historical private `release_artifacts` flags for a private changelog or
feature table are not accepted. Supply public release notes and the exact reviewed
source instead. Ordinary development and reviewed source commits can continue
without preparing a new version.
