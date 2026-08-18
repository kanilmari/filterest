# Publication Checklist

This repository was synced from the non-public maintainer release source for
Filterest review. `filterest` is the owner-approved repository target. Exact
fresh-clone, runtime, browser, and preview evidence must be repeated before
remote publication.

## Current Verdict

`filterest` is approved as the active generation and repository target.
Owner-policy rows are decided, and the exact-release evidence rows below are
complete for generated Filterest commit
`479485d2df9250a94174cd5f05a7ca835849fff3` from release-source commit
`9b26b86482adf07cf4425079d508519a11bdb6b3`. The local release-readiness
gate can proceed to its final deterministic preflight.
Generated deterministic evidence is summarized in
[`PUBLICATION_EVIDENCE.md`](PUBLICATION_EVIDENCE.md), and current runtime and
Computer Use artifacts are attached to non-public maintainer ticket #834.

Earlier Filterest runtime and Computer Use artifacts remain historical. Exact
stable proof for this candidate consists of the fresh-clone QA pass, the
37-check structured runtime PASS under
`/tmp/filterest-runtime-proof-479485d`, and the Computer Use PASS under the
non-public maintainer evidence path
`agent_tasks/_artifacts/human_qa/computer_use/ticket-834/final-published-8.32.0-479485d`.

This checklist governs the current `filterest` release. Filterest is generated
from a clean non-public maintainer release-source commit into its own GitHub
repository with a fresh initial artifact commit. Non-public maintainer-source
history is not copied. The active checkout is `../filterest`.

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
| P0 | Final source license chosen | done | Human release owner | Owner confirmed that Filterest uses GPLv2 / `GPL-2.0-only` within the generated-only public license boundary. |
| P0 | Final `LICENSE` file present | done | Human release owner + release agent | `LICENSE` contains the GNU General Public License version 2 text and package metadata declares `GPL-2.0-only`; verify both after every candidate regeneration. |
| P0 | Security disclosure path | done | Human release owner + release agent | Owner approved `support@filterest.fi` as the private vulnerability channel and prohibited public vulnerability reports; verify generated `SECURITY.md` after regeneration. |
| P0 | Contribution terms | done | Human/project owner + release agent | Owner approved the owner-led posture: unsolicited public pull requests are not the routine operating model; normal feedback scope and private vulnerability reporting remain available. Verify generated `CONTRIBUTING.md` and README after regeneration. |
| P0 | Notice and trademark wording | done | Human/project owner | Owner directed on 2026-08-03 that the accepted Filterest Oy ownership, distinct-name, and allowed-use wording be consolidated in `NOTICE`; reopen after material wording changes. |
| P0 | Third-party notices | done | Release agent + human/project owner | Owner accepted the current `THIRD_PARTY_NOTICES.md`; the generated `THIRD_PARTY_NOTICE_REVIEW.md` is authoritative for current Go, npm, and asset totals plus review-required rows and findings. Reopen if the notice bytes or inventory changes. |
| P0 | First-ever admin credential path | done | Release agent + Human/project owner | Fresh installs expose the one-time environment, sign-in verification, site identity, username, email address, and password flow only while the server-owned `first_run` setting is true and no login-ready admin exists. Site identity, account data including the hashed password, protected verification data, admin membership, and flag closure share one database transaction and fail closed. |
| P0 | Public bootstrap content review | done | Release agent + Human/project owner | [`server_tools/public_bootstrap/REVIEW.md`](../../server_tools/public_bootstrap/REVIEW.md) passes for 47 schema tables, 28 seed tables, and 593 counted fixture rows; the reviewed public scope includes the complete First Run environment, verification, identity, credential, and four-dataset image-upload flow. |
| P0 | Private source boundary | done | Release agent | The clean candidate and tracked-tree audit pass; [`PUBLICATION_EVIDENCE.md`](PUBLICATION_EVIDENCE.md) records the exact current release-source commit. |
| P0 | Secret/private-material scan | done | Release agent | Current tracked-file and candidate scans pass with no private app/tool rows, secrets, or non-public release-source runtime files in the generated repository. |
| P0 | Fresh-clone public build/test | done | Release agent | Exact stable proof: clean clone of `479485d2df9250a94174cd5f05a7ca835849fff3` completed `npm ci` with 0 vulnerabilities and `npm run qa` with all checks passing on 2026-08-18. |
| P0 | Browser review uses Filterest runtime | done | Release agent + Computer Use | Exact stable proof: the generated checkout's own port-8100 runtime and `filterest_local_preview` database passed all 37 structured checks with app 8.32.0, DB 9.0.0, no HTTP 5xx, failed requests, page errors, or console errors. |
| P0 | Current browser release-readiness acceptance | done | Human release owner | Exact stable proof: the owner approved promotion to a production-suitable stable release on 2026-08-18, and Computer Use passed the exact published runtime while visibly confirming Stable, Intended for public release, Published, app 8.32.0, and DB 9.0.0. |
| P1 | Draft/private-maintainer wording cleanup | done | Release agent | The current 9-file public docs wording audit passes with no pre-release or private-maintainer launch blockers. |
| P1 | Recovery and rollback wording | done | Release agent | Public docs do not claim supported row, table, or full-database rollback. Whole-table or whole-database recovery is manual from backups, and single-row rollback is unsupported until row history exists. |
| P1 | Public screenshots/demo data | done | Release agent | [`server_tools/public_bootstrap/DEMO_ASSET_REVIEW.md`](../../server_tools/public_bootstrap/DEMO_ASSET_REVIEW.md) passes for 5 auth-tour JPEGs and 21 fixture storage assets; the current runtime also renders reviewed fixture images. |
| P1 | Public CI and local-preview posture | done | Release agent | Exact stable proof: the local Filterest preview passed on port 8100 and the 2026-08-18 account-wide audit confirmed Actions disabled for every `kanilmari` repository except the approved `kanilmari/try_it_html` exception. |
| P2 | Local release evidence review | manual-final | Human release owner | Review this checklist, ticket evidence, generated commit, and approved remote state before authorizing a push. |
| P2 | GitHub repository target | done | Human release owner | Owner selected `kanilmari/filterest` on `main`. Only the approved `origin` and `main` upstream are allowed. |
| P2 | Remote push | gated-authorized | Release agent under standing owner authorization | Push a reviewed clean commit only to `filterest` after every required local gate and the manual-final evidence review pass. Do not request a second publication confirmation. The approved publish command also pushes the matching `v<VERSION_APP>` tag, which builds checksum-verified Linux admin binaries. |

## Evidence Log

Add one dated line per publication-candidate attempt:

| Date | Release source commit | Generated Filterest commit | Evidence summary |
| --- | --- | --- | --- |
| 2026-07-25 | Earlier Filterest evidence | Earlier Filterest commit | Historical evidence only; it cannot satisfy the current exact-commit evidence rows. No current remote push was performed. |
| 2026-08-18 | `9b26b86482adf07cf4425079d508519a11bdb6b3` | `479485d2df9250a94174cd5f05a7ca835849fff3` | Exact stable proof: fresh-clone QA PASS, 37-check Filterest runtime PASS, Computer Use PASS, published/public-release identity visible, and account-wide GitHub Actions policy PASS. |

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

The wrapper fixes the target to the active `filterest` repository. Publishing
uses the standing owner authorization through `./filterest_release publish --yes`
only after every exact-candidate and manual-final evidence gate passes.
That command must build both administrator binaries locally and must fail before
any push if GitHub Actions is enabled outside the approved `try_it_html`
exception. GitHub only stores the reviewed commit, tag, and release files.
