"""test_dataset_appearance_bootstrap.py
Proves private WL160 storage is included, accepted and repeatable in bootstrap.
Connects the reviewed migration with fresh and pre-slice-2 disposable databases.
Never connects to an installation database or uses protected credentials.
"""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

import pytest
from test_front_page_bootstrap import cluster, installed  # noqa: F401
from test_row_actor_support import value

APP = Path(__file__).resolve().parents[2]
ROOT = APP.parent
BOOTSTRAP = APP / "server_tools/public_bootstrap"
MIGRATIONS = APP / "server_tools/migrations"
MIGRATION = MIGRATIONS / "20261009000003_create_system_dataset_appearance.sql"
CUTOVER = MIGRATIONS / "20261009000040_cut_over_dataset_card_appearance.sql"
OWNER = MIGRATIONS / "20261009000099_record_database_release_9_10_2.sql"
BASE = "e314e34"


def test_dataset_appearance_migration_version_and_generated_artifacts():
    sql = MIGRATION.read_text()
    assert "-- VERSION_DB: 9.10.2" in sql
    assert f"-- VERSION_DB_OWNER: {OWNER.name}" in sql
    assert MIGRATION.name < OWNER.name
    assert "-- COMPLETION_MARKER: system_dataset_appearance_table" in sql
    assert "-- FINAL_CHECK: public.app_check_dataset_appearance_storage()" in sql
    assert "system_db_version" not in sql
    assert "card_style_variant" not in sql and "card_detail_columns" not in sql
    assert sql in (BOOTSTRAP / "schema.sql").read_text()
    assert (BOOTSTRAP / "schema.sql").read_bytes() == (APP / "server_tools/versioning/schema_snapshots/db-9.10.2.sql").read_bytes()
    assert (APP / "VERSION_DB").read_text().strip() == "9.10.2"
    manifest = json.loads((BOOTSTRAP / "manifest.json").read_text())
    assert manifest["db_version"] == "9.10.2"
    assert "public.system_dataset_appearance" in manifest["allowed_schema_tables"]
    assert "public.system_dataset_appearance" not in manifest["allowed_seed_tables"]
    assert MIGRATION.name in manifest["migration_ledger_baseline"]
    acceptance = (BOOTSTRAP / "seed_data.sql").read_text().split("DO $filterest_acceptance$", 1)[1]
    assert "'system_dataset_appearance_table'" in acceptance
    assert "FROM public.app_check_dataset_appearance_storage() AS result" in acceptance
    for name, metadata in manifest["source_files"].items():
        path = ROOT / name.removeprefix("filterest/")
        assert hashlib.sha256(path.read_bytes()).hexdigest() == metadata["sha256"], name
    for name, metadata in manifest["generated_files"].items():
        assert hashlib.sha256((APP / name).read_bytes()).hexdigest() == metadata["sha256"], name


