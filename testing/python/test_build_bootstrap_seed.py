"""test_build_bootstrap_seed.py
Verifies bootstrap seed SQL scrubbing and role-profile artifact contracts.
Bridges build_bootstrap_seed helpers and pytest regression coverage.
Exists so compact committed seeds and profile-specific archives stay stable.
"""

import json
from pathlib import Path

import pytest

from server_tools.scripts import build_bootstrap_seed


def test_scrub_seed_sql_replaces_embedding_vector_only() -> None:
    sql = (
        "INSERT INTO public.dev_todo (id, title, embedding_vector, notes) "
        "VALUES (1, 'hello, world', '[0.1,0.2,0.3]', 'keep, this');\n"
    )

    scrubbed, counts = build_bootstrap_seed.scrub_seed_sql_excluded_columns(sql)

    assert counts == {"embedding_vector": 1}
    assert "'hello, world'" in scrubbed
    assert "'keep, this'" in scrubbed
    assert "embedding_vector, notes) VALUES (1, 'hello, world', NULL, 'keep, this')" in scrubbed


def test_scrub_seed_sql_handles_quoted_embedding_identifier() -> None:
    sql = (
        'INSERT INTO public.example (id, "embedding_vector", "regular_column") '
        "VALUES (7, '[1,2,3]', 'still here');\n"
    )

    scrubbed, counts = build_bootstrap_seed.scrub_seed_sql_excluded_columns(sql)

    assert counts == {"embedding_vector": 1}
    assert 'VALUES (7, NULL, \'still here\');' in scrubbed


def test_restore_seed_runtime_search_path_replaces_pg_dump_empty_path() -> None:
    seed_sql = "\n".join(
        [
            "SET standard_conforming_strings = on;",
            "SELECT pg_catalog.set_config('search_path', '', false);",
            "INSERT INTO public.example (id) VALUES (1);",
            "",
        ]
    )

    restored = build_bootstrap_seed.restore_seed_runtime_search_path(seed_sql)

    assert "RESET search_path;" in restored
    assert "set_config('search_path', '', false)" not in restored


def test_scrub_seed_sql_handles_overriding_system_value() -> None:
    sql = (
        "INSERT INTO public.example (id, embedding_vector, note) "
        "OVERRIDING SYSTEM VALUE VALUES (7, '[1,2,3]', 'still here');\n"
    )

    scrubbed, counts = build_bootstrap_seed.scrub_seed_sql_excluded_columns(sql)

    assert counts == {"embedding_vector": 1}
    assert "OVERRIDING SYSTEM VALUE VALUES (7, NULL, 'still here');" in scrubbed


def test_scrub_seed_sql_leaves_rows_without_embedding_vector_unchanged() -> None:
    sql = "INSERT INTO public.example (id, note) VALUES (1, 'embedding_vector as text');\n"

    scrubbed, counts = build_bootstrap_seed.scrub_seed_sql_excluded_columns(sql)

    assert counts == {}
    assert scrubbed == sql


def test_order_system_table_folders_seed_rows_keeps_parents_before_children() -> None:
    sql = "\n".join(
        [
            "INSERT INTO public.system_table_folders (id, folder_name, parent_id) VALUES (12, 'logs', 2);",
            "INSERT INTO public.system_table_folders (id, folder_name, parent_id) VALUES (2, 'system', 15);",
            "INSERT INTO public.system_table_folders (id, folder_name, parent_id) VALUES (15, 'database', NULL);",
            "",
        ]
    )

    ordered = build_bootstrap_seed.order_system_table_folders_seed_rows(sql)

    assert ordered.splitlines()[:3] == [
        "INSERT INTO public.system_table_folders (id, folder_name, parent_id) VALUES (15, 'database', NULL);",
        "INSERT INTO public.system_table_folders (id, folder_name, parent_id) VALUES (2, 'system', 15);",
        "INSERT INTO public.system_table_folders (id, folder_name, parent_id) VALUES (12, 'logs', 2);",
    ]


def test_resolve_output_path_keeps_application_legacy_filename() -> None:
    output_path = build_bootstrap_seed.resolve_output_path("8.0.37", None, "application")

    assert output_path == (
        build_bootstrap_seed.BOOTSTRAP_SEED_DIR
        / "db-8.0.37"
        / "easelect_bootstrap_db-8.0.37.zip"
    ).resolve()


def test_resolve_output_path_uses_management_filename() -> None:
    output_path = build_bootstrap_seed.resolve_output_path("8.0.37", None, "management")

    assert output_path == (
        build_bootstrap_seed.BOOTSTRAP_SEED_DIR
        / "db-8.0.37"
        / "easelect_management_bootstrap_db-8.0.37.zip"
    ).resolve()


