"""WL132 survivor schema, upgrade idempotence and bootstrap acceptance contracts."""
from pathlib import Path
import json

from test_login_name_postgres import cluster, installed, upgrade, value  # noqa: F401

APP = Path(__file__).resolve().parents[2]
MIGRATIONS = APP / "server_tools/migrations"
SURVIVOR = MIGRATIONS / "20261005000040_add_surviving_sign_in.sql"
BOOTSTRAP = APP / "server_tools/public_bootstrap"


def test_survivor_migration_and_bootstrap_contract():
    current_db = (APP / "VERSION_DB").read_text(encoding="utf-8").strip()
    sql = SURVIVOR.read_text()
    assert "-- VERSION_DB: 9.10.0" in sql
    assert "-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql" in sql
    assert "-- COMPLETION_MARKER: wl132_surviving_sign_in" in sql
    assert "INSERT INTO public.system_db_version" not in sql
    assert "ADD COLUMN IF NOT EXISTS surviving_sign_in_id text" in sql
    assert "ADD COLUMN IF NOT EXISTS surviving_sign_in_generation bigint" in sql
    schema = (BOOTSTRAP / "schema.sql").read_bytes()
    assert SURVIVOR.read_bytes() in schema
    assert schema == (APP / f"server_tools/versioning/schema_snapshots/db-{current_db}.sql").read_bytes()
    seed = (BOOTSTRAP / "seed_data.sql").read_text()
    acceptance = seed[seed.index("DO $filterest_acceptance$"):]
    assert "'wl132_surviving_sign_in'" in acceptance
    assert SURVIVOR.name in json.loads((BOOTSTRAP / "manifest.json").read_text())["migration_ledger_baseline"]


def survivor_shape(run):
    return value(run, """SELECT jsonb_agg(jsonb_build_array(attname,
        format_type(atttypid,atttypmod),attnotnull,atthasdef) ORDER BY attname)
        FROM pg_attribute WHERE attrelid='restricted.users_restricted'::regclass
        AND attname IN ('surviving_sign_in_id','surviving_sign_in_generation') AND NOT attisdropped""")


def test_survivor_upgrade_matches_bootstrap_and_rerun_preserves_state(installed, upgrade):
    for migration in sorted(MIGRATIONS.glob("202610050000*.sql")):
        if migration.name <= SURVIVOR.name:
            upgrade(migration.read_text())
    expected = [["surviving_sign_in_generation", "bigint", False, False],
                ["surviving_sign_in_id", "text", False, False]]
    assert json.loads(survivor_shape(installed)) == expected
    assert survivor_shape(installed) == survivor_shape(upgrade)
    for run in (installed, upgrade):
        run("""INSERT INTO system_users(id,username,enabled) VALUES(91002,'survivor_display',true);
            INSERT INTO restricted.users_restricted(id,password,email,login_name,authentication_generation,
                surviving_sign_in_id,surviving_sign_in_generation)
            VALUES(91002,'fixture_hash','survivor@example.invalid','survivor_login',4,'opaque_sign_in',4)""")
        before = value(run, "SELECT to_jsonb(ur)::text FROM restricted.users_restricted ur WHERE id=91002")
        run(SURVIVOR.read_text())
        run(SURVIVOR.read_text())
        assert value(run, "SELECT to_jsonb(ur)::text FROM restricted.users_restricted ur WHERE id=91002") == before
        assert value(run, "SELECT count(*) FROM system_data_repair_records WHERE migration='wl132_surviving_sign_in' AND action='completed'") == "1"
