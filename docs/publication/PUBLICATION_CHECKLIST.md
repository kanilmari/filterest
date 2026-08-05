# Publication Checklist

This sibling repository was synced from the non-public maintainer release
source for stable Filterest review. `filterest` is the owner-approved stable
repository target. Stable-specific fresh-clone, runtime, browser, and preview
evidence must be repeated before remote publication.

## Current Verdict

`filterest` is approved as the active stable generation and repository target.
Owner-policy rows are decided, but the stable-only evidence rows below remain
`blocked-evidence`. The local stable release-readiness gate therefore remains
blocked until those rows are replaced by evidence for the exact stable commit.
Generated deterministic evidence is summarized in
[`PUBLICATION_EVIDENCE.md`](PUBLICATION_EVIDENCE.md), and current runtime and
Computer Use artifacts are attached to non-public maintainer ticket #834.

Earlier beta runtime and Computer Use artifacts are historical. They must not
be described as fresh stable evidence. Create fresh structured runtime,
browser, and Computer Use artifacts for the exact stable commit before changing
the blocked rows below to `done`.

This checklist governs the active stable `filterest` channel only. Alpha is
retired from the active workflow, and `filterest-beta` is now a read-only
predecessor unless the release owner explicitly reopens it. Stable is generated
from a clean non-public maintainer release-source commit into its own GitHub
repository with a fresh initial artifact commit. Non-public maintainer-source,
alpha, and beta history is not copied into stable. The active checkout is
`../filterest`.

Each candidate must preserve the artifact traceability contract in
`PUBLICATION_EVIDENCE.md` and compatibility metadata: accepted maintainer
release-source commit, application version, database version, generation time,
and generated artifact commit.

## Status Legend

- `done`: completed, with evidence linked in this file or in the release ticket.
- `blocked-human`: waiting for a named human/project owner decision.
- `blocked-evidence`: waiting for a repeatable scan, build, review, or artifact.
- `deferred-approved`: intentionally deferred with the approving owner named.
- `manual-final`: final human review of exact-candidate evidence.
- `gated-authorized`: standing owner authorization applies automatically after every listed gate passes.

## Required Before Production-Ready Public Release

