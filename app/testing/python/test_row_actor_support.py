"""Run DB 9.10.0's row-actor support and the bootstrap acceptance it brings on real PostgreSQL.

Connects 20261005000001 (actor marks, repair record, the functions that add, constrain,
register, read and check creator and owner columns, and the history guards' exception)
and 20261005000002 (the marks keyed by the registry table_uid instead of its id) with
the public bootstrap generator's acceptance block and its class and header rules.
Protects the promises WL58 stage 2 rests on: only the owner role writes the two internal
tables, whatever rights other roles hold; only that role sees the repair record; a
registry deletion still takes its marks; the owner setting cannot leave the mark; a
creator never changes except when its user is deleted; deleting a user may empty its
references in immutable history and nothing else; a data step leaves every trigger as
it found it; and a bootstrap import is accepted whole or not at all.
Runs on disposable Unix-socket-only clusters, never the native or a production database.
"""
from __future__ import annotations

import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

import pytest

APP = Path(__file__).resolve().parents[2]
MIGRATIONS = APP / "server_tools/migrations"
SUPPORT = MIGRATIONS / "20261005000001_add_row_actor_support.sql"
CONVERSION = MIGRATIONS / "20261005000002_key_row_actor_marks_by_table_uid.sql"
RELEASE_RECORD = MIGRATIONS / "20261005000099_record_database_release_9_10_0.sql"
BOOTSTRAP = APP / "server_tools/public_bootstrap"
GENERATOR = BOOTSTRAP / "generate_bootstrap.py"
PORT = "15483"


def test_the_support_file_is_schema_only_and_declares_its_release_and_marker():
    sql = SUPPORT.read_text(encoding="utf-8")
    assert "-- VERSION_DB: 9.10.0" in sql
    assert "-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql" in sql
    assert "-- COMPLETION_MARKER: wl58_row_actor_support" in sql
    # Its only row is its own completion marker; it does not start a transaction of its own.
    assert re.findall(r"INSERT INTO public\.(\w+)", sql) == [
        "system_column_details", "system_row_actor_columns", "system_row_actor_columns",
        "system_foreign_key_relations_1_m", "system_data_repair_records",
    ]
    assert sql.rstrip().endswith("AND action = 'completed'\n);".rstrip())
    assert not re.search(r"^\s*BEGIN\s*;", sql, re.M)
    record = RELEASE_RECORD.read_text(encoding="utf-8")
    assert "-- VERSION_DB: 9.10.0" in record and "SELECT '9.10.0'" in record
    assert (APP / "VERSION_DB").read_text(encoding="utf-8").strip() == "9.10.0"


def test_the_conversion_is_schema_only_and_leaves_no_registry_id_form_behind():
    sql = CONVERSION.read_text(encoding="utf-8")
    assert "-- VERSION_DB: 9.10.0" in sql
    assert "-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql" in sql
    assert "-- COMPLETION_MARKER: wl58_row_actor_marks_by_table_uid" in sql
    assert "-- FINAL_CHECK: public.app_check_row_actor_marks()" in sql
    assert "DROP FUNCTION IF EXISTS public.app_register_row_actor_columns(bigint, text);" in sql
    assert "app_register_row_actor_columns(registry_table_uid integer, owner_column text)" in sql
    # Outside the conversion block, nothing joins or keys the marks by the registry id.
    after_block = sql[sql.index("END $convert$;"):]
    assert "table_id" not in after_block.replace("attname = 'table_id'", "").replace("(table_id)", "")
    assert not re.search(r"registry\.id\b|\bOLD\.id\b|WHERE id = ", after_block)
    assert re.findall(r"INSERT INTO public\.(\w+)", sql) == [
        "system_column_details", "system_row_actor_columns", "system_row_actor_columns",
        "system_foreign_key_relations_1_m", "system_data_repair_records",
    ]
    assert sql.rstrip().endswith("AND action = 'completed'\n);".rstrip())
    assert not re.search(r"^\s*BEGIN\s*;", sql, re.M)


def test_the_bootstrap_runs_the_support_and_leaves_the_release_record_to_its_acceptance_block():
    source = GENERATOR.read_text(encoding="utf-8")
    assert ('"20261005000001_add_row_actor_support.sql",\n'
            '    "20261005000002_key_row_actor_marks_by_table_uid.sql",\n)') in source
    assert '"20261005000099_record_database_release_9_10_0.sql",\n)' in source
    seed = (BOOTSTRAP / "seed_data.sql").read_text(encoding="utf-8")
    block = seed[seed.index("DO $filterest_acceptance$"):]
    assert "ARRAY['wl58_row_actor_support', 'wl58_row_actor_marks_by_table_uid']::text[]" in block
    assert ("SELECT 'public.app_check_row_actor_marks(): ' || result "
            "FROM public.app_check_row_actor_marks() AS result") in block
    assert block.index("missing completion markers") < block.index("INSERT INTO public.system_schema_migrations")
    assert block.index("INSERT INTO public.system_schema_migrations") < block.index("INSERT INTO public.system_db_version")
    assert block.rstrip().endswith("$filterest_acceptance$;")
    assert "__FILTEREST_DB_VERSION__" not in (BOOTSTRAP / "source/runtime.seed.sql").read_text(encoding="utf-8")


