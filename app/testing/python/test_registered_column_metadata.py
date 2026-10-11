"""test_registered_column_metadata.py
Exercise missing permission metadata and the held-lock proof's baseline offline.
Run the shipped completion SELECT and fixture preparation against in-memory rows.
Keep scoped creation independent of incidental whole-catalogue repair.
"""
from pathlib import Path
import re
import sqlite3

import pytest

from bootstrap_contract_assertions import assert_bootstrap_baseline

APP = Path(__file__).resolve().parents[2]
BOOTSTRAP = APP / "server_tools/public_bootstrap"
MIGRATION = APP / "server_tools/migrations/20261009000082_complete_registered_column_metadata.sql"
AUTOMATIC_REFRESH_TEST = APP / "backend/core_components/runtime_grants/automatic_refresh_reads_postgres_test.go"


def catalogue_rows():
    """Match the missing bootstrap rows; emulate only PostgreSQL catalogue functions."""
    db = sqlite3.connect(":memory:")
    db.execute("ATTACH DATABASE ':memory:' AS public")
    db.execute("ATTACH DATABASE ':memory:' AS pg_catalog")
    db.executescript("""
        CREATE TABLE public.system_db_tables(table_uid INTEGER, table_name TEXT, schema_name TEXT);
        CREATE TABLE public.system_column_details(
            table_uid INTEGER, column_name TEXT, data_type TEXT, co_number INTEGER,
            card_element TEXT, show_key_on_card BOOLEAN, editable_in_ui BOOLEAN DEFAULT TRUE,
            UNIQUE(table_uid,column_name));
        CREATE TABLE pg_catalog.pg_attribute(
            attrelid INTEGER, attname TEXT, atttypid INTEGER, atttypmod INTEGER,
            attnum INTEGER, attisdropped BOOLEAN);
        INSERT INTO public.system_db_tables VALUES
            (204,'system_db_tables','public'),(217,'system_functions','public'),
            (220,'system_user_group_memberships','public'),
            (209,'spatial_ref_sys','public'),(216,'payments','public'),(990,NULL,'public');
        INSERT INTO pg_catalog.pg_attribute VALUES
            (204,'table_name',25,-1,2,FALSE),(204,'table_uid',23,-1,3,FALSE),
            (217,'name',25,-1,2,FALSE),(220,'group_id',23,-1,3,FALSE),
            (217,'disabled',16,-1,4,FALSE),(217,'old_dropped',25,-1,5,TRUE),
            (217,'ctid',25,-1,-1,FALSE);
        INSERT INTO public.system_column_details VALUES
            (217,'disabled','authored diagnostic',999,'hidden',TRUE,FALSE);
    """)
    physical = {"public.system_db_tables": 204, "public.system_functions": 217,
                "public.system_user_group_memberships": 220}
    db.create_function("format", 3, lambda _, schema, name: f"{schema}.{name}")
    db.create_function("to_regclass", 1, physical.get)
    db.create_function("format_type", 2, lambda oid, _: {25: "text", 23: "integer", 16: "boolean"}[oid])
    return db


def complete_columns(db):
    seed = (BOOTSTRAP / "seed_data.sql").read_text()
    match = re.search(r"DO \$registered_columns\$.*?INSERT INTO public\.system_column_details\s+(.*?);", seed, re.S)
    assert match, "bootstrap leaves permission columns missing after scoped creation"
    # SQLite runs the real INSERT/SELECT, joins, filters and defaults. Only the
    # namespace of the catalogue formatting function differs between engines.
    db.execute("INSERT INTO public.system_column_details " + match[1].replace("pg_catalog.format_type", "format_type"))


@pytest.mark.parametrize("hook,uid,column", [
    ("unrelated administrator save", 217, "name"),
    ("dataset rename", 204, "table_name"),
    ("automation endpoint rename", 204, "table_name"),
    ("following membership save", 220, "group_id"),
])
def test_bootstrap_completes_permission_columns_without_creation_refresh(hook, uid, column):
    with catalogue_rows() as db:
        source = (APP / "backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_update/update_row.go").read_text()
        lookup = re.search(r"func isColumnEditable\(.*?query := `(.*?)`", source, re.S).group(1)
        parameters = {"1": uid, "2": column}
        assert db.execute(lookup, parameters).fetchone() is None
        complete_columns(db)
        assert db.execute(lookup, parameters).fetchone() == (True,), hook
        complete_columns(db)  # Replay does not duplicate columns or overwrite permissions.
        assert db.execute("SELECT data_type,co_number,card_element,editable_in_ui FROM system_column_details WHERE column_name='disabled'").fetchone() == ("authored diagnostic", 999, "hidden", False)
        assert db.execute(lookup, {"1": 204, "2": "table_uid"}).fetchone() == (False,)
        assert db.execute("SELECT count(*) FROM system_column_details WHERE column_name IN ('ctid','old_dropped') OR table_uid IN (209,216)").fetchone() == (0,)


def test_completion_is_part_of_fresh_and_upgrade_evidence():
    seed = (BOOTSTRAP / "seed_data.sql").read_text()
    assert MIGRATION.read_text() in seed
    assert MIGRATION.name in (BOOTSTRAP / "generate_bootstrap.py").read_text()
    assert_bootstrap_baseline(seed, MIGRATION)


def test_held_lock_proof_starts_with_a_current_catalogue():
    # Exercise the actual setup statements of the PostgreSQL proof. Its old
    # bootstrap contained these optional registry entries without their tables.
    schema = (BOOTSTRAP / "schema.sql").read_text()
    for name in ("spatial_ref_sys", "payments"):
        assert not re.search(rf"CREATE TABLE (?:IF NOT EXISTS )?public\.{name}\b", schema)
    source = AUTOMATIC_REFRESH_TEST.read_text().split("func TestAutomaticRefreshReadsDuringHeldPolicyLockPostgres", 1)[1]
    setup = source.split('uid := fixture.create("refresh_probe"', 1)[0]
    with catalogue_rows() as db:
        for statement in re.findall(r"runtime_grants.FixtureExec\(t, fixture.owner, `(.*?)`\)", setup, re.S):
            db.execute(statement)
        dangling = db.execute("SELECT table_name FROM system_db_tables WHERE table_name IS NOT NULL AND to_regclass(format('%I.%I',schema_name,table_name)) IS NULL").fetchall()
        assert dangling == [], f"initial refresh affects old blockers before the held-lock proof: {dangling}"
