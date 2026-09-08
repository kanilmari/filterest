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
seed_sources = ("base.seed.sql", "runtime.seed.sql", "app_tables.seed.sql", "app_tables.lang_keys.sql", "db_9_7_0.seed.sql", "db_9_7_0.lang_keys.sql", "field_settings.lang_keys.sql", "label_value_layout.lang_keys.sql", "article_view.seed.sql", "column_supported_views.seed.sql", "media_library.lang_keys.sql", "image_picker.lang_keys.sql", "search_filter_fallback.lang_keys.sql", "article_editor.lang_keys.sql")

def reviewed_source(name: str) -> str:
    path = public_bootstrap_sources / name
    if path.is_symlink() or not path.is_file():
        parser.error(f"Reviewed public source missing or not regular: {name}")
    return path.read_text(encoding="utf-8")

schema_sql = "".join(reviewed_source(name) for name in schema_sources)
seed_sql = "".join(reviewed_source(name).replace("__FILTEREST_DB_VERSION__", db_version) for name in seed_sources)

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
with seed_file.open("a", encoding="utf-8") as seed_handle:
    seed_handle.write(
        "\n-- Generated migration-ledger baseline. These migrations are already "
        "embodied by this bootstrap.\n"
        "INSERT INTO public.system_schema_migrations (filename) VALUES\n"
    )
    seed_handle.write(
        ",\n".join(f"  ('{filename}')" for filename in migration_ledger_baseline)
    )
    seed_handle.write("\nON CONFLICT (filename) DO NOTHING;\n")
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
