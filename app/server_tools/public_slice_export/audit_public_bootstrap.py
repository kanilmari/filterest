#!/usr/bin/env python3
# audit_public_bootstrap.py
# Reviews generated Filterest public bootstrap schema and seed contents.
# Bridges public-release seed policy, generated SQL, and ticket evidence.
# Exists so public bootstrap review is repeatable instead of hand-waved.

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import sys
from collections import Counter
from dataclasses import dataclass


ALLOWED_SCHEMA_TABLES = {
    "public.ai_chat_conversations",
    "public.dokumentaatio",
    "public.dokumentaatio_assets",
    "public.dokumentaatio_tiketit_relation",
    "public.palvelukatalogi",
    "public.palvelukatalogi_assets",
    "public.palvelukatalogi_dokumentaatio_relation",
    "public.palvelukatalogi_riskienhallinta_relation",
    "public.palvelukatalogi_tiketit_relation",
    "public.riskienhallinta",
    "public.riskienhallinta_assets",
    "public.riskienhallinta_dokumentaatio_relation",
    "public.riskienhallinta_tiketit_relation",
    "public.tiketit",
    "public.tiketit_assets",
    "public.system_audit_log",
    "public.system_about",
    "public.system_column_control",
    "public.system_child_tab_config",
    "public.system_comments",
    "public.system_row_groups",
    "public.system_row_group_memberships",
    "public.system_column_field_set_members",
    "public.system_column_field_sets",
    "public.system_column_details",
    "public.system_config",
    "public.system_db_table_aliases",
    "public.system_db_tables",
    "public.system_db_version",
    "public.system_dataset_media",
    "public.system_media_assets",
    "public.system_media_asset_usages",
    "public.system_dataset_sort_defaults",
    "public.system_embedding_refresh_jobs",
    "public.system_foreign_key_relations_1_m",
    "public.system_foreign_key_relations_m_m",
    "public.system_functions",
    "public.system_group_table_func_rights",
    "public.system_languages",
    "public.system_lang_key_translations",
    "public.system_lang_key_sources",
    "public.system_lang_keys",
    "public.system_lang_keys_archive",
    "public.system_schema_migrations",
    "public.system_permission_actions",
    "public.system_permission_categories",
    "public.system_row_access_rule_events",
    "public.system_row_access_rules",
    "public.system_table_folders",
    "public.system_table_row_view_counts",
    "public.system_table_views",
    "public.system_transaction_log",
    "public.system_view_field_set_assignments",
    "public.system_user_group_memberships",
    "public.system_user_groups",
    "public.system_user_visual_preferences",
    "public.system_users",
    "restricted.otp_send_events",
    "restricted.users_restricted",
    "restricted.verification_codes",
}

ALLOWED_SEED_TABLES = {
    "public.dokumentaatio",
    "public.dokumentaatio_tiketit_relation",
    "public.palvelukatalogi",
    "public.palvelukatalogi_assets",
    "public.palvelukatalogi_dokumentaatio_relation",
    "public.palvelukatalogi_riskienhallinta_relation",
    "public.palvelukatalogi_tiketit_relation",
    "public.riskienhallinta",
    "public.riskienhallinta_assets",
    "public.riskienhallinta_dokumentaatio_relation",
    "public.riskienhallinta_tiketit_relation",
    "public.tiketit",
    "public.tiketit_assets",
    "public.system_column_details",
    "public.system_about",
    "public.system_config",
    "public.system_db_tables",
    "public.system_db_version",
    "public.system_functions",
    "public.system_foreign_key_relations_1_m",
    "public.system_group_table_func_rights",
    "public.system_languages",
    "public.system_lang_key_sources",
    "public.system_lang_key_translations",
    "public.system_lang_keys",
    "public.system_permission_actions",
    "public.system_permission_categories",
    "public.system_schema_migrations",
    "public.system_table_folders",
    "public.system_table_views",
    "public.system_view_field_set_assignments",
    "public.system_user_group_memberships",
    "public.system_user_groups",
    "public.system_users",
}

