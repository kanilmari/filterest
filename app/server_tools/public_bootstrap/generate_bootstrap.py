#!/usr/bin/env python3
"""Assemble Filterest's reviewed public schema, synthetic seed and hashes.

Every input lives in this public checkout. The tool never reads a running
database, deployment credentials, or a non-public source tree.
"""
from __future__ import annotations
import argparse
import re
import sys
import tempfile
from pathlib import Path

public_root = Path(__file__).resolve().parents[3]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--target", type=Path, default=public_root, help="Filterest root receiving app/server_tools/public_bootstrap.")
parser.add_argument("--app-version")
parser.add_argument("--db-version")
args = parser.parse_args()
app_version = args.app_version or (public_root / "app/VERSION_APP").read_text().strip()
db_version = args.db_version or (public_root / "app/VERSION_DB").read_text().strip()
for label, version in (("app", app_version), ("DB", db_version)):
    if re.fullmatch(r"[0-9]+[.][0-9]+[.][0-9]+(?:[-+][A-Za-z0-9.-]+)?", version) is None:
        parser.error(f"Invalid {label} version")
public_bootstrap_sources = Path(__file__).resolve().parent / "source"
public_migrations = public_root / "app/server_tools/migrations"
bootstrap_dir = args.target.resolve() / "app/server_tools/public_bootstrap"
for path in (bootstrap_dir.parent.parent, bootstrap_dir.parent, bootstrap_dir,
             *(bootstrap_dir / name for name in ("schema.sql", "seed_data.sql", "manifest.json"))):
    if path.is_symlink():
        parser.error("Bootstrap output cannot use a symlink")

schema_sources = ("base.schema.sql", "runtime.schema.sql", "db_9_7_0.schema.sql", "app_tables.schema.sql", "column_supported_views.schema.sql", "media_assets.schema.sql")
seed_sources = ("base.seed.sql", "runtime.seed.sql", "app_tables.seed.sql", "app_tables.lang_keys.sql", "db_9_7_0.seed.sql", "db_9_7_0.lang_keys.sql", "field_settings.lang_keys.sql", "label_value_layout.lang_keys.sql", "article_view.seed.sql", "column_supported_views.seed.sql", "media_library.lang_keys.sql", "image_picker.lang_keys.sql", "search_filter_fallback.lang_keys.sql", "article_editor.lang_keys.sql", "dataset_rights.seed.sql")
developer_workflow_schema_migrations = (
    "20260919000007_create_developer_ticket_schema.sql",
    "20260919000008_create_developer_workline_schema.sql",
)
developer_workflow_seed_migrations = (
    "20260919000009_seed_developer_workflow_metadata.sql",
)
# Interface copy an upgrade seeds is seeded for a new installation by the same
# file, after every language row the reviewed sources above provide, and in the
# order an upgrade runs them.
language_seed_migrations = (
    "20260919000005_seed_dataset_form_dimension_language_keys.sql",
    "20260922000001_seed_failure_notice_and_dataset_form_language_keys.sql",
    "20260922000004_seed_request_notice_and_interface_language_keys.sql",
    "20260922000005_seed_interface_language_keys_of_9_8_1.sql",
    "20260922000006_seed_dataset_creation_warning_language_key.sql",
    "20260922000007_seed_embedding_refresh_and_dataset_header_language_keys.sql",
    "20260929000001_seed_connect_two_fields_language_keys.sql",
    "20260929000005_seed_missing_media_check_language_keys.sql",
)
# A setting an upgrade adds is added for a new installation by the same file, so
# the default is written once and an upgraded site and a new one start with the
# same policy. Each of these leaves an existing value alone, except the two run
# choices of the missing-media check, which its file moves to after-update only.
setting_seed_migrations = (
    "20260927000001_add_absolute_sign_in_limit.sql",
    "20260929000004_add_missing_media_check_setting.sql",
)
# What an upgrade adds where a site lacks it — a table, or a relationship between
# two tables — is added for a new installation by the same file, so an upgraded
# database and a newly installed one end with the same schema, stated once.
repair_schema_migrations = (
    "20260922000002_create_missing_deletion_log.sql",
    "20260926000001_restore_system_foreign_keys.sql",
    "20260926000003_create_revoked_sign_in_store.sql",
    "20261005000001_add_row_actor_support.sql",
    "20261005000002_key_row_actor_marks_by_table_uid.sql",
)
# Runs after every table exists, as the importing application role, so a new
# installation withholds table creation from PUBLIC exactly as an upgrade does.
schema_privilege_migrations = (
    "20260921000001_withdraw_public_table_creation.sql",
)
# A release's data step is run for a new installation by the same file, after every
# seed: it needs the groups, folders, users and registry rows the seeds create. Each
# is one DO block that writes its own completion marker.
release_data_migrations: tuple[str, ...] = ()
# The record of each database release is not run by the bootstrap: the acceptance
# block below writes the version row of the version this bootstrap is built for.
release_record_migrations = (
    "20261005000099_record_database_release_9_10_0.sql",
)
# Every public migration whose sequence number comes after this one belongs to
# exactly one list above, so no file is marked as run while missing from the
# bootstrap. Older files predate the rule; 20260929000006 recorded DB 9.9.2.
classified_after_sequence = "20260929000006"
schema_phase_lists = (developer_workflow_schema_migrations, repair_schema_migrations, schema_privilege_migrations)
marker_required_lists = schema_phase_lists + (release_data_migrations,)
completion_marker_pattern = re.compile(r"^-- COMPLETION_MARKER:\s*(\S+)\s*$", re.MULTILINE)
final_check_pattern = re.compile(r"^-- FINAL_CHECK:\s*(\S+)\s*$", re.MULTILINE)