def test_build_manifest_records_seed_profile(tmp_path: Path) -> None:
    schema_path = tmp_path / "db-8.0.37.sql"
    schema_path.write_text("-- schema\n", encoding="utf-8")

    manifest = json.loads(
        build_bootstrap_seed.build_manifest(
            db_version="8.0.37",
            seed_profile="management",
            schema_path=schema_path,
            schema_bytes=b"-- schema\n",
            seed_bytes=b"-- seed\n",
            seed_metadata={"mode": "seed_sql_file"},
        )
    )

    assert manifest["seed_profile"] == "management"
    assert manifest["entries"][0]["path"] == "schema.sql"
    assert manifest["entries"][1]["path"] == "seed_data.sql"


def test_normalize_seed_profile_rejects_unknown_profile() -> None:
    with pytest.raises(build_bootstrap_seed.BootstrapSeedBuilderError):
        build_bootstrap_seed.normalize_seed_profile("analytics")


def test_seed_profile_role_config_sql_enforces_management_role() -> None:
    sql = build_bootstrap_seed.seed_profile_role_config_sql("management")

    assert "INSERT INTO public.system_config" in sql
    assert "'easelect_instance_role'" in sql
    assert "'management'" in sql
    assert '"value": "management"' in sql
    assert "ON CONFLICT (key) DO UPDATE" in sql
    assert "text_value = EXCLUDED.text_value" in sql


def test_append_seed_profile_role_config_keeps_existing_seed_and_appends_role_upsert() -> None:
    seed_sql = (
        "INSERT INTO public.system_config (id, key, text_value) "
        "VALUES (1, 'easelect_instance_role', 'application');\n"
    )

    output = build_bootstrap_seed.append_seed_profile_role_config(seed_sql, "management")

    assert output.startswith(seed_sql)
    assert output.count("easelect_instance_role") == 2
    assert "UPDATE public.system_db_tables" in output
    assert output.rstrip().endswith("AND COALESCE(sql_dump_policy, 'all') = 'all';")


def test_seed_profile_table_policy_sql_application_marks_cloud_and_runtime_schema_only() -> None:
    sql = build_bootstrap_seed.seed_profile_table_policy_sql("application")

    assert "UPDATE public.system_db_tables" in sql
    assert "table_name LIKE 'app_cloud\\_%' ESCAPE '\\'" in sql
    assert "table_name = 'bee_messages'" in sql
    assert "table_name = 'system_audit_log'" in sql
    assert "table_name LIKE '%\\_lang_embeddings' ESCAPE '\\'" in sql
    assert "table_name LIKE 'dev\\_%' ESCAPE '\\'" in sql
    assert "'dev_agent_task_statuses'" in sql
    assert "table_name NOT LIKE 'app_cloud\\_%'" not in sql


def test_seed_profile_table_policy_sql_management_marks_non_cloud_app_and_runtime_schema_only() -> None:
    sql = build_bootstrap_seed.seed_profile_table_policy_sql("management")

    assert "UPDATE public.system_db_tables" in sql
    assert "table_name LIKE 'app\\_%' ESCAPE '\\'" in sql
    assert "table_name NOT LIKE 'app_cloud\\_%' ESCAPE '\\'" in sql
    assert "table_name = 'bee_messages'" in sql


def test_sql_dump_policy_flags_application_excludes_cloud_management_data() -> None:
    rows = [
        ("public", "app_cloud_services", "all"),
        ("public", "app_service_catalog", "all"),
        ("public", "app_service_catalog_lang_embeddings", "all"),
        ("public", "bee_messages", "all"),
        ("public", "dev_todo", "all"),
        ("public", "dev_agent_task_statuses", "all"),
        ("public", "dev_agent_tasks", "schema_only"),
        ("public", "system_audit_log", "all"),
    ]

    flags = build_bootstrap_seed.sql_dump_policy_flags_from_rows(rows, "application")

    assert "--exclude-table-data=public.app_cloud_services" in flags
    assert "--exclude-table-data=public.app_service_catalog_lang_embeddings" in flags
    assert "--exclude-table-data=public.bee_messages" in flags
    assert "--exclude-table-data=public.dev_todo" in flags
    assert "--exclude-table-data=public.dev_agent_tasks" in flags
    assert "--exclude-table-data=public.system_audit_log" in flags
    assert "--exclude-table-data=public.app_service_catalog" not in flags
    assert "--exclude-table-data=public.dev_agent_task_statuses" not in flags


