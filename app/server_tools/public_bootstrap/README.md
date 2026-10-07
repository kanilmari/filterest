# Filterest Public Bootstrap Seed

This directory belongs to the canonical Filterest public source tree. Its
README and reviewed fixture inputs are maintained source; schema, seed,
manifest, and review files are derived release artifacts.

It contains a curated schema skeleton plus small synthetic seed rows so a
local Filterest checkout can bootstrap its own database instead of borrowing a
running non-public release-source backend or non-public bootstrap archive. The
seed rows are placeholders for setup and smoke testing, not production data. The
generated seed is assembled only from the reviewed SQL and fixture files in
this directory. No external test fixture, private source, or live database is
an input. The base schema and seed were retained from the already reviewed
public package when their source ownership moved here.

The generated seed also records a migration-ledger baseline for every public
migration file whose effects are already present in that bootstrap. A fresh
installation therefore starts from the packaged schema state instead of
replaying historical migrations. Existing installations do not import a new
bootstrap during upgrades, so migrations added after their own baseline still
run normally. The manifest binds this filename list to the exact migration-file
hashes and the bootstrap audit rejects drift.

The seed's last statement is one acceptance block, so an import is accepted whole
or not at all. It requires the completion marker of every included file that
declares one (`-- COMPLETION_MARKER: <name>`, a `completed` row in
`system_data_repair_records`), runs every declared final check
(`-- FINAL_CHECK: <schema>.<function>()`, each returned row is a contradiction),
and only then writes the migration ledger and the version row. Every import path
runs both files with `ON_ERROR_STOP`, so a failed statement or check leaves no
ledger and no version behind. The generator refuses to publish when a public
migration numbered after 20260929000006 (the record of DB 9.9.2) is in no
bootstrap list, when a schema-phase or data file lacks a completion marker, or
when a final check names a function the bootstrap does not create; the previous
artifacts then stay as they were. Release records (`*_record_database_release_*`)
are not run here: the block writes the version row of the version it is built for.

Classification headings are empty in the public seed, as are the existing values
and assignments. The 9.10.0 package includes the heading schema, Finnish and
English labels, and protected registry metadata through the same upgrade files.
Acceptance requires both `wl103_row_group_classifications` and
`wl103_row_group_classifications_registry`. Vocabulary and assignments belonging
to a site are administrator-managed content, never public fixture data.

WL132's account-name migration runs in the schema phase after row-actor support.
It copies existing public names unchanged into confidential login names, assigns
administrator display names, and creates serialized name protections in one
atomic statement. The acceptance block requires its `k116_login_names` completion
marker and an empty `app_check_login_name_protections()` result. The ordinary-account
setting `display_name_may_equal_login_name` defaults to true; changing it to false
preserves existing equal names until a name changes. The reviewed base seed and
the migration both preserve a previously saved setting. Before an upgrade, run
`app/server_tools/scripts/login_name_dry_run.sql` as a read-only query with a role
that can read credentials; its results contain counts, account ids and trigger
names without account names or credential values.

The three reviewed walkthrough images and the user-approved service, risk, and
ticket starter images remain immutable fixture inputs under `source/fixtures/`.
The runtime-media manifest declares a monotonic materialization revision. On
the first startup for a strictly newer revision, Filterest creates only missing
row-scoped copies under the mutable installation data root and records the
completed revision under `data/bootstrap/`. The same or an older revision is
not run again, so an operator's later deletion remains in force. Existing
runtime files are never overwritten, and runtime media is never tracked in the
public source. Intentionally offering new missing fixture copies requires an
explicit materialization-revision increase.

If you need to change the public bootstrap schema or seed rows, change the
reviewed inputs and regenerate the derived artifacts. Do not treat ad-hoc edits
in a local Filterest database as durable source changes.

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

First Run asks for both the private login name and public display name, with
editable suggestions from the shared site-slug rule and display-name allocator.
It also asks whether ordinary users may use equal names (preselected yes) and
saves the choice with the account in one transaction. Missing setting rows refuse
setup. Administrator names always differ.

The isolated preview helper defaults to `admin_<site_slug>` for sign-in and
allocates `admin_<n>` for display. `--login-name` overrides the sign-in suggestion;
invalid/reserved names and numeric-only default slugs fail before any write.
Its owner-only credential handoff contains both names and the account id; neither
name is printed in bootstrap status output.

An installation that has already completed setup but has lost every usable
administrator — for example a restored or rebuilt site — is not returned to this
form. The operator-only recovery command restores an existing administrator, or
creates one under the same protections when none is usable, writing the same
account definition this form writes. The repository's `SECURITY.md` is the
canonical description of both modes.

Before a public GitHub release, review the schema boundary and seed contents
against the publication checklist.

## Rebuild from the public checkout

From a standalone Filterest root, run:

    python3 app/server_tools/public_bootstrap/generate_bootstrap.py
    python3 app/server_tools/public_slice_export/audit_public_bootstrap.py --target .

The command reads app/VERSION_APP and app/VERSION_DB by default. For release
assembly, --target, --app-version and --db-version select a staging root and
explicit planned versions. It writes schema.sql, seed_data.sql and manifest.json;
it does not initialize or modify a database. Every recorded source-file hash
resolves to a file shipped in the same public checkout. The historical
filterest/ prefix in manifest evidence keys identifies canonical source
ownership; remove that prefix when locating a file in a standalone checkout.

Maintain base.schema.sql and base.seed.sql alongside the smaller companion SQL
sources. A new migration may be recorded in the bootstrap baseline only after
its resulting schema or seed behavior is included in these reviewed inputs.

Third-party notices can also be rebuilt entirely from this public checkout
after installing its dependencies and building its browser assets:

    python3 app/server_tools/public_slice_export/generate_third_party_notices.py --target .

That tool inventories the public module, package and asset sources. No private
release script or sibling checkout is required.