| Priority | Gate | Status | Owner | Evidence or decision required |
| --- | --- | --- | --- | --- |
| P0 | Final source license chosen | done | Human release owner | Owner confirmed that stable `filterest` uses GPLv2 / `GPL-2.0-only`, continuing the same generated-only public license boundary as the predecessor channels. |
| P0 | Final `LICENSE` file present | done | Human release owner + release agent | `LICENSE` contains the GNU General Public License version 2 text and package metadata declares `GPL-2.0-only`; verify both after every candidate regeneration. |
| P0 | Security disclosure path | done | Human release owner + release agent | Owner approved `support@filterest.fi` as the private vulnerability channel and prohibited public vulnerability reports; verify generated `SECURITY.md` after regeneration. |
| P0 | Contribution terms | done | Human/project owner + release agent | Owner approved the owner-led posture: unsolicited public pull requests are not the routine operating model; normal feedback scope and private vulnerability reporting remain available. Verify generated `CONTRIBUTING.md` and README after regeneration. |
| P0 | Notice and trademark wording | done | Human/project owner | Owner directed on 2026-08-03 that the accepted Filterest Oy ownership, distinct-name, and allowed-use wording be consolidated in `NOTICE`; reopen after material wording changes. |
| P0 | Third-party notices | done | Release agent + human/project owner | Owner accepted the current `THIRD_PARTY_NOTICES.md`; the generated `THIRD_PARTY_NOTICE_REVIEW.md` is authoritative for current Go, npm, and asset totals plus review-required rows and findings. Reopen if the notice bytes or inventory changes. |
| P0 | First-ever admin credential path | done | Release agent + Human/project owner | Fresh installs expose the one-time environment, sign-in verification, site identity, username, email address, and password flow only while the server-owned `first_run` setting is true and no login-ready admin exists. Site identity, account data including the hashed password, protected verification data, admin membership, and flag closure share one database transaction and fail closed. |
| P0 | Public bootstrap content review | done | Release agent + Human/project owner | [`server_tools/public_bootstrap/REVIEW.md`](../../server_tools/public_bootstrap/REVIEW.md) passes for 43 schema tables, 23 seed tables, and 625 counted fixture rows; the reviewed public scope includes the complete First Run environment, verification, identity, credential, and four-dataset image-upload flow. |
| P0 | Private source boundary | done | Release agent | The clean candidate and tracked-tree audit pass; [`PUBLICATION_EVIDENCE.md`](PUBLICATION_EVIDENCE.md) records the exact current release-source commit. |
| P0 | Secret/private-material scan | done | Release agent | Current tracked-file and candidate scans pass with no private app/tool rows, secrets, or non-public release-source runtime files in the generated repository. |
| P0 | Fresh-clone public build/test | blocked-evidence | Release agent | Run the complete fresh-clone build and test against the exact stable commit; predecessor proof does not satisfy this row. |
| P0 | Browser review uses Filterest runtime | blocked-evidence | Release agent + Computer Use | Run the structured verifier and browser proof against the stable checkout's own runtime and database on port 8100. |
| P0 | Current browser release-readiness acceptance | blocked-evidence | Human release owner | Review and accept the exact stable runtime after fresh automated evidence exists. |
| P1 | Draft/private-maintainer wording cleanup | done | Release agent | The current 9-file public docs wording audit passes with no draft/private-maintainer launch blockers. |
| P1 | Recovery and rollback wording | done | Release agent | Public docs do not claim supported row, table, or full-database rollback. Whole-table or whole-database recovery is manual from backups, and single-row rollback is unsupported until row history exists. |
| P1 | Public screenshots/demo data | done | Release agent | [`server_tools/public_bootstrap/DEMO_ASSET_REVIEW.md`](../../server_tools/public_bootstrap/DEMO_ASSET_REVIEW.md) passes for 5 auth-tour JPEGs and 9 fixture storage assets; the current runtime also renders reviewed fixture images. |
| P1 | Public CI and local-preview posture | blocked-evidence | Release agent | Prove the stable checkout's local preview and repeat the account-wide GitHub Actions disable audit before publication. |
| P2 | Local release evidence review | manual-final | Human release owner | Review this checklist, ticket evidence, generated commit, and approved remote state before authorizing a push. |
| P2 | GitHub repository target | done | Human release owner | Owner selected the fresh stable `kanilmari/filterest` repository on `main`. `filterest-beta` is its read-only predecessor. Only the approved `origin` and `main` upstream are allowed. |
| P2 | Remote push | gated-authorized | Release agent under standing owner authorization | Push a reviewed clean commit only to stable `filterest` after every required local gate and the manual-final evidence review pass. Do not request a second publication confirmation. The approved publish command also pushes the matching `v<VERSION_APP>` tag, which builds checksum-verified Linux admin binaries. |

## Evidence Log

Add one dated line per publication-candidate attempt:

| Date | Release source commit | Generated Filterest commit | Evidence summary |
| --- | --- | --- | --- |
| 2026-07-25 | Historical beta evidence | Historical beta commit | Predecessor evidence only; it cannot satisfy the stable blocked-evidence rows. No stable remote push was performed. |

## Local Generation Command

```bash
./filterest_release status
./filterest_release generate
./filterest_release verify
```

Run the command from the non-public maintainer release source. During iterative local
testing, use repo-local ignored staging targets rather than overwriting the
active publication checkout from dirty source state. The only active sibling
sync target is `../filterest`. Publication candidates must be generated
from a clean release-source checkout without `--allow-dirty`.

The wrapper fixes the target to the active stable `filterest` channel. Publishing
uses the standing owner authorization through `./filterest_release publish --yes`
only after every exact-candidate and manual-final evidence gate passes.
That command must build both administrator binaries locally and must fail before
any push if GitHub Actions is enabled outside the approved `try_it_html`
exception. GitHub only stores the reviewed commit, tag, and release files.
