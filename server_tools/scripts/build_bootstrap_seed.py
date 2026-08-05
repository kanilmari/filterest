#!/usr/bin/env python3
# build_bootstrap_seed.py
# Builds password-protected DB bootstrap-seed zip artifacts between tracked schema snapshots and seed SQL inputs.
# Operates between local versioning files, optional local PostgreSQL read-only dump commands, and committed zip outputs.
# Exists so each DB version can ship one committed bootstrap archive without hand-assembling schema/data files.

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence


PROJECT_ROOT = Path(__file__).resolve().parents[2]
VERSION_DB_FILE = PROJECT_ROOT / "VERSION_DB"
SCHEMA_SNAPSHOT_DIR = PROJECT_ROOT / "server_tools" / "versioning" / "schema_snapshots"
BOOTSTRAP_SEED_DIR = PROJECT_ROOT / "server_tools" / "versioning" / "bootstrap_seeds"
DEFAULT_DB_PASSWORD_FILE = BOOTSTRAP_SEED_DIR / "local_db_password.txt"
DEFAULT_ZIP_PASSWORD_FILE = BOOTSTRAP_SEED_DIR / "bootstrap_zip_password.txt"
FIXED_FILE_EPOCH = int(datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp())
DEFAULT_EXCLUDED_SEED_COLUMNS = ("embedding_vector",)
DEFAULT_SEED_USER_ALLOWLIST = (
    "guest",
    "easelect_admin",
    "editorial_staff",
    "test_user",
    "test_admin",
    "filterest_admin",
)
VALID_SEED_PROFILES = ("application", "management")
INSTANCE_ROLE_CONFIG_KEY = "easelect_instance_role"
CURATED_DEV_SEED_TABLES = frozenset(
    {
        "dev_agent_task_groups",
        "dev_agent_task_queues",
        "dev_agent_task_statuses",
        "dev_agent_task_todo_statuses",
        "dev_todo_list_statuses",
        "dev_todo_types",
    }
)
SEED_SCHEMA_ONLY_TABLES = frozenset(
    {
        "ai_chat_conversations",
        "ai_usage_logs",
        "app_cloud_action_audit",
        "bee_messages",
        "deletion_log",
        "mcp_query_log",
        "root_files",
        "system_audit_log",
        "system_comments",
        "system_file_structure",
        "system_log",
        "system_transaction_log",
    }
)
SEED_ROW_POLICY_DROP_TABLES_BY_USER_ID = frozenset(
    {
        "public.system_user_column_settings",
        "public.system_user_group_memberships",
        "restricted.users_restricted",
        "restricted.verification_codes",
    }
)
INSTANCE_ROLE_CREATION_SPEC = (
    "Persistent Easelect instance role. application is a normal application/domain "
    "instance; management is a dedicated Easelect instance for cloud/instance "
    "management surfaces."
)

SQL_DUMP_POLICY_QUERY = """
SELECT
    COALESCE(NULLIF(schema_name, ''), 'public') AS schema_name,
    table_name,
    COALESCE(to_jsonb(system_db_tables) ->> 'sql_dump_policy', 'all') AS sql_dump_policy
FROM system_db_tables
ORDER BY COALESCE(NULLIF(schema_name, ''), 'public'), table_name;
""".strip()


class BootstrapSeedBuilderError(RuntimeError):
    """Raised when the bootstrap seed archive cannot be built safely."""


def normalize_seed_user_allowlist(value: str | Sequence[str] | None) -> tuple[str, ...]:
    """Normalize the explicit user allowlist used by seed row pruning."""
    if value is None:
        candidates = DEFAULT_SEED_USER_ALLOWLIST
    elif isinstance(value, str):
        candidates = tuple(part.strip() for part in value.split(","))
    else:
        candidates = tuple(str(part).strip() for part in value)

    normalized: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        if not candidate:
            continue
        lowered = candidate.lower()
        if lowered in seen:
            continue
        normalized.append(lowered)
        seen.add(lowered)
    if not normalized:
        raise BootstrapSeedBuilderError("seed user allowlist cannot be empty")
    return tuple(normalized)


def read_text_file(path: Path) -> str:
    """Read UTF-8 text from disk for schema snapshots, seed SQL, and version files."""
    return path.read_text(encoding="utf-8")


def normalize_sql_text(sql_text: str) -> str:
    """Normalize SQL text so repeated builds keep the same content and line endings."""
    normalized = sql_text.replace("\r\n", "\n").replace("\r", "\n")
    filtered_lines = [
        line
        for line in normalized.split("\n")
        if not line.startswith("\\restrict ") and not line.startswith("\\unrestrict ")
    ]
    return "\n".join(filtered_lines).rstrip("\n") + "\n"


def restore_seed_runtime_search_path(seed_sql: str) -> str:
    """Reset pg_dump's empty search path before seed rows can fire runtime triggers."""
    empty_search_path = "SELECT pg_catalog.set_config('search_path', '', false);"
    return seed_sql.replace(empty_search_path, "RESET search_path;")


