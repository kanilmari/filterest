"""test_database_identity_postgres.py
Prove fresh and upgraded identity storage matches the original native installer.
Connect the migration and real setup SQL to the existing disposable PostgreSQL harness.
Verify byte preservation, future timestamp behavior, grants and replay without live access.
"""
import json
from pathlib import Path

import pytest

from row_actor_support_contracts import cluster
from test_database_identity_schema import APP, BOOTSTRAP, MIGRATION, NAME, ROOT

ORIGINAL = Path(__file__).parent / "fixtures/database_identity_installer.sql"
NATIVE = APP / "server_tools/lib/setup_native_database.sh"
EXPORT = APP / "server_tools/installation_conformance/schema_drift_export.sql"


def migrate(run, sql=None, check=True):
    return run("BEGIN;\n" + (MIGRATION.read_text() if sql is None else sql) + "\nCOMMIT;", check=check)


def identity_values(run):
    # record_send proves the stored bytes of all twelve values, including NULL,
    # multilingual text, timestamps and ids; tuple location/xmin detect rewrites.
    return run("SELECT encode(record_send(identity), 'hex'), ctid, xmin "
               "FROM public.system_database_identity identity ORDER BY id").stdout


def sequence_state(run):
    return run("SELECT last_value, is_called FROM public.system_database_identity_id_seq").stdout


def catalogue(run):
    output = json.loads(run(EXPORT.read_text()).stdout)
    return output[0]["schema_catalogue"] if isinstance(output, list) else output


def identity_schema(run):
    return run("""
        SELECT json_build_object(
          'columns', (SELECT json_agg(json_build_array(attname, format_type(atttypid, atttypmod),
                     attnotnull, attidentity, attgenerated, pg_get_expr(adbin, adrelid)) ORDER BY attnum)
                FROM pg_attribute LEFT JOIN pg_attrdef ON adrelid=attrelid AND adnum=attnum
                WHERE attrelid='public.system_database_identity'::regclass AND attnum>0 AND NOT attisdropped),
          'constraints', (SELECT json_agg(json_build_array(conname,pg_get_constraintdef(oid),convalidated) ORDER BY conname)
                FROM pg_constraint WHERE conrelid='public.system_database_identity'::regclass),
          'indexes', (SELECT json_agg(json_build_array(indexrelid::regclass::text,pg_get_indexdef(indexrelid),indisvalid) ORDER BY indexrelid::regclass::text)
                FROM pg_index WHERE indrelid='public.system_database_identity'::regclass),
          'triggers', (SELECT json_agg(json_build_array(tgname,pg_get_triggerdef(oid),tgenabled) ORDER BY tgname)
                FROM pg_trigger WHERE tgrelid='public.system_database_identity'::regclass AND NOT tgisinternal),
          'function', (SELECT json_build_array(prosrc,prosecdef,proconfig,provolatile)
                FROM pg_proc WHERE oid='public.set_system_database_identity_updated_timestamp()'::regprocedure))
    """).stdout


def setup_row_sql():
    source = NATIVE.read_text()
    start = source.index('run_local_db_psql_stdin "Database identity initialization"')
    sql = source[source.index("\nINSERT INTO system_database_identity", start):]
    sql = sql[:sql.index("\nSQL\n")]
    return "\\set required_db_version 9.10.2\n\\set app_version 9.3.23\n" + sql


@pytest.fixture
def original_shape(cluster):
    cluster("CREATE DATABASE original")
    cluster(ORIGINAL.read_text(), "original")
    return identity_schema(lambda sql: cluster(sql, "original"))


