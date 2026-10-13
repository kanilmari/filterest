<!-- Source_Code_Availability.md: describes keeping published Filterest releases obtainable without GitHub. -->
<!-- Connects release publication, an owned release mirror, archives and update awareness. -->
<!-- Defines mirror contents, integrity, retention and failure states without fixing a schema. -->
<!-- Keeps the server, retention window, signing and mirror-first publication owner decisions. -->

# Source Code Availability

A future feature extending Filterest's [release publication](../publication/PUBLISHING.md).
The mirror and its publication phase are not implemented.

## What it makes possible

Published Filterest versions stay obtainable when GitHub is not: during an
outage, a regional or network block, or a restriction on the publishing
account. Publishing a new version also places byte-identical copies of its
source archive and the files that verify and accompany it on a **release
mirror**, a plain file location on a server the project controls. Anyone can
download a chosen version from the mirror without an account or Git, verify it
against the release manifest and install it as a Gitless folder using the
existing [source-based installation](../../../README.md#installation-options).
Building still obtains the toolchain, dependencies and base images from their
own public sources; the mirror keeps the product's source available, not every
build input.
The owner's retention choice determines which older versions remain available.

Normally, security releases reach the mirror in the same publication that reaches
GitHub. The mirror is therefore never silently behind: a version is either in
both places, or the publication reports which copy is still missing.

The mirror is a distribution copy, not a second development home. It carries
no Git history, issues, pull requests or review discussion, and it never
accepts files that were not first verified as a complete release. GitHub
remains the canonical publication. The mirror does not back up installations
either; installation update and database recovery keep their own backups.

## Concepts

### Canonical publication and release mirror

The **canonical publication** is the GitHub release made by the release
publication command, with its version tag and verified readback. The **release
mirror** is a read-only, static HTTPS location holding exact copies of
selected files from canonical releases. It runs no application, forge or
database, so it adds no software of its own to keep patched beyond the web
server and operating system.

### Mirrored release set

The release manifest names the release artifacts and their kinds. The
**mirrored release set** contains selected artifacts plus the manifest,
any detached signatures and the reviewed release notes:

- the source archive;
- the license and notice files;
- the checksum file of each carried artifact;
- the manifest itself, detached signatures when the release is signed, and
  the reviewed release notes.

Each mirrored release asset is byte-identical to the corresponding GitHub asset.
The reviewed release notes match the text used for the canonical release.
Prebuilt server binaries and container images are left out. They can be rebuilt
from the source archive; a copy of the source does not need them.
The manifest still lists them, and the mirror index names the artifact kinds
that a version's mirror copy omits.

The mirror selects artifacts by an explicit list of carried kinds. An artifact
kind that a future release introduces stays off the mirror, and the plan
reports it, until the list is deliberately extended.

The source archive is carried whole, exactly as published. Its digest is bound
into the manifest and, for a signed release, into the signature; a reduced
archive would lose that binding. Tests, earlier schema snapshots and other
reviewed source stay in the archive.

Local publication evidence, such as the publication receipt and the owner's
approval record, is not part of any release set and stays off the mirror.

### Mirror index

The **mirror index** lists every version known to the mirror with its
application and database versions, publication time, manifest digest, signing
status, canonical release address and **availability status**:

- **Current**: the newest stable version, the one to install.
- **Superseded**: an older version without known security problems.
- **Vulnerable**: a version that a later security release replaces; the entry
  names the fixing version and any advisory.
- **Withdrawn**: a version that must not be installed; its files may be gone.

The index is the mirror's single source for which version is current. A
"latest" address and any human-readable listing are generated from it, never
maintained beside it. A security release names the versions it makes
vulnerable, and the same publication updates their entries, so a reader who
finds an old version also finds the warning. The index is language-neutral
data; the mirror needs no interface of its own.

### Mirror receipt

A **mirror receipt** records the public readback of one version: every file's
name, size and SHA-256 as downloaded through the public address, and the index
entry that made the version visible. It joins the publication receipt as
evidence. A mirror copy without a receipt is not verified.

## Publication sequence

### Same operation, same bytes

Copying to the mirror is a phase of the release publication command, run after
GitHub's verified readback and planned and applied the same way: planning reads
and reports, and only an explicit apply writes. The phase takes the mirrored
release set from the verified local release files and reviewed release notes, never
from files downloaded back from GitHub. No separate manual step, scheduled job
or GitHub automation is needed to keep the mirror current.

A server that periodically pulls new releases from GitHub was considered and
rejected. It would depend on GitHub to obtain each new release and would add a
scheduled service to maintain.

### Staging, verification and activation

1. The files go to a version-specific **staging area** that the public address
   does not serve.
2. Every staged file's size and SHA-256 are compared with the verified local
   originals. Artifacts listed in the manifest must also match its inventory;
   the manifest, signatures and release notes cannot be checked against a
   manifest entry for themselves. The staged files must be exactly the
   mirrored release set: nothing missing, nothing extra.
3. One atomic step makes the version directory public.
4. The index is updated last, also atomically, so it never names a version
   whose files are incomplete.
5. Every file is downloaded through the public address and compared again.
   Only this readback produces the mirror receipt.

A published version directory is immutable. Repeating the phase with identical
bytes verifies and changes nothing; different bytes under an existing version
are refused, as GitHub publication refuses them. Because staging, verification
and immutable versions make the phase repeatable, a failed mirror phase can
be retried separately, without rerunning GitHub publication.

### Truthful outcome

The publication reports each copy separately. When GitHub is verified and the
mirror is not, the release is reported as published with its mirror copy
pending, naming the step that failed; it is not reported as complete. A
publication is complete when both receipts exist.

### Publishing while GitHub is unavailable

A security release may be needed while GitHub cannot be reached. If the owner
allows it, the same verified mirrored release set can then reach the mirror
first. Local release verification and owner authorization still apply;
GitHub-specific checks and readback run when GitHub publication becomes possible.
The index marks the version as **mirror-first** until GitHub publication of the
identical bytes follows. A version number is never published with different
bytes in different places.

## Integrity and trust

Checksums prove that files match the manifest; they do not prove who made the
manifest when both come from the same host. Whoever controls one release
location could replace a release's files together with their checksums, and
every additional location is another account or server that could be misused
this way.

- **Signed releases**: the mirror carries the detached signatures, and anyone
  can authenticate the manifest with an independently trusted owner public key.
  Its fingerprint is published through channels independent of the mirror:
  the repository's security policy, its README and the project website.
- **Unsigned releases**: the index states the signing status plainly. A mirror
  copy is then only as trustworthy as the mirror server, and readers are told
  to compare the manifest digest with the canonical publication whenever it is
  reachable.

Installations never consume mirror files automatically unless the release is
signed and the installation trusts the key. This matches managed update
verification, which already refuses unsigned updates.
Managed OCI updates still require a complete verified bundle, including images;
the source-only mirror does not provide that bundle.

The upload uses a dedicated credential that can write only to the mirror's
staging area. It has no shell, no site deployment rights and no access to
installation data, and site deployment credentials are not reused for it. The
credential and the mirror's address are installation settings outside source.
The mirror server never holds signing keys. It serves files only: no script
execution, no rendering of release files as web pages, and HTTPS throughout.

## Retention

Leaving out prebuilt binaries and container images reduces storage needs.
Storage still grows with release size and frequency. The retention window is
an owner decision:

| Option | What stays on the mirror | Consequence |
| --- | --- | --- |
| Keep everything | Every published version | The simplest rule and the fullest copy. Storage grows steadily, and vulnerable versions stay downloadable behind their index status. |
| Rolling window | The current version, the previous stable version and the last version of each earlier minor line | Reduced storage and a rollback target. Older versions depend on Git and canonical releases rather than the mirror. |
| Current only | The current version | Minimal storage, but no rollback target while GitHub is unavailable. |

Keeping everything is the suggested starting point: it needs no
pruning rule, and the index status already warns about vulnerable versions. If
a window is chosen later, pruning happens only after the replacing version's
mirror receipt exists. A pruned version keeps its index entry and status, so a
link to it is explained rather than simply broken.

## Update awareness and the updater

The administrator's update notice and the Git updater learn about new versions
only from GitHub. When GitHub is unreachable, the notice reports that update
status is unavailable and the updater refuses. Until either can read the
mirror, the fallback is the existing Gitless path: download the current
source archive from the mirror, verify it, and use the
[Gitless upgrade procedure](../instructions_and_documentation/Installation_Update_And_Recovery.md#updating-older-docker-releases):
take a backup and carry only the five operator-owned directories into the
complete reviewed release folder, then build from source.

The index is shaped so that the existing update awareness can later read it as
a second source, with the same version facts and the canonical address
alongside. That extension belongs to the existing update awareness and updater,
not to a second checker, and automatic updates from the mirror require signed
releases as stated above.

## Other copies

The mirror is the copy the project controls. Other locations complement it
without joining the publication sequence:

- **Archive services** such as Software Heritage aim to preserve public source
  history independently of the release mirror. Automatic discovery can take a
  long time, so publication may request an archive visit where supported.
  Archived source history complements the release files rather than replacing them.
- **Third-party release hosts** are added only when they copy canonical
  releases automatically or can join the publication command, so a security
  release never depends on remembering a manual upload.

Any additional home must accept the project as it is developed. Some community
forges may restrict projects written mainly with generative AI tools, and
Filterest is developed with AI assistance, so a host's current terms are
checked before it is added and again when they change. At least one copy should
sit with an operator and jurisdiction other than GitHub's. The official
download locations are listed in one canonical place in the repository, so
users can tell an official mirror from an impostor.

## Open owner decisions

- **Server and address**: which server hosts the mirror and under which host
  name. A dedicated host name, separate from production sites, keeps a site
  incident and a mirror incident from becoming one.
- **Retention window**: one of the options above.
- **Signing**: whether releases are signed before the mirror starts serving
  them, given that readers cannot authenticate unsigned mirror copies.
- **Mirror-first publication**: whether a security release may reach the
  mirror before GitHub while GitHub is unavailable.

## Implementation principles

- Extend the release publication command and its existing verification of the
  release files; do not create a second verifier or a second inventory.
- Keep the mirror target, its public address and its upload credential in
  installation settings, never in source.
- Cover the mirror phase with automated tests against a local target and a
  local web server, including partial staging, a repeated run, a refused byte
  change and an interrupted index update.
- Add no GitHub automation and no server-side polling of GitHub.
