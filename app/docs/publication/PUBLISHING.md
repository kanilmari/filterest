# Publishing Filterest

Filterest is intentionally local-first. Its complete canonical public source is
maintained under the `filterest/` subtree in the maintainer workspace; the release generator mirrors those
bytes into the standalone GitHub repository while preserving that repository's
own `.git` history. Generation never creates a remote or pushes.

Maintain durable public code and documentation in the canonical Filterest
source tree. The standalone sibling and GitHub repository are mirrors, while
release identity, dependency notices, compatibility snapshots, and publication
review reports remain derived artifacts.

## Local Review

```bash
git status --short
git log --oneline --max-count=3
cat app/VERSION_APP
cat app/VERSION_DB
```

Review `app/docs/publication/PUBLICATION_CHECKLIST.md` before publishing. Every
Filterest update must come from a clean maintainer release-source commit and a
reviewed sibling-repo commit.

From the maintainer workspace, use the release wrapper:

```bash
./filterest_release status
./filterest_release generate
./filterest_release verify
```

`generate` regenerates the sibling repository and runs the candidate checks.
`verify` repeats the checks against the current artifact without regenerating
it. Ordinary source commits only mark the release pending.

For candidate-to-published promotion, the normal sequence is:

```bash
./filterest_release generate
# Review the fully checked candidate.
./filterest_release promote
# Commit and push the promotion-only source-ledger change and its exact test update.
./filterest_release fast-patch
# Run final runtime, browser, and Actions-policy proof, then record the human
# release owner's named UI checks in a human-acceptance JSON artifact.
./filterest_release attest-final <exact-evidence-options>
./filterest_release publish --yes
```

Successful full generation records a clone-local marker for the exact candidate
commit, build identity, source-evidence commit, and committed `app/frontend/dist`
tree. `fast-patch` accepts only that marker plus exactly one promotion-only
source commit. It reuses the committed bundles, regenerates the final
third-party notices and review from the complete final file set, performs
focused identity/root/notice checks, and creates one local published-export
commit. It performs no push. Any drift requires another full `generate`, and
successful Fast Patch records an owner-only candidate-to-final assembly marker.
`attest-final` then requires the exact accepted `THIRD_PARTY_NOTICES.md`
SHA-256 and a structured human UI-acceptance record bound to the candidate
source and final frontend tree, hashes every named final proof, and writes a
second owner-only local Phase 6 readiness marker. A ticket and Computer Use are
not part of this runtime contract.
`publish --yes` always reruns the full publication gate and revalidates those
bytes before each remote mutation.

Treat the standalone sibling checkout and its preview database as release-review
surfaces. Make durable code, schema, seed, environment-scaffold, language-key,
setup, and maintained-document fixes in that canonical `filterest/` subtree, then regenerate
the mirror. Direct edits in the sibling mirror are temporary unless ported back
to that canonical public source.

## GitHub Publication

The approved Filterest repository is `kanilmari/filterest`. Standing owner
authorization permits the source-repository publication action after every
required local and manual-final evidence gate passes:

```bash
./filterest_release publish --yes
```

The approved publish command builds Linux `amd64` and `arm64` binaries plus
SHA-256 checksum files on the maintainer machine, pushes the reviewed `main`
commit and matching version tag derived from `app/VERSION_APP`, and uploads those reviewed local
assets directly to GitHub Release storage. GitHub Actions must remain disabled;
GitHub stores the release but does not execute it. Do not create or move these
version tags by hand.

The command re-verifies both clean repositories, source evidence, the approved
`origin/main` contract, the local cross-compilation toolchain, and the account
Actions-disable policy before pushing Filterest. No generation command adds,
replaces, or pushes a remote.

The maintainer machine needs Go, `gcc`, and the ARM64 cross-compiler. On
Ubuntu-family systems the one-time ARM64 prerequisite is:

```bash
sudo apt install gcc-aarch64-linux-gnu
```

The resulting binaries keep WebP support and dynamically link only the
reviewed host glibc/libm surface. The builder rejects binaries requiring newer
than glibc 2.34, verifies both architectures' embedded Go version and module
set against the retained third-party manifest, and the admin installer checks
the same glibc floor before using a prebuilt binary.

## Updating Later Releases

Regenerate with `./filterest_release generate`, inspect the resulting commit,
and run `verify`. When the next source commit is strictly the published-identity
promotion, `fast-patch` may assemble the final identity without rebuilding the
already audited bundles. Use `publish --yes` only after every gate passes; do not ask
for a second publication confirmation. Keep private apps, config, runtime data, and unclear media outside the
public history.

## Release Source Boundary

The canonical `filterest/` subtree is the durable public-source owner.
Its containing maintainer-workspace Git history and private DB-native development records do
not transfer into the standalone publication repository.

Filterest is mirrored into its own repository without copying non-public
maintainer-workspace history. The active standalone checkout is `../filterest`.