def test_sql_dump_policy_flags_management_excludes_non_cloud_app_data() -> None:
    rows = [
        ("public", "app_cloud_services", "all"),
        ("public", "app_service_catalog", "all"),
        ("public", "app_service_catalog_assets", "all"),
        ("public", "bee_messages", "all"),
        ("public", "system_config", "all"),
        ("public", "dev_agent_tasks", "schema_only"),
    ]

    flags = build_bootstrap_seed.sql_dump_policy_flags_from_rows(rows, "management")

    assert "--exclude-table-data=public.app_service_catalog" in flags
    assert "--exclude-table-data=public.app_service_catalog_assets" in flags
    assert "--exclude-table-data=public.bee_messages" in flags
    assert "--exclude-table-data=public.dev_agent_tasks" in flags
    assert "--exclude-table-data=public.app_cloud_services" not in flags
    assert "--exclude-table-data=public.system_config" not in flags


def test_apply_seed_row_policies_keeps_only_allowed_users_and_restricted_rows() -> None:
    seed_sql = "\n".join(
        [
            "INSERT INTO public.system_users (id, username) OVERRIDING SYSTEM VALUE VALUES (1, 'guest');",
            "INSERT INTO public.system_users (id, username) OVERRIDING SYSTEM VALUE VALUES (2, 'bulk_user');",
            "INSERT INTO public.system_users (id, username) OVERRIDING SYSTEM VALUE VALUES (3, 'test_admin');",
            "INSERT INTO restricted.users_restricted (id, password, email) VALUES (1, 'hash', 'guest@example.invalid');",
            "INSERT INTO restricted.users_restricted (id, password, email) VALUES (2, 'hash', 'bulk@example.invalid');",
            "INSERT INTO restricted.users_restricted (id, password, email) VALUES (3, 'hash', 'admin@example.invalid');",
            "INSERT INTO public.system_user_group_memberships (user_id, group_id) VALUES (2, 4);",
            "INSERT INTO public.system_user_group_memberships (user_id, group_id) VALUES (3, 1);",
            "",
        ]
    )

    pruned, metadata = build_bootstrap_seed.apply_seed_row_policies(seed_sql, ("guest", "test_admin"))

    assert "'guest'" in pruned
    assert "'test_admin'" in pruned
    assert "'bulk_user'" not in pruned
    assert "bulk@example.invalid" not in pruned
    assert "VALUES (2, 4)" not in pruned
    assert "VALUES (3, 1)" in pruned
    assert metadata["allowed_user_ids"] == [1, 3]
    assert metadata["dropped_insert_rows_by_table"] == {
        "public.system_user_group_memberships": 1,
        "public.system_users": 1,
        "restricted.users_restricted": 1,
    }


def test_apply_seed_row_policies_preserves_system_user_foreign_key_integrity() -> None:
    schema_sql = """
ALTER TABLE ONLY public.app_listing
    ADD CONSTRAINT app_listing_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES public.system_users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.required_user_event
    ADD CONSTRAINT required_user_event_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES public.system_users(id) ON DELETE CASCADE;
"""
    seed_sql = "\n".join(
        [
            "INSERT INTO public.system_users (id, username) VALUES (1, 'guest');",
            "INSERT INTO public.system_users (id, username) VALUES (2, 'private_user');",
            "INSERT INTO public.app_listing (id, user_id) VALUES (10, 2);",
            "INSERT INTO public.app_listing (id, user_id) VALUES (11, 1);",
            "INSERT INTO public.required_user_event (id, user_id) VALUES (20, 2);",
            "",
        ]
    )

    pruned, metadata = build_bootstrap_seed.apply_seed_row_policies(
        seed_sql,
        ("guest",),
        schema_sql,
    )

    assert "VALUES (10, NULL)" in pruned
    assert "VALUES (11, 1)" in pruned
    assert "required_user_event" not in pruned
    assert "private_user" not in pruned
    assert metadata["system_user_foreign_keys_checked"] == 2
    assert metadata["nulled_user_references_by_table_column"] == {
        "public.app_listing.user_id": 1,
    }
    assert metadata["dropped_invalid_user_references_by_table"] == {
        "public.required_user_event": 1,
    }