FORBIDDEN_CONTENT_PATTERNS = {
    "private/dev table": re.compile(
        r"\b(dev_agent_tasks|dev_agent_worklines|dev_agent_workline_reports|"
        r"dev_agent_release_goals|dev_agent_release_goal_contracts|"
        r"dev_agent_workline_tasks|dev_agent_handover_reports|"
        r"dev_agent_handover_report_items|dev_projects|dev_milestones|app_notes|"
        r"app_service_catalog|app_service_catalog_assets|"
        r"app_service_child_items|app_service_locations)\b",
        re.IGNORECASE,
    ),
    "private app/tool reference": re.compile(
        r"\b(agent_tools|tukisuu|mcp_app|private_tools|private_apps)\b|"
        r"/api/app/(agent|tukisuu|mcp)",
        re.IGNORECASE,
    ),
    "parallel replacement mock table": re.compile(
        r"\b(app_services|app_tickets|app_risks|app_documents)\b",
        re.IGNORECASE,
    ),
    "provider token": re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b"),
    "secret assignment": re.compile(
        r"\b[A-Z0-9_]*(API_KEY|SECRET|TOKEN|PASSWORD)\s*=", re.IGNORECASE
    ),
    "private upstream runtime wording": re.compile(
        r"\bprivate\s+(?:Easelect|upstream)\s+runtime\b|\bEaselect\s+runtime\s+state\b",
        re.IGNORECASE,
    ),
}

EMAIL_PATTERN = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
TABLE_PATTERN = re.compile(
    r"\b(?:CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|INSERT\s+INTO|COPY)\s+"
    r"((?:public|restricted)\.[A-Za-z0-9_]+)",
    re.IGNORECASE,
)
INSERT_TABLE_PATTERN = re.compile(r"\bINSERT\s+INTO\s+((?:public|restricted)\.[A-Za-z0-9_]+)", re.IGNORECASE)
SYSTEM_CONFIG_KEY_PATTERN = re.compile(
    r"\(\s*\d+\s*,\s*'((?:''|[^'])+)'\s*,",
    re.IGNORECASE,
)
SYSTEM_CONFIG_SELECT_KEY_PATTERN = re.compile(
    r"\bSELECT\s*'((?:''|[^'])+)'\s*,",
    re.IGNORECASE,
)
MIGRATION_LEDGER_INSERT_PATTERN = re.compile(
    r"\bINSERT\s+INTO\s+public\.system_schema_migrations\s*\(\s*filename\s*\)"
    r"\s*VALUES\s*(.*?)\s*ON\s+CONFLICT\s*\(\s*filename\s*\)\s+DO\s+NOTHING\s*;",
    re.IGNORECASE | re.DOTALL,
)
MIGRATION_LEDGER_FILENAME_PATTERN = re.compile(r"\(\s*'([^']+\.sql)'\s*\)")

CANONICAL_MOCK_ROW_COUNTS = {
    "public.palvelukatalogi": 1,
    "public.riskienhallinta": 1,
    "public.dokumentaatio": 3,
    "public.tiketit": 1,
    "public.palvelukatalogi_assets": 1,
    "public.riskienhallinta_assets": 1,
    "public.dokumentaatio_assets": 0,
    "public.tiketit_assets": 1,
}

CANONICAL_MOCK_RELATION_MINIMUMS = {
    "public.palvelukatalogi_riskienhallinta_relation": 1,
    "public.palvelukatalogi_dokumentaatio_relation": 1,
    "public.palvelukatalogi_tiketit_relation": 1,
    "public.riskienhallinta_dokumentaatio_relation": 1,
    "public.riskienhallinta_tiketit_relation": 1,
    "public.dokumentaatio_tiketit_relation": 1,
}

CANONICAL_IMAGE_ASSET_RELATIONS = {
    "palvelukatalogi": ("palvelukatalogi_assets", "palvelukatalogi_id", 300, 7),
    "riskienhallinta": ("riskienhallinta_assets", "riskienhallinta_id", 301, 8),
    "dokumentaatio": ("dokumentaatio_assets", "dokumentaatio_id", 302, 9),
    "tiketit": ("tiketit_assets", "tiketit_id", 303, 10),
}

CANONICAL_RUNTIME_SEED_COUNTS = {
    "public.system_about": 1,
    "public.system_db_version": 1,
}

