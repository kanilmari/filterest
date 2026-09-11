# Filterest release checklist

This checklist applies to the maintained Filterest repository. Follow
[PUBLISHING.md](PUBLISHING.md) for the source and release model. Historical
publication records retain their original evidence; they do not require a
new source mirror, a disposable clone, or a private parent repository.

## Prepare and review

- Confirm the requested version, release repository and branch. Preserve
  existing tags and release files. Keep operator credentials and state out of Git.
- Review the exact source diff and run checks appropriate to changed behavior.
  Reuse a completed check while its tested inputs remain unchanged; record its
  scope and limitations. A new version label alone does not change UI behavior.
- Record a reviewed source commit. Prepare release metadata from that commit:
  application version, compatible database range, append-only release ledger,
  build identity, bootstrap manifest, dependency notices and release notes.
- Keep database schema versions and snapshots unchanged when the schema does
  not change. Validate the compatibility and bootstrap contracts.
- Preserve the approved source license, contribution policy, security contact,
  trademark notice and asset-rights register. Recheck affected dependency and
  asset inventory against the actual files to be distributed.

## Build and verify

- Build from this repository into an ignored output directory. Never reconstruct
  or replace the maintained checkout while assembling a release.
- Build the complete application Docker image before publication when Go imports,
  embedded assets or Docker build inputs change. A native binary build cannot
  verify the files copied into an isolated Docker build stage. From the standalone
  root, use `docker build --file app/docker/Dockerfile app`.
- Verify the Linux binaries for every published architecture, including the
  declared Go module set, WebP support and glibc compatibility boundary.
- Include applicable license texts and dependency notices. Generate and verify
  checksums for every distributed binary and notice bundle.
- Verify the release in the intended local runtime. Match additional browser,
  upgrade and recovery checks to the changes; record observations without
  presenting historical results as new tests.
- Commit candidate metadata separately from the reviewed source, including
  generated frontend files in the reviewed source before preparation. Build and
  verify the candidate, then use the [promotion command](../../server_tools/release/PROMOTING_RELEASES.md).
  Commit only the promoted identity and appended ledger row as the final release
  commit. Rebuild final assets from that clean commit so both binaries identify it.

## Publish and verify remotely

- Check the selected Git remote, current remote branch and tag, and the
  maintainer's GitHub Actions policy before pushing. Builds run locally.
- Use the owner's authorization for this named release; do not ask for a
  duplicate confirmation when its scope is already authorized.
- Inspect the [publication command's plan](../../server_tools/release/PUBLISHING_RELEASES.md)
  before applying it. It fast-forwards the branch, tags the final release commit,
  uploads and verifies a draft, then makes it public. Never force an existing tag
  or overwrite different assets.
- Read back the remote commit, tag, release version and complete asset hashes.
  Keep a local receipt of the final commit, source commit and uploaded bytes.
  A local ledger entry by itself does not prove publication succeeded.

A product release does not itself deploy customer sites. Site updates retain
separate target selection, backup, compatibility and recovery procedures.
