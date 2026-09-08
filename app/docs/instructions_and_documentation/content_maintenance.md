<!--
What: Operator workflow for metadata-driven content planning, application, and recovery.
Between: Reviewed JSON content, the public API client, recovery artifacts, and write journals.
Why: Make repeatable content maintenance understandable while preserving explicit data boundaries.
-->

# Content maintenance through the application API

`filterest/content_maintenance` plans and applies a small batch of authored content
to one registered dataset. It uses the existing `EaselectAPIClient` and application
permissions. The public tool contains no site content, fixed table names, or fixed
row IDs. Site-specific definitions and credentials stay in ignored private storage.

“Multilingual” means the language variants stored in one field of the same row.
The command does not translate or invent text. Supply reviewed language maps such
as `{"fi": "Esittely", "en": "Introduction"}`; only language codes advertised by
that field's metadata are accepted. Updating these two variants preserves other
existing variants. Omitting a field leaves it unchanged.

## Prepare a definition and read the current state

Run in WSL/Linux from the installation root. The wrapper requires Python 3.11+;
the apply backup check also requires PostgreSQL's `pg_restore`. Create an
owner-only working directory under ignored `data/`. Keep plans, receipts,
journals, credentials, and content out of Git.

The [example definition](../reference_implementations/content_maintenance.definition.json)
illustrates two named rows and a predecessor chain. Adapt its fields to the actual
dataset; it does not create a schema. Supported values are text, boolean, numeric,
JSON, null when nullable, and metadata-declared multilingual maps. Date, binary,
array, file-upload, and spatial workflows are outside this first command.

Each row has a unique local `ref`, a nonempty exact `match`, and `values`.
Use an existing integer `id` to update one known row, or a stable authored field
to support create-or-update. Zero matches require explicit `"create": true`;
more than one match stops the operation. Matching fields cannot be changed by
the same batch. A create must supply required editable and insertable fields.
Unknown, hidden, server-only, generated, identity, and noneditable writes are
rejected before any request to write.

An optional `expect` field map adds explicit before-value expectations.
A relationship value `{"$ref": "introduction"}` points to an earlier named
row and is accepted only for a metadata-declared self-reference to `id`.
The optional `order` block names every definition row once, in definition
order. Its field must be an editable nullable integer self-reference.
It links those rows as a predecessor chain; include all rows whose relative
ordering you intend to change. It does not reorder unrelated rows automatically.

```bash
umask 077
mkdir -p data/content-maintenance
# Save the reviewed definition as data/content-maintenance/definition.json.
./content_maintenance plan \
  --base-url https://localhost:8082 \
  --dataset your_registered_dataset \
  --definition data/content-maintenance/definition.json \
  --output data/content-maintenance/reviewed-plan.json
```

When running from the private parent repository, use
`./filterest/content_maintenance` instead. The wrapper reuses the API client's
native credential resolution. Explicit remote targets require either
`--prompt-credentials` in a visible local interactive terminal, or
`--credentials-file /absolute/private/credentials.json`. A credentials file
must be owner-only, not a symlink, and contain `target`, `username`, and
`password` (optionally `otp_code`). Its `target` must match the HTTPS
origin exactly. No credentials are accepted in URLs. Ambient remote credential
and TLS environment overrides are not imported; remote HTTPS verification stays
enabled. Never paste credentials into a definition, command line, or chat.

`plan` is the dry-run. It reads registered metadata and every visible row's
relevant fields, with a limit of 1,000 visible rows and 1,000 planned rows.
It writes no application data. The private output contains the concrete before
values, authored definition, metadata, target, and two SHA-256 hashes. Review that
file locally. Standard output contains only paths, hashes, and counts.

## Back up the exact instance, then apply the reviewed plan

Before applying, obtain a fresh recovery backup through the target instance's
authorized backup procedure. This first CLI accepts a PostgreSQL custom-format
archive, not the older plain SQL or compressed SQL backups. It checks actual
bytes, SHA-256, archive readability with `pg_restore --list`, and freshness.
A readable archive is not a substitute for a restore rehearsal or a complete
instance backup. Include any other files required to restore the content or its
referenced media as additional receipt artifacts.

The backup receipt is a private JSON file created after taking the backup:

```json
{
  "target": "https://localhost:8082",
  "dataset": "your_registered_dataset",
  "plan_sha256": "copy the reviewed plan hash",
  "before_sha256": "copy the reviewed before-state hash",
  "created_at": "2026-09-07T20:00:00Z",
  "provenance": "operator-confirmed",
  "database_name": "the database verified from this instance configuration",
  "instance_identity": "the independently verified instance or deployment identity",
  "artifacts": [
    {
      "kind": "database",
      "path": "/absolute/private/path/to/fresh-backup.dump",
      "sha256": "SHA-256 of this actual archive"
    }
  ]
}
```

