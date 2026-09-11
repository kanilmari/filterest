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
- `THIRD_PARTY_NOTICES.md` and the regenerated `THIRD_PARTY_LICENSES/` documents.

The new identity is always **stable/runtime candidate**. Existing ledger bytes
remain unchanged, including published history. The old active compatibility row
becomes historical. The existing database minimum, target and schema snapshot
remain the same. This command cannot introduce a database version or regenerate
the schema and seed. Such changes need their own reviewed migration/bootstrap
work before preparation. Product packages currently have no npm version field,
so no package version is invented. Private shell versions and feature registries
are outside this command's scope.

Each changed file is replaced using an atomic rename on its own filesystem. A
write failure rolls back the touched files to their original bytes. This is a
recoverable group of file replacements, not a filesystem-wide transaction:
process termination, power loss, or a storage failure that also prevents rollback
requires inspecting Git status and the retained release evidence before retrying.
Do not run other source editors while applying. Release metadata input/output
symlinks are refused.

## Verification and later publication

`publication_ready` is always false. Candidate preparation does not build a
binary, prove browser behavior, promote a candidate to published, create a Git
commit or tag, upload files, or deploy a site. Review the resulting diff, run the
[release checklist](../../docs/publication/PUBLICATION_CHECKLIST.md), and commit
only the intended derived metadata. The existing [Linux asset builder](BUILDING_LINUX_ASSETS.md)
then requires clean source and verifies the binary dependency and ABI contracts.
Candidate promotion and publication remain separate work.

The historical private `release_artifacts` flags for a private changelog or
feature table are not accepted. Supply public release notes and the exact reviewed
source instead. Ordinary development and reviewed source commits can continue
without preparing a new version.
