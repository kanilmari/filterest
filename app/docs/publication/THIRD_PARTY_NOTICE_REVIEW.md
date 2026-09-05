# Filterest Third-Party Notice Review

- Target: `generated Filterest export tree`
- Filterest app version: `9.2.3`
- Database version: `9.7.2`
- Go metadata source: `GOOS=linux GOARCH=amd64 CGO_ENABLED=1 go list -deps metadata for filterest[linux-release]:. tags=netgo osusergo; filterest[container]:.; filterest-admin-recovery[container]:./server_tools/admin_credential_recovery, plus compiled vendored components and Go toolchain`
- npm metadata source: `package-lock.json production dependency graph`
- browser bundle metadata source: `app/server_tools/licenses/browser_bundle_provenance.json matched against app/package-lock.json and app/frontend/dist/*.js`
- compiled Go modules matched: `18`
- Go runtime or vendored components matched: `2`
- runtime npm packages matched: `0`
- browser bundle build components matched: `3`
- third-party asset files matched: `80`
- first-party asset files matched: `48`
- source files containing third-party icon geometry matched: `6`
- retained legal and attribution documents verified: `34`
- unresolved third-party rows: `0`
- Findings: `0`

## Verdict

PASS

## Findings

- Dependency identities, asset provenance, notice rendering, and every retained legal/attribution document hash match the generated release tree.

## Human Review Boundary

This deterministic report verifies that every first-party group carries the required owner-attested rights fields, but does not independently prove authorship or transfer of rights.
It does not itself approve the legal sufficiency of the dependency notices.
Owner approval is recorded separately against the exact notice and manifest bytes and must be reopened if either changes.
