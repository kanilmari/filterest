# Building Linux release assets

The maintained implementation lives here: `build_assets.sh` and
`verify_binary_manifest.py`. The public installation command is:

```bash
./filterest release build --output-dir /tmp/filterest-release-build --check-only
```

This checks required source/license files and the availability of Git, Go, native
GCC, `aarch64-linux-gnu-gcc`, Python 3, GNU binutils/coreutils, tar and gzip. It
creates no output, downloads nothing and does not start an application. It does
not certify the source's release readiness or test a compiler's ABI output.

Both modes first run the release source checks, which also run on their own
as `./filterest release verify` (implemented by `verify_source.py` beside this
guide). In order, and stopping at the first failure, they check:

- the source boundary (`audit_source_boundary.py`): operator homes are neither
  tracked nor unignored, tracked symlinks stay inside the checkout, and no
  tracked source addresses a private owner name passed with `--forbidden-name`;
- the repository root (`audit_public_root_files.py`): tracked root files match
  `public_root_files.txt`, so a new root launcher or policy file and its entry
  there belong in the same commit;
- the release ledger, the app/database compatibility record and the public
  bootstrap package;
- the demo media (`audit_public_demo_assets.py`), including secret-like text and
  any extra marker passed with `--forbidden-marker`;
- the tracked browser bundle (`audit_browser_bundle.py`): the minified files
  under `app/frontend/dist/` are rebuilt into a temporary directory and compared
  with the tracked ones, so no release ships an interface that its own source no
  longer produces. This check runs the frontend build and therefore needs the
  installation's Node dependencies; when it cannot build, it fails and says so
  rather than passing quietly.

Filterest lists no private names itself; a workspace that embeds it supplies
them. Each check can also run alone, for example
`python3 app/server_tools/release/audit_source_boundary.py`.

To assemble an actual release, first prepare and commit the reviewed source and
release metadata according to the [publication checklist](../../docs/publication/PUBLICATION_CHECKLIST.md).
Then run the same command without `--check-only`, with a new or empty output
directory **outside the entire source checkout**:

```bash
./filterest release build --output-dir /tmp/filterest-release-build
```

The builder rejects an unclean checkout and never bypasses that check to reuse
an already published version number. It does not prepare version numbers,
regenerate notices, commit, tag, upload, publish or deploy. A development change
can be tested without claiming that it produced a publishable release.

The target defaults to the current tool's installation root. Direct tool callers
may select a complete reviewed installation with `--target PATH`; this does not
copy, recreate or replace source. Go workspace composition is disabled, module
changes are forbidden, and default Go caches live under the target installation's
ignored `data/runtime/go/`. Explicit cache overrides remain supported. No parent
source repository or private Python module is required.

Release builds pin baseline processor levels (amd64 v1 and arm64 v8.0), disable
persisted Go settings and normalize Cgo flags so machine-specific optimizations
cannot silently raise the processor requirement.

A real build checks both Linux architectures, the recorded processor baseline,
the allowed glibc/libm dynamic library boundary, maximum required GLIBC symbol version 2.34, and the exact Go
version and compiled module set recorded in `THIRD_PARTY_LICENSES/manifest.json`.
A compiler whose output requires newer glibc is rejected; command availability
alone does not prove compiler compatibility. Use a matching build environment,
not a relaxed compatibility check.

The output is fourteen files: two Linux server binaries, four version-named
license/notice documents, one deterministic third-party-license archive, and one
SHA-256 sidecar for each of those seven assets. Every checksum is read back.
Failure may leave partial artifacts in the selected output directory; retain
failure evidence and choose a fresh or deliberately cleaned output before retry.

The standalone binary verifier can also inspect an already built artifact:

```bash
python3 app/server_tools/release/verify_binary_manifest.py \
  --manifest THIRD_PARTY_LICENSES/manifest.json \
  --binary /tmp/filterest-release-build/filterest-linux-amd64 \
  --architecture amd64 --binary-target filterest
```

After all release checks, retain verified output and build receipts in the
installation's ignored `data/release/<version>/` area. Uploading those assets is a
separate operation bound to the reviewed Git commit and release identity.
Candidate metadata is prepared by [`./filterest release prepare`](PREPARING_RELEASES.md).
Continue with [candidate promotion](PROMOTING_RELEASES.md), rebuild final assets
from the committed published identity, then inspect the
[publication plan](PUBLISHING_RELEASES.md) before applying it.
