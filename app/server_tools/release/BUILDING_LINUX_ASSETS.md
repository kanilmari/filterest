<!-- BUILDING_LINUX_ASSETS.md -->
<!-- Defines candidate native assets and final unsigned source/OCI bundle contracts. -->
<!-- Connects reviewed Git history and explicit requirements to local packaging. -->
<!-- Keeps operator state and signing secrets outside build automation. -->
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

The candidate output is fourteen files: two Linux server binaries, four version-named
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

Keep built payloads outside source. Receipts may be retained in the installation's
ignored `data/release/<version>/` area; publication requires an outside bundle directory.
Uploading is a separate operation bound to the reviewed commit and signed inventory.
Candidate metadata is prepared by [`./filterest release prepare`](PREPARING_RELEASES.md).
Continue with [candidate promotion](PROMOTING_RELEASES.md), rebuild final assets
from the committed published identity, then inspect the
[publication plan](PUBLISHING_RELEASES.md) before applying it.

## Final unsigned source and OCI bundle

Candidate promotion still uses exactly those fourteen files. From final published
commit **P**, build with `--bundle-spec /outside/reviewed-requirements.json`,
`--published-commit <full-P>` and, for each managed image,
`--oci-archive amd64=/outside/prebuilt-image.tar` (or `arm64`). The builder never
invokes Docker. It accepts prebuilt **uncompressed single-image OCI layout tars**,
not Docker-save archives, registry tags, multi-image indexes or foreign/remote blobs.
Final images must already have been built/rehearsed from the pinned composition;
do not rebuild or substitute an image after signing.

The packaging command can also extend already verified final native output:

```bash
python3 app/server_tools/release/build_bundle.py \
  --published-commit <full-P> --assets-dir /outside/final-assets \
  --bundle-spec /outside/reviewed-requirements.json \
  --oci-archive amd64=/outside/prebuilt-image.tar
```

The specification contains exactly these manifest-v1 fields: `publisher`,
`release_id`, `created_at`, `product`, `minimum_trust_policy_revision`,
`composition`, `database`, `protocol`, `platform`, `health`, `recovery`, `capacity`.
Their shapes are defined in
[release_manifest.v1.schema.json](../versioning/release_manifest.v1.schema.json);
the Go parser is authoritative. The public builder requires product/composition
`filterest`, one exact Filterest component pin at P, and the published build's
database range. Supply a positive increasing composition revision and explicit
supported starting combinations. This tool cannot discover a site's safe legacy
baseline or manufacture past migration execution evidence.

Each selected migration declares its component, filename, database version,
version ownership, transaction and error policies. Its `content_sha256` may be
omitted in the specification: the packager fills it from the pinned Git blob;
a supplied mismatching hash is refused. The source's `VERSION_DB` marker and
`skip-on-error` directive must agree. Transaction policy and version ownership
are reviewed claims, not SQL execution proofs. The final globally ordered
inventory must equal the union of the explicit routes and each route must end
with its target-version owner. Do not omit required migration work; unresolved
or unverified historical evidence requires a separate baseline audit.

Generated fields are schema/type, version/tag, published commit, build identity,
artifact hashes/sizes/platforms and OCI descriptors. The build identity retains
its **source C**; it is never rewritten to P. Source archives use the complete
reviewed Git tree at P, preserving regular file bytes/executable modes. Operator
homes, symlinks, submodules and export attributes that omit/change members are
refused. Ignored caches, keys and worktree edits cannot enter the archive.

Native targets declare baseline CPU features and glibc 2.34.0; OCI targets declare
Linux/architecture, empty CPU features and no host libc. Include every distinct
target in the specification. Docker requirements require at least one OCI image.
Each OCI image config must carry the labels returned by `oci_archive.identity_labels`:

- `org.opencontainers.image.revision`: the composition's published commit;
- `org.opencontainers.image.version`: the shared Filterest application version;
- `com.filterest.build-identity-sha256`: SHA-256 of canonical build identity plus LF;
- `com.filterest.composition` and `com.filterest.composition-revision`;
- `com.filterest.component.<id>.commit` and `.version` for each pinned component.

The layout's manifest/config descriptors, every blob hash/size, platform and
uncompressed layer diff IDs are checked. Unreferenced blobs and ambiguous members
are refused. Archives are inspected without extraction/loading. Expanded sizes
are conservative file-content allocations (OCI includes decoded layer bytes),
at least the archive size; installation capacity still needs a separate preflight.

One-image public output has **19 unsigned files**: the fourteen native files,
`filterest-<version>-source.tar.gz` and its checksum, one
`filterest-<version>-oci-linux-<architecture>.tar` and its checksum, and
`release_manifest.v1.json`. The canonical manifest signs every payload and checksum;
detached signatures are separate to avoid a circular inventory. A native-only
bundle has 17 unsigned files. Agents/build tools stop here. Follow the owner's
[terminal signing and publication handoff](PUBLISHING_RELEASES.md).

## Contract for an embedding composition builder

The later private builder owns its own pinned private commit, increasing
composition revision, private migration routes and separate signing key. Reuse
`source_archive.package_source`, `bind_migrations`, `oci_archive.identity_labels`
and `verify_oci_archive`, and the same canonical manifest v1. Retain the verified
public native/notices set and public build identity; add one
`<component>-<component-version>-source.tar.gz` per component, with its checksum,
and composition-prefixed OCI names using the shared app version. Merge migration
filenames globally without collisions. Call `verify_signed_bundle` with the
independently chosen composition and `component_sources` mapping each component
to its reviewed repository and migration prefix. Paths never come from a manifest.
The public builder/publisher refuse private composition output. Private payloads
must use the private publication channel; no private builder is implemented here.