def split_sql_csv_fields(text: str) -> list[str]:
    """Split a SQL comma list while respecting quotes and nested expressions."""
    fields: list[str] = []
    start = 0
    depth = 0
    in_single_quote = False
    in_double_quote = False
    index = 0

    while index < len(text):
        char = text[index]
        next_char = text[index + 1] if index + 1 < len(text) else ""

        if in_single_quote:
            if char == "'" and next_char == "'":
                index += 2
                continue
            if char == "'":
                in_single_quote = False
            index += 1
            continue

        if in_double_quote:
            if char == '"' and next_char == '"':
                index += 2
                continue
            if char == '"':
                in_double_quote = False
            index += 1
            continue

        if char == "'":
            in_single_quote = True
        elif char == '"':
            in_double_quote = True
        elif char in "([{":
            depth += 1
        elif char in ")]}" and depth > 0:
            depth -= 1
        elif char == "," and depth == 0:
            fields.append(text[start:index].strip())
            start = index + 1
        index += 1

    fields.append(text[start:].strip())
    return fields


def normalize_sql_identifier(identifier: str) -> str:
    """Return a comparable SQL identifier for column-exclusion matching."""
    normalized = identifier.strip()
    if normalized.startswith('"') and normalized.endswith('"'):
        normalized = normalized[1:-1].replace('""', '"')
    return normalized.lower()


def split_seed_sql_statements(seed_sql: str) -> list[str]:
    """Split seed SQL into statements while preserving quoted semicolons/newlines."""
    statements: list[str] = []
    current: list[str] = []
    in_single_quote = False
    in_double_quote = False
    in_line_comment = False
    index = 0

    while index < len(seed_sql):
        char = seed_sql[index]
        next_char = seed_sql[index + 1] if index + 1 < len(seed_sql) else ""
        current.append(char)

        if in_line_comment:
            if char == "\n":
                in_line_comment = False
            index += 1
            continue

        if in_single_quote:
            if char == "'" and next_char == "'":
                current.append(next_char)
                index += 2
                continue
            if char == "'":
                in_single_quote = False
            index += 1
            continue

        if in_double_quote:
            if char == '"' and next_char == '"':
                current.append(next_char)
                index += 2
                continue
            if char == '"':
                in_double_quote = False
            index += 1
            continue

        if char == "'":
            in_single_quote = True
        elif char == '"':
            in_double_quote = True
        elif char == "-" and next_char == "-":
            current.append(next_char)
            in_line_comment = True
            index += 2
            continue
        elif char == ";":
            statements.append("".join(current))
            current = []
        index += 1

    if current:
        statements.append("".join(current))
    return statements


