"""Exercise current public features on a complete disposable PostgreSQL install.

Loads only reviewed public schema and synthetic seed, never a production dump.
Checks view registration, migration replay, permissions and new feature metadata.
Prevents ledger-baselined features from disappearing in clean installations.
"""
from pathlib import Path
from test_field_settings_language_seed import database

APP = Path(__file__).resolve().parents[2]
BOOTSTRAP = APP / "server_tools/public_bootstrap"
MIGRATIONS = APP / "server_tools/migrations"

DEVELOPER_WORKFLOW_TABLES = {
    "dev_agent_handover_report_items",
    "dev_agent_handover_reports",
    "dev_agent_release_goal_contracts",
    "dev_agent_release_goals",
    "dev_agent_task_group_relations",
    "dev_agent_task_groups",
    "dev_agent_task_queues",
    "dev_agent_task_runs",
    "dev_agent_task_statuses",
    "dev_agent_task_todo_statuses",
    "dev_agent_task_todos",
    "dev_agent_tasks",
    "dev_agent_tasks_assets",
    "dev_agent_workline_reports",
    "dev_agent_workline_tasks",
    "dev_agent_worklines",
}

DB_TASK_SELECTED_COLUMNS = {
    "id",
    "title",
    "issue_type",
    "status",
    "created",
    "updated",
    "content",
    "priority",
    "tags",
    "parent_id",
    "assigned_to",
    "queue_id",
}