Replace every example value, including the timestamp. The receipt and artifact
mtime must be within the previous hour, and the artifact must not precede the
receipt time by more than five minutes. Exactly one database artifact is
required. Each artifact must be a regular nonempty file, not a symlink.

The operator, including an already authorized agent, verifies that the named
database, instance, origin, and backup belong together using trusted instance
configuration and retained export evidence. Existing user authorization covers
this verification; it does not create a new human confirmation gate. The receipt
records that verified provenance, but is not itself cryptographic proof that the
API server produced the archive. Copying a hash, renaming an old backup, or
guessing the identity does not satisfy this workflow.

```bash
./content_maintenance apply \
  --base-url https://localhost:8082 \
  --dataset your_registered_dataset \
  --plan data/content-maintenance/reviewed-plan.json \
  --confirm-plan-sha256 THE_REVIEWED_PLAN_SHA256 \
  --backup-receipt data/content-maintenance/backup-receipt.json \
  --journal data/content-maintenance/apply-journal.json \
  --output data/content-maintenance/apply-result.json
```

The target origin, dataset, definition, metadata, and reviewed hash must match.
The relevant live state must still match the dry-run before the first write.
The command checks for drift again before each write, persists a journal entry
before sending it, and reads back every written field afterward. Creation is
resolved through stable named matches and readback; a repeated completed apply
returns a verified no-op instead of creating duplicates.

Use a controlled maintenance window with no concurrent writes. The existing
HTTP API does not provide a multi-request transaction or compare-and-swap.
The CLI's read-before-write checks detect drift but cannot eliminate the interval
between a read and a write. Its journal lock serializes only callers sharing the
same journal path. Ordering may temporarily clear existing predecessor links.
The operation is not atomic and can stop after some writes succeeded.

Clearing existing nullable values and reordering existing predecessor chains
require the backend's explicit JSON-null update support introduced with this
workline. Older deployed backends reject null updates even when their column
metadata says nullable. They can still perform the separately verified non-null
text/language updates. Do not infer null-update capability from nullable metadata
alone when selecting an older target.

## Handle partial failure without guessing

On failure, preserve the private journal and inspect the live rows. A pending
request may have committed even when its response was lost. The tool never
blindly repeats an uncertain create. If every planned value is now present,
retrying the same plan verifies completion without writing. Otherwise an
existing incomplete journal stops another apply until it has been reconciled.

For a journal containing only verified updates, a separate recovery definition
can restore the prior written values:

```bash
./content_maintenance recovery-definition \
  --journal data/content-maintenance/apply-journal.json \
  --output data/content-maintenance/recovery-definition.json
```

Review that definition, run a new `plan`, take a new backup, and apply using a
new journal. Recovery includes expectations for the last verified values so
subsequent changes are not silently overwritten. Automatic recovery is refused
for uncertain writes, created rows, or removal of a newly introduced language
variant; these require a reviewed operator decision. There is no bulk-delete
command and no automatic full-database restore. After an interrupted process,
inspect any leftover `.lock` file and its journal before removing the stale lock.

Output artifacts created by the command use atomic writes and mode `0600`.
Plans and journals contain private content even though stdout only contains a
summary. API response bodies and credentials are not echoed on failure.

## Verification scope

The unit suite exercises create/update/order, preserved language variants,
metadata restrictions, stale plans, concrete backup checks, idempotent retries,
uncertain writes, recovery boundaries, and private output permissions:

```bash
python3 -m pytest -q app/server_tools/agent_tools/test_content_maintenance.py
```

On 2026-09-07, a read-only CLI plan was verified against the local native
`https://localhost:8082` API and its registered documentation dataset.

A separate public installation at `https://localhost:18445`, backed by its own
disposable PostgreSQL cluster, then passed real API create, FI/EN update,
predecessor reorder, per-field readback, and a second apply returning no-op.
Each apply used an actual fresh custom-format dump and a matching private
receipt. Non-null FI/EN updates were also verified on the pre-fix server.
The corrected server passed nullable FK/text/boolean clearing, NOT NULL
rejection with the value unchanged, and missing-value rejection. TLS certificate
validation stayed enabled. Only synthetic fixture rows were changed; fixture
schema and language settings were created through the existing public APIs.

No native or production content was changed by these checks. A target-specific
reviewed plan and backup remain required before a site-specific apply.