def reviewed_source(name: str) -> str:
    path = public_bootstrap_sources / name
    if path.is_symlink() or not path.is_file():
        parser.error(f"Reviewed public source missing or not regular: {name}")
    return path.read_text(encoding="utf-8")

def reviewed_public_migration(name: str) -> str:
    path = public_migrations / name
    if path.is_symlink() or not path.is_file():
        parser.error(f"Reviewed public migration missing or not regular: {name}")
    return path.read_text(encoding="utf-8")

schema_sql = (
    "".join(reviewed_source(name) for name in schema_sources)
    + "".join(reviewed_public_migration(name) for name in developer_workflow_schema_migrations)
    + "".join(reviewed_public_migration(name) for name in repair_schema_migrations)
    + "".join(reviewed_public_migration(name) for name in schema_privilege_migrations)
)
seed_sql = (
    "".join(reviewed_source(name) for name in seed_sources)
    + "".join(reviewed_public_migration(name) for name in developer_workflow_seed_migrations)
    + "".join(reviewed_public_migration(name) for name in language_seed_migrations)
    + "".join(reviewed_public_migration(name) for name in setting_seed_migrations)
    + "".join(reviewed_public_migration(name) for name in release_data_migrations)
)
if "__FILTEREST_DB_VERSION__" in schema_sql + seed_sql:
    parser.error("The version row belongs to the acceptance block, not to a source")

# Every file the bootstrap marks as run is in it, and every file that must prove it
# ran to the end says how: schema-phase and data files name a completion marker, and
# a file may name a final check, which the acceptance block runs after the import.
included_migrations = [
    name
    for names in (developer_workflow_schema_migrations, repair_schema_migrations, schema_privilege_migrations,
                  developer_workflow_seed_migrations, language_seed_migrations, setting_seed_migrations,
                  release_data_migrations)
    for name in names
]
classified = included_migrations + list(release_record_migrations)
for name in sorted({name for name in classified if classified.count(name) > 1}):
    parser.error(f"Migration listed in more than one bootstrap class: {name}")
for name in release_record_migrations:
    if "_record_database_release_" not in name:
        parser.error(f"Only release records may stay out of the bootstrap: {name}")