REQUIRED_RUNTIME_SCHEMA_FRAGMENTS = {
    "AI conversation table": "CREATE TABLE IF NOT EXISTS public.ai_chat_conversations",
    "table-view metadata table": "CREATE TABLE IF NOT EXISTS public.system_table_views",
    "child-tab configuration table": "CREATE TABLE IF NOT EXISTS public.system_child_tab_config",
    "cross-dataset comments table": "CREATE TABLE IF NOT EXISTS public.system_comments",
    "row-group table": "CREATE TABLE IF NOT EXISTS public.system_row_groups",
    "row-group membership table": "CREATE TABLE IF NOT EXISTS public.system_row_group_memberships",
    "field collection table": "CREATE TABLE IF NOT EXISTS public.system_column_field_sets",
    "field collection member table": "CREATE TABLE IF NOT EXISTS public.system_column_field_set_members",
    "view field assignment table": "CREATE TABLE IF NOT EXISTS public.system_view_field_set_assignments",
    "user visual preference table": "CREATE TABLE IF NOT EXISTS public.system_user_visual_preferences",
    "user visual preference timestamp trigger": "update_system_user_visual_preferences_timestamp",
    "client delivery mode": "ADD COLUMN IF NOT EXISTS client_delivery_mode VARCHAR(32)",
    "protected ID delivery constraint": "ck_system_column_details_id_client_delivery",
    "group view assignment target": "ADD COLUMN IF NOT EXISTS group_id BIGINT",
    "group view assignment precedence": "ADD COLUMN IF NOT EXISTS group_priority INTEGER",
    "group view assignment uniqueness": "uq_system_view_field_set_assignment_principal",
    "permission category registry": "CREATE TABLE IF NOT EXISTS public.system_permission_categories",
    "permission action registry": "CREATE TABLE IF NOT EXISTS public.system_permission_actions",
    "row access rules": "CREATE TABLE IF NOT EXISTS public.system_row_access_rules",
    "row access audit events": "CREATE TABLE IF NOT EXISTS public.system_row_access_rule_events",
    "deny-wins row access resolver": "CREATE OR REPLACE FUNCTION public.resolve_effective_row_access",
    "stable view key": "view_key text NOT NULL UNIQUE",
    "about/privacy table": "CREATE TABLE IF NOT EXISTS public.system_about",
    "database-version table": "CREATE TABLE IF NOT EXISTS public.system_db_version",
    "dataset alias table": "CREATE TABLE IF NOT EXISTS public.system_db_table_aliases",
    "UI-language registry": "CREATE TABLE IF NOT EXISTS public.system_languages",
    "normalized UI translations": "CREATE TABLE IF NOT EXISTS public.system_lang_key_translations",
    "single default UI language index": "idx_system_languages_one_default",
    "normalized UI translation lookup index": "idx_system_lang_key_translations_language",
    "embedding refresh queue": "CREATE TABLE IF NOT EXISTS public.system_embedding_refresh_jobs",
    "embedding refresh claim index": "idx_system_embedding_refresh_jobs_claim",
    "dataset media registry": "CREATE TABLE IF NOT EXISTS public.system_dataset_media",
    "dataset media lookup index": "idx_system_dataset_media_table_uid",
    "dataset media timestamp trigger": "update_system_dataset_media_timestamp",
    "dataset sorting defaults": "CREATE TABLE IF NOT EXISTS public.system_dataset_sort_defaults",
    "dataset sorting user index": "idx_system_dataset_sort_defaults_user",
    "dataset embedding enable switch": "external_embedding_enabled BOOLEAN NOT NULL DEFAULT FALSE",
    "dataset embedding policy marker": "external_embedding_policy_configured BOOLEAN NOT NULL DEFAULT FALSE",
    "embedding field allowlist marker": "external_embedding_allowed BOOLEAN NOT NULL DEFAULT FALSE",
    "dataset alias lookup index": "idx_system_db_table_aliases_table_uid",
    "single primary dataset alias index": "idx_system_db_table_aliases_one_primary_alias_per_table",
    "system table ID default": "ALTER TABLE public.system_db_tables ALTER COLUMN id SET DEFAULT",
    "system table UID default": "ALTER TABLE public.system_db_tables ALTER COLUMN table_uid SET DEFAULT",
    "system table default flag": "ALTER TABLE public.system_db_tables ALTER COLUMN is_default SET DEFAULT FALSE",
    "system table non-null default flag": "ALTER TABLE public.system_db_tables ALTER COLUMN is_default SET NOT NULL",
    "system table filterbar flag": "ALTER TABLE public.system_db_tables ALTER COLUMN filterbar_visible_by_default SET DEFAULT FALSE",
    "system table non-null filterbar flag": "ALTER TABLE public.system_db_tables ALTER COLUMN filterbar_visible_by_default SET NOT NULL",
    "AI conversation uniqueness": "idx_ai_chat_conversations_user_dataset",
    "comment lookup index": "idx_system_comments_lookup",
}