@pytest.mark.parametrize("origin", ["legacy", "public_bootstrap"])
@pytest.mark.parametrize("present", [False, True])
def test_upgrade_and_replay_preserve_values_and_match_installer(cluster, original_shape, origin, present):
    cluster("CREATE DATABASE upgraded")
    def run(sql, check=True):
        return cluster(sql, "upgraded", check)
    if origin == "public_bootstrap":
        # Emulate the previous bootstrap's absence, keeping the full product
        # support/ledger/seed around it. This destructive SQL is fixture-only.
        run((BOOTSTRAP / "schema.sql").read_text())
        run((BOOTSTRAP / "seed_data.sql").read_text())
        run("DROP TABLE public.system_database_identity; "
            "DROP FUNCTION public.set_system_database_identity_updated_timestamp(); "
            "DROP FUNCTION public.app_check_database_identity_schema(); "
            "DELETE FROM public.system_data_repair_records WHERE migration='wl167_database_identity_schema'; "
            f"DELETE FROM public.system_schema_migrations WHERE filename='{NAME}'")
    if present:
        run(ORIGINAL.read_text())
        run("""
            INSERT INTO public.system_database_identity
              (id,singleton_key,database_id,database_role,source_database_id,source_db_version,
               source_app_version,source_git_commit,notes,created,updated,last_refresh_at)
            VALUES (41,true,'0123456789abcdef0123456789abcdef','custom_role',NULL,'9.7.15',
              '9.3.8','abc123','Identity ä Ω 中文 with newline' || chr(10) || 'and tab' || chr(9),
              '2024-02-29 03:04:05.123456+02','2025-03-04 05:06:07.234567+02',NULL);
            SELECT setval('public.system_database_identity_id_seq', 93, true);
            CREATE ROLE identity_custom_readonly;
            GRANT SELECT ON public.system_database_identity TO identity_custom_readonly;
            REVOKE ALL ON FUNCTION public.set_system_database_identity_updated_timestamp() FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION public.set_system_database_identity_updated_timestamp() TO identity_custom_readonly;
        """)
        before = identity_values(run)
        frontier = sequence_state(run)
        acls = run("SELECT relacl FROM pg_class WHERE oid='public.system_database_identity'::regclass").stdout
        function_acl = run("SELECT proacl FROM pg_proc WHERE oid='public.set_system_database_identity_updated_timestamp()'::regprocedure").stdout
        # Repair missing keys, wrong defaults, nullability and an incorrectly
        # defined/disabled updater without running any update against the row.
        run("""
            ALTER TABLE public.system_database_identity ALTER COLUMN notes DROP NOT NULL,
              ALTER COLUMN notes SET DEFAULT 'wrong',
              ALTER COLUMN source_database_id SET DEFAULT 'wrong',
              DROP CONSTRAINT system_database_identity_singleton_key_key;
            CREATE OR REPLACE FUNCTION public.set_system_database_identity_updated_timestamp()
              RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$;
            ALTER TABLE public.system_database_identity DISABLE TRIGGER set_system_database_identity_updated;
        """)
    migrate(run)
    assert identity_schema(run) == original_shape
    assert run("SELECT count(*) FROM public.app_check_database_identity_schema()").stdout.strip() == "0"
    if present:
        assert identity_values(run) == before
        assert sequence_state(run) == frontier
        assert run("SELECT relacl FROM pg_class WHERE oid='public.system_database_identity'::regclass").stdout == acls
        assert run("SELECT proacl FROM pg_proc WHERE oid='public.set_system_database_identity_updated_timestamp()'::regprocedure").stdout == function_acl
    else:
        assert run("SELECT count(*) FROM public.system_database_identity").stdout.strip() == "0"
    state = identity_values(run), sequence_state(run), identity_schema(run)
    migrate(run)
    assert (identity_values(run), sequence_state(run), identity_schema(run)) == state
    # Run the real native setup INSERT twice: populated imports retain every
    # byte; empty imports receive exactly the setup-specific versions and note.
    run(setup_row_sql())
    initialized = identity_values(run)
    run(setup_row_sql())
    assert identity_values(run) == initialized
    if present:
        assert initialized == before
    else:
        row = run("SELECT database_role,source_db_version,source_app_version,notes "
                  "FROM public.system_database_identity").stdout
        assert row.startswith("legacy_unclassified|9.10.2|9.3.23|Initialized by setup_local_dev_environment.sh")
    run("UPDATE public.system_database_identity SET notes=notes || ' changed', updated='2001-01-01';")
    assert run("SELECT updated>'2001-01-02' FROM public.system_database_identity").stdout.strip() == "t"
    if origin == "public_bootstrap":
        assert run("SELECT count(*) FROM public.system_data_repair_records "
                   "WHERE migration='wl167_database_identity_schema' AND action='completed'").stdout.strip() == "1"


def test_fresh_bootstrap_and_native_first_row_pass_real_reference_inventory(cluster, original_shape):
    from server_tools.installation_conformance.schema_drift_catalogue import verify_reference
    cluster("CREATE DATABASE fresh")
    def run(sql, check=True):
        return cluster(sql, "fresh", check)
    run((BOOTSTRAP / "schema.sql").read_text())
    run((BOOTSTRAP / "seed_data.sql").read_text())
    assert identity_schema(run) == original_shape
    assert run("SELECT count(*) FROM public.system_database_identity").stdout.strip() == "0"
    before = identity_schema(run), sequence_state(run)
    migrate(run)
    assert (identity_schema(run), sequence_state(run)) == before
    assert verify_reference(catalogue(run), ROOT)["ledger_evidence"] == "bootstrap_baseline"
    run(setup_row_sql())
    assert verify_reference(catalogue(run), ROOT)["ledger_evidence"] == "bootstrap_baseline"


def test_incompatible_existing_values_refuse_without_mutation(cluster):
    cluster("CREATE DATABASE incompatible")
    def run(sql, check=True):
        return cluster(sql, "incompatible", check)
    run(ORIGINAL.read_text())
    run("ALTER TABLE public.system_database_identity ALTER COLUMN notes DROP NOT NULL; "
        "INSERT INTO public.system_database_identity(notes) VALUES(NULL);")
    before = identity_values(run), identity_schema(run), sequence_state(run)
    result = migrate(run, check=False)
    assert result.returncode != 0
    assert "null" in result.stderr.lower()
    assert (identity_values(run), identity_schema(run), sequence_state(run)) == before


def test_original_updater_on_another_table_does_not_hide_the_missing_identity_trigger(cluster):
    cluster("CREATE DATABASE trigger_scope")
    def run(sql, check=True):
        return cluster(sql, "trigger_scope", check)
    run(ORIGINAL.read_text())
    run("DROP TRIGGER set_system_database_identity_updated ON public.system_database_identity; "
        "CREATE TABLE public.unrelated(updated timestamptz); "
        "CREATE TRIGGER set_system_database_identity_updated BEFORE UPDATE ON public.unrelated "
        "FOR EACH ROW EXECUTE FUNCTION public.set_system_database_identity_updated_timestamp();")
    migrate(run)
    assert run("SELECT count(*) FROM pg_trigger WHERE tgname='set_system_database_identity_updated'").stdout.strip() == "2"
    assert run("SELECT count(*) FROM public.app_check_database_identity_schema()").stdout.strip() == "0"
