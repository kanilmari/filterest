# Filterest Third-Party Notice Review

- Target: `generated Filterest export tree`
- Filterest app version: `9.0.1`
- Database version: `9.6.7`
- Go metadata source: `GOOS=linux GOARCH=amd64 CGO_ENABLED=1 go list -tags 'netgo osusergo' -deps metadata plus compiled vendored components and Go toolchain`
- npm metadata source: `package-lock.json production dependency graph`
- compiled Go modules matched: `17`
- Go runtime or vendored components matched: `2`
- runtime npm packages matched: `0`
- third-party asset files matched: `80`
- first-party asset files matched: `57`
- source files containing third-party icon geometry matched: `2`
- retained legal and attribution documents verified: `28`
- unresolved third-party rows: `0`
- Findings: `0`

## Verdict

PASS

## Findings

- Dependency identities, asset provenance, notice rendering, and every retained legal/attribution document hash match the generated release tree.

## Human Review Boundary

This deterministic report does not itself approve the legal sufficiency of the dependency notices.
Owner approval is recorded separately against the exact notice and manifest bytes and must be reopened if either changes.