def test_apply_seed_row_policies_drops_schema_only_runtime_tables_from_seed_sql() -> None:
    seed_sql = "\n".join(
        [
            "INSERT INTO public.system_audit_log (id) VALUES (1);",
            "INSERT INTO public.dev_todo (id) VALUES (2);",
            "INSERT INTO public.dev_agent_task_statuses (id, slug) VALUES (1, 'new');",
            "INSERT INTO public.app_service_catalog_lang_embeddings (id) VALUES (3);",
            "",
        ]
    )

    pruned, metadata = build_bootstrap_seed.apply_seed_row_policies(seed_sql)

    assert "system_audit_log" not in pruned
    assert "dev_todo" not in pruned
    assert "app_service_catalog_lang_embeddings" not in pruned
    assert "dev_agent_task_statuses" in pruned
    assert metadata["dropped_insert_rows_by_table"] == {
        "public.app_service_catalog_lang_embeddings": 1,
        "public.dev_todo": 1,
        "public.system_audit_log": 1,
    }


def test_apply_seed_row_policies_drops_multiline_schema_only_insert() -> None:
    seed_sql = (
        "INSERT INTO public.system_comments (id, comment) VALUES (1, 'first line\n"
        "second line');\n"
        "INSERT INTO public.dev_agent_task_statuses (id, slug) VALUES (1, 'new');\n"
    )

    pruned, metadata = build_bootstrap_seed.apply_seed_row_policies(seed_sql)

    assert "system_comments" not in pruned
    assert "second line" not in pruned
    assert "dev_agent_task_statuses" in pruned
    assert metadata["dropped_insert_rows_by_table"] == {"public.system_comments": 1}


def test_apply_seed_row_policies_handles_pg_dump_comment_prefix() -> None:
    seed_sql = (
        "--\n"
        "-- Data for Name: system_audit_log; Type: TABLE DATA; Schema: public; Owner: -\n"
        "--\n"
        "\n"
        "INSERT INTO public.system_audit_log (id) VALUES (1);\n"
        "--\n"
        "-- Data for Name: dev_agent_task_statuses; Type: TABLE DATA; Schema: public; Owner: -\n"
        "--\n"
        "\n"
        "INSERT INTO public.dev_agent_task_statuses (id, slug) VALUES (1, 'new');\n"
    )

    pruned, metadata = build_bootstrap_seed.apply_seed_row_policies(seed_sql)

    assert "system_audit_log" not in pruned
    assert "dev_agent_task_statuses" in pruned
    assert "Data for Name: dev_agent_task_statuses" in pruned
    assert metadata["dropped_insert_rows_by_table"] == {"public.system_audit_log": 1}


def test_audit_seed_sql_tables_reports_rows_and_bytes_by_table() -> None:
    seed_sql = "\n".join(
        [
            "INSERT INTO public.alpha (id) VALUES (1);",
            "INSERT INTO public.beta (id, note) VALUES (2, 'longer');",
            "INSERT INTO public.alpha (id) VALUES (3);",
            "",
        ]
    )

    audit = build_bootstrap_seed.audit_seed_sql_tables(seed_sql)
    formatted = build_bootstrap_seed.format_seed_audit(audit)

    assert audit[0]["table"] == "public.alpha"
    assert audit[0]["rows"] == 2
    assert any(row["table"] == "public.beta" and row["rows"] == 1 for row in audit)
    assert formatted.startswith("table\trows\tbytes\n")
    assert "public.alpha\t2\t" in formatted


def test_audit_seed_sql_tables_counts_multiline_insert_as_one_row() -> None:
    seed_sql = (
        "INSERT INTO public.alpha (id, note) VALUES (1, 'first line\n"
        "second line; still quoted');\n"
        "INSERT INTO public.alpha (id, note) VALUES (2, 'plain');\n"
    )

    audit = build_bootstrap_seed.audit_seed_sql_tables(seed_sql)

    assert audit[0]["table"] == "public.alpha"
    assert audit[0]["rows"] == 2
    assert audit[0]["bytes"] > len("INSERT INTO public.alpha (id, note) VALUES (2, 'plain');")


def test_load_sql_dump_policy_flags_fails_closed_when_inventory_unavailable(monkeypatch) -> None:
    args = type(
        "Args",
        (),
        {
            "db_host": "localhost",
            "db_port": 5433,
            "db_user": "admin_user",
            "db_name": "easelect",
        },
    )()

    def fail_command(*_args, **_kwargs):
        raise build_bootstrap_seed.BootstrapSeedBuilderError("database unavailable")

    monkeypatch.setattr(build_bootstrap_seed, "ensure_command_exists", lambda _command: None)
    monkeypatch.setattr(build_bootstrap_seed, "run_text_command", fail_command)

    with pytest.raises(build_bootstrap_seed.BootstrapSeedBuilderError, match="refusing"):
        build_bootstrap_seed.load_sql_dump_policy_flags(args, "password", "management")
