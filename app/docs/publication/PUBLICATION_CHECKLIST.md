# Publication Checklist

This repository is mirrored from the canonical `filterest/` public-source
source for Filterest review. `filterest` is the owner-approved repository target. Exact
fresh-clone, runtime, browser, and preview evidence must be repeated before
remote publication.

## Current Verdict

`filterest` is approved as the active generation and repository target.
Owner-policy rows are decided. The repeatable exact-release evidence rows below
remain `manual-final`: their volatile commit IDs, hashes, and artifact paths live
in the owner-only local Phase 6 final-readiness manifest, not in this generated
file or in a ticket. The local release-readiness gate may proceed only after the
manifest and the current final commit have been compared directly.
Derived deterministic evidence is summarized in
[`PUBLICATION_EVIDENCE.md`](PUBLICATION_EVIDENCE.md). Current runtime,
browser-audit, and explicit human UI-acceptance artifacts must be hashed into
the local Phase 6 final-readiness manifest before the manual-final review
passes.

Earlier Filterest runtime, browser, and human UI-acceptance artifacts are
historical. They must not be described as evidence for the current release.
Create fresh structured runtime and browser artifacts, then record the human
release owner's named UI checks for the exact candidate before completing the
`manual-final` evidence review.

This checklist governs the current `filterest` release. Filterest is mirrored
from a clean canonical public-source commit into its own GitHub repository.
Non-public maintainer-workspace history is not copied. The active checkout is `../filterest`.

Each candidate must preserve the artifact traceability contract in
`PUBLICATION_EVIDENCE.md` and compatibility metadata: accepted maintainer
release-source commit, application version, database version, generation time,
and generated artifact commit.

## Status Legend

- `done`: completed, with evidence linked in this file or its named local Phase 6 proof.
- `blocked-human`: waiting for a named human/project owner decision.
- `blocked-evidence`: waiting for a repeatable scan, build, review, or artifact.
- `deferred-approved`: intentionally deferred with the approving owner named.
- `manual-final`: final human review of exact-candidate evidence.
- `gated-authorized`: standing owner authorization applies automatically after every listed gate passes.

## Required Before Production-Ready Public Release

| Priority | Gate | Status | Owner | Evidence or decision required |
| --- | --- | --- | --- | --- |
| P0 | Final source license chosen | done | Human release owner | Owner confirmed that Filterest uses GPLv2 / `GPL-2.0-only` for its canonical public source. |
| P0 | Final `LICENSE` file present | done | Human release owner + release agent | `LICENSE` contains the GNU General Public License version 2 text and package metadata declares `GPL-2.0-only`; verify both after every candidate regeneration. |
| P0 | Security disclosure path | done | Human release owner + release agent | Owner approved `support@filterest.fi` as the private vulnerability channel and prohibited public vulnerability reports; verify canonical `SECURITY.md` after material changes. |
| P0 | Contribution terms | done | Human/project owner + release agent | Owner approved the owner-led posture: unsolicited public pull requests are not the routine operating model; normal feedback scope and private vulnerability reporting remain available. Verify canonical `CONTRIBUTING.md` and README after material changes. |
| P0 | Notice and trademark wording | done | Human/project owner | Owner directed on 2026-08-03 that the accepted Filterest Oy ownership, distinct-name, and allowed-use wording be consolidated in `NOTICE`; reopen after material wording changes. |
| P0 | Third-party notices | done | Release agent + human/project owner | Owner accepted the current `THIRD_PARTY_NOTICES.md`; the generated `THIRD_PARTY_NOTICE_REVIEW.md` is authoritative for current Go, npm, and asset totals plus review-required rows and findings. Reopen if the notice bytes or inventory changes. |
| P0 | First-ever admin credential path | done | Release agent + Human/project owner | Fresh installs expose the one-time environment, sign-in verification, site identity, username, email address, and password flow only while the server-owned `first_run` setting is true and no login-ready admin exists. Site identity, account data including the hashed password, protected verification data, admin membership, and flag closure share one database transaction and fail closed. |
| P0 | Public bootstrap content review | done | Release agent + Human/project owner | [`app/server_tools/public_bootstrap/REVIEW.md`](../../server_tools/public_bootstrap/REVIEW.md) is authoritative for the current schema-table, seed-table, fixture-row, and demo-asset counts; the reviewed public scope includes the complete First Run environment, verification, identity, credential, and four-dataset image-upload flow. |
| P0 | Private source boundary | done | Release agent | The clean candidate and tracked-tree audit pass; [`PUBLICATION_EVIDENCE.md`](PUBLICATION_EVIDENCE.md) records the exact current release-source commit. |
| P0 | Secret/private-material scan | done | Release agent | Current tracked-file and candidate scans pass with no private app/tool rows, secrets, or non-public release-source runtime files in the generated repository. |
| P0 | Fresh-clone public build/test | manual-final | Release agent | Exact stable proof: the Phase 6 final-readiness manifest must bind the final HEAD for the version recorded in `app/VERSION_APP` to the clean disposable-clone, dependency-audit, full public-QA, and focused security/operations evidence hashes. Historical evidence cannot satisfy this row. |
| P0 | Browser review uses Filterest runtime | manual-final | Release agent + browser audit | Exact stable proof: the Phase 6 final-readiness manifest must bind the final HEAD for the version recorded in `app/VERSION_APP` to its isolated port-8100 runtime, structured verifier report, screenshot, and browser-audit evidence hashes. Historical runtime artifacts cannot satisfy this row. |
| P0 | Current browser release-readiness acceptance | manual-final | Human release owner | Exact stable proof: the Phase 6 final-readiness manifest must bind the current owner approval, named UI checks, accepted dependency-notice hash, candidate source commit, and final frontend tree to the final HEAD for the version recorded in `app/VERSION_APP`. Historical acceptance cannot satisfy this row. |
| P1 | Draft/private-maintainer wording cleanup | done | Release agent | The current public docs wording audit passes with no pre-release or private-maintainer launch blockers. |
| P1 | Recovery and rollback wording | done | Release agent | Public docs do not claim supported row, table, or full-database rollback. Whole-table or whole-database recovery is manual from backups, and single-row rollback is unsupported until row history exists. |
| P1 | Public screenshots/demo data | done | Release agent | [`app/server_tools/public_bootstrap/DEMO_ASSET_REVIEW.md`](../../server_tools/public_bootstrap/DEMO_ASSET_REVIEW.md) passes for 5 auth-tour JPEGs and 15 immutable bootstrap fixture sources; first-run setup materializes runtime copies under the mutable data root. |
| P1 | Public CI and local-preview posture | manual-final | Release agent | Exact stable proof: the Phase 6 final-readiness manifest must bind the final HEAD for the version recorded in `app/VERSION_APP` to its current port-8100 preview proof and a fresh account-wide Actions policy-audit hash. Historical preview or policy evidence cannot satisfy this row. |
| P2 | Local release evidence review | manual-final | Human release owner | Review this checklist, the local Phase 6 final-readiness manifest, generated commit, and approved remote state before authorizing a push. |
| P2 | GitHub repository target | done | Human release owner | Owner selected `kanilmari/filterest` on `main`. Only the approved `origin` and `main` upstream are allowed. |
| P2 | Remote push | gated-authorized | Release agent under standing owner authorization | Push a reviewed clean commit only to `filterest` after every required local gate and the manual-final evidence review pass. Do not request a second publication confirmation. The approved publish command also pushes the matching `v<VERSION_APP>` tag, which builds checksum-verified Linux admin binaries. |

