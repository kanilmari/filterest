# Filterest 9.3.3 publication evidence

This release is assembled directly from the independently maintained Filterest
repository. This file records source and metadata checks; successful remote
publication is established by the GitHub release and its uploaded files.

- Reviewed source commit: `d9402094628ab4f496c74980d66ac559e6f46318`.
- Application version: **9.3.3**.
- Compatible database version: **9.7.13**.
- Source model: `public_first`.
- The final `v9.3.3` tag identifies the release commit containing these derived
  files; it follows the reviewed source commit without reconstructing source.

## Verified source and metadata

- The development setup, portable launchers, bootstrap contract and release
  ledger pass 54 targeted Python tests in Filterest's own environment.
- The ledger retains every byte of the prior 133-record published history and
  appends one new release identity derived from the reviewed source commit.
- The application/database compatibility validator and public bootstrap audit
  pass. Bootstrap SQL and the DB 9.7.13 schema snapshot are unchanged.
- The selected Git changes contain no operator-state directories or installed
  third-party dependency trees. Added-line private-key/token pattern checks
  found no matches; these checks do not claim to prove the absence of every
  possible secret format.
- The approved product Constitution is preserved. Applicable source, binary,
  dependency and asset terms remain described by `LICENSE`, `NOTICE`,
  `THIRD_PARTY_NOTICES.md`, the retained legal texts and the asset register.

The [dependency review](THIRD_PARTY_NOTICE_REVIEW.md) records the current notice
inventory. The [release notes](RELEASE_NOTES.md) describe the shipped changes.

## Final assembly and delivery

Build Linux amd64 and arm64 administrator binaries from the final release
commit, validate their Go module inventory and glibc boundary, and generate
checksums for both binaries and the five license/notice files or bundles.
The fourteen uploaded files and their hashes must match the local build receipt.

The maintainer retains exact local runtime checks, final Git commit, Actions
policy audit, binary manifests and remote readback in an ignored release receipt.
A changed receipt or artifact must be rechecked before publication. These
installation-specific records are not copied into the public repository.

This release does not introduce database migrations or deploy customer sites.