def parse_insert_line(line: str) -> dict[str, Any] | None:
    """Parse a single pg_dump column-INSERT line into table, columns, and values."""
    match = re.match(
        r"^(?P<leading>.*?)(?P<prefix>INSERT INTO\s+(?P<table>\S+)\s*)"
        r"\((?P<columns>.*)\)"
        r"(?P<between>\s+(?:OVERRIDING\s+SYSTEM\s+VALUE\s+)?)"
        r"VALUES\s*\((?P<values>.*)\)(?P<suffix>;\s*)$",
        line,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not match:
        return None

    columns = split_sql_csv_fields(match.group("columns"))
    values = split_sql_csv_fields(match.group("values"))
    if len(columns) != len(values):
        return None
    return {
        "leading": match.group("leading"),
        "prefix": match.group("prefix"),
        "table": match.group("table"),
        "columns": columns,
        "between": match.group("between"),
        "values": values,
        "suffix": match.group("suffix"),
    }


def render_insert_line(parsed_insert: dict[str, Any]) -> str:
    """Render a parsed pg_dump INSERT line after value-level seed edits."""
    return (
        f"{parsed_insert['leading']}{parsed_insert['prefix']}({', '.join(parsed_insert['columns'])})"
        f"{parsed_insert['between']}VALUES ({', '.join(parsed_insert['values'])})"
        f"{parsed_insert['suffix']}"
    )


def column_value(parsed_insert: dict[str, Any], column_name: str) -> str | None:
    """Return the raw SQL value for one parsed INSERT column if present."""
    normalized_target = normalize_sql_identifier(column_name)
    for index, column in enumerate(parsed_insert["columns"]):
        if normalize_sql_identifier(column) == normalized_target:
            return parsed_insert["values"][index]
    return None


def integer_column_value(parsed_insert: dict[str, Any], column_name: str) -> int | None:
    """Return an integer column value from a parsed INSERT, or None when absent/null."""
    value = column_value(parsed_insert, column_name)
    if value is None or value.upper() == "NULL":
        return None
    try:
        return int(value)
    except ValueError:
        return None


def text_column_value(parsed_insert: dict[str, Any], column_name: str) -> str | None:
    """Return a simple SQL text literal value from a parsed INSERT."""
    value = column_value(parsed_insert, column_name)
    if value is None or value.upper() == "NULL":
        return None
    if not (value.startswith("'") and value.endswith("'")):
        return value
    return value[1:-1].replace("''", "'")


def scrub_insert_line_excluded_columns(
    line: str,
    excluded_columns: Sequence[str],
) -> tuple[str, dict[str, int]]:
    """Replace excluded column values in a pg_dump column-INSERT line with NULL."""
    parsed_insert = parse_insert_line(line)
    if not parsed_insert:
        return line, {}

    excluded = {column.lower() for column in excluded_columns}
    scrubbed_counts: dict[str, int] = {}
    for index, column in enumerate(parsed_insert["columns"]):
        normalized_column = normalize_sql_identifier(column)
        if normalized_column not in excluded:
            continue
        if parsed_insert["values"][index].upper() == "NULL":
            continue
        parsed_insert["values"][index] = "NULL"
        scrubbed_counts[normalized_column] = scrubbed_counts.get(normalized_column, 0) + 1

    if not scrubbed_counts:
        return line, {}
    return render_insert_line(parsed_insert), scrubbed_counts


def scrub_seed_sql_excluded_columns(
    seed_sql: str,
    excluded_columns: Sequence[str] = DEFAULT_EXCLUDED_SEED_COLUMNS,
) -> tuple[str, dict[str, int]]:
    """Remove regeneratable column values from seed INSERTs while preserving rows."""
    output_statements: list[str] = []
    total_counts: dict[str, int] = {}
    for statement in split_seed_sql_statements(seed_sql):
        scrubbed_statement, line_counts = scrub_insert_line_excluded_columns(
            statement,
            excluded_columns,
        )
        output_statements.append(scrubbed_statement)
        for column, count in line_counts.items():
            total_counts[column] = total_counts.get(column, 0) + count
    return "".join(output_statements).rstrip("\n") + "\n", total_counts


def seed_schema_only_policy_for_table(schema_name: str, table_name: str) -> str:
    """Return hard bootstrap schema-only policy for runtime/cache/dev-history tables."""
    if schema_name == "public" and table_name in SEED_SCHEMA_ONLY_TABLES:
        return "schema_only"
    if schema_name == "restricted" and table_name == "verification_codes":
        return "schema_only"
    if schema_name == "public" and table_name.endswith("_lang_embeddings"):
        return "schema_only"
    if (
        schema_name == "public"
        and table_name.startswith("dev_")
        and table_name not in CURATED_DEV_SEED_TABLES
    ):
        return "schema_only"
    return "all"


def should_drop_seed_insert_table(parsed_insert: dict[str, Any]) -> bool:
    """Return whether an INSERT belongs to a table that seed exports keep schema-only."""
    table = parsed_insert["table"]
    if "." not in table:
        return False
    schema_name, table_name = table.split(".", 1)
    return seed_schema_only_policy_for_table(schema_name, table_name) == "schema_only"


def parse_system_user_foreign_keys(schema_sql: str) -> dict[str, list[dict[str, str]]]:
    """Find single-column foreign keys that point to public.system_users(id)."""
    pattern = re.compile(
        r"ALTER\s+TABLE\s+ONLY\s+(?P<table>\S+)\s+"
        r"ADD\s+CONSTRAINT\s+\S+\s+FOREIGN\s+KEY\s*\((?P<column>[^,)]+)\)\s+"
        r"REFERENCES\s+public\.system_users\s*\(id\)"
        r"(?:\s+ON\s+DELETE\s+(?P<on_delete>SET\s+NULL|CASCADE|RESTRICT|NO\s+ACTION))?",
        flags=re.IGNORECASE | re.DOTALL,
    )
    foreign_keys: dict[str, list[dict[str, str]]] = {}
    for match in pattern.finditer(schema_sql):
        table = match.group("table").lower()
        on_delete = re.sub(r"\s+", " ", match.group("on_delete") or "NO ACTION").upper()
        foreign_keys.setdefault(table, []).append(
            {
                "column": normalize_sql_identifier(match.group("column")),
                "on_delete": on_delete,
            }
        )
    return foreign_keys


def apply_seed_row_policies(
    seed_sql: str,
    seed_user_allowlist: Sequence[str] = DEFAULT_SEED_USER_ALLOWLIST,
    schema_sql: str = "",
) -> tuple[str, dict[str, Any]]:
    """Keep the public user allowlist and preserve its foreign-key integrity."""
    allowed_usernames = set(normalize_seed_user_allowlist(seed_user_allowlist))
    system_user_foreign_keys = parse_system_user_foreign_keys(schema_sql)
    parsed_lines: list[tuple[str, dict[str, Any] | None]] = [
        (statement, parse_insert_line(statement)) for statement in split_seed_sql_statements(seed_sql)
    ]

    allowed_user_ids: set[int] = set()
    for _line, parsed_insert in parsed_lines:
        if not parsed_insert or parsed_insert["table"] != "public.system_users":
            continue
        username = text_column_value(parsed_insert, "username")
        user_id = integer_column_value(parsed_insert, "id")
        if username and username.lower() in allowed_usernames and user_id is not None:
            allowed_user_ids.add(user_id)

    output_statements: list[str] = []
    dropped_by_table: dict[str, int] = {}
    dropped_invalid_user_references_by_table: dict[str, int] = {}
    nulled_user_references_by_table_column: dict[str, int] = {}

    def record_drop(table_name: str) -> None:
        dropped_by_table[table_name] = dropped_by_table.get(table_name, 0) + 1

    for line, parsed_insert in parsed_lines:
        if not parsed_insert:
            output_statements.append(line)
            continue

        table = parsed_insert["table"]
        if should_drop_seed_insert_table(parsed_insert):
            record_drop(table)
            continue

        if table == "public.system_users":
            username = text_column_value(parsed_insert, "username")
            if not username or username.lower() not in allowed_usernames:
                record_drop(table)
                continue

        if table in SEED_ROW_POLICY_DROP_TABLES_BY_USER_ID:
            user_column = "id" if table == "restricted.users_restricted" else "user_id"
            user_id = integer_column_value(parsed_insert, user_column)
            if user_id is not None and user_id not in allowed_user_ids:
                record_drop(table)
                continue

        invalid_reference_requires_drop = False
        pending_nulled_reference_keys: list[str] = []
        for foreign_key in system_user_foreign_keys.get(table.lower(), []):
            column = foreign_key["column"]
            raw_user_id = column_value(parsed_insert, column)
            if raw_user_id is None or raw_user_id.upper() == "NULL":
                continue
            try:
                referenced_user_id = int(raw_user_id)
            except ValueError as exc:
                raise BootstrapSeedBuilderError(
                    f"cannot validate {table}.{column} system_users reference: {raw_user_id}"
                ) from exc
            if referenced_user_id in allowed_user_ids:
                continue

            if foreign_key["on_delete"] != "SET NULL":
                invalid_reference_requires_drop = True
                break

            for index, insert_column in enumerate(parsed_insert["columns"]):
                if normalize_sql_identifier(insert_column) == column:
                    parsed_insert["values"][index] = "NULL"
                    pending_nulled_reference_keys.append(f"{table}.{column}")
                    break

        if invalid_reference_requires_drop:
            record_drop(table)
            dropped_invalid_user_references_by_table[table] = (
                dropped_invalid_user_references_by_table.get(table, 0) + 1
            )
            continue

        for key in pending_nulled_reference_keys:
            nulled_user_references_by_table_column[key] = (
                nulled_user_references_by_table_column.get(key, 0) + 1
            )
        output_statements.append(
            render_insert_line(parsed_insert) if pending_nulled_reference_keys else line
        )

    return "".join(output_statements).rstrip("\n") + "\n", {
        "allowed_usernames": sorted(allowed_usernames),
        "allowed_user_ids": sorted(allowed_user_ids),
        "dropped_insert_rows_by_table": dict(sorted(dropped_by_table.items())),
        "dropped_invalid_user_references_by_table": dict(
            sorted(dropped_invalid_user_references_by_table.items())
        ),
        "nulled_user_references_by_table_column": dict(
            sorted(nulled_user_references_by_table_column.items())
        ),
        "system_user_foreign_keys_checked": sum(map(len, system_user_foreign_keys.values())),
    }


def audit_seed_sql_tables(seed_sql: str) -> list[dict[str, Any]]:
    """Summarize final seed INSERT rows and bytes by table before archive creation."""
    table_rows: dict[str, int] = {}
    table_bytes: dict[str, int] = {}
    for statement in split_seed_sql_statements(seed_sql):
        parsed_insert = parse_insert_line(statement)
        if not parsed_insert:
            continue
        table = parsed_insert["table"]
        table_rows[table] = table_rows.get(table, 0) + 1
        table_bytes[table] = table_bytes.get(table, 0) + len(statement.encode("utf-8"))
    return [
        {
            "table": table,
            "rows": table_rows[table],
            "bytes": table_bytes[table],
        }
        for table in sorted(table_rows, key=lambda item: (-table_bytes[item], item))
    ]


def format_seed_audit(seed_audit: Sequence[dict[str, Any]]) -> str:
    """Format a compact human-readable seed audit table."""
    lines = ["table\trows\tbytes"]
    for row in seed_audit:
        lines.append(f"{row['table']}\t{row['rows']}\t{row['bytes']}")
    return "\n".join(lines)


def order_system_table_folders_seed_rows(seed_sql: str) -> str:
    """Order self-referencing folder seed rows so parent rows import first."""
    lines = seed_sql.splitlines()
    insert_re = re.compile(
        r"^INSERT INTO public\.system_table_folders \((?P<columns>.+)\) VALUES \((?P<values>.+)\);$"
    )
    rows: list[tuple[int, int, int | None, str]] = []
    parent_by_id: dict[int, int | None] = {}

    for index, line in enumerate(lines):
        match = insert_re.match(line)
        if not match:
            continue
        columns = [column.strip().strip('"') for column in split_sql_csv_fields(match.group("columns"))]
        values = split_sql_csv_fields(match.group("values"))
        try:
            id_index = columns.index("id")
            parent_index = columns.index("parent_id")
            folder_id = int(values[id_index])
            parent_value = values[parent_index].strip()
            parent_id = None if parent_value.upper() == "NULL" else int(parent_value)
        except (ValueError, IndexError):
            continue
        rows.append((index, folder_id, parent_id, line))
        parent_by_id[folder_id] = parent_id

    if len(rows) < 2:
        return seed_sql

    depth_cache: dict[int, int] = {}

    def row_depth(folder_id: int, visiting: set[int] | None = None) -> int:
        if folder_id in depth_cache:
            return depth_cache[folder_id]
        visiting = visiting or set()
        if folder_id in visiting:
            return 0
        visiting.add(folder_id)
        parent_id = parent_by_id.get(folder_id)
        if parent_id is None:
            depth = 0
        elif parent_id not in parent_by_id:
            depth = 10_000
        else:
            depth = row_depth(parent_id, visiting) + 1
        depth_cache[folder_id] = depth
        return depth

    sorted_rows = sorted(rows, key=lambda row: (row_depth(row[1]), row[1]))
    sorted_lines = iter(row[3] for row in sorted_rows)
    for index, *_ in sorted(rows, key=lambda row: row[0]):
        lines[index] = next(sorted_lines)

    return "\n".join(lines).rstrip("\n") + "\n"


def sql_string_literal(value: str) -> str:
    """Return a simple single-quoted SQL literal for generated seed upserts."""
    return "'" + value.replace("'", "''") + "'"


def seed_profile_role_config_sql(seed_profile: str) -> str:
    """Return an idempotent seed SQL upsert that enforces the instance role."""
    role = normalize_seed_profile(seed_profile)
    json_value = json.dumps(
        {"value": role, "allowed_values": list(VALID_SEED_PROFILES)},
        ensure_ascii=False,
    )

    return f"""
-- Enforce the bootstrap seed profile at import time.
-- This keeps management seed archives from booting as application instances.
INSERT INTO public.system_config (
    key,
    json_value,
    creation_spec,
    boolean_value,
    text_value,
    int_value,
    value_type
)
VALUES (
    {sql_string_literal(INSTANCE_ROLE_CONFIG_KEY)},
    {sql_string_literal(json_value)}::jsonb,
    {sql_string_literal(INSTANCE_ROLE_CREATION_SPEC)},
    NULL,
    {sql_string_literal(role)},
    NULL,
    (
        SELECT id
        FROM public.system_config_value_data_types
        WHERE lower(data_type) IN ('text', 'string')
        ORDER BY id ASC
        LIMIT 1
    )
)
ON CONFLICT (key) DO UPDATE
SET
    json_value = EXCLUDED.json_value,
    creation_spec = EXCLUDED.creation_spec,
    boolean_value = EXCLUDED.boolean_value,
    text_value = EXCLUDED.text_value,
    int_value = EXCLUDED.int_value,
    value_type = EXCLUDED.value_type,
    updated = now();
    """.lstrip()


def seed_profile_table_policy_sql(seed_profile: str) -> str:
    """Return SQL that persists profile-owned data boundaries inside the seed."""
    role = normalize_seed_profile(seed_profile)
    profile_conditions: list[str] = []

    if role == "application":
        profile_conditions.append("table_name LIKE 'app_cloud\\_%' ESCAPE '\\'")
    elif role == "management":
        profile_conditions.append(
            "(table_name LIKE 'app\\_%' ESCAPE '\\' AND table_name NOT LIKE 'app_cloud\\_%' ESCAPE '\\')"
        )

    for table_name in sorted(SEED_SCHEMA_ONLY_TABLES):
        profile_conditions.append(f"table_name = {sql_string_literal(table_name)}")
    profile_conditions.append("table_name LIKE '%\\_lang_embeddings' ESCAPE '\\'")
    profile_conditions.append(
        "("
        "table_name LIKE 'dev\\_%' ESCAPE '\\' "
        f"AND table_name NOT IN ({', '.join(sql_string_literal(table) for table in sorted(CURATED_DEV_SEED_TABLES))})"
        ")"
    )

    condition_sql = "\n        OR ".join(profile_conditions)

    return f"""
-- Persist bootstrap profile data boundaries for future exports from this instance.
UPDATE public.system_db_tables
SET sql_dump_policy = 'schema_only',
    updated = now()
WHERE COALESCE(NULLIF(schema_name, ''), 'public') = 'public'
  AND (
        {condition_sql}
  )
  AND COALESCE(sql_dump_policy, 'all') = 'all';
""".lstrip()


def append_seed_profile_role_config(seed_sql: str, seed_profile: str) -> str:
    """Append profile enforcement SQL after the dumped seed data."""
    return (
        normalize_sql_text(seed_sql)
        + "\n"
        + seed_profile_role_config_sql(seed_profile)
        + "\n"
        + seed_profile_table_policy_sql(seed_profile)
    )


def sha256_hex(content: bytes) -> str:
    """Return a stable SHA-256 digest for manifest bookkeeping."""
    return hashlib.sha256(content).hexdigest()


def resolve_repo_relative_path(path: Path) -> str:
    """Render paths relative to the repo when possible so manifests stay review-friendly."""
    try:
        return str(path.resolve().relative_to(PROJECT_ROOT))
    except ValueError:
        return str(path.resolve())


def read_default_db_version() -> str:
    """Load the current tracked DB version from VERSION_DB."""
    if not VERSION_DB_FILE.exists():
        raise BootstrapSeedBuilderError(f"VERSION_DB file not found at {VERSION_DB_FILE}")
    db_version = read_text_file(VERSION_DB_FILE).strip()
    if not db_version:
        raise BootstrapSeedBuilderError("VERSION_DB is empty")
    return db_version


def resolve_schema_snapshot(db_version: str, override_path: str | None) -> Path:
    """Pick the schema snapshot file that corresponds to the target DB version."""
    if override_path:
        schema_path = Path(override_path).expanduser().resolve()
    else:
        schema_path = (SCHEMA_SNAPSHOT_DIR / f"db-{db_version}.sql").resolve()
    if not schema_path.exists():
        raise BootstrapSeedBuilderError(
            f"schema snapshot not found for DB version {db_version}: {schema_path}"
        )
    return schema_path


def normalize_seed_profile(seed_profile: str | None) -> str:
    """Validate the requested seed profile before it affects output paths or manifests."""
    normalized = (seed_profile or "application").strip().lower()
    if normalized not in VALID_SEED_PROFILES:
        valid_values = ", ".join(VALID_SEED_PROFILES)
        raise BootstrapSeedBuilderError(
            f"unsupported seed profile {seed_profile!r}; expected one of: {valid_values}"
        )
    return normalized


def profile_sql_dump_policy_for_table(schema_name: str, table_name: str, seed_profile: str) -> str:
    """Return profile-owned dump policy for app/cloud table data boundaries."""
    seed_policy = seed_schema_only_policy_for_table(schema_name, table_name)
    if seed_policy == "schema_only":
        return seed_policy
    if schema_name != "public":
        return "all"
    if seed_profile == "application" and table_name.startswith("app_cloud_"):
        return "schema_only"
    if (
        seed_profile == "management"
        and table_name.startswith("app_")
        and not table_name.startswith("app_cloud_")
    ):
        return "schema_only"
    return "all"


def sql_dump_policy_flags_from_rows(
    rows: Sequence[tuple[str, str, str]],
    seed_profile: str,
) -> list[str]:
    """Translate DB dump policies plus seed-profile boundaries into pg_dump flags."""
    flags: list[str] = []
    seen_flags: set[str] = set()

    def add_flag(flag: str) -> None:
        if flag in seen_flags:
            return
        flags.append(flag)
        seen_flags.add(flag)

    for schema_name, table_name, sql_dump_policy in rows:
        qualified_table = f"{schema_name}.{table_name}"
        profile_policy = profile_sql_dump_policy_for_table(schema_name, table_name, seed_profile)
        effective_policy = sql_dump_policy
        if profile_policy == "schema_only" and effective_policy == "all":
            effective_policy = "schema_only"

        if effective_policy == "schema_only":
            add_flag(f"--exclude-table-data={qualified_table}")
            continue
        if effective_policy == "none":
            add_flag(f"--exclude-table={qualified_table}")

    return flags


def bootstrap_seed_archive_name(db_version: str, seed_profile: str) -> str:
    """Return the canonical archive filename for an application or management seed."""
    if seed_profile == "application":
        return f"easelect_bootstrap_db-{db_version}.zip"
    return f"easelect_management_bootstrap_db-{db_version}.zip"


def resolve_output_path(db_version: str, output_arg: str | None, seed_profile: str = "application") -> Path:
    """Choose the canonical profile-specific archive path unless the caller overrides it."""
    if output_arg:
        return Path(output_arg).expanduser().resolve()
    return (
        BOOTSTRAP_SEED_DIR
        / f"db-{db_version}"
        / bootstrap_seed_archive_name(db_version, seed_profile)
    ).resolve()


def read_password_from_file(password_file: Path) -> str | None:
    """Read the first non-empty line from an optional local password helper file."""
    if not password_file.exists():
        return None
    password = read_text_file(password_file).strip()
    if not password:
        raise BootstrapSeedBuilderError(f"password file is empty: {password_file}")
    return password.splitlines()[0].strip()


def resolve_db_password(args: argparse.Namespace) -> tuple[str | None, str | None]:
    """Resolve a DB password from CLI, environment, or the optional gitignored local file."""
    if args.db_password:
        return args.db_password, "cli"

    if os.environ.get("PGPASSWORD"):
        return os.environ["PGPASSWORD"], "env"

    password_file = Path(args.db_password_file).expanduser().resolve()
    password_from_file = read_password_from_file(password_file)
    if password_from_file:
        return password_from_file, resolve_repo_relative_path(password_file)

    return None, None


def resolve_zip_password(args: argparse.Namespace) -> tuple[str, str]:
    """Resolve the password used to encrypt the committed bootstrap zip output."""
    if args.zip_password:
        return args.zip_password, "cli"

    if os.environ.get("BOOTSTRAP_SEED_ZIP_PASSWORD"):
        return os.environ["BOOTSTRAP_SEED_ZIP_PASSWORD"], "env"

    password_file = Path(args.zip_password_file).expanduser().resolve()
    password_from_file = read_password_from_file(password_file)
    if password_from_file:
        return password_from_file, resolve_repo_relative_path(password_file)

    raise BootstrapSeedBuilderError(
        "bootstrap zip password missing; provide --zip-password, "
        "BOOTSTRAP_SEED_ZIP_PASSWORD, or "
        f"{resolve_repo_relative_path(DEFAULT_ZIP_PASSWORD_FILE)}"
    )


def ensure_command_exists(command_name: str) -> None:
    """Fail fast when a requested dump path depends on missing local tooling."""
    if shutil.which(command_name):
        return
    raise BootstrapSeedBuilderError(f"required command not found in PATH: {command_name}")


def run_text_command(
    command: Sequence[str],
    env: dict[str, str] | None = None,
    cwd: Path | None = None,
) -> str:
    """Run a shell command and return stdout, surfacing stderr on failure for debugging."""
    completed = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        env=env,
        cwd=str(cwd) if cwd is not None else None,
    )
    if completed.returncode == 0:
        return completed.stdout

    stderr = (completed.stderr or "").strip()
    stdout = (completed.stdout or "").strip()
    detail = stderr or stdout or f"exit code {completed.returncode}"
    raise BootstrapSeedBuilderError(detail)


