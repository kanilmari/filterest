#!/usr/bin/env python3
"""Regenerate the canonical testing fixture bundle.

This script keeps the checked-in schema skeleton and dummy seed rows aligned with
the live schema inventory in data/db_backups/schema_info.csv.
It intentionally generates a small, boot-focused subset instead of a full
production clone.
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import OrderedDict
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SCHEMA_INFO = PROJECT_ROOT / "data" / "db_backups" / "schema_info.csv"
SCHEMA_OUT = Path(__file__).with_name("generated") / "schema.sql"
SEED_OUT = Path(__file__).with_name("generated") / "seed.sql"

TABLE_ORDER = [
    "system_user_groups",
    "system_users",
    "system_user_group_memberships",
    "system_table_folders",
    "system_db_tables",
    "system_functions",
    "system_config",
    "dev_projects",
    "dev_milestones",
    "dev_agent_tasks",
    "app_service_catalog",
    "app_service_child_items",
    "app_service_catalog_assets",
    "app_service_locations",
    "app_notes",
]

MANUAL_SCHEMA_BLOCKS = {}


def sql_type(data_type: str) -> str:
    if data_type == "USER-DEFINED":
        return "vector"
    return data_type


def sql_literal(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, dict):
        return f"'{json.dumps(value, ensure_ascii=False)}'::jsonb"
    if isinstance(value, list):
        return f"'{json.dumps(value, ensure_ascii=False)}'::jsonb"
    text = str(value).replace("'", "''")
    return f"'{text}'"


def load_schema_info(schema_info_path: Path) -> dict[str, list[tuple[str, str]]]:
    tables: dict[str, list[tuple[str, str]]] = OrderedDict()
    with schema_info_path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            tables.setdefault(row["table_name"], []).append((row["column_name"], row["data_type"]))
    return tables


def render_schema(tables: dict[str, list[tuple[str, str]]]) -> str:
    lines: list[str] = [
        "-- Generated from schema_info.csv by testing/essential/generate_dummy_test_database.py",
        "-- This is a curated boot-focused schema skeleton, not a full production dump.",
        "",
        "CREATE EXTENSION IF NOT EXISTS vector;",
        "",
    ]
    for table_name in TABLE_ORDER:
        if table_name in MANUAL_SCHEMA_BLOCKS:
            lines.append(MANUAL_SCHEMA_BLOCKS[table_name])
            lines.append("")
            continue
        columns = tables.get(table_name)
        if not columns:
            continue
        lines.append(f"CREATE TABLE public.{table_name} (")
        col_lines = []
        for column_name, data_type in columns:
            col_lines.append(f"    {column_name} {sql_type(data_type)}")
        lines.append(",\n".join(col_lines))
        lines.append(");")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def render_insert(table: str, columns: list[str], rows: list[dict[str, Any]]) -> list[str]:
    if not rows:
        return []
    lines = [f"INSERT INTO public.{table} ({', '.join(columns)}) VALUES"]
    value_lines = []
    for row in rows:
        values = ", ".join(sql_literal(row.get(column)) for column in columns)
        value_lines.append(f"  ({values})")
    lines.append(",\n".join(value_lines) + ";")
    lines.append("")
    return lines


def render_seed() -> str:
    rows = {
        "system_user_groups": {
            "columns": ["id", "name", "created", "updated", "creation_spec"],
            "rows": [
                {
                    "id": 1,
                    "name": "admin",
                    "created": "2026-03-29 00:00:00+00",
                    "updated": "2026-03-29 00:00:00+00",
                    "creation_spec": "fixture seed",
                },
                {
                    "id": 2,
                    "name": "basic",
                    "created": "2026-03-29 00:00:00+00",
                    "updated": "2026-03-29 00:00:00+00",
                    "creation_spec": "fixture seed",
                },
                {
                    "id": 3,
                    "name": "guest",
                    "created": "2026-03-29 00:00:00+00",
                    "updated": "2026-03-29 00:00:00+00",
                    "creation_spec": "fixture seed",
                },
            ],
        },
        "system_users": {
            "columns": [
                "id",
                "username",
                "full_name",
                "created",
                "updated",
                "enabled",
                "privileged",
                "main_group_id",
                "creation_spec",
                "bio_social_medias",
                "website",
                "admin_access_allowed",
            ],
            "rows": [
                {
                    "id": 1,
                    "username": "fixture_admin",
                    "full_name": "Fixture Admin",
                    "created": "2026-03-29 00:00:00+00",
                    "updated": "2026-03-29 00:00:00+00",
                    "enabled": True,
                    "privileged": True,
                    "main_group_id": 1,
                    "creation_spec": "fixture seed",
                    "bio_social_medias": "",
                    "website": "",
                    "admin_access_allowed": True,
                },
                {
                    "id": 2,
                    "username": "fixture_basic",
                    "full_name": "Fixture Basic",
                    "created": "2026-03-29 00:00:00+00",
                    "updated": "2026-03-29 00:00:00+00",
                    "enabled": True,
                    "privileged": False,
                    "main_group_id": 2,
                    "creation_spec": "fixture seed",
                    "bio_social_medias": "",
                    "website": "",
                    "admin_access_allowed": False,
                },
                {
                    "id": 3,
                    "username": "fixture_guest",
                    "full_name": "Fixture Guest",
                    "created": "2026-03-29 00:00:00+00",
                    "updated": "2026-03-29 00:00:00+00",
                    "enabled": True,
                    "privileged": False,
                    "main_group_id": 3,
                    "creation_spec": "fixture seed",
                    "bio_social_medias": "",
                    "website": "",
                    "admin_access_allowed": False,
                },
            ],
        },
        "system_user_group_memberships": {
            "columns": ["user_id", "group_id", "created", "updated", "id", "creation_spec"],
            "rows": [
                {
                    "user_id": 1,
                    "group_id": 1,
                    "created": "2026-03-29 00:00:00",
                    "updated": "2026-03-29 00:00:00",
                    "id": 1001,
                    "creation_spec": "fixture seed",
                },
                {
                    "user_id": 2,
                    "group_id": 2,
                    "created": "2026-03-29 00:00:00",
                    "updated": "2026-03-29 00:00:00",
                    "id": 1002,
                    "creation_spec": "fixture seed",
                },
                {
                    "user_id": 3,
                    "group_id": 3,
                    "created": "2026-03-29 00:00:00",
                    "updated": "2026-03-29 00:00:00",
                    "id": 1003,
                    "creation_spec": "fixture seed",
                },
            ],
        },
        "system_table_folders": {
            "columns": [
                "id",
                "folder_name",
                "folder_description",
                "created",
                "updated",
                "parent_id",
                "creation_spec",
                "is_current_project",
                "admin_user_id",
                "tab_order_json",
            ],
            "rows": [
                {
                    "id": 1,
                    "folder_name": "Essentials",
                    "folder_description": "Curated testing fixtures",
                    "created": "2026-03-29",
                    "updated": "2026-03-29",
                    "parent_id": None,
                    "creation_spec": "fixture seed",
                    "is_current_project": True,
                    "admin_user_id": 1,
                    "tab_order_json": {},
                }
            ],
        },
        "system_db_tables": {
            "columns": [
                "id",
                "table_name",
                "description",
                "table_uid",
                "cached_oid",
                "folder_id",
                "created",
                "updated",
                "creation_spec",
                "default_view_id",
                "schema_name",
                "display_name",
                "multi_lang_embeddings",
                "is_default",
                "filterbar_visible_by_default",
                "is_removable",
                "is_main_table",
                "is_about_table",
                "fk_display_column",
                "icon_key",
            ],
            "rows": [
                {
                    "id": 101,
                    "table_name": "system_users",
                    "description": "Fixture users",
                    "table_uid": 101,
                    "cached_oid": None,
                    "folder_id": 1,
                    "created": "2026-03-29 00:00:00",
                    "updated": "2026-03-29 00:00:00",
                    "creation_spec": "fixture seed",
                    "default_view_id": None,
                    "schema_name": "public",
                    "display_name": "Users",
                    "multi_lang_embeddings": False,
                    "is_default": False,
                    "filterbar_visible_by_default": True,
                    "is_removable": False,
                    "is_main_table": True,
                    "is_about_table": False,
                    "fk_display_column": "username",
                    "icon_key": "users",
                },
                {
                    "id": 102,
                    "table_name": "system_config",
                    "description": "Fixture config",
                    "table_uid": 102,
                    "cached_oid": None,
                    "folder_id": 1,
                    "created": "2026-03-29 00:00:00",
                    "updated": "2026-03-29 00:00:00",
                    "creation_spec": "fixture seed",
                    "default_view_id": None,
                    "schema_name": "public",
                    "display_name": "Configuration",
                    "multi_lang_embeddings": False,
                    "is_default": False,
                    "filterbar_visible_by_default": True,
                    "is_removable": False,
                    "is_main_table": True,
                    "is_about_table": False,
                    "fk_display_column": "key",
                    "icon_key": "settings",
                },
                {
                    "id": 103,
                    "table_name": "dev_agent_tasks",
                    "description": "Fixture task queue",
                    "table_uid": 103,
                    "cached_oid": None,
                    "folder_id": 1,
                    "created": "2026-03-29 00:00:00",
                    "updated": "2026-03-29 00:00:00",
                    "creation_spec": "fixture seed",
                    "default_view_id": None,
                    "schema_name": "public",
                    "display_name": "Tasks",
                    "multi_lang_embeddings": False,
                    "is_default": False,
                    "filterbar_visible_by_default": True,
                    "is_removable": True,
                    "is_main_table": True,
                    "is_about_table": False,
                    "fk_display_column": "title",
                    "icon_key": "task",
                },
                {
                    "id": 104,
                    "table_name": "app_service_catalog",
                    "description": "Fixture services",
                    "table_uid": 104,
                    "cached_oid": None,
                    "folder_id": 1,
                    "created": "2026-03-29 00:00:00",
                    "updated": "2026-03-29 00:00:00",
                    "creation_spec": "fixture seed",
                    "default_view_id": None,
                    "schema_name": "public",
                    "display_name": "Service catalog",
                    "multi_lang_embeddings": True,
                    "is_default": False,
                    "filterbar_visible_by_default": True,
                    "is_removable": True,
                    "is_main_table": True,
                    "is_about_table": False,
                    "fk_display_column": "header",
                    "icon_key": "service",
                },
            ],
        },
        "system_functions": {
            "columns": [
                "id",
                "name",
                "disabled",
                "created",
                "updated",
                "package",
                "specific_table_related",
                "creation_spec",
                "rate_limit_amount",
                "rate_limit_minutes",
                "url_route_endpoint",
                "ui_only",
            ],
            "rows": [                {
                    "id": 2002,
                    "name": "Service catalog",
                    "disabled": False,
                    "created": "2026-03-29 00:00:00",
                    "updated": "2026-03-29 00:00:00",
                    "package": "app",
                    "specific_table_related": True,
                    "creation_spec": "fixture seed",
                    "rate_limit_amount": 0,
                    "rate_limit_minutes": 0,
                    "url_route_endpoint": "/app_service_catalog",
                    "ui_only": False,
                },
            ],
        },
        "system_config": {
            "columns": [
                "id",
                "key",
                "json_value",
                "created",
                "updated",
                "creation_spec",
                "boolean_value",
                "text_value",
                "int_value",
                "value_type",
            ],
            "rows": [
                {
                    "id": 3001,
                    "key": "login_to_browse",
                    "json_value": {"value": False},
                    "created": "2026-03-29 00:00:00",
                    "updated": "2026-03-29 00:00:00",
                    "creation_spec": "fixture seed",
                    "boolean_value": False,
                    "text_value": "false",
                    "int_value": None,
                    "value_type": 1,
                },
                {
                    "id": 3002,
                    "key": "site_name",
                    "json_value": {"value": "Easelect Essentials"},
                    "created": "2026-03-29 00:00:00",
                    "updated": "2026-03-29 00:00:00",
                    "creation_spec": "fixture seed",
                    "boolean_value": None,
                    "text_value": "Easelect Essentials",
                    "int_value": None,
                    "value_type": 2,
                },
            ],
        },
        "dev_projects": {
            "columns": ["id", "created", "updated", "project_name", "description"],
            "rows": [
                {
                    "id": 4001,
                    "created": "2026-03-29 00:00:00+00",
                    "updated": "2026-03-29 00:00:00+00",
                    "project_name": "Fixture Project",
                    "description": "Dummy project used by the essential testing bundle",
                }
            ],
        },
        "dev_milestones": {
            "columns": ["id", "created", "updated", "header", "description", "deadline_date", "completed_date", "parent_id"],
            "rows": [
                {
                    "id": 4011,
                    "created": "2026-03-29 00:00:00+00",
                    "updated": "2026-03-29 00:00:00+00",
                    "header": "Bootstrap fixture bundle",
                    "description": "Create the minimal test database fixtures",
                    "deadline_date": "2026-03-31",
                    "completed_date": None,
                    "parent_id": None,
                },
                {
                    "id": 4012,
                    "created": "2026-03-29 00:00:00+00",
                    "updated": "2026-03-29 00:00:00+00",
                    "header": "Keep fixtures in sync",
                    "description": "Refresh the generated seed when essential tables change",
                    "deadline_date": None,
                    "completed_date": None,
                    "parent_id": 4011,
                },
            ],
        },
        "dev_agent_tasks": {
            "columns": ["id", "filename", "title", "status", "created", "content", "original_path", "user_message", "goals", "updated"],
            "rows": [
                {
                    "id": 5001,
                    "filename": "fixture-bundle.md",
                    "title": "Canonical testing fixture bundle",
                    "status": "done",
                    "created": "2026-03-29 00:00:00+00",
                    "content": "Seed rows for bootable testing fixtures.",
                    "original_path": "testing/essential",
                    "user_message": "Create the canonical testing fixture bundle.",
                    "goals": "Keep schema and seed data documented and reproducible.",
                    "updated": "2026-03-29 00:00:00+00",
                }
            ],
        },
        "app_service_catalog": {
            "columns": [
                "id",
                "created",
                "updated",
                "header",
                "description",
                "user_id",
                "cached_image",
                "published",
                "enabled",
                "keywords_static",
                "admin_reviewed",
                "type_of_operation",
                "website",
                "contact_details",
                "admin_approved",
                "association_type_id",
                "assoc_t_name_cached",
                "cached_username",
                "locality",
                "national_corporation_identifier",
                "view_count",
                "paid_views_left",
            ],
            "rows": [
                {
                    "id": 6001,
                    "created": "2026-03-29 00:00:00+00",
                    "updated": "2026-03-29 00:00:00+00",
                    "header": "Fixture catalog entry",
                    "description": "Dummy service entry for testing the app shell",
                    "user_id": 1,
                    "cached_image": "",
                    "published": True,
                    "enabled": True,
                    "keywords_static": "fixture,test",
                    "admin_reviewed": True,
                    "type_of_operation": "testing",
                    "website": "https://example.invalid",
                    "contact_details": "fixture@example.invalid",
                    "admin_approved": True,
                    "association_type_id": -1,
                    "assoc_t_name_cached": "",
                    "cached_username": "fixture_admin",
                    "locality": "Helsinki",
                    "national_corporation_identifier": "0000000-0",
                    "view_count": 0,
                    "paid_views_left": 0,
                }
            ],
        },
        "app_service_child_items": {
            "columns": ["id", "created", "updated", "name", "description", "service_id", "currency", "price_incl_taxes", "price_i_t_base"],
            "rows": [
                {
                    "id": 6002,
                    "created": "2026-03-29 00:00:00+00",
                    "updated": "2026-03-29 00:00:00+00",
                    "name": "Fixture child item",
                    "description": "Dummy child row linked to the fixture service",
                    "service_id": 6001,
                    "currency": "EUR",
                    "price_incl_taxes": 0.0,
                    "price_i_t_base": 0.0,
                }
            ],
        },
        "app_service_catalog_assets": {
            "columns": [
                "id",
                "app_service_catalog_id",
                "asset_kind",
                "filename",
                "original_name",
                "mime_type",
                "size_bytes",
                "title",
                "description",
                "sort_order",
                "is_primary",
                "metadata_json",
                "created",
                "updated",
            ],
            "rows": [
                {
                    "id": 6003,
                    "app_service_catalog_id": 6001,
                    "asset_kind": "image",
                    "filename": "fixture-service.png",
                    "original_name": "fixture-service.png",
                    "mime_type": "image/png",
                    "size_bytes": None,
                    "title": "Fixture service image",
                    "description": "Placeholder image metadata",
                    "sort_order": 0,
                    "is_primary": True,
                    "metadata_json": None,
                    "created": "2026-03-29 00:00:00+00",
                    "updated": "2026-03-29 00:00:00+00",
                }
            ],
        },
        "app_service_locations": {
            "columns": [
                "id",
                "service_id",
                "location_id",
                "here_id",
                "title",
                "result_type",
                "house_number",
                "street",
                "city",
                "county",
                "state",
                "country_name",
                "postal_code",
                "position",
            ],
            "rows": [
                {
                    "id": 6004,
                    "service_id": 6001,
                    "location_id": 1,
                    "here_id": "fixture-here-id",
                    "title": "Fixture location",
                    "result_type": "place",
                    "house_number": "1",
                    "street": "Example Street",
                    "city": "Helsinki",
                    "county": "Uusimaa",
                    "state": "FI",
                    "country_name": "Finland",
                    "postal_code": "00100",
                    "position": None,
                }
            ],
        },
        "app_notes": {
            "columns": ["id", "created", "updated", "note"],
            "rows": [
                {
                    "id": 7001,
                    "created": "2026-03-29 00:00:00+00",
                    "updated": "2026-03-29 00:00:00+00",
                    "note": "Fixture note for testing the app shell",
                }
            ],
        },
    }

    lines = [
        "-- Generated dummy seed data for the testing fixture bundle.",
        "-- The rows below are harmless placeholders, not production data.",
        "",
    ]
    for table_name in TABLE_ORDER:
        table = rows.get(table_name)
        if not table:
            continue
        lines.extend(render_insert(table_name, table["columns"], table["rows"]))
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--schema-info",
        type=Path,
        default=DEFAULT_SCHEMA_INFO,
        help="Path to schema_info.csv (defaults to data/db_backups/schema_info.csv).",
    )
    parser.add_argument("--schema-out", type=Path, default=SCHEMA_OUT, help="Output path for generated schema.sql.")
    parser.add_argument("--seed-out", type=Path, default=SEED_OUT, help="Output path for generated seed.sql.")
    args = parser.parse_args()

    schema_info = load_schema_info(args.schema_info)
    schema_sql = render_schema(schema_info)
    seed_sql = render_seed()

    args.schema_out.parent.mkdir(parents=True, exist_ok=True)
    args.seed_out.parent.mkdir(parents=True, exist_ok=True)
    args.schema_out.write_text(schema_sql, encoding="utf-8")
    args.seed_out.write_text(seed_sql, encoding="utf-8")

    print(f"Wrote {args.schema_out}")
    print(f"Wrote {args.seed_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
