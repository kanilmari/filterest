# Promoting a verified candidate

`./filterest release promote` turns verified candidate metadata into the metadata
for a published release. It performs no Git commit, push, tag, upload or site
update. A local `published` identity is an intended release identity; successful
remote publication is established separately by a publication receipt.

Three commits keep the source and evidence clear:

1. **Reviewed source (S):** the approved product changes and generated frontend
   files have been reviewed, tested and committed.
2. **Candidate metadata (C):** candidate preparation changes only its documented
   version, ledger, identity, compatibility, bootstrap-manifest, notice and
   release-note outputs. Commit those changes separately, then build and verify
   candidate assets from this clean commit.
3. **Published metadata (P):** promotion appends one immutable published record
   and updates the build identity. Commit these two files separately and rebuild
   final assets from this clean commit before publication.

S must be an ancestor of C, and C must be an ancestor of P. The candidate identity
names S as its source. The new published identity names C, which preserves the
reviewed product implementation and adds the verified candidate metadata.
This gives the published record a new build identifier while keeping the same
application and database versions. Existing ledger records are never rewritten.

## Plan and apply

Prepare and commit a candidate using the [preparation command](PREPARING_RELEASES.md),
then build its fourteen deliverables with the [Linux builder](BUILDING_LINUX_ASSETS.md).
Use an output directory outside the whole source checkout. From the Filterest
installation root, verify and inspect a promotion plan:

```bash
./filterest release promote \
  --expect-version 9.3.4 \
  --candidate-commit <full-candidate-commit> \
  --reviewed-source-commit <full-reviewed-source-commit> \
  --assets-dir /tmp/filterest-candidate-assets \
  --json
```

Substitute the actual version and full lowercase 40-character Git commits.
Plan mode is the default; `--dry-run` selects it explicitly. Both plan and apply
require clean source at the exact candidate commit. `--created-at` accepts a fixed
UTC timestamp (`YYYY-MM-DDTHH:MM:SSZ`) when reproducible planned bytes are needed.
A promotion timestamp cannot precede candidate creation. `--apply` applies the
same verified plan to the two metadata files; it cannot be combined with
`--dry-run`. Long options must be spelled in full.

The command refuses any implementation changes between S and C, including edits
to generated frontend JavaScript. Build and commit those files before candidate
preparation. It verifies the candidate's latest ledger identity, application and
database markers, complete compatibility history and public bootstrap hashes.
A candidate may not change database compatibility during promotion.

The shared asset verifier reads all fourteen files and verifies:

- the exact filename set, regular files, and each SHA-256 sidecar;
- source license and notice bytes, complete license-archive membership and every
  retained document hash, without extracting archive paths;
- the Go toolchain, compiled modules, architecture, required build tags and
  baseline processor levels (amd64 v1 and arm64 v8.0) for both Linux binaries;
- `vcs.revision` equal to C and `vcs.modified=false` in each binary;
- the supported glibc 2.34 maximum and permitted dynamic-library dependencies.

The builder pins the Go processor baseline and Cgo compiler flags instead of
inheriting a maintainer machine's CPU optimizations. It explicitly selects
production mode; Go binary metadata alone does not prove that injected runtime
flag. Keep the builder invocation evidence and applicable runtime checks.

The source commit and all artifact hashes are checked again after inspection.
Passing these checks establishes the named source and asset contracts; it does
not replace the applicable browser, runtime, upgrade or recovery checks from the
[release checklist](../../docs/publication/PUBLICATION_CHECKLIST.md).

## Final rebuild and publication

After applying, inspect and commit only:

- `app/server_tools/versioning/release_ledger.v1.jsonl`
- `app/BUILD_IDENTITY.json`

The command uses the preparation lock and recoverable grouped file replacements.
Ordinary write failures roll back both files. The same process-termination and
storage-failure limits as [preparation](PREPARING_RELEASES.md) apply.

Build final release assets in a fresh outside directory from the clean P commit.
Candidate binaries still identify C and must never be substituted for those
final assets. The shared final-source checker requires that C-to-P changes are
exactly the ledger append and derived identity; it rejects any added product or
release-document changes. Additional source changes require a newly reviewed
candidate rather than weakening this boundary.

Candidate assets remain local verification evidence. Commit P, its final rebuilt
assets and remote publication must each be verified explicitly. Promotion always
reports `remote_published=false`, `publication_ready=false` and
`final_rebuild_required=true`; it does not claim to have uploaded a release.