def load_sql_dump_policy_flags(
    args: argparse.Namespace,
    db_password: str,
    seed_profile: str,
) -> list[str]:
    """Read per-table dump-policy metadata and translate it into profile-aware pg_dump flags."""
    ensure_command_exists("psql")
    command = [
        "psql",
        "-h",
        args.db_host,
        "-p",
        str(args.db_port),
        "-U",
        args.db_user,
        "-d",
        args.db_name,
        "-At",
        "-F",
        "\t",
        "-c",
        SQL_DUMP_POLICY_QUERY,
    ]
    env = os.environ.copy()
    env["PGPASSWORD"] = db_password

    try:
        raw_rows = run_text_command(command, env=env)
    except BootstrapSeedBuilderError as exc:
        raise BootstrapSeedBuilderError(
            "could not read sql_dump_policy metadata; refusing live bootstrap export "
            f"because seed profile {seed_profile!r} depends on table-data boundaries ({exc})"
        ) from exc

    rows: list[tuple[str, str, str]] = []
    for row in raw_rows.splitlines():
        if not row.strip():
            continue
        schema_name, table_name, sql_dump_policy = row.split("\t")
        rows.append((schema_name, table_name, sql_dump_policy))
    if not rows:
        raise BootstrapSeedBuilderError(
            "system_db_tables inventory is empty; refusing live bootstrap export"
        )
    return sql_dump_policy_flags_from_rows(rows, seed_profile)


