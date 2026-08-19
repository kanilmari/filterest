# Filterest Third-Party Notice Review

- Target: `generated Filterest export tree`
- Filterest app version: `8.35.0`
- Database version: `9.2.1`
- Go metadata source: `go list metadata with go mod download cache`
- npm metadata source: `package-lock.json with installed package.json license metadata`
- Go modules matched: `96`
- npm packages matched: `441`
- bundled asset files matched: `72`
- review-required dependency rows: `0`
- Findings: `0`

## Verdict

PASS

## Findings

- THIRD_PARTY_NOTICES.md matches the current generated dependency and bundled-asset counts, and no dependency rows require unresolved license review.

## Human Review Boundary

This deterministic report does not itself approve the legal sufficiency of the dependency notices.
Owner approval is recorded separately against the exact notice bytes and must be reopened if the inventory changes.