REQUIRED_RUNTIME_SEED_FRAGMENTS = {
    "production-update notice state": "'production_update_notice'",
    "production-update manager route": "('router.systemUpdateNoticeHandler', '/system/update-notice'",
    "production-update administrator stream": "('router.adminUpdateNoticeStreamHandler', '/api/admin/update-notice/stream'",
    "production-update administrator permission": "Filterest public bootstrap administrator production-update notice stream",
    "row-group table registry": "('system_row_groups', 'Row Groups'",
    "row-group membership table registry": "('system_row_group_memberships', 'Row Group Memberships'",
    "row-group administrator route": "('system_table_tools.AdminRowGroupsHandler', '/api/admin/row-groups'",
    "row-group membership administrator route": "('system_table_tools.AdminRowGroupMembershipsHandler', '/api/admin/row-group-memberships'",
    "row-group administrator permission": "Filterest public bootstrap administrator row-group API",
    "guest public-schema access": "GRANT USAGE ON SCHEMA public TO guest_user",
    "guest row-group read access": "public.system_row_groups,\n            public.system_row_group_memberships\n        TO guest_user",
    "PostgreSQL RLS readiness gate": "'postgresql_rls_backend_enabled'",
    "row-access administrator route": "'/api/admin/row-access-rules'",
    "view-field reset route": "'system_table_tools.ResetSharedViewFieldSetHandler'",
    "view-field administrator UI permission": "'ui.admin.view_field_assignments'",
    "user visual preference table registry": "('system_user_visual_preferences', 'User Visual Preferences'",
    "user visual preference route": "'auth.UserVisualPreferenceHandler'",
    "user visual preference authenticated grants": "public.system_user_visual_preferences\n        TO basic_user",
    "embedding client-delivery exclusion": "SET client_delivery_mode = 'server_only'",
    "row-access administrator permission": "Filterest DB 9.7.0 accepted administrator access-control workflows",
    "row-access translated copy": "('edit_row_permissions',",
    "view-field translated copy": "('view_field_assignments',",
}


@dataclass(frozen=True)
class BootstrapAudit:
    schema_tables: list[str]
    seed_tables: list[str]
    row_counts: Counter[str]
    emails: list[str]
    manifest: dict
    findings: list[str]