def build_seed_sql_from_live_db(
    args: argparse.Namespace,
    db_version: str,
    seed_profile: str,
) -> tuple[str, dict[str, Any]]:
    """Create policy-aware seed SQL from the live DB using pg_dump read-only export commands."""
    ensure_command_exists("pg_dump")
    db_password, password_source = resolve_db_password(args)
    if not db_password:
        raise BootstrapSeedBuilderError(
            "live seed export requires --db-password, PGPASSWORD, or "
            f"{resolve_repo_relative_path(DEFAULT_DB_PASSWORD_FILE)}"
        )

    dump_policy_flags = load_sql_dump_policy_flags(args, db_password, seed_profile)
    command = [
        "pg_dump",
        "-h",
        args.db_host,
        "-p",
        str(args.db_port),
        "-U",
        args.db_user,
        "-d",
        args.db_name,
        "--data-only",
        "--column-inserts",
        "--no-owner",
        "--no-acl",
        *dump_policy_flags,
    ]
    env = os.environ.copy()
    env["PGPASSWORD"] = db_password

    seed_sql = normalize_sql_text(run_text_command(command, env=env))
    source_metadata = {
        "mode": "live_pg_dump",
        "db_host": args.db_host,
        "db_port": args.db_port,
        "db_name": args.db_name,
        "db_user": args.db_user,
        "db_version": db_version,
        "password_source": password_source,
        "seed_profile": seed_profile,
        "sql_dump_policy_flags": dump_policy_flags,
    }
    return seed_sql, source_metadata