def test_fresh_bootstrap_contains_features_and_repair_is_repeatable(database):
    database("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    database((BOOTSTRAP / "schema.sql").read_text())
    database((BOOTSTRAP / "seed_data.sql").read_text())
    assert database("SELECT count(*) FROM system_table_views WHERE view_key='article_view'") == "1"
    assert database("SELECT count(*) FROM system_functions WHERE name IN ('ui.view.article_view','ui.admin.view_field_settings')") == "2"
    assert database("SELECT count(*) FROM system_media_assets") == "0"
    assert database("SELECT count(*) FROM system_media_asset_usages") == "0"
    assert database("SELECT count(*) FROM system_db_tables WHERE table_name IN ('system_media_assets','system_media_asset_usages')") == "0"
    assert database("SELECT count(*) FROM system_db_tables WHERE table_name='system_column_supported_views'") == "1"
    assert int(database("SELECT count(*) FROM system_column_supported_views WHERE view_key='article_view'")) > 0
    assert database("SELECT en FROM system_lang_keys WHERE lang_key='see_original_page'") == "See original page"
    assert database("SELECT count(*) FROM system_lang_keys WHERE lang_key='search_results_without_filters'") == "1"
    assert database("SELECT count(*) FROM system_lang_keys WHERE lang_key='article_edit_languages'") == "1"
    # Replay the exact upgrade batch over the synthetic installation twice.
    # This exercises dependency ordering and idempotence without touching live data.
    batch = sorted(path for path in MIGRATIONS.glob("202609080000*.sql")
                   if "20260908000004" <= path.name[:14] <= "20260908000010")
    assert len(batch) == 7
    for _ in range(2):
        for migration in batch:
            database(migration.read_text())
    assert database("SELECT count(*) FROM system_table_views WHERE view_key='article_view'") == "1"
    assert database("SELECT count(*) FROM system_media_assets") == "0"
    repair = (MIGRATIONS / "20260908000010_restrict_media_registry_and_restore_support_view.sql").read_text()
    database("""
        DELETE FROM system_group_table_func_rights WHERE target_table_uid IN
          (SELECT table_uid FROM system_db_tables WHERE table_name='system_column_supported_views');
        DELETE FROM system_column_details WHERE table_uid IN
          (SELECT table_uid FROM system_db_tables WHERE table_name='system_column_supported_views');
        DELETE FROM system_db_tables WHERE table_name='system_column_supported_views';
    """)
    database(repair)
    counts = database("""SELECT count(*), sum(CASE WHEN editable_in_ui THEN 1 ELSE 0 END)
        FROM system_column_details WHERE table_uid IN
        (SELECT table_uid FROM system_db_tables WHERE table_name='system_column_supported_views')""")
    assert counts.endswith('|0') and int(counts.split('|')[0]) > 10
    database(repair)
    assert database("SELECT count(*) FROM system_db_tables WHERE table_name='system_column_supported_views'") == "1"
    assert database("SELECT count(*) FROM system_db_version WHERE version='9.7.13'") == "1"
    assert database("""SELECT count(*) FROM system_group_table_func_rights rights
        JOIN system_db_tables tables ON tables.table_uid=rights.target_table_uid
        JOIN system_user_groups groups ON groups.id=rights.user_group_id
        WHERE tables.table_name='system_column_supported_views' AND groups.name<>'admins'""") == "0"


def test_fresh_bootstrap_contains_empty_developer_workflow_schema(database):
    database("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    database((BOOTSTRAP / "schema.sql").read_text())
    database((BOOTSTRAP / "seed_data.sql").read_text())

    table_names = set(database("""
        SELECT relname
        FROM pg_catalog.pg_class AS tables
        JOIN pg_catalog.pg_namespace AS schemas ON schemas.oid = tables.relnamespace
        WHERE schemas.nspname = 'public'
          AND tables.relkind = 'r'
          AND tables.relname LIKE 'dev_agent_%'
        ORDER BY relname
    """).splitlines())
    assert table_names == DEVELOPER_WORKFLOW_TABLES

    task_columns = set(database("""
        SELECT attributes.attname
        FROM pg_catalog.pg_attribute AS attributes
        WHERE attributes.attrelid = 'public.dev_agent_tasks'::regclass
          AND attributes.attnum > 0
          AND NOT attributes.attisdropped
        ORDER BY attributes.attnum
    """).splitlines())
    assert DB_TASK_SELECTED_COLUMNS <= task_columns

    assert database("SELECT count(*) FROM dev_agent_task_statuses") == "12"
    assert database("SELECT count(*) FROM dev_agent_task_todo_statuses") == "5"
    assert database("SELECT count(*) FROM dev_agent_task_groups") == "7"
    assert database("SELECT count(*) FROM dev_agent_task_queues") == "0"
    assert database("SELECT count(*) FROM dev_agent_tasks") == "0"
    assert database("SELECT count(*) FROM dev_agent_worklines") == "0"
    assert database("SELECT count(*) FROM dev_agent_workline_reports") == "0"
    assert database("SELECT count(*) FROM dev_agent_handover_reports") == "0"


def test_upgrade_restores_a_view_omitted_by_an_older_bootstrap(database):
    database("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    database((BOOTSTRAP / "schema.sql").read_text())
    database((BOOTSTRAP / "seed_data.sql").read_text())
    # Older released seed marked migration 9.7.3 applied while omitting the view.
    database("""
        DROP VIEW public.system_column_supported_views;
        DELETE FROM system_group_table_func_rights WHERE target_table_uid IN
          (SELECT table_uid FROM system_db_tables WHERE table_name='system_column_supported_views');
        DELETE FROM system_column_details WHERE table_uid IN
          (SELECT table_uid FROM system_db_tables WHERE table_name='system_column_supported_views');
        DELETE FROM system_db_tables WHERE table_name='system_column_supported_views';
    """)
    assert database("SELECT count(*) FROM system_schema_migrations WHERE filename="
                    "'20260906000002_add_column_view_support_matrix.sql'") == "1"
    batch = sorted(MIGRATIONS.glob("202609080000*.sql"))
    batch = [path for path in batch if path.name[:14] >= "20260908000008"]
    assert len(batch) == 3
    for _ in range(2):
        for migration in batch:
            database(migration.read_text())
        assert int(database("SELECT count(*) FROM system_column_supported_views")) > 0
        assert database("SELECT count(*) FROM system_db_tables WHERE table_name="
                        "'system_column_supported_views'") == "1"
    assert database("SELECT count(*) FROM system_db_version WHERE version='9.7.13'") == "1"


def test_upgrade_preserves_an_existing_site_view_definition(database):
    database("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    database((BOOTSTRAP / "schema.sql").read_text())
    database((BOOTSTRAP / "seed_data.sql").read_text())
    original = database("SELECT pg_get_viewdef('public.system_column_supported_views', true)")
    # Keep the same result columns but give this site a distinct view definition.
    database("CREATE OR REPLACE VIEW public.system_column_supported_views AS "
             + original.rstrip(";") + " WHERE details.table_uid > 0")
    before = database("SELECT pg_get_viewdef('public.system_column_supported_views', true)")
    repair = MIGRATIONS / "20260908000008_restore_column_support_view_registration.sql"
    for _ in range(2):
        database(repair.read_text())
        assert database("SELECT pg_get_viewdef('public.system_column_supported_views', true)") == before


# WL58 uses the existing Unix-socket-only cluster and the two production import
# scripts. No Docker daemon or installation database is involved in these tests.
import json
import os
import subprocess
import pytest
from test_row_actor_support import cluster, DATA_STEP, ACTOR_TABLES


def import_actor_package(cluster, tmp_path, path, schema, seed):
    cluster("CREATE DATABASE imported")
    (tmp_path / "schema.sql").write_text(schema)
    (tmp_path / "seed_data.sql").write_text(seed)
    connection = json.loads(cluster("SELECT json_build_object('host',current_setting('unix_socket_directories'),'port',current_setting('port'),'user',current_user)").stdout)
    env = os.environ.copy()
    env.update(PGHOST=connection['host'], PGPORT=connection['port'], PGUSER=connection['user'],
               PGDATABASE='imported', POSTGRES_USER=connection['user'], POSTGRES_DB='imported',
               FILTEREST_PUBLIC_BOOTSTRAP_DIR=str(tmp_path),
               PATH=os.environ.get('PG_TEST_BIN', '/usr/lib/postgresql/16/bin') + ':' + env['PATH'])
    if path == "docker-init":
        command = ["bash", str(APP / "server_tools/db_init/02_import_public_bootstrap.sh")]
    else:
        command = ["bash", "-c", 'source "$1"; import_bootstrap_package "$2/schema.sql" "$2/seed_data.sql" 1 psql -X',
                   "bootstrap-test", str(APP / "server_tools/lib/public_bootstrap.sh"), str(tmp_path)]
    return subprocess.run(command, env=env, text=True, capture_output=True), env


@pytest.mark.parametrize("path", ["docker-init", "native"])
@pytest.mark.parametrize("fault", [None, "schema", "data", "policy"])
def test_actor_package_import_stops_on_the_first_error(cluster, tmp_path, path, fault):
    schema = (BOOTSTRAP / "schema.sql").read_text()
    seed = (BOOTSTRAP / "seed_data.sql").read_text()
    if fault == "schema":
        schema = schema.replace("CREATE TABLE IF NOT EXISTS public.system_data_repair_records (",
                                "DO $$ BEGIN RAISE EXCEPTION 'forced schema failure'; END $$;\nCREATE TABLE IF NOT EXISTS public.system_data_repair_records (", 1)
    elif fault == "data":
        seed = seed.replace("saved := public.app_suspend_row_triggers(target);",
                            "saved := public.app_suspend_row_triggers(target); RAISE EXCEPTION 'forced data failure';", 1)
    elif fault == "policy":
        # Remove the entire guard statement, not merely its marker. 000006 now
        # checks it even earlier than 000004; either way no import is accepted.
        start = schema.index("CREATE POLICY repair_records_owner_role")
        end = schema.index(";", start) + 1
        schema = schema[:start] + schema[end:]
    result, _ = import_actor_package(cluster, tmp_path, path, schema, seed)
    if fault is None:
        assert result.returncode == 0, result.stderr
        # The acceptance block writes the version row of the open database version.
        assert cluster("SELECT version FROM system_db_version", "imported").stdout.strip() == \
            (APP / "VERSION_DB").read_text(encoding="utf-8").strip()
        assert cluster("SELECT count(*) FROM system_row_actor_columns", "imported").stdout.strip() == "32"
        assert cluster("SELECT count(*) FROM app_check_row_actor_marks()", "imported").stdout.strip() == "0"
        assert cluster("SELECT count(*) FROM system_data_repair_records WHERE migration='wl58_row_actor_columns' AND action IN ('column_added','fk_added','index_added','default_added','creator_trigger_added')", "imported").stdout.strip() == "0"
        assert cluster("SELECT count(*) FROM system_db_tables r JOIN system_table_folders f ON f.id=r.folder_id WHERE r.table_name='system_data_repair_records' AND f.folder_name='logs' AND NOT r.is_removable", "imported").stdout.strip() == "1"
        assert cluster("SELECT count(*) FROM system_group_table_func_rights r JOIN system_db_tables t ON t.table_uid=r.target_table_uid JOIN system_user_groups g ON g.id=r.user_group_id WHERE t.table_name='system_data_repair_records' AND g.name<>'admins'", "imported").stdout.strip() == "0"
    else:
        assert result.returncode != 0
        assert ("repair_records_owner_role" if fault == "policy" else f"forced {fault} failure") in result.stderr
        assert cluster("SELECT count(*) FROM system_schema_migrations", "imported").stdout.strip() == "0"
        assert cluster("SELECT count(*) FROM system_db_version", "imported").stdout.strip() == "0"
        if fault == "data":
            assert cluster("SELECT count(*) FROM system_data_repair_records WHERE migration='wl58_row_actor_columns'", "imported").stdout.strip() == "0"
            assert cluster("SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'protect_%_creator' AND tgenabled='D'", "imported").stdout.strip() == "0"


@pytest.mark.parametrize("prefix", ["filterest", "site_custom"])
def test_actor_guards_work_with_the_real_role_creation_script(cluster, tmp_path, prefix):
    result, env = import_actor_package(cluster, tmp_path, "docker-init", (BOOTSTRAP / "schema.sql").read_text(), (BOOTSTRAP / "seed_data.sql").read_text())
    assert result.returncode == 0, result.stderr
    env['POSTGRES_PASSWORD'] = 'disposable-test-only'
    for role in ('BASIC', 'GUEST', 'READONLY', 'CONFIDENTIAL'):
        env[f'DB_{role}_USER'] = prefix + '_' + role.lower()
        env[f'DB_{role}_PASSWORD'] = 'disposable-test-only'
    created = subprocess.run(['bash', str(APP / 'server_tools/db_init/03_create_roles.sh')], env=env, capture_output=True, text=True)
    assert created.returncode == 0, created.stderr
    for role in ('basic', 'guest', 'readonly', 'confidential'):
        name = prefix + '_' + role
        # Explicit rights make all four writes reach the guard, including DELETE
        # and TRUNCATE that the production script correctly does not grant.
        cluster(f"GRANT ALL ON system_row_actor_columns, system_data_repair_records TO {name}; GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO {name}", 'imported')
        assert cluster(f"SET ROLE {name}; SELECT count(*) FROM system_row_actor_columns", 'imported').stdout.strip() == '32'
        assert cluster(f"SET ROLE {name}; SELECT count(*) FROM system_data_repair_records", 'imported').stdout.strip() == '0'
        for statement in ("INSERT INTO system_row_actor_columns(table_uid,actor_role,column_name) VALUES(7,'creator','created_by')",
                          "UPDATE system_row_actor_columns SET column_name='bad' WHERE table_uid=7",
                          "DELETE FROM system_row_actor_columns WHERE table_uid=7", "TRUNCATE system_row_actor_columns",
                          "INSERT INTO system_data_repair_records(migration,action) VALUES('forged','completed')", "TRUNCATE system_data_repair_records"):
            result = cluster(f'SET ROLE {name}; ' + statement, 'imported', check=False)
            assert result.returncode != 0 and 'only the owner role' in result.stderr
        cluster(f"SET ROLE {name}; UPDATE system_data_repair_records SET action='forged'; DELETE FROM system_data_repair_records", 'imported')
    assert cluster("SELECT count(*) FROM app_check_row_actor_marks()", 'imported').stdout.strip() == '0'