for path in sorted(public_migrations.glob("*.sql")):
    if "'" in path.name or "/" in path.name:
        parser.error(f"public migration filename is not safe for the bootstrap ledger: {path.name}")
    if path.name[:14] > classified_after_sequence and path.name not in classified:
        parser.error(f"Migration is in no bootstrap class: {path.name}")
completion_markers: list[str] = []
final_checks: list[str] = []
for name in included_migrations:
    text = reviewed_public_migration(name)
    markers = completion_marker_pattern.findall(text)
    checks = final_check_pattern.findall(text)
    if len(markers) > 1 or len(checks) > 1:
        parser.error(f"Migration declares more than one completion marker or final check: {name}")
    if not markers and name[:14] > classified_after_sequence and any(name in names for names in marker_required_lists):
        parser.error(f"Schema-phase or data migration declares no completion marker: {name}")
    for marker in markers:
        if re.fullmatch(r"[a-z0-9_]+", marker) is None or marker in completion_markers:
            parser.error(f"Completion marker is malformed or not unique: {marker} ({name})")
        completion_markers.append(marker)
    for check in checks:
        function = re.fullmatch(r"([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\(\)", check)
        if function is None:
            parser.error(f"Final check must name a schema-qualified function without arguments: {check} ({name})")
        created = re.compile(
            rf"\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+{function.group(1)}\.{function.group(2)}\s*\(",
            re.IGNORECASE,
        )
        if created.search(schema_sql + seed_sql) is None:
            parser.error(f"Final check {check} is not created by this bootstrap ({name})")
        if check not in final_checks:
            final_checks.append(check)

# Enforce the same explicit content boundary used by the public release audit.
sys.path.insert(0, str(public_root / "app/server_tools/public_slice_export"))
from audit_public_bootstrap import ALLOWED_SCHEMA_TABLES, ALLOWED_SEED_TABLES, FORBIDDEN_CONTENT_PATTERNS, TABLE_PATTERN, INSERT_TABLE_PATTERN, EMAIL_PATTERN
for label, sql, pattern, allowed in (
    ("schema", schema_sql, TABLE_PATTERN, ALLOWED_SCHEMA_TABLES),
    ("seed", seed_sql, INSERT_TABLE_PATTERN, ALLOWED_SEED_TABLES),
):
    forbidden_tables = {match.group(1).lower() for match in pattern.finditer(sql)} - allowed
    if forbidden_tables:
        parser.error(f"Unreviewed {label} tables: {sorted(forbidden_tables)}")
    for description, forbidden in FORBIDDEN_CONTENT_PATTERNS.items():
        if forbidden.search(sql):
            parser.error(f"Public {label} contains forbidden {description}")
for address in EMAIL_PATTERN.findall(seed_sql):
    if not address.endswith((".invalid", "@example.com", "@example.org", "@example.net")):
        parser.error("Public seed contains an unreviewed email address")
output_bootstrap_dir = bootstrap_dir
output_bootstrap_dir.mkdir(parents=True, exist_ok=True)
staging = tempfile.TemporaryDirectory(prefix=".filterest-bootstrap-", dir=output_bootstrap_dir.parent)
bootstrap_dir = Path(staging.name)
(bootstrap_dir / "schema.sql").write_text(schema_sql, encoding="utf-8")
(bootstrap_dir / "seed_data.sql").write_text(seed_sql, encoding="utf-8")


import hashlib
import json
import os
import re
from collections import Counter
from pathlib import Path

repo_root = public_root




