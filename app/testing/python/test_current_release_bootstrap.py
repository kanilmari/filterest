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