## Evidence Log

Add one dated line per publication-candidate attempt:

| Date | Release source commit | Generated Filterest commit | Evidence summary |
| --- | --- | --- | --- |
| 2026-07-25 | Earlier Filterest evidence | Earlier Filterest commit | Historical evidence only; it cannot satisfy the current exact-commit evidence rows. No current remote push was performed. |
| 2026-08-18 | `e14f788226c32dbba4f0ffb7c491ac49effe3c28` | `8326ea4849a76e35353b7dda367b62bc66f0f055` | Exact stable proof: fresh-clone QA PASS, isolated Filterest 9.1.0 runtime verifier 37/37 PASS, browser audit accessibility/best-practices 100/100 with zero P1 findings, account-wide GitHub Actions policy PASS, and explicit owner direction to deploy only this corrected 8.33.0 version to Fintravel production. |

## Local Generation Command

```bash
./filterest_release status
./filterest_release generate
./filterest_release verify
```

After a fully reviewed candidate is promoted in exactly one source commit, the
maintainer may use `./filterest_release fast-patch`. The command requires the
clone-local audited-candidate marker to match the clean candidate commit,
identity, evidence source, and `app/frontend/dist` tree. It creates one local
published-identity commit and refreshes final third-party notice evidence, but
does not publish and does not replace the final `publish --yes` full gate. A
successful Fast Patch also writes clone-local final-assembly proof. After the
final runtime, browser, Actions-policy, human UI-acceptance, and
dependency-notice review, use `attest-final` to bind their exact paths and
hashes directly to final HEAD in the owner-only local Phase 6 final-readiness
manifest. Publication fails closed when either marker or any bound byte is
missing, stale, moved, or changed.

Run the command from the maintainer source repository. During iterative local
testing, use repo-local ignored staging targets rather than overwriting the
active publication checkout from dirty source state. The only active sibling
sync target is `../filterest`. Publication candidates must be generated
from a clean canonical-source checkout without `--allow-dirty`.

The wrapper fixes the target to the active `filterest` repository. Publishing
uses the standing owner authorization through `./filterest_release publish --yes`
only after every exact-candidate and manual-final evidence gate passes.
That command must build both administrator binaries locally and must fail before
any push if GitHub Actions is enabled outside the approved `try_it_html`
exception. GitHub only stores the reviewed commit, tag, and release files.
