# Publishing Filterest

This Filterest repository is intentionally local-first. The generator syncs it
from the maintainer release source, preserves its own `.git` history, and does
not create a GitHub remote or push.

This repository is a generated artifact. Prefer changing the maintainer release
source or the export generator, then regenerating this checkout. Direct edits in
the generated repository should be treated as temporary unless they are ported
back before the next export.

## Local Review

```bash
git status --short
git log --oneline --max-count=3
cat VERSION_APP
cat VERSION_DB
```

Review `docs/publication/PUBLICATION_CHECKLIST.md` before publishing. Every
Filterest update must come from a clean maintainer release-source commit and a
reviewed sibling-repo commit.

From the maintainer release source, use the release wrapper:

```bash
./filterest_release status
./filterest_release generate
./filterest_release verify
```

`generate` regenerates the sibling repository and runs the candidate checks.
`verify` repeats the checks against the current artifact without regenerating
it. Ordinary source commits only mark the release pending.

Treat this local sibling checkout and its preview database as review candidates.
Make durable code, schema, seed, env, language-key, and setup fixes
in the maintainer release-source generator or source files, then regenerate this
repository. Direct edits inside the generated Filterest checkout are disposable
unless they are intentionally converted back into release-source changes.

## GitHub Publication

The approved Filterest repository is `kanilmari/filterest`. Standing owner
authorization permits the source-repository publication action after every
required local and manual-final evidence gate passes:

```bash
./filterest_release publish --yes
```

The approved publish command builds Linux `amd64` and `arm64` binaries plus
SHA-256 checksum files on the maintainer machine, pushes the reviewed `main`
commit and matching `v<VERSION_APP>` tag, and uploads those reviewed local
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

The resulting binaries keep WebP support but are statically linked, so an
administrator does not inherit the maintainer machine's Linux library version.

## Updating Later Releases

Regenerate with `./filterest_release generate`, inspect the resulting commit,
and run `verify`. Use `publish --yes` only after every gate passes; do not ask
for a second publication confirmation. Keep private apps, config, runtime data, and unclear media outside the
public history.

## Release Source Boundary

The non-public maintainer release source is the only durable development
upstream. Its Git history and DB-native development records do not transfer
into the generated publication repository.

Filterest is published in its own repository with a fresh initial artifact
commit; non-public maintainer-source history is not copied. The active checkout
is `../filterest`.