def load_seed_sql(
    args: argparse.Namespace,
    db_version: str,
    seed_profile: str,
) -> tuple[str, dict[str, Any]]:
    """Resolve seed SQL from either a caller-supplied file or a local live DB dump."""
    if args.seed_sql:
        seed_path = Path(args.seed_sql).expanduser().resolve()
        if not seed_path.exists():
            raise BootstrapSeedBuilderError(f"seed SQL file not found: {seed_path}")
        seed_sql = normalize_sql_text(read_text_file(seed_path))
        return seed_sql, {
            "mode": "seed_sql_file",
            "source_path": resolve_repo_relative_path(seed_path),
            "db_version": db_version,
            "seed_profile": seed_profile,
        }

    return build_seed_sql_from_live_db(args, db_version, seed_profile)


def build_manifest(
    db_version: str,
    seed_profile: str,
    schema_path: Path,
    schema_bytes: bytes,
    seed_bytes: bytes,
    seed_metadata: dict[str, Any],
) -> bytes:
    """Assemble a deterministic manifest that explains the zip contents and provenance."""
    manifest = {
        "artifact_type": "easelect_bootstrap_seed",
        "builder_script": "server_tools/scripts/build_bootstrap_seed.py",
        "db_version": db_version,
        "default_zip_password_file": resolve_repo_relative_path(DEFAULT_ZIP_PASSWORD_FILE),
        "entries": [
            {
                "path": "schema.sql",
                "sha256": sha256_hex(schema_bytes),
                "size_bytes": len(schema_bytes),
            },
            {
                "path": "seed_data.sql",
                "sha256": sha256_hex(seed_bytes),
                "size_bytes": len(seed_bytes),
            },
        ],
        "format_version": 1,
        "schema_snapshot_path": resolve_repo_relative_path(schema_path),
        "seed_profile": seed_profile,
        "seed_source": seed_metadata,
    }
    return (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode("utf-8")


def write_encrypted_zip(
    output_path: Path,
    files: list[tuple[str, bytes]],
    overwrite: bool,
    zip_password: str,
) -> None:
    """Write an encrypted zip in a fixed file order with fixed mtimes for stable layout rebuilds."""
    if output_path.exists() and not overwrite:
        raise BootstrapSeedBuilderError(
            f"refusing to overwrite existing archive without --overwrite: {output_path}"
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    ensure_command_exists("zip")
    ensure_command_exists("zipcloak")

    with tempfile.TemporaryDirectory(prefix="easelect-bootstrap-seed-") as temp_dir:
        temp_path = Path(temp_dir)
        archive_entries: list[str] = []
        plain_archive_path = temp_path / output_path.name

        for archive_name, content in files:
            entry_path = temp_path / archive_name
            entry_path.write_bytes(content)
            os.utime(entry_path, (FIXED_FILE_EPOCH, FIXED_FILE_EPOCH))
            archive_entries.append(archive_name)

        command = [
            "zip",
            "-X",
            "-q",
            str(plain_archive_path),
            *archive_entries,
        ]
        run_text_command(command, env=os.environ.copy() | {"TZ": "UTC"}, cwd=temp_path)
        run_zipcloak_command(plain_archive_path, zip_password)

        if output_path.exists():
            output_path.unlink()
        shutil.move(str(plain_archive_path), str(output_path))


def run_zipcloak_command(zip_path: Path, zip_password: str) -> None:
    """Encrypt a plain zip archive in-place via zipcloak without exposing the password in argv."""
    try:
        import pexpect
    except Exception as exc:
        raise BootstrapSeedBuilderError(
            "python3 module pexpect is required for zipcloak automation"
        ) from exc

    child = pexpect.spawn("zipcloak", [str(zip_path)], encoding="utf-8", timeout=10)
    try:
        child.expect("Enter password:")
        child.sendline(zip_password)
        child.expect("Verify password:")
        child.sendline(zip_password)
        child.expect(pexpect.EOF)
    except Exception as exc:
        raise BootstrapSeedBuilderError(f"zipcloak interaction failed: {exc}") from exc
    finally:
        child.close()

    if child.exitstatus != 0:
        raise BootstrapSeedBuilderError(f"zipcloak failed with exit code {child.exitstatus}")


def parse_args() -> argparse.Namespace:
    """Parse CLI arguments for deterministic bootstrap archive creation."""
    parser = argparse.ArgumentParser(
        description="Build a password-protected bootstrap seed zip for an Easelect DB version."
    )
    parser.add_argument(
        "--db-version",
        default=None,
        help="Target DB version. Defaults to VERSION_DB.",
    )
    parser.add_argument(
        "--schema-snapshot",
        default=None,
        help="Optional override path for schema.sql input.",
    )
    parser.add_argument(
        "--seed-sql",
        default=None,
        help="Use an existing seed SQL file instead of running pg_dump.",
    )
    parser.add_argument(
        "--seed-profile",
        choices=VALID_SEED_PROFILES,
        default="application",
        help=(
            "Bootstrap seed profile. application keeps the historical archive name; "
            "management writes a management-specific archive name."
        ),
    )
    parser.add_argument(
        "--seed-user-allowlist",
        default=",".join(DEFAULT_SEED_USER_ALLOWLIST),
        help=(
            "Comma-separated usernames to keep in system_users and matching restricted user rows."
        ),
    )
    parser.add_argument(
        "--print-audit",
        action="store_true",
        help="Print final seed table row/byte counts to stderr before writing the archive.",
    )
    parser.add_argument(
        "--audit-only",
        action="store_true",
        help="Print final seed table row/byte counts to stdout and exit without writing a zip.",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Output zip path. Defaults under server_tools/versioning/bootstrap_seeds/.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Allow replacing an existing zip at the output path.",
    )
    parser.add_argument("--db-host", default="localhost", help="PostgreSQL host for live seed export.")
    parser.add_argument("--db-port", default=5433, type=int, help="PostgreSQL port for live seed export.")
    parser.add_argument("--db-name", default="easelect", help="PostgreSQL database name for live seed export.")
    parser.add_argument("--db-user", default="admin_user", help="PostgreSQL user for live seed export.")
    parser.add_argument("--db-password", default=None, help="PostgreSQL password for live seed export.")
    parser.add_argument(
        "--db-password-file",
        default=str(DEFAULT_DB_PASSWORD_FILE),
        help="Optional local password file. First line is used when present.",
    )
    parser.add_argument(
        "--zip-password",
        default=None,
        help="Password for the committed bootstrap zip artifact.",
    )
    parser.add_argument(
        "--zip-password-file",
        default=str(DEFAULT_ZIP_PASSWORD_FILE),
        help="Gitignored local file whose first line is used as the bootstrap zip password.",
    )
    return parser.parse_args()


def main() -> int:
    """Build the requested archive and print the resulting path."""
    args = parse_args()
    db_version = args.db_version or read_default_db_version()
    seed_profile = normalize_seed_profile(args.seed_profile)
    schema_path = resolve_schema_snapshot(db_version, args.schema_snapshot)
    output_path = resolve_output_path(db_version, args.output, seed_profile)
    seed_user_allowlist = normalize_seed_user_allowlist(args.seed_user_allowlist)
    zip_password = ""
    zip_password_source = "not-required"
    if not args.audit_only:
        zip_password, zip_password_source = resolve_zip_password(args)

    schema_sql = normalize_sql_text(read_text_file(schema_path))
    seed_sql, seed_metadata = load_seed_sql(args, db_version, seed_profile)
    seed_sql = restore_seed_runtime_search_path(seed_sql)
    seed_sql, scrubbed_column_counts = scrub_seed_sql_excluded_columns(seed_sql)
    seed_sql = order_system_table_folders_seed_rows(seed_sql)
    seed_sql, row_policy_metadata = apply_seed_row_policies(
        seed_sql,
        seed_user_allowlist,
        schema_sql,
    )
    seed_sql = append_seed_profile_role_config(seed_sql, seed_profile)
    seed_audit = audit_seed_sql_tables(seed_sql)
    seed_metadata["excluded_seed_columns"] = list(DEFAULT_EXCLUDED_SEED_COLUMNS)
    seed_metadata["excluded_seed_column_value_counts"] = scrubbed_column_counts
    seed_metadata["row_policy"] = row_policy_metadata
    seed_metadata["final_table_audit"] = seed_audit
    seed_metadata["zip_password_source"] = zip_password_source

    if args.audit_only:
        print(format_seed_audit(seed_audit))
        return 0

    if args.print_audit:
        print(format_seed_audit(seed_audit), file=sys.stderr)

    schema_bytes = schema_sql.encode("utf-8")
    seed_bytes = seed_sql.encode("utf-8")
    manifest_bytes = build_manifest(
        db_version=db_version,
        seed_profile=seed_profile,
        schema_path=schema_path,
        schema_bytes=schema_bytes,
        seed_bytes=seed_bytes,
        seed_metadata=seed_metadata,
    )

    write_encrypted_zip(
        output_path=output_path,
        files=[
            ("schema.sql", schema_bytes),
            ("seed_data.sql", seed_bytes),
            ("manifest.json", manifest_bytes),
        ],
        zip_password=zip_password,
        overwrite=args.overwrite,
    )

    print(resolve_repo_relative_path(output_path))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BootstrapSeedBuilderError as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