@pytest.fixture
def cluster():
    """A disposable Unix-socket-only cluster; yields a psql runner taking a database name."""
    if os.environ.get("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1":
        pytest.skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 for isolated PostgreSQL checks")
    pg_bin = Path(os.environ.get("PG_TEST_BIN", "/usr/lib/postgresql/16/bin"))
    if not (pg_bin / "initdb").exists():
        pytest.skip("PostgreSQL test binaries unavailable")
    with tempfile.TemporaryDirectory(prefix="row-actor-support-test-") as directory:
        base = Path(directory)
        socket = base / "socket"
        socket.mkdir(mode=0o700)
        subprocess.run([str(pg_bin / "initdb"), "-D", str(base / "pgdata"), "-A", "trust", "-U", "test_owner",
                        "--no-locale", "--encoding=UTF8"], check=True, capture_output=True)
        subprocess.run([str(pg_bin / "pg_ctl"), "-D", str(base / "pgdata"), "-l", str(base / "postgres.log"),
                        "-o", f"-h '' -k '{socket}' -p {PORT}", "-w", "start"], check=True, capture_output=True)
        try:
            def psql(sql, database="postgres", check=True):
                result = subprocess.run(
                    [str(pg_bin / "psql"), "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
                     "-h", str(socket), "-p", PORT, "-U", "test_owner", "-d", database],
                    input=sql, text=True, capture_output=True,
                )
                if check and result.returncode != 0:
                    raise AssertionError(result.stderr)
                return result
            yield psql
        finally:
            subprocess.run([str(pg_bin / "pg_ctl"), "-D", str(base / "pgdata"), "-m", "fast", "-w", "stop"],
                           check=True, capture_output=True)


@pytest.fixture
def installed(cluster):
    """A database from the generated public bootstrap, imported as every path imports it."""
    cluster("CREATE DATABASE site")
    for name in ("schema.sql", "seed_data.sql"):
        cluster((BOOTSTRAP / name).read_text(encoding="utf-8"), "site")

    def run(sql, check=True):
        return cluster(sql, "site", check)
    return run


def value(run, sql):
    return run(sql).stdout.strip()


def refused(run, sql, expected):
    result = run(sql, check=False)
    assert result.returncode != 0, f"accepted: {sql}"
    assert expected in result.stderr, result.stderr
    return result.stderr


def test_the_imported_bootstrap_is_accepted_whole(installed):
    assert value(installed, "SELECT version FROM system_db_version") == "9.10.0"
    ledger = int(value(installed, "SELECT count(*) FROM system_schema_migrations"))
    assert ledger == len(list(MIGRATIONS.glob("*.sql")))
    assert value(installed, "SELECT string_agg(migration || ':' || action, ' ' ORDER BY id) "
                            "FROM system_data_repair_records") == \
        "wl58_row_actor_support:completed wl58_row_actor_marks_by_table_uid:completed"
    assert value(installed, "SELECT count(*) FROM app_check_row_actor_marks()") == "0"
    # A new installation has the marks keyed by table_uid only.
    assert value(installed, "SELECT string_agg(attname, ',' ORDER BY attnum) FROM pg_attribute WHERE attrelid = "
                            "'public.system_row_actor_columns'::regclass AND attnum > 0 AND NOT attisdropped") == \
        "actor_role,column_name,marked_at,table_uid"
    assert value(installed, "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = "
                            "'public.system_row_actor_columns'::regclass AND contype = 'f'") == \
        "FOREIGN KEY (table_uid) REFERENCES system_db_tables(table_uid) ON DELETE CASCADE"
    # Running the conversion again on an installed database changes nothing.
    installed(CONVERSION.read_text(encoding="utf-8"))
    assert value(installed, "SELECT count(*) FROM system_data_repair_records") == "2"


def test_a_missing_marker_refuses_the_import_and_writes_neither_ledger_nor_version(cluster):
    cluster("CREATE DATABASE broken")
    schema = (BOOTSTRAP / "schema.sql").read_text(encoding="utf-8")
    cluster(schema.replace("SELECT 'wl58_row_actor_support', 'completed',",
                           "SELECT 'wl58_row_actor_support_lost', 'completed',"), "broken")
    result = cluster((BOOTSTRAP / "seed_data.sql").read_text(encoding="utf-8"), "broken", check=False)
    assert result.returncode != 0
    assert "missing completion markers: wl58_row_actor_support" in result.stderr
    assert cluster("SELECT count(*) FROM system_schema_migrations", "broken").stdout.strip() == "0"
    assert cluster("SELECT count(*) FROM system_db_version", "broken").stdout.strip() == "0"


def test_a_failure_in_the_blocks_last_statement_takes_the_whole_ledger_back(cluster):
    cluster("CREATE DATABASE late_failure")
    cluster((BOOTSTRAP / "schema.sql").read_text(encoding="utf-8"), "late_failure")
    cluster("""
        CREATE FUNCTION refuse_version() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'version row refused for the test'; END $$;
        CREATE TRIGGER refuse_version BEFORE INSERT ON public.system_db_version
            FOR EACH ROW EXECUTE FUNCTION refuse_version();
    """, "late_failure")
    result = cluster((BOOTSTRAP / "seed_data.sql").read_text(encoding="utf-8"), "late_failure", check=False)
    assert result.returncode != 0 and "version row refused for the test" in result.stderr
    assert cluster("SELECT count(*) FROM system_schema_migrations", "late_failure").stdout.strip() == "0"


@pytest.fixture
def roles(installed):
    """v9 case 1's cast: a plain owner role, its member, another superuser and an outsider.

    The outsider and the member hold every write right on both tables explicitly, so a
    refusal can only come from the guard, not from a missing privilege.
    """
    installed("""
        CREATE ROLE site_owner NOLOGIN;
        CREATE ROLE owner_member NOLOGIN IN ROLE site_owner;
        CREATE ROLE other_super SUPERUSER NOLOGIN;
        CREATE ROLE outsider NOLOGIN;
        ALTER TABLE public.system_row_actor_columns OWNER TO site_owner;
        ALTER TABLE public.system_data_repair_records OWNER TO site_owner;
        GRANT USAGE ON SCHEMA public TO site_owner, owner_member, outsider;
        GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON public.system_row_actor_columns,
              public.system_data_repair_records TO owner_member, outsider;
        GRANT SELECT, DELETE ON public.system_db_tables TO outsider;
        GRANT SELECT ON public.system_users, public.system_db_tables TO site_owner, owner_member;
        INSERT INTO public.system_db_tables (table_name, schema_name, table_uid) VALUES ('roles_demo', 'public', 99101);
        INSERT INTO public.system_row_actor_columns (table_uid, actor_role, column_name)
        SELECT table_uid, role, column_name FROM public.system_db_tables,
               (VALUES ('creator', 'created_by'), ('owner', 'owner_id')) AS marks (role, column_name)
         WHERE table_name = 'roles_demo';
    """)
    return installed


@pytest.mark.parametrize("role", ["site_owner", "owner_member", "other_super"])
def test_the_owner_role_its_member_and_a_superuser_write_the_marks(roles, role):
    roles(f"""
        SET ROLE {role};
        UPDATE public.system_row_actor_columns SET marked_at = now() WHERE table_uid = 99101;
        INSERT INTO public.system_data_repair_records (migration, action) VALUES ('test', 'by_{role}');
    """)
    assert value(roles, f"SELECT count(*) FROM system_data_repair_records WHERE action = 'by_{role}'") == "1"


def test_an_outsider_with_every_right_is_refused_by_the_guard(roles):
    for statement in (
        "INSERT INTO public.system_row_actor_columns (table_uid, actor_role, column_name) "
        "SELECT table_uid, 'owner', 'x' FROM public.system_db_tables WHERE table_name = 'system_about'",
        "UPDATE public.system_row_actor_columns SET column_name = 'user_id'",
        "DELETE FROM public.system_row_actor_columns",
        "TRUNCATE public.system_row_actor_columns",
        "INSERT INTO public.system_data_repair_records (migration, action) VALUES ('forged', 'completed')",
        "TRUNCATE public.system_data_repair_records",
    ):
        refused(roles, f"SET ROLE outsider; {statement}", "only the owner role of")
    assert value(roles, "SELECT count(*) FROM system_row_actor_columns") == "2"


def test_the_repair_record_is_invisible_to_an_outsider_and_untouchable(roles):
    assert value(roles, "SET ROLE outsider; SELECT count(*) FROM public.system_data_repair_records") == "0"
    # Row security filters before the trigger, so these hit no row rather than fail.
    roles("SET ROLE outsider; UPDATE public.system_data_repair_records SET action = 'x'; "
          "DELETE FROM public.system_data_repair_records")
    # The two completion markers of 000001 and 000002 stay.
    assert value(roles, "SELECT count(*) FROM system_data_repair_records") == "2"
    assert value(roles, "SET ROLE owner_member; SELECT count(*) FROM public.system_data_repair_records") == "2"
    # A role that bypasses row security sees every row: why the start-up refuses such a runtime role.
    roles("CREATE ROLE bypassing BYPASSRLS NOLOGIN; GRANT USAGE ON SCHEMA public TO bypassing; "
          "GRANT SELECT ON public.system_data_repair_records TO bypassing")
    assert value(roles, "SET ROLE bypassing; SELECT count(*) FROM public.system_data_repair_records") == "2"


def test_a_registry_deletion_takes_its_marks_though_the_registry_has_another_owner(roles):
    roles("SET ROLE outsider; DELETE FROM public.system_db_tables WHERE table_name = 'roles_demo'")
    assert value(roles, "SELECT count(*) FROM system_row_actor_columns") == "0"


def test_the_owner_setting_cannot_leave_the_mark_for_any_role(roles):
    roles("UPDATE system_db_tables SET row_policy_owner_column = 'owner_id' WHERE table_name = 'roles_demo'")
    for role in ("test_owner", "other_super"):
        refused(roles, f"SET ROLE {role}; UPDATE public.system_db_tables SET row_policy_owner_column = 'user_id' "
                       "WHERE table_name = 'roles_demo'", "row owner setting is fixed")
    refused(roles, "UPDATE system_db_tables SET row_policy_owner_column = NULL WHERE table_name = 'roles_demo'",
            "row owner setting is fixed")
    # An unmarked dataset's setting stays an administrator's tool.
    roles("UPDATE system_db_tables SET row_policy_owner_column = 'user_id' WHERE table_name = 'system_about'")


def create_marked_dataset(run, name, uid):
    run(f"""
        CREATE TABLE public.{name} (id serial PRIMARY KEY, title text, updated timestamptz DEFAULT now());
        CREATE FUNCTION {name}_touch() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN NEW.updated := now(); RETURN NEW; END $$;
        CREATE TRIGGER {name}_touch BEFORE UPDATE ON public.{name} FOR EACH ROW EXECUTE FUNCTION {name}_touch();
        INSERT INTO public.system_db_tables (table_name, schema_name, table_uid) VALUES ('{name}', 'public', {uid});
        SELECT app_ensure_row_actor_columns('public.{name}', 'owner_id');
        SELECT app_ensure_row_actor_constraints('public.{name}', 'owner_id');
        SELECT app_register_row_actor_columns({uid}, 'owner_id');
    """)


def test_registration_marks_hides_and_relates_the_columns_and_reruns_change_nothing(installed):
    create_marked_dataset(installed, "notes_demo", 99201)
    assert value(installed, "SELECT app_row_actor_column('public.notes_demo', 'owner') || ',' || "
                            "app_row_actor_column('public.notes_demo', 'creator')") == "owner_id,created_by"
    assert value(installed, "SELECT row_policy_owner_column FROM system_db_tables WHERE table_name = 'notes_demo'") == \
        "owner_id"
    assert value(installed, """
        SELECT string_agg(column_name || ':' || card_element || ':' || insertable || ':' || editable_in_ui || ':' ||
                          hide_in_filter_panel || ':' || co_number, ' ' ORDER BY column_name)
          FROM system_column_details WHERE table_uid = 99201""") == \
        "created_by:hidden:false:false:true:4 owner_id:hidden:false:false:true:5"
    assert value(installed, """
        SELECT string_agg(source_column_name || ':' || insert_new_source_with_target, ' ' ORDER BY source_column_name)
          FROM system_foreign_key_relations_1_m WHERE source_table_uid = 99201""") == \
        "created_by:false owner_id:false"
    for call in ("app_ensure_row_actor_columns('public.notes_demo', 'owner_id')",
                 "app_ensure_row_actor_constraints('public.notes_demo', 'owner_id')",
                 "app_register_row_actor_columns(99201, 'owner_id')"):
        assert value(installed, f"SELECT {call}") == "[]"
    assert value(installed, "SELECT count(*) FROM app_check_row_actor_marks()") == "0"


def test_an_existing_metadata_row_keeps_the_administrators_role(installed):
    installed("""
        CREATE TABLE public.kept_demo (id serial PRIMARY KEY, created_by integer);
        INSERT INTO public.system_db_tables (table_name, schema_name, table_uid) VALUES ('kept_demo', 'public', 99301);
        INSERT INTO public.system_column_details (table_uid, column_name, data_type, co_number, card_element, insertable)
        VALUES (99301, 'created_by', 'integer', 2, 'details', TRUE);
        SELECT app_ensure_row_actor_columns('public.kept_demo', 'owner_id');
        SELECT app_ensure_row_actor_constraints('public.kept_demo', 'owner_id');
        SELECT app_register_row_actor_columns(99301, 'owner_id');
    """)
    assert value(installed, "SELECT card_element || ':' || insertable || ':' || editable_in_ui FROM system_column_details "
                            "WHERE table_uid = 99301 AND column_name = 'created_by'") == "details:false:false"


def test_an_unfit_existing_column_or_foreign_key_stops_before_anything_is_written(installed):
    installed("CREATE TABLE public.text_owner (id serial PRIMARY KEY, created_by text)")
    refused(installed, "SELECT app_ensure_row_actor_columns('public.text_owner', 'owner_id')",
            "must be an integer or bigint column")
    installed("CREATE TABLE public.cascading (id serial PRIMARY KEY, "
              "created_by bigint REFERENCES public.system_users(id) ON DELETE CASCADE)")
    installed("SELECT app_ensure_row_actor_columns('public.cascading', 'owner_id')")
    refused(installed, "SELECT app_ensure_row_actor_constraints('public.cascading', 'owner_id')",
            "must be ON DELETE SET NULL")
    assert value(installed, "SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.cascading'::regclass "
                            "AND contype = 'f'") == "1"


def test_a_new_row_is_stamped_its_creator_never_changes_and_deleting_the_user_clears_both(installed):
    create_marked_dataset(installed, "stamped_demo", 99401)
    installed("INSERT INTO public.system_users (id, username) VALUES (7001, 'actor_a'), (7002, 'actor_b')")
    installed("SELECT set_config('app.user_id', '7001', false); INSERT INTO public.stamped_demo (title) VALUES ('a row');"
              "SELECT set_config('app.user_id', '1', false); INSERT INTO public.stamped_demo (title) VALUES ('a visit')")
    assert value(installed, "SELECT string_agg(coalesce(created_by::text, '-') || '/' || coalesce(owner_id::text, '-'), "
                            "' ' ORDER BY id) FROM stamped_demo") == "7001/7001 -/-"
    refused(installed, "UPDATE public.stamped_demo SET created_by = 7002 WHERE title = 'a row'",
            "row creator is immutable")
    refused(installed, "UPDATE public.stamped_demo SET created_by = NULL WHERE title = 'a row'",
            "row creator is immutable")
    installed("UPDATE public.stamped_demo SET owner_id = 7002 WHERE title = 'a row'")
    installed("DELETE FROM public.system_users WHERE id = 7001")
    assert value(installed, "SELECT coalesce(created_by::text, '-') || '/' || owner_id || '/' || title "
                            "FROM stamped_demo WHERE title = 'a row'") == "-/7002/a row"


def test_deleting_a_user_empties_only_that_users_references_in_immutable_history(installed):
    installed("""
        INSERT INTO public.system_users (id, username) VALUES (7101, 'reporter'), (7102, 'reader');
        INSERT INTO public.dev_agent_worklines (id, title, status) VALUES (7101, 'history demo', 'active');
        INSERT INTO public.dev_agent_workline_reports (workline_id, title, report_type, outcome, content, source_kind,
                                                       content_hash, created_by)
        VALUES (7101, 'report', 'progress', 'partial', 'body', 'chat', repeat('a', 64), 7101);
    """)
    refused(installed, "UPDATE public.dev_agent_workline_reports SET content = 'changed'",
            "workline report bodies are immutable")
    refused(installed, "UPDATE public.dev_agent_workline_reports SET created_by = NULL",
            "workline report bodies are immutable")
    refused(installed, "UPDATE public.dev_agent_workline_reports SET created_by = 7102",
            "workline report bodies are immutable")
    installed("DELETE FROM public.system_users WHERE id = 7101")
    assert value(installed, "SELECT coalesce(created_by::text, 'cleared') || '/' || content "
                            "FROM dev_agent_workline_reports") == "cleared/body"


def test_suspending_and_restoring_returns_every_trigger_to_its_exact_state(installed):
    installed("""
        CREATE TABLE public.trigger_states (id serial PRIMARY KEY, n int);
        CREATE FUNCTION trigger_states_noop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
        CREATE TRIGGER t_origin BEFORE UPDATE ON public.trigger_states FOR EACH ROW EXECUTE FUNCTION trigger_states_noop();
        CREATE TRIGGER t_replica BEFORE UPDATE ON public.trigger_states FOR EACH ROW EXECUTE FUNCTION trigger_states_noop();
        CREATE TRIGGER t_always BEFORE UPDATE ON public.trigger_states FOR EACH ROW EXECUTE FUNCTION trigger_states_noop();
        CREATE TRIGGER t_off BEFORE UPDATE ON public.trigger_states FOR EACH ROW EXECUTE FUNCTION trigger_states_noop();
        ALTER TABLE public.trigger_states ENABLE REPLICA TRIGGER t_replica;
        ALTER TABLE public.trigger_states ENABLE ALWAYS TRIGGER t_always;
        ALTER TABLE public.trigger_states DISABLE TRIGGER t_off;
    """)
    states = "SELECT string_agg(tgname || '=' || tgenabled::text, ' ' ORDER BY tgname) FROM pg_trigger " \
             "WHERE tgrelid = 'public.trigger_states'::regclass AND NOT tgisinternal"
    before = value(installed, states)
    assert before == "t_always=A t_off=D t_origin=O t_replica=R"
    assert value(installed, "SELECT app_suspend_row_triggers('public.trigger_states')") == \
        '[{"name": "t_always", "state": "A"}, {"name": "t_origin", "state": "O"}, {"name": "t_replica", "state": "R"}]'
    assert value(installed, states) == "t_always=D t_off=D t_origin=D t_replica=D"
    installed("SELECT app_restore_row_triggers('public.trigger_states', '[{\"name\": \"t_always\", \"state\": \"A\"}, "
              "{\"name\": \"t_origin\", \"state\": \"O\"}, {\"name\": \"t_replica\", \"state\": \"R\"}]')")
    assert value(installed, states) == before


def test_the_final_check_names_each_contradiction(installed):
    create_marked_dataset(installed, "checked_demo", 99501)
    installed("""
        ALTER TABLE public.checked_demo DISABLE TRIGGER protect_checked_demo_creator;
        ALTER TABLE public.checked_demo DROP CONSTRAINT fk_checked_demo_owner_id;
        ALTER TABLE public.system_db_tables DISABLE TRIGGER protect_row_owner_setting;
        UPDATE public.system_db_tables SET row_policy_owner_column = 'created_by' WHERE table_name = 'checked_demo';
        ALTER TABLE public.system_data_repair_records DISABLE ROW LEVEL SECURITY;
        ALTER TABLE public.system_row_actor_columns DROP CONSTRAINT system_row_actor_columns_table_uid_fkey;
    """)
    findings = value(installed, "SELECT string_agg(f, ' | ') FROM app_check_row_actor_marks() AS f")
    for expected in ("checked_demo: the creator guard trigger is missing or not firing on ordinary writes",
                     "checked_demo.owner_id: no validated ON DELETE SET NULL foreign key",
                     "checked_demo: registry owner setting created_by differs from the owner mark owner_id",
                     "public.system_db_tables: guard trigger protect_row_owner_setting is missing, not firing on "
                     "ordinary writes or not running public.protect_row_owner_setting()",
                     "public.system_data_repair_records: row security is off",
                     "public.system_row_actor_columns: no validated ON DELETE CASCADE foreign key from table_uid to "
                     "system_db_tables(table_uid)"):
        assert expected in findings, findings


def schema_before_and_from_the_conversion():
    schema = (BOOTSTRAP / "schema.sql").read_text(encoding="utf-8")
    split = schema.index("-- 20261005000002_key_row_actor_marks_by_table_uid.sql")
    return schema[:split], schema[split:]


def test_the_conversion_keeps_old_marks_when_registry_id_and_table_uid_cross(cluster):
    """On a long-lived database id and table_uid differ, and one row's uid is another's id."""
    before, conversion = schema_before_and_from_the_conversion()
    cluster("CREATE DATABASE upgraded")
    cluster(before, "upgraded")
    # Two real marked datasets in 000001's shape: columns, keys, guards, the setting, marks by registry id.
    cluster("""
        CREATE TABLE public.cross_a (id serial PRIMARY KEY, title text);
        CREATE TABLE public.cross_b (id serial PRIMARY KEY, title text, user_id bigint);
        INSERT INTO public.system_db_tables (id, table_name, schema_name, table_uid, row_policy_owner_column)
        VALUES (99701, 'cross_a', 'public', 99702, 'owner_id'), (99702, 'cross_b', 'public', 99703, 'user_id');
        SELECT app_ensure_row_actor_columns('public.cross_a', 'owner_id');
        SELECT app_ensure_row_actor_constraints('public.cross_a', 'owner_id');
        SELECT app_ensure_row_actor_columns('public.cross_b', 'user_id');
        SELECT app_ensure_row_actor_constraints('public.cross_b', 'user_id');
        INSERT INTO public.system_row_actor_columns (table_id, actor_role, column_name)
        VALUES (99701, 'creator', 'created_by'), (99701, 'owner', 'owner_id'),
               (99702, 'creator', 'created_by'), (99702, 'owner', 'user_id');
    """, "upgraded")
    cluster(conversion, "upgraded")
    assert cluster("SELECT count(*) FROM app_check_row_actor_marks()", "upgraded").stdout.strip() == "0"
    marks = ("SELECT string_agg(registry.table_name || ':' || mark.actor_role || '=' || mark.column_name, ' ' "
             "ORDER BY registry.table_name, mark.actor_role) FROM system_row_actor_columns AS mark "
             "JOIN system_db_tables AS registry ON registry.table_uid = mark.table_uid")
    expected = "cross_a:creator=created_by cross_a:owner=owner_id cross_b:creator=created_by cross_b:owner=user_id"
    assert cluster(marks, "upgraded").stdout.strip() == expected
    assert cluster("SELECT string_agg(table_uid::text, ',' ORDER BY table_uid) FROM system_row_actor_columns "
                   "WHERE actor_role = 'owner'", "upgraded").stdout.strip() == "99702,99703"
    # The registry-id form of registration is gone; the table_uid form remains.
    assert cluster("SELECT string_agg(pg_get_function_identity_arguments(oid), ' | ') FROM pg_proc "
                   "WHERE proname = 'app_register_row_actor_columns'", "upgraded").stdout.strip() == \
        "registry_table_uid integer, owner_column text"
    # Running the conversion again changes nothing, and deleting a registry row still takes its marks.
    cluster(CONVERSION.read_text(encoding="utf-8"), "upgraded")
    assert cluster(marks, "upgraded").stdout.strip() == expected
    cluster("DELETE FROM public.system_db_tables WHERE table_name = 'cross_a'", "upgraded")
    assert cluster("SELECT count(*) FROM system_row_actor_columns", "upgraded").stdout.strip() == "2"


def test_a_mark_whose_registry_row_has_no_table_uid_stops_the_conversion_and_changes_nothing(cluster):
    before, conversion = schema_before_and_from_the_conversion()
    cluster("CREATE DATABASE stopped")
    cluster(before, "stopped")
    cluster("""
        INSERT INTO public.system_db_tables (id, table_name, schema_name, table_uid) VALUES (99801, 'no_uid', 'public', NULL);
        INSERT INTO public.system_row_actor_columns (table_id, actor_role, column_name)
        VALUES (99801, 'creator', 'created_by'), (99801, 'owner', 'owner_id');
    """, "stopped")
    result = cluster(conversion, "stopped", check=False)
    assert result.returncode != 0
    assert "an actor mark points to a registry row without table_uid" in result.stderr
    assert cluster("SELECT string_agg(attname, ',' ORDER BY attnum) FROM pg_attribute WHERE attrelid = "
                   "'public.system_row_actor_columns'::regclass AND attnum > 0 AND NOT attisdropped",
                   "stopped").stdout.strip() == "table_id,actor_role,column_name,marked_at"


def test_a_missing_conversion_marker_refuses_the_import(cluster):
    cluster("CREATE DATABASE unconverted")
    schema = (BOOTSTRAP / "schema.sql").read_text(encoding="utf-8")
    cluster(schema.replace("SELECT 'wl58_row_actor_marks_by_table_uid', 'completed',",
                           "SELECT 'wl58_row_actor_marks_by_table_uid_lost', 'completed',"), "unconverted")
    result = cluster((BOOTSTRAP / "seed_data.sql").read_text(encoding="utf-8"), "unconverted", check=False)
    assert result.returncode != 0
    assert "missing completion markers: wl58_row_actor_marks_by_table_uid" in result.stderr
    assert cluster("SELECT count(*) FROM system_db_version", "unconverted").stdout.strip() == "0"


def test_a_final_check_finding_refuses_the_import(cluster):
    cluster("CREATE DATABASE unsound")
    cluster((BOOTSTRAP / "schema.sql").read_text(encoding="utf-8"), "unsound")
    cluster("ALTER TABLE public.system_data_repair_records DISABLE ROW LEVEL SECURITY", "unsound")
    result = cluster((BOOTSTRAP / "seed_data.sql").read_text(encoding="utf-8"), "unsound", check=False)
    assert result.returncode != 0
    assert "public.system_data_repair_records: row security is off" in result.stderr
    assert cluster("SELECT count(*) FROM system_schema_migrations", "unsound").stdout.strip() == "0"
    assert cluster("SELECT count(*) FROM system_db_version", "unsound").stdout.strip() == "0"


def test_a_guard_that_fires_only_in_replica_mode_does_not_count(installed):
    """Replica-only triggers skip ordinary writes, so the final check must not accept them."""
    create_marked_dataset(installed, "replica_demo", 99601)
    installed("ALTER TABLE public.replica_demo ENABLE REPLICA TRIGGER protect_replica_demo_creator;"
              "ALTER TABLE public.system_row_actor_columns ENABLE REPLICA TRIGGER owner_only_writes")
    findings = value(installed, "SELECT string_agg(f, ' | ') FROM app_check_row_actor_marks() AS f")
    assert "replica_demo: the creator guard trigger is missing or not firing on ordinary writes" in findings
    assert "public.system_row_actor_columns: guard trigger owner_only_writes is missing" in findings
    installed("ALTER TABLE public.replica_demo ENABLE ALWAYS TRIGGER protect_replica_demo_creator;"
              "ALTER TABLE public.system_row_actor_columns ENABLE TRIGGER owner_only_writes")
    assert value(installed, "SELECT count(*) FROM app_check_row_actor_marks()") == "0"


def test_an_existing_unique_rule_on_the_owner_column_survives(installed):
    """A valid but non-qualifying index under the helper's name keeps its rule; the helper takes another name."""
    installed("""
        CREATE TABLE public.unique_owner (id serial PRIMARY KEY, created_by bigint, owner_id bigint);
        CREATE UNIQUE INDEX idx_unique_owner_owner_id ON public.unique_owner (owner_id) WHERE owner_id IS NOT NULL;
        INSERT INTO public.system_users (id, username) VALUES (7201, 'only_once');
    """)
    changes = value(installed, "SELECT app_ensure_row_actor_constraints('public.unique_owner', 'owner_id')")
    assert '"index": "idx_unique_owner_owner_id_actor"' in changes
    assert '"index": "idx_unique_owner_owner_id", "action": "index_not_qualifying"' in changes
    assert value(installed, "SELECT indisunique FROM pg_index WHERE indexrelid = "
                            "'public.idx_unique_owner_owner_id'::regclass") == "t"
    installed("INSERT INTO public.unique_owner (owner_id) VALUES (7201)")
    refused(installed, "INSERT INTO public.unique_owner (owner_id) VALUES (7201)", "duplicate key value")
    assert value(installed, "SELECT app_ensure_row_actor_constraints('public.unique_owner', 'owner_id')") == "[]"


def test_only_an_invalid_index_under_the_helpers_name_is_replaced(installed):
    installed("""
        CREATE TABLE public.invalid_index (id serial PRIMARY KEY, created_by bigint, owner_id bigint);
        CREATE INDEX idx_invalid_index_created_by ON public.invalid_index (created_by);
        UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'public.idx_invalid_index_created_by'::regclass;
    """)
    changes = value(installed, "SELECT app_ensure_row_actor_constraints('public.invalid_index', 'owner_id')")
    assert '"action": "invalid_index_replaced"' in changes
    assert value(installed, "SELECT indisvalid FROM pg_index WHERE indexrelid = "
                            "'public.idx_invalid_index_created_by'::regclass") == "t"


def test_side_tables_and_long_names(installed):
    reasons = value(installed, """
        SELECT string_agg(name || '=' || coalesce(app_row_actor_side_table_reason(name), 'content'), ' ' ORDER BY name)
          FROM unnest(ARRAY['palvelukatalogi', 'system_about', 'system_users', 'photos_assets', 'texts_lang_embeddings',
                            'a_relation', 'a_relations', 'review_history', 'ai_usage_logs']) AS name""")
    assert reasons == ("a_relation=R4: link table a_relations=R4: link table ai_usage_logs=R5: log or history table "
                       "palvelukatalogi=content photos_assets=R2: attachment table review_history=R5: log or history "
                       "table system_about=content system_users=R1: system table texts_lang_embeddings=R3: language "
                       "embedding table")
    long_name = value(installed, "SELECT app_row_actor_object_name('idx', repeat('t', 70), 'created_by')")
    assert len(long_name.encode()) == 63
    assert long_name == value(installed, "SELECT app_row_actor_object_name('idx', repeat('t', 70), 'created_by')")
    assert value(installed, "SELECT app_row_actor_object_name('fk', 'notes', 'owner_id')") == "fk_notes_owner_id"


@pytest.fixture
def generator_copy():
    """The generator with its inputs in a scratch tree, so a test can add a migration."""
    with tempfile.TemporaryDirectory(prefix="bootstrap-rules-") as directory:
        root = Path(directory)
        for relative in ("app/server_tools/public_bootstrap", "app/server_tools/migrations",
                         "app/server_tools/public_slice_export"):
            shutil.copytree(APP.parent / relative, root / relative)
        for name in ("VERSION_APP", "VERSION_DB"):
            shutil.copy2(APP / name, root / "app" / name)
        yield root


def generate(root):
    return subprocess.run(["python3", str(root / "app/server_tools/public_bootstrap/generate_bootstrap.py")],
                          capture_output=True, text=True)


def published_bytes(root):
    return {name: (root / "app/server_tools/public_bootstrap" / name).read_bytes()
            for name in ("schema.sql", "seed_data.sql", "manifest.json")}


LAST_REPAIR_ENTRY = '"20261005000002_key_row_actor_marks_by_table_uid.sql",\n)'


def add_repair_migration(generator, name):
    """Lists one more schema-phase file after the last repair entry of the generator copy."""
    source = generator.read_text()
    assert LAST_REPAIR_ENTRY in source
    generator.write_text(source.replace(LAST_REPAIR_ENTRY, LAST_REPAIR_ENTRY[:-2] + f'\n    "{name}",\n)'))


def test_a_new_migration_outside_every_class_stops_the_generation(generator_copy):
    before = published_bytes(generator_copy)
    (generator_copy / "app/server_tools/migrations/20261005000008_unlisted.sql").write_text("SELECT 1;\n")
    result = generate(generator_copy)
    assert result.returncode != 0
    assert "Migration is in no bootstrap class: 20261005000008_unlisted.sql" in result.stderr
    assert published_bytes(generator_copy) == before


def test_a_schema_phase_migration_without_a_completion_marker_stops_the_generation(generator_copy):
    generator = generator_copy / "app/server_tools/public_bootstrap/generate_bootstrap.py"
    (generator_copy / "app/server_tools/migrations/20261005000008_unmarked.sql").write_text("SELECT 1;\n")
    add_repair_migration(generator, "20261005000008_unmarked.sql")
    result = generate(generator_copy)
    assert result.returncode != 0
    assert "declares no completion marker: 20261005000008_unmarked.sql" in result.stderr


def test_a_final_check_this_bootstrap_does_not_create_stops_the_generation(generator_copy):
    generator = generator_copy / "app/server_tools/public_bootstrap/generate_bootstrap.py"
    (generator_copy / "app/server_tools/migrations/20261005000008_checked.sql").write_text(
        "-- COMPLETION_MARKER: test_checked\n-- FINAL_CHECK: public.app_check_nothing()\nSELECT 1;\n")
    add_repair_migration(generator, "20261005000008_checked.sql")
    result = generate(generator_copy)
    assert result.returncode != 0
    assert "Final check public.app_check_nothing() is not created by this bootstrap" in result.stderr


def test_a_marked_and_checked_migration_joins_the_acceptance_block(generator_copy):
    generator = generator_copy / "app/server_tools/public_bootstrap/generate_bootstrap.py"
    (generator_copy / "app/server_tools/migrations/20261005000008_checked.sql").write_text(
        "-- COMPLETION_MARKER: test_checked\n-- FINAL_CHECK: public.app_check_row_actor_marks()\nSELECT 1;\n")
    add_repair_migration(generator, "20261005000008_checked.sql")
    result = generate(generator_copy)
    assert result.returncode == 0, result.stderr
    seed = (generator_copy / "app/server_tools/public_bootstrap/seed_data.sql").read_text()
    assert "ARRAY['wl58_row_actor_support', 'wl58_row_actor_marks_by_table_uid', 'test_checked']::text[]" in seed
    assert seed.count("SELECT 'public.app_check_row_actor_marks(): ' || result "
                      "FROM public.app_check_row_actor_marks() AS result") == 1