def read_text(path: pathlib.Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def sha256_file(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def audit_source_file_hashes(
    public_root: pathlib.Path,
    source_files: dict,
    findings: list[str],
) -> None:
    """Validate recorded upstream hashes wherever public target bytes exist.

    Bridges producer-relative `filterest/...` evidence keys to the standalone
    public checkout. Every input must ship publicly; external/private-only
    evidence keys are rejected instead of being silently skipped.
    """
    for relative_path, entry in sorted(source_files.items()):
        declared_sha256 = str(entry.get("sha256", "")) if isinstance(entry, dict) else ""
        if re.fullmatch(r"[0-9a-f]{64}", declared_sha256) is None:
            findings.append(f"manifest source_files invalid sha256 for {relative_path}")
            continue
        if not isinstance(relative_path, str) or not relative_path.startswith("filterest/"):
            findings.append(f"manifest source_files input is not shipped publicly: {relative_path}")
            continue

        parsed_path = pathlib.PurePosixPath(relative_path)
        if (
            parsed_path.is_absolute()
            or parsed_path.as_posix() != relative_path
            or len(parsed_path.parts) < 2
            or parsed_path.parts[0] != "filterest"
            or any(part in {"", ".", ".."} for part in parsed_path.parts)
        ):
            findings.append(f"manifest source_files invalid public target path: {relative_path}")
            continue

        target_path = public_root.joinpath(*parsed_path.parts[1:])
        if target_path.is_symlink() or not target_path.is_file():
            findings.append(
                f"manifest source_files public target is missing or not a regular file: {relative_path}"
            )
            continue
        if sha256_file(target_path) != declared_sha256:
            findings.append(f"manifest source_files sha256 mismatch for {relative_path}")


def normalize_table_name(name: str) -> str:
    return name.strip().lower()


def extract_tables(sql: str) -> list[str]:
    return sorted({normalize_table_name(match.group(1)) for match in TABLE_PATTERN.finditer(sql)})


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


def count_insert_rows(seed_sql: str) -> Counter[str]:
    counts: Counter[str] = Counter()
    tuple_pattern = re.compile(r"(?im)(?:^\s*|,\s*|\bVALUES\s*)\(")
    insert_column_list_pattern = re.compile(
        r"(\bINSERT\s+INTO\s+(?:public|restricted)\.[A-Za-z0-9_]+)\s*\([^)]*\)",
        re.IGNORECASE | re.DOTALL,
    )
    for statement in split_sql_statements(seed_sql):
        match = INSERT_TABLE_PATTERN.search(statement)
        if not match:
            continue
        table = normalize_table_name(match.group(1))
        # Fixture tuples either start a line or follow a comma. This supports
        # both direct INSERT ... VALUES and WITH ... VALUES ... INSERT forms,
        # including compact relation lists with several tuples on one line.
        countable_statement = insert_column_list_pattern.sub(r"\1", statement, count=1)
        counts[table] += len(tuple_pattern.findall(countable_statement))
    return counts


def extract_system_config_keys(seed_sql: str) -> list[str]:
    keys: list[str] = []
    for statement in split_sql_statements(seed_sql):
        match = INSERT_TABLE_PATTERN.search(statement)
        if not match or normalize_table_name(match.group(1)) != "public.system_config":
            continue
        keys.extend(
            key.replace("''", "'")
            for key in SYSTEM_CONFIG_KEY_PATTERN.findall(statement)
        )
        keys.extend(
            key.replace("''", "'")
            for key in SYSTEM_CONFIG_SELECT_KEY_PATTERN.findall(statement)
        )
    return keys


def extract_migration_ledger_baseline(seed_sql: str) -> list[str]:
    """Return the generated public-bootstrap migration filename snapshot."""
    match = MIGRATION_LEDGER_INSERT_PATTERN.search(seed_sql)
    if match is None:
        return []
    return MIGRATION_LEDGER_FILENAME_PATTERN.findall(match.group(1))


def audit_bootstrap(public_root: pathlib.Path) -> BootstrapAudit:
    bootstrap_dir = public_root / "app" / "server_tools" / "public_bootstrap"
    schema_file = bootstrap_dir / "schema.sql"
    seed_file = bootstrap_dir / "seed_data.sql"
    manifest_file = bootstrap_dir / "manifest.json"
    readme_file = bootstrap_dir / "README.md"
    findings: list[str] = []

    if not schema_file.is_file():
        findings.append(f"missing public bootstrap schema: {schema_file}")
        schema_sql = ""
    else:
        schema_sql = read_text(schema_file)

    if not seed_file.is_file():
        findings.append(f"missing public bootstrap seed: {seed_file}")
        seed_sql = ""
    else:
        seed_sql = read_text(seed_file)

    if not manifest_file.is_file():
        findings.append(f"missing public bootstrap manifest: {manifest_file}")
        manifest = {}
    else:
        try:
            manifest = json.loads(read_text(manifest_file))
        except json.JSONDecodeError as exc:
            findings.append(f"public bootstrap manifest is not valid JSON: {exc}")
            manifest = {}

    if not readme_file.is_file():
        findings.append(f"missing public bootstrap README: {readme_file}")
    else:
        readme_text = read_text(readme_file)
        readme_normalized = " ".join(readme_text.split())
        required_readme_fragments = (
            "does not ship a reusable admin password",
            "two-section form where the installation owner first chooses",
            "Email verification uses Postmark",
            "visible DEV/TEST/QA purpose cannot downgrade a production-locked binary",
            "server-owned `first_run` setting",
            "committed in one database transaction",
            "completed setups fail closed",
            "`FILTEREST_AUTOMATED_PREVIEW_INITIAL_ADMIN=1`",
        )
        for fragment in required_readme_fragments:
            if fragment not in readme_normalized:
                findings.append(
                    "public bootstrap README must preserve credential boundary: "
                    + fragment
                )

    if manifest.get("artifact") != "filterest-public-bootstrap":
        findings.append("public bootstrap manifest artifact must be filterest-public-bootstrap")
    if manifest.get("purpose") != "local independent Filterest bootstrap without private source runtime dependency":
        findings.append("public bootstrap manifest purpose must document independent Filterest bootstrap")
    if manifest.get("format_version") != 2:
        findings.append("public bootstrap manifest format_version must be 2")

    schema_tables = extract_tables(schema_sql)
    seed_tables = sorted(
        {
            normalize_table_name(match.group(1))
            for match in INSERT_TABLE_PATTERN.finditer(seed_sql)
        }
    )
    row_counts = count_insert_rows(seed_sql)
    system_config_keys = extract_system_config_keys(seed_sql)
    emails = sorted(set(EMAIL_PATTERN.findall(seed_sql)))

    duplicate_config_keys = sorted(
        key for key, count in Counter(system_config_keys).items() if count > 1
    )
    if duplicate_config_keys:
        findings.append(
            "duplicate public.system_config keys: " + ", ".join(duplicate_config_keys)
        )

    unexpected_schema_tables = sorted(set(schema_tables) - ALLOWED_SCHEMA_TABLES)
    unexpected_seed_tables = sorted(set(seed_tables) - ALLOWED_SEED_TABLES)
    if unexpected_schema_tables:
        findings.append("unexpected schema tables: " + ", ".join(unexpected_schema_tables))
    if unexpected_seed_tables:
        findings.append("unexpected seed tables: " + ", ".join(unexpected_seed_tables))

    manifest_schema_tables = manifest.get("allowed_schema_tables")
    manifest_seed_tables = manifest.get("allowed_seed_tables")
    manifest_row_counts = manifest.get("seed_row_counts")
    if manifest_schema_tables != schema_tables:
        findings.append("manifest allowed_schema_tables does not match generated schema.sql")
    if manifest_seed_tables != seed_tables:
        findings.append("manifest allowed_seed_tables does not match generated seed_data.sql")
    if manifest_row_counts != dict(sorted(row_counts.items())):
        findings.append("manifest seed_row_counts does not match generated seed_data.sql")

    migration_dir = public_root / "app" / "server_tools" / "migrations"
    shipped_migrations = sorted(path.name for path in migration_dir.glob("*.sql"))
    ledger_match = MIGRATION_LEDGER_INSERT_PATTERN.search(seed_sql)
    seeded_migrations = extract_migration_ledger_baseline(seed_sql)
    manifest_migrations = manifest.get("migration_ledger_baseline")
    if ledger_match is None:
        findings.append("public bootstrap seed must declare the migration-ledger baseline")
    elif len(seeded_migrations) != len(set(seeded_migrations)):
        findings.append("public bootstrap migration-ledger baseline contains duplicate filenames")
    if manifest_migrations != seeded_migrations:
        findings.append("manifest migration_ledger_baseline does not match generated seed_data.sql")
    if seeded_migrations != shipped_migrations:
        findings.append(
            "public bootstrap migration-ledger baseline does not match shipped public migrations"
        )

    for label, fragment in REQUIRED_RUNTIME_SCHEMA_FRAGMENTS.items():
        if fragment not in schema_sql:
            findings.append(f"public bootstrap schema missing required runtime contract: {label}")
    for label, fragment in REQUIRED_RUNTIME_SEED_FRAGMENTS.items():
        if fragment not in seed_sql:
            findings.append(f"public bootstrap seed missing required runtime contract: {label}")

    manifest_db_version = str(manifest.get("db_version", "")).strip()
    if not manifest_db_version:
        findings.append("public bootstrap manifest must declare db_version")
    elif re.search(
        rf"INSERT\s+INTO\s+public\.system_db_version\s*\([^)]*version[^)]*\)\s*VALUES\s*\(\s*'{re.escape(manifest_db_version)}'",
        seed_sql,
        re.IGNORECASE | re.DOTALL,
    ) is None:
        findings.append("public bootstrap seed must record the manifest db_version")

    for table, expected_count in CANONICAL_MOCK_ROW_COUNTS.items():
        if row_counts.get(table, 0) != expected_count:
            findings.append(
                f"canonical mock table {table} must contain {expected_count} rows; "
                f"found {row_counts.get(table, 0)}"
            )
    for table, minimum_count in CANONICAL_MOCK_RELATION_MINIMUMS.items():
        if row_counts.get(table, 0) < minimum_count:
            findings.append(
                f"canonical mock relation {table} must contain at least {minimum_count} "
                f"links; found {row_counts.get(table, 0)}"
            )
    for parent_table, (
        child_table,
        foreign_key_column,
        source_uid,
        target_uid,
    ) in CANONICAL_IMAGE_ASSET_RELATIONS.items():
        qualified_child_table = f"public.{child_table}"
        if qualified_child_table not in schema_tables:
            findings.append(
                f"canonical image asset table missing for {parent_table}: "
                f"{qualified_child_table}"
            )
        relation_pattern = re.compile(
            rf"\(\s*'{re.escape(child_table)}'\s*,\s*'{re.escape(parent_table)}'\s*,"
            rf"\s*'{re.escape(foreign_key_column)}'\s*,\s*{source_uid}\s*,\s*{target_uid}\s*\)",
            re.IGNORECASE,
        )
        if relation_pattern.search(seed_sql) is None:
            findings.append(
                f"canonical image asset relation metadata missing for {parent_table}"
            )
    if "'profile_key', 'asset_linking'" not in seed_sql:
        findings.append("canonical image asset relations must use asset_linking profile")
    if "'asset_kinds', jsonb_build_array('image')" not in seed_sql:
        findings.append("canonical image asset relations must enable the image asset kind")
    for table, expected_count in CANONICAL_RUNTIME_SEED_COUNTS.items():
        if row_counts.get(table, 0) != expected_count:
            findings.append(
                f"runtime seed table {table} must contain {expected_count} row; "
                f"found {row_counts.get(table, 0)}"
            )

    generated_files = manifest.get("generated_files")
    if not isinstance(generated_files, dict):
        findings.append("public bootstrap manifest must declare generated_files hashes")
    else:
        expected_generated = {
            "server_tools/public_bootstrap/schema.sql": schema_file,
            "server_tools/public_bootstrap/seed_data.sql": seed_file,
        }
        for relative_path, path in expected_generated.items():
            entry = generated_files.get(relative_path)
            if not isinstance(entry, dict) or not entry.get("sha256"):
                findings.append(f"manifest generated_files missing sha256 for {relative_path}")
                continue
            if path.is_file() and entry.get("sha256") != sha256_file(path):
                findings.append(f"manifest generated_files sha256 mismatch for {relative_path}")

    source_files = manifest.get("source_files")
    if not isinstance(source_files, dict) or not source_files:
        findings.append("public bootstrap manifest must declare source_files hashes")
    else:
        audit_source_file_hashes(public_root, source_files, findings)
        migration_source_prefix = "filterest/app/server_tools/migrations/"
        declared_migration_sources = sorted(
            path.removeprefix(migration_source_prefix)
            for path in source_files
            if path.startswith(migration_source_prefix)
        )
        if declared_migration_sources != shipped_migrations:
            findings.append(
                "manifest source_files migration coverage does not match shipped public migrations"
            )

    for label, pattern in FORBIDDEN_CONTENT_PATTERNS.items():
        for file_label, text in (("schema.sql", schema_sql), ("seed_data.sql", seed_sql)):
            match = pattern.search(text)
            if match:
                findings.append(f"{file_label} contains forbidden {label}: {match.group(0)}")

    non_example_emails = [email for email in emails if not email.endswith(".invalid")]
    if non_example_emails:
        findings.append("non-example email values: " + ", ".join(non_example_emails))

    public_fixture_count = seed_sql.count("public fixture seed")
    if public_fixture_count < 5:
        findings.append("seed_data.sql should clearly mark generated rows as public fixture seed")

    legacy_bootstrap_dir = public_root / "app" / "server_tools" / "versioning" / "bootstrap_seeds"
    if legacy_bootstrap_dir.exists():
        findings.append(f"private bootstrap seed archive directory must be absent: {legacy_bootstrap_dir}")

    return BootstrapAudit(
        schema_tables=schema_tables,
        seed_tables=seed_tables,
        row_counts=row_counts,
        emails=emails,
        manifest=manifest,
        findings=findings,
    )


def render_report(public_root: pathlib.Path, audit: BootstrapAudit) -> str:
    lines = [
        "# Filterest Public Bootstrap Audit",
        "",
        "- Target: `Filterest public bootstrap`",
        f"- Schema tables: `{len(audit.schema_tables)}`",
        f"- Seed tables: `{len(audit.seed_tables)}`",
        f"- Example emails: `{len(audit.emails)}`",
        f"- Manifest format: `{audit.manifest.get('format_version', 'missing')}`",
        f"- Manifest source files: `{len(audit.manifest.get('source_files', {})) if isinstance(audit.manifest.get('source_files'), dict) else 0}`",
        f"- Findings: `{len(audit.findings)}`",
        "",
        "## Verdict",
        "",
        "PASS" if not audit.findings else "FAIL",
        "",
        "## Schema Tables",
        "",
    ]
    lines.extend(f"- `{table}`" for table in audit.schema_tables)
    lines.extend(["", "## Seed Tables", ""])
    lines.extend(f"- `{table}`" for table in audit.seed_tables)
    lines.extend(["", "## Seed Row Counts", ""])
    for table, count in sorted(audit.row_counts.items()):
        lines.append(f"- `{table}`: {count}")
    lines.extend(["", "## Manifest Hash Coverage", ""])
    generated_files = audit.manifest.get("generated_files", {})
    source_files = audit.manifest.get("source_files", {})
    if isinstance(generated_files, dict):
        lines.append(f"- Generated files with hashes: `{len(generated_files)}`")
    else:
        lines.append("- Generated files with hashes: `0`")
    if isinstance(source_files, dict):
        lines.append(f"- Source files with hashes: `{len(source_files)}`")
    else:
        lines.append("- Source files with hashes: `0`")
    lines.extend(["", "## Email Domains", ""])
    if audit.emails:
        lines.extend(f"- `{email}`" for email in audit.emails)
    else:
        lines.append("- No email values found.")
    lines.extend(["", "## Findings", ""])
    if audit.findings:
        lines.extend(f"- {finding}" for finding in audit.findings)
    else:
        lines.append("- No private app/tool rows, non-example emails, secret-like values, or historical bootstrap archives detected.")
    lines.extend(
        [
            "",
            "## Human Review Boundary",
            "",
            "This deterministic report does not approve the public bootstrap strategy or content scope for publication.",
            "It also does not replace runtime proof of the first-ever admin credential path.",
            "The technical guest row is not a reusable password; the installation owner creates the first admin through the guarded browser form.",
            "A human/project owner still needs to review the bootstrap content and approve the credential path before publication.",
            "",
        ]
    )
    return "\n".join(lines)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit a generated Filterest public bootstrap seed.")
    parser.add_argument("--target", required=True, help="Generated Filterest repository root.")
    parser.add_argument("--report", help="Optional markdown report output path.")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    public_root = pathlib.Path(args.target).resolve()
    if not public_root.is_dir():
        raise SystemExit(f"target directory not found: {public_root}")

    audit = audit_bootstrap(public_root)
    report = render_report(public_root, audit)
    if args.report:
        report_path = pathlib.Path(args.report)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(report, encoding="utf-8")
        print(f"wrote {report_path}")

    if audit.findings:
        print(report)
        return 1

    print(
        "Public bootstrap audit OK: "
        f"{len(audit.schema_tables)} schema tables, "
        f"{len(audit.seed_tables)} seed tables, "
        f"{sum(audit.row_counts.values())} counted fixture rows."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