table_pattern = re.compile(
    r"\b(?:CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|INSERT\s+INTO|COPY)\s+"
    r"((?:public|restricted)\.[A-Za-z0-9_]+)",
    re.IGNORECASE,
)
insert_table_pattern = re.compile(
    r"\bINSERT\s+INTO\s+((?:public|restricted)\.[A-Za-z0-9_]+)", re.IGNORECASE
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def split_sql_statements(sql: str) -> list[str]:
    statements: list[str] = []
    current: list[str] = []
    in_single_quote = False
    index = 0
    while index < len(sql):
        # A line comment is not SQL: an apostrophe in it must not open a string.
        if not in_single_quote and sql.startswith("--", index):
            newline = sql.find("\n", index)
            index = len(sql) if newline == -1 else newline
            continue
        char = sql[index]
        current.append(char)
        if char == "'":
            if index + 1 < len(sql) and sql[index + 1] == "'":
                current.append(sql[index + 1])
                index += 2
                continue
            in_single_quote = not in_single_quote
        elif char == ";" and not in_single_quote:
            statements.append("".join(current))
            current = []
        index += 1
    if "".join(current).strip():
        statements.append("".join(current))
    return statements


def count_insert_rows(seed_sql: str) -> dict[str, int]:
    counts: Counter[str] = Counter()
    tuple_pattern = re.compile(r"(?im)(?:^\s*|,\s*|\bVALUES\s*)\(")
    insert_column_list_pattern = re.compile(
        r"(\bINSERT\s+INTO\s+(?:public|restricted)\.[A-Za-z0-9_]+)\s*\([^)]*\)",
        re.IGNORECASE | re.DOTALL,
    )
    for statement in split_sql_statements(seed_sql):
        match = insert_table_pattern.search(statement)
        if not match:
            continue
        table = match.group(1).lower()
        countable_statement = insert_column_list_pattern.sub(r"\1", statement, count=1)
        counts[table] += len(tuple_pattern.findall(countable_statement))
    return dict(sorted(counts.items()))


schema_file = bootstrap_dir / "schema.sql"
seed_file = bootstrap_dir / "seed_data.sql"
migration_ledger_baseline = sorted(path.name for path in public_migrations.glob("*.sql"))
if not migration_ledger_baseline:
    raise SystemExit("public migration ledger baseline cannot be empty")
if any("'" in filename or "/" in filename for filename in migration_ledger_baseline):
    raise SystemExit("public migration filename is not safe for the bootstrap ledger")
def sql_text_array(values: list[str]) -> str:
    return "ARRAY[" + ", ".join(f"'{value}'" for value in values) + "]::text[]"


# The acceptance block is the seed's last statement and one statement, so the import
# is accepted whole or not at all: every included file's completion marker must be
# present and every declared final check must come back empty before the migration
# ledger and the version row are written. Every import path stops at the first
# error, so a failed check leaves no ledger and no version behind.
acceptance_lines = [
    "",
    "-- Generated migration-ledger baseline and version row, written by this acceptance block only after",
    "-- every completion marker is present and every final check comes back empty. These migrations are",
    "-- already embodied by this bootstrap.",
    "DO $filterest_acceptance$",
    "DECLARE",
    "    missing_markers text;",
    "    findings text;",
    "BEGIN",
]
if completion_markers:
    acceptance_lines += [
        "    SELECT string_agg(marker, ', ' ORDER BY marker) INTO missing_markers",
        f"      FROM unnest({sql_text_array(completion_markers)}) AS marker",
        "     WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records AS record",
        "                        WHERE record.migration = marker AND record.action = 'completed');",
        "    IF missing_markers IS NOT NULL THEN",
        "        RAISE EXCEPTION 'bootstrap import is incomplete; missing completion markers: %', missing_markers;",
        "    END IF;",
    ]
if final_checks:
    acceptance_lines += [
        "    SELECT string_agg(finding, '; ') INTO findings FROM (",
        "\n        UNION ALL\n".join(
            f"        SELECT '{check}: ' || result FROM {check} AS result" for check in final_checks
        ),
        "    ) AS checks (finding);",
        "    IF findings IS NOT NULL THEN",
        "        RAISE EXCEPTION 'bootstrap import failed its final checks: %', findings;",
        "    END IF;",
    ]
acceptance_lines += [
    "    INSERT INTO public.system_schema_migrations (filename) VALUES",
    ",\n".join(f"      ('{filename}')" for filename in migration_ledger_baseline),
    "    ON CONFLICT (filename) DO NOTHING;",
    "    INSERT INTO public.system_db_version (version, description)",
    f"    VALUES ('{db_version}', 'Filterest generated public bootstrap');",
    "END",
    "$filterest_acceptance$;",
    "",
]
with seed_file.open("a", encoding="utf-8") as seed_handle:
    seed_handle.write("\n".join(acceptance_lines))
schema_sql = schema_file.read_text(encoding="utf-8", errors="replace")
seed_sql = seed_file.read_text(encoding="utf-8", errors="replace")

source_files = [
    public_bootstrap_sources / "base.schema.sql",
    public_bootstrap_sources / "base.seed.sql",
    public_bootstrap_sources / "field_settings.lang_keys.sql",
    public_bootstrap_sources / "label_value_layout.lang_keys.sql",
    Path(__file__).resolve(),
    public_root / "app/server_tools/public_slice_export/audit_public_bootstrap.py",
    public_bootstrap_sources / "runtime.schema.sql",
    public_bootstrap_sources / "runtime.seed.sql",
    public_bootstrap_sources / "db_9_7_0.schema.sql",
    public_bootstrap_sources / "db_9_7_0.seed.sql",
    public_bootstrap_sources / "db_9_7_0.lang_keys.sql",
    public_bootstrap_sources / "app_tables.schema.sql",
    public_bootstrap_sources / "app_tables.seed.sql",
    public_bootstrap_sources / "app_tables.lang_keys.sql",
    public_bootstrap_sources / "article_view.seed.sql",
    public_bootstrap_sources / "media_assets.schema.sql",
    public_bootstrap_sources / "media_library.lang_keys.sql",
    public_bootstrap_sources / "column_supported_views.schema.sql",
    public_bootstrap_sources / "column_supported_views.seed.sql",
    public_bootstrap_sources / "image_picker.lang_keys.sql",
    public_bootstrap_sources / "search_filter_fallback.lang_keys.sql",
    public_bootstrap_sources / "article_editor.lang_keys.sql",
    public_bootstrap_sources / "dataset_rights.seed.sql",
    public_bootstrap_sources / "fixtures/runtime_media.v1.json",
]
source_files.extend(sorted(public_migrations.glob("*.sql")))
source_files.extend(sorted((public_bootstrap_sources / "fixtures/icons").glob("*.svg")))
source_files.extend(sorted((public_bootstrap_sources / "fixtures/docs").glob("*.png")))
source_files.extend(sorted((public_bootstrap_sources / "fixtures/starter-images").glob("*.jpg")))

manifest = {
    "artifact": "filterest-public-bootstrap",
    "format_version": 2,
    "app_version": app_version,
    "db_version": db_version,
    "schema_source": "app/server_tools/public_bootstrap/source/base.schema.sql",
    "seed_source": "app/server_tools/public_bootstrap/source/base.seed.sql",
    "purpose": "local independent Filterest bootstrap without private source runtime dependency",
    "migration_ledger_baseline": migration_ledger_baseline,
    "allowed_schema_tables": sorted({match.group(1).lower() for match in table_pattern.finditer(schema_sql)}),
    "allowed_seed_tables": sorted({match.group(1).lower() for match in insert_table_pattern.finditer(seed_sql)}),
    "seed_row_counts": count_insert_rows(seed_sql),
    "generated_files": {
        "server_tools/public_bootstrap/schema.sql": {"sha256": sha256(schema_file)},
        "server_tools/public_bootstrap/seed_data.sql": {"sha256": sha256(seed_file)},
    },
    "source_files": {
        "filterest/" + path.relative_to(repo_root).as_posix(): {"sha256": sha256(path)}
        for path in source_files
    },
}

(bootstrap_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
# Publish only after every input, ledger entry and generated hash was validated.
# A failed rebuild therefore leaves the previously usable package untouched.
for filename in ("schema.sql", "seed_data.sql", "manifest.json"):
    (bootstrap_dir / filename).replace(output_bootstrap_dir / filename)
staging.cleanup()
print(f"Generated public Filterest bootstrap: {output_bootstrap_dir}")
