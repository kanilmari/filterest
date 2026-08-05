# Filterest Public Bootstrap Seed

This directory is generated for the Filterest public repository candidate.

It contains a curated schema skeleton plus small synthetic seed rows so a
local Filterest checkout can bootstrap its own database instead of borrowing a
running non-public release-source backend or non-public bootstrap archive. The
seed rows are placeholders for setup and smoke testing, not production data. The
generated seed is derived from testing fixtures and normalized for public
Filterest branding and runtime boundaries.

The three reviewed walkthrough images and the user-approved service, risk, and
ticket starter images are generated into the same row-scoped storage shape as
ordinary uploaded images. Examples include
`storage/9/1/{300,1000,original}/9_1_1.png` and
`storage/7/1/{300,1000,2160,original}/7_1_1.jpg`. The generator and asset audit
reject repeated theme placeholders and any unreviewed storage files.

The sibling checkout and its local database are review candidates. If
you need to change the public bootstrap schema, seed rows, local env defaults,
or preview behavior, make that change in the maintainer release-source generator and
regenerate this checkout. Do not treat ad-hoc edits inside `filterest/` or its
local database as durable source changes.

## Credential Boundary

The public bootstrap seed creates only the technical guest identity needed for
anonymous browsing; it does not ship a reusable admin password or any reusable
ordinary-user password. On first browser
access, Filterest opens a two-section form where the installation owner first
chooses the visible environment purpose and sign-in verification method, then
sets the site identity and creates the administrator username, email address,
and password. The saved site identity replaces Filterest and deployment-domain
defaults across normal browser-facing pages after setup. Email
verification uses Postmark and requires a separately created free Postmark
account; password-only, fixed-PIN, and standard TOTP authenticator methods do
not require an email delivery provider for sign-in.

The server-owned `first_run` setting and absence of a login-ready admin must
both be true before the form is available. The environment purpose, selected
user-owned verification factor, account, hashed password, administrator
membership, saved site identity, and transition of `first_run` to false are
committed in one database transaction. The visible DEV/TEST/QA purpose cannot downgrade a
production-locked binary. Existing installations and completed setups fail
closed and redirect to normal login.

The generated-credential helper remains available only to the isolated,
disposable automated preview when
`FILTEREST_AUTOMATED_PREVIEW_INITIAL_ADMIN=1` is set. It is not the normal
installation flow and does not define production authentication behavior.

Before a public GitHub release, review the schema boundary and seed contents
against the publication checklist.