def test_dataset_appearance_bootstrap_regeneration_is_exact(tmp_path):
    result = subprocess.run([sys.executable, str(BOOTSTRAP / "generate_bootstrap.py"), "--target", str(tmp_path)],
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    for name in ("schema.sql", "seed_data.sql", "manifest.json"):
        assert (tmp_path / "app/server_tools/public_bootstrap" / name).read_bytes() == (BOOTSTRAP / name).read_bytes()


@pytest.fixture
def appearance_upgrade(cluster):
    """Existing main's unreleased 9.10.2 package, before the slice 2 table exists."""
    cluster("CREATE DATABASE appearance_upgrade")
    for name in ("schema.sql", "seed_data.sql"):
        original = subprocess.run(["git", "show", f"{BASE}:app/server_tools/public_bootstrap/{name}"],
                                  cwd=ROOT, capture_output=True, text=True, check=True).stdout
        cluster(original, "appearance_upgrade")

    def run(sql, check=True):
        return cluster(sql, "appearance_upgrade", check)

    assert value(run, "SELECT to_regclass('public.system_dataset_appearance') IS NULL") == "t"
    return run


def appearance_shape(run):
    return value(run, """SELECT jsonb_build_object(
        'columns', (SELECT jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull)
            ORDER BY attnum) FROM pg_attribute WHERE attrelid='system_dataset_appearance'::regclass
            AND attnum>0 AND NOT attisdropped),
        'constraints', (SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY conname)
            FROM pg_constraint WHERE conrelid='system_dataset_appearance'::regclass),
        'markers', (SELECT count(*) FROM system_data_repair_records
            WHERE migration='system_dataset_appearance_table' AND action='completed'),
        'registry', (SELECT count(*) FROM system_db_tables WHERE table_name='system_dataset_appearance'),
        'check', (SELECT count(*) FROM app_check_dataset_appearance_storage()))""")


def test_dataset_appearance_fresh_upgrade_and_twice_replay(installed, appearance_upgrade):
    appearance_upgrade(MIGRATION.read_text())
    appearance_upgrade(CUTOVER.read_text())
    appearance_upgrade(OWNER.read_text())
    expected = appearance_shape(installed)
    assert expected == appearance_shape(appearance_upgrade)
    shape = json.loads(expected)
    assert len(shape["columns"]) == 4 and len(shape["constraints"]) == 6
    assert shape["registry"] == shape["check"] == 0 and shape["markers"] == 1
    for run in (installed, appearance_upgrade):
        assert value(run, "SELECT count(*) FROM system_dataset_appearance") == "0"
        uid = value(run, "SELECT table_uid FROM system_db_tables WHERE table_name='tiketit'")
        run(f"INSERT INTO system_dataset_appearance(table_uid,overrides,revision) VALUES({uid},"
            "'{\"light.image_blur\":0,\"light.oval_enabled\":false,\"shared.card_detail_columns\":2}',7)")
        for _ in range(2):
            run(MIGRATION.read_text())
            run(CUTOVER.read_text())
            run(OWNER.read_text())
            assert appearance_shape(run) == expected
            assert value(run, "SELECT revision||':'||overrides FROM system_dataset_appearance") == \
                '7:{"light.image_blur": 0, "light.oval_enabled": false, "shared.card_detail_columns": 2}'
            assert value(run, "SELECT count(*) FROM app_check_dataset_card_appearance_cutover()") == "0"
            assert value(run, "SELECT count(*) FROM system_db_version WHERE version='9.10.2'") == "1"
        run("UPDATE system_dataset_appearance SET overrides='{}',revision=8")
        run(MIGRATION.read_text())
        assert value(run, "SELECT revision||':'||overrides FROM system_dataset_appearance") == "8:{}"


def test_dataset_appearance_upgrade_refuses_malformed_existing_table(appearance_upgrade):
    # CREATE TABLE IF NOT EXISTS keeps a pre-existing table, so the migration's own final check must refuse a same-named
    # permissive constraint before it records completion.
    appearance_upgrade("""CREATE TABLE public.system_dataset_appearance (
        table_uid integer PRIMARY KEY REFERENCES public.system_db_tables(table_uid) ON DELETE CASCADE,
        schema_version integer NOT NULL DEFAULT 1, overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
        revision bigint NOT NULL DEFAULT 1,
        CONSTRAINT ck_system_dataset_appearance_schema_version CHECK (schema_version = 1),
        CONSTRAINT ck_system_dataset_appearance_object CHECK (jsonb_typeof(overrides) = 'object'),
        CONSTRAINT ck_system_dataset_appearance_no_null CHECK (true),
        CONSTRAINT ck_system_dataset_appearance_revision CHECK (revision > 0))""")
    result = appearance_upgrade(MIGRATION.read_text(), check=False)
    assert result.returncode != 0
    assert "dataset appearance storage final check refused" in result.stderr
    assert value(appearance_upgrade, "SELECT count(*) FROM system_data_repair_records "
                                     "WHERE migration='system_dataset_appearance_table'") == "0"


@pytest.mark.parametrize("fault", ["marker", "check"])
def test_dataset_appearance_bootstrap_refuses_missing_proof(cluster, fault):
    cluster("CREATE DATABASE appearance_broken")
    schema = (BOOTSTRAP / "schema.sql").read_text()
    if fault == "marker":
        schema = schema.replace("SELECT 'system_dataset_appearance_table', 'completed',",
                                "SELECT 'system_dataset_appearance_missing', 'completed',")
    cluster(schema, "appearance_broken")
    if fault == "check":
        cluster("ALTER TABLE system_dataset_appearance DROP CONSTRAINT ck_system_dataset_appearance_no_null", "appearance_broken")
    result = cluster((BOOTSTRAP / "seed_data.sql").read_text(), "appearance_broken", check=False)
    assert result.returncode != 0
    assert ("missing completion markers: system_dataset_appearance_table" if fault == "marker"
            else "bootstrap import failed its final checks") in result.stderr
    assert cluster("SELECT count(*) FROM system_schema_migrations", "appearance_broken").stdout.strip() == "0"
    assert cluster("SELECT count(*) FROM system_db_version", "appearance_broken").stdout.strip() == "0"
