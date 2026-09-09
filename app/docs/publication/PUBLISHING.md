# Publishing Filterest

## Maintained source

This Git repository is the maintained source for Filterest and its development
tools. Application code, migrations, tests, product documentation, and version
contracts live under `app/`; the root contains portable launchers and project
policies. No parent or sibling source repository is required for development.

A new contributor may clone the public repository normally. Once a checkout is
the project's authoritative working repository, make durable changes and
commits there. Never regenerate or replace that checkout from another
repository, a fresh clone, an old working folder, or a release copy. Apply
reviewed changes through Git while preserving existing history and local work.
Moving the containing directory does not change GitHub repository identity.

## Ordinary source development

Use the [development commands](../../../README.md#development) after the
installation's development dependencies are ready. Review the actual diff and
run checks appropriate to the changed behavior:

```bash
git status --short
git diff --check
git diff
```

Commit an understood, bounded set of changes. Before pushing, verify the target
remote and branch and reconcile newer remote commits normally; do not rewrite
published history to hide a local directory move. Contributor submission
follows [CONTRIBUTING.md](../../../CONTRIBUTING.md).

An ordinary source commit or push does not create a version tag, replace
published release assets, or deploy a site. It need not change the application
or database version when the version contract does not call for one.
Operator-owned `config/`, `keys/`, `projects/`, `data/`, and `backups/` remain
outside tracked source. A source checkout is not a database backup.

## Versioned releases

Release assembly must read the reviewed Filterest commit directly. Generated
binaries, frontend bundles, checksums, dependency notices, compatibility
snapshots, and review reports are outputs of that source; generating them must
not reconstruct or replace the maintained repository.

A versioned release binds the application and supported database versions to
the exact source commit and distributed files. Validate relevant upgrade and
recovery behavior, dependency notices, asset rights, public-source boundaries,
and the resulting runtime before publishing those files. Preserve existing
version tags and release records rather than silently moving or rewriting them.

Builds and release checks run locally. GitHub stores source, tags, and reviewed
release files; this workflow does not require GitHub Actions.

## Maintainer automation status

The maintainer release automation is being adapted to build and publish from
this directly maintained repository. It is not yet a complete standalone
release command shipped here. Ordinary local development and Git commits do
not depend on finishing that automation.

Older release records, including [publication evidence](PUBLICATION_EVIDENCE.md)
and the release-specific [publication checklist](PUBLICATION_CHECKLIST.md), may
refer to a producer repository, generated candidates, source/export pairs, or
old promotion commands. Those descriptions explain historical releases; they
are not instructions to restore that source-authority model. Do not run an
old generator against the current authoritative checkout.

The maintained [release checklist](PUBLICATION_CHECKLIST.md) and
[release notes](RELEASE_NOTES.md) describe the current direct-source process.
Until the standalone release command is complete, a maintainer may perform
the same steps with the verified build tools and ordinary Git/GitHub CLI,
recording the exact source commit, final release commit and asset hashes.
Optional external build orchestration must read this source directly.

A future supported release command must identify the exact current source,
keep build output separate from maintained files and operator state, and report
what will be pushed or uploaded. Until that command is verified, do not treat
an older wrapper documented elsewhere as proof that the new release workflow
is ready.

## Binary and dependency compatibility

Published Linux administrator binaries retain WebP support and the reviewed
host glibc/libm boundary. The current binary contract requires glibc 2.34 or
newer; its checks must cover the embedded Go version and module set for each
distributed architecture. Development toolchains and cross-compilers are
build prerequisites, not source repositories.

Dependency notices cover the release server, container server, and container
administrator-recovery binary. Shared modules retain explicit binary membership
so a dependency used only by a recovery tool is still included in the notice
inventory. See [the retained third-party review](THIRD_PARTY_NOTICE_REVIEW.md)
for the release-specific evidence.

## Public Asset Rights Boundary

The reviewed [asset-provenance register](../../server_tools/licenses/asset_provenance.json)
classifies every distributed
image and every source file that embeds third-party icon geometry. A public
candidate fails if an asset is absent from the register, its bytes change, or a
component uses the former generic first-party label without an explicit author,
rights holder, publication-rights basis, license, and owner attestation.

Filterest's project-original media is recorded in separate groups for neutral
demo placeholders, original interface SVGs, and brand or fallback graphics.
The demo placeholders are simple text images created by the human project owner
in Microsoft Paint without third-party source imagery. They are redistributed
with Filterest under GPL-2.0-or-later and require no separate attribution.
Third-party SVG sources retain their own component names, licenses, upstream
links, and exact legal-document bytes in the release license bundle.

Auth-tour screenshots are currently excluded from both source and built public
trees. Any proposed capture belongs in an ignored review area until its content
and publication rights have been reviewed. Reintroducing screenshots must not
publish user data, credentials, or another installation's private material.
