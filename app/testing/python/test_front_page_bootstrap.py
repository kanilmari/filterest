"""Verify WL143 bootstrap classes, translation copy and fresh/9.9.2 upgrade parity.

Reuses the row-actor disposable cluster and its historical upgrade fixture.
Sandbox-denied Unix sockets skip the database proof; source checks still run.
"""
from pathlib import Path
import hashlib
import json
import subprocess

import pytest
from test_row_actor_support import cluster as _cluster, installed, upgrade, value  # noqa: F401

APP = Path(__file__).resolve().parents[2]
MIGRATIONS = APP / "server_tools/migrations"
BOOTSTRAP = APP / "server_tools/public_bootstrap"
FILES = tuple(MIGRATIONS / name for name in (
    "20261005000030_create_front_page_revision_metadata.sql",
    "20261005000031_create_system_front_page_blocks.sql",
    "20261005000032_add_front_page_settings.sql",
    "20261005000033_seed_front_page_language_keys.sql",
    "20261005000034_register_system_front_page_blocks.sql",
    "20261005000085_add_front_page_show_blocks.sql",
    "20261005000086_seed_front_page_hero_language_keys.sql",
))


@pytest.fixture
def cluster():
    generator = _cluster.__wrapped__()
    try:
        try:
            runner = next(generator)
        except (pytest.fail.Exception, subprocess.CalledProcessError) as error:
            detail = str(error) + str(getattr(error, "stderr", ""))
            if "Operation not permitted" in detail or "Permission denied" in detail:
                pytest.skip("sandbox cannot start disposable PostgreSQL Unix socket")
            raise
        yield runner
    finally:
        generator.close()


def test_front_page_bootstrap_classes_and_exact_schema_snapshot():
    schema = (BOOTSTRAP / "schema.sql").read_bytes()
    seed = (BOOTSTRAP / "seed_data.sql").read_text()
    # The generated schema always equals the snapshot of the database version it targets (9.10.0 when WL143 shipped).
    version = (APP / "VERSION_DB").read_text().strip()
    assert schema == (APP / f"server_tools/versioning/schema_snapshots/db-{version}.sql").read_bytes()
    for migration in FILES[:2]:
        assert migration.read_bytes() in schema
    for migration in FILES[2:]:
        assert migration.read_text() in seed
    manifest = json.loads((BOOTSTRAP / "manifest.json").read_text())
    assert "public.system_front_page_blocks" in manifest["allowed_schema_tables"]
    assert "public.system_front_page_revisions" in manifest["allowed_schema_tables"]
    for migration in FILES:
        assert migration.name in manifest["migration_ledger_baseline"]
        assert "-- VERSION_DB: 9.10.0" in migration.read_text()
        assert "-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql" in migration.read_text()
    assert "-- COMPLETION_MARKER: system_front_page_revisions_table" in FILES[0].read_text()
    assert "-- COMPLETION_MARKER: system_front_page_blocks_table" in FILES[1].read_text()
    assert "-- COMPLETION_MARKER: system_front_page_blocks_registry" in FILES[4].read_text()
    assert "UNIQUE NULLS NOT DISTINCT (user_id, table_uid)" in schema.decode()
    assert "UNIQUE NULLS NOT DISTINCT (user_id, sort_order)" in schema.decode()


def test_front_page_bootstrap_source_and_generated_hashes():
    manifest = json.loads((BOOTSTRAP / "manifest.json").read_text())
    for name, metadata in manifest["source_files"].items():
        source = APP.parent / name.removeprefix("filterest/")
        assert hashlib.sha256(source.read_bytes()).hexdigest() == metadata["sha256"], name
    for name, metadata in manifest["generated_files"].items():
        assert hashlib.sha256((APP / name).read_bytes()).hexdigest() == metadata["sha256"], name


def test_front_page_legacy_revisions_normalize_keep_greatest_and_repeat(upgrade):
    # An upgrade runs 9.10.0's earlier files first; they create the completion-marker table this file writes to.
    for earlier in sorted(MIGRATIONS.glob("202610050000*.sql")):
        if earlier.name < FILES[0].name:
            upgrade(earlier.read_text())
    # These synthetic rows live only in the historical disposable upgrade fixture.
    upgrade("""INSERT INTO system_users (id,username) VALUES
        (42,'front_page_legacy_42'),(73,'front_page_legacy_73'),(74,'front_page_deleted_74');
        DELETE FROM system_users WHERE id=74;
        INSERT INTO system_config (key,text_value) VALUES
        ('front_page_scope_version:0','2026-10-01T00:00:00Z'),
        ('front_page_scope_version:00','2026-10-04T00:00:00Z'),
        ('front_page_scope_version:42','2026-10-02T00:00:00Z'),
        ('front_page_scope_version:042','2026-10-06T00:00:00Z'),
        ('front_page_scope_version:00042','2026-10-03T00:00:00Z'),
        ('front_page_scope_version:73','2026-10-05T00:00:00Z'),
        ('front_page_scope_version:074','2026-10-07T00:00:00Z'),
        ('front_page_scope_version:1','2026-10-07T00:00:00Z'),
        ('front_page_scope_version:0042','not a revision'),
        ('front_page_scope_version:000042',NULL),
        ('front_page_scope_version:0000042',''),
        ('front_page_scope_version:9223372036854775808','2026-10-07T00:00:00Z'),
        ('front_page_scope_version:abc','2026-10-07T00:00:00Z'),
        ('front_page_scope_version:-42','2026-10-07T00:00:00Z'),
        ('front_page_scope_version:','2026-10-07T00:00:00Z'),
        ('front_page_scope_versions:42','untouched');""")
    migration = FILES[0].read_text()
    snapshot_query = """SELECT jsonb_agg(jsonb_build_array(user_id,
        to_char(revision AT TIME ZONE 'UTC','YYYY-MM-DD')) ORDER BY user_id NULLS FIRST)
        FROM system_front_page_revisions"""
    upgrade(migration)
    expected = [[None, "2026-10-04"], [42, "2026-10-06"], [73, "2026-10-05"]]
    assert json.loads(value(upgrade, snapshot_query)) == expected
    records = value(upgrade, "SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM system_data_repair_records r")
    assert value(upgrade, "SELECT count(*) FROM system_config WHERE left(key,25)='front_page_scope_version:'") == "0"
    assert value(upgrade, "SELECT text_value FROM system_config WHERE key='front_page_scope_versions:42'") == "untouched"
    for _ in range(2):
        upgrade(migration)
        assert json.loads(value(upgrade, snapshot_query)) == expected
        assert value(upgrade, "SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM system_data_repair_records r") == records
    # Upserts preserve a protected newer value and advance an older one.
    upgrade("""INSERT INTO system_config (key,text_value) VALUES
        ('front_page_scope_version:42','2026-10-01T00:00:00Z'),
        ('front_page_scope_version:042','2026-10-02T00:00:00Z'),
        ('front_page_scope_version:73','2026-10-06T00:00:00Z'),
        ('front_page_scope_version:073','2026-10-07T00:00:00Z');""")
    upgrade(migration)
    expected[2][1] = "2026-10-07"
    assert json.loads(value(upgrade, snapshot_query)) == expected
    upgrade(migration)
    assert json.loads(value(upgrade, snapshot_query)) == expected


def _shape(run):
    return value(run, """SELECT jsonb_build_object(
        'columns', (SELECT jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull) ORDER BY attnum)
            FROM pg_attribute WHERE attrelid='system_front_page_blocks'::regclass AND attnum>0 AND NOT attisdropped),
        'constraints', (SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY conname)
            FROM pg_constraint WHERE conrelid='system_front_page_blocks'::regclass),
        'revision_constraints', (SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY conname)
            FROM pg_constraint WHERE conrelid='system_front_page_revisions'::regclass),
        'registry', (SELECT jsonb_agg(jsonb_build_array(t.table_name,f.folder_name,t.is_removable)) FROM system_db_tables t
            JOIN system_table_folders f ON f.id=t.folder_id WHERE t.table_name='system_front_page_blocks'),
        'metadata', (SELECT jsonb_agg(jsonb_build_array(column_name,data_type,insertable,editable_in_ui) ORDER BY co_number)
            FROM system_column_details WHERE table_uid=(SELECT table_uid FROM system_db_tables WHERE table_name='system_front_page_blocks')),
        'settings', (SELECT jsonb_agg(jsonb_build_array(key,boolean_value,json_value,text_value,value_type) ORDER BY key)
            FROM system_config WHERE key IN ('separate_front_page','front_page_button_shows_site_name')),
        'markers', (SELECT jsonb_agg(migration ORDER BY migration) FROM system_data_repair_records
            WHERE migration IN ('system_front_page_blocks_table','system_front_page_blocks_registry') AND action='completed'))""")


def test_front_page_fresh_install_and_992_upgrade_match_and_repeat(installed, upgrade):
    for migration in sorted(MIGRATIONS.glob("202610050000*.sql")):
        upgrade(migration.read_text())
    original = _shape(installed)
    assert original == _shape(upgrade)
    shape = json.loads(original)
    assert len(shape["columns"]) == len(shape["metadata"]) == 8
    assert shape["registry"] == [["system_front_page_blocks", "system", False]]
    assert shape["markers"] == ["system_front_page_blocks_registry", "system_front_page_blocks_table"]
    for run in (installed, upgrade):
        assert value(run, "SELECT count(*) FROM system_front_page_blocks") == "0"
        assert value(run, "SELECT count(*) FROM system_front_page_revisions") == "0"
        assert value(run, "SELECT count(*) FROM system_db_tables WHERE table_name='system_front_page_revisions'") == "0"
        assert value(run, "SELECT count(*) FROM system_config WHERE left(key,25)='front_page_scope_version:'") == "0"
        assert value(run, "SELECT count(*) FROM system_row_actor_columns WHERE table_uid=(SELECT table_uid FROM system_db_tables WHERE table_name='system_front_page_blocks')") == "0"
        assert value(run, "SELECT relrowsecurity FROM pg_class WHERE oid='system_front_page_blocks'::regclass") == "f"
        assert value(run, "SELECT count(*) FROM system_lang_keys WHERE lang_key='front_page' AND fi='Etusivu' AND en='Home'") == "1"
        assert value(run, "SELECT count(*) FROM system_lang_key_translations t JOIN system_lang_keys k ON k.id=t.lang_key_id WHERE k.lang_key='front_page' AND language_code IN ('fi','en')") == "2"
        for _ in range(2):
            for migration in FILES:
                run(migration.read_text())
            assert _shape(run) == original
        # Re-running defaults or copy must never overwrite a site's accepted values.
        run("UPDATE system_config SET boolean_value=true WHERE key='separate_front_page'")
        run("UPDATE system_lang_keys SET fi='Sivuston koti' WHERE lang_key='front_page'")
        for migration in FILES[2:4]:
            run(migration.read_text())
        assert value(run, "SELECT boolean_value FROM system_config WHERE key='separate_front_page'") == "t"
        assert value(run, "SELECT fi FROM system_lang_keys WHERE lang_key='front_page'") == "Sivuston koti"


DESCRIPTION = MIGRATIONS / "20261009000001_seed_front_page_description_language_key.sql"
DESCRIPTION_OWNER = MIGRATIONS / "20261009000099_record_database_release_9_10_2.sql"


def test_home_description_release_and_generated_bootstrap():
    sql = DESCRIPTION.read_text()
    assert "-- VERSION_DB: 9.10.2" in sql
    assert f"-- VERSION_DB_OWNER: {DESCRIPTION_OWNER.name}" in sql
    assert DESCRIPTION.name < DESCRIPTION_OWNER.name
    assert "SELECT '9.10.2'" in DESCRIPTION_OWNER.read_text()
    assert "site_front_page_description" in sql and "usage_explanation" in sql
    assert sql in (BOOTSTRAP / "seed_data.sql").read_text()
    assert (BOOTSTRAP / "schema.sql").read_bytes() == (APP / "server_tools/versioning/schema_snapshots/db-9.10.2.sql").read_bytes()
    manifest = json.loads((BOOTSTRAP / "manifest.json").read_text())
    assert manifest["db_version"] == "9.10.2"
    assert DESCRIPTION.name in manifest["migration_ledger_baseline"]
    assert DESCRIPTION_OWNER.name in manifest["migration_ledger_baseline"]
    assert (APP / "VERSION_DB").read_text().strip() == "9.10.2"


def test_home_description_fresh_upgrade_repeat_and_reviewed_copy(installed, upgrade):
    for migration in sorted(MIGRATIONS.glob("202610050000*.sql")):
        upgrade(migration.read_text())
    upgrade(DESCRIPTION.read_text())
    query = """SELECT jsonb_agg(jsonb_build_array(k.lang_key,k.fi,k.en,t.language_code,t.translation)
        ORDER BY k.lang_key,t.language_code) FROM system_lang_keys k
        LEFT JOIN system_lang_key_translations t ON t.lang_key_id=k.id
        WHERE k.lang_key IN ('site_front_page_description','slogan','front_page_hero','front_page_hero_help')"""
    expected = value(installed, query)
    assert expected == value(upgrade, query)
    for run in (installed, upgrade):
        for _ in range(2):
            run(DESCRIPTION.read_text())
            assert value(run, query) == expected
        assert value(run, "SELECT count(*) FROM system_lang_key_sources s JOIN system_lang_keys k ON k.id=s.lang_key_id WHERE k.lang_key='site_front_page_description' AND source_type='front_page_hero' AND length(usage_explanation)>40") == "1"
        run("""UPDATE system_lang_keys SET fi='Oma kuvaus',en='Reviewed description' WHERE lang_key='site_front_page_description';
            INSERT INTO system_lang_key_translations(lang_key_id,language_code,translation,source_kind,review_status)
                SELECT id,'fi','Oma tarkistettu kuvaus','manual','approved' FROM system_lang_keys WHERE lang_key='site_front_page_description';
            UPDATE system_lang_key_sources SET usage_explanation='Reviewed explanation' WHERE source_high='site_front_page_description';""")
        for _ in range(2):
            run(DESCRIPTION.read_text())
        assert value(run, "SELECT fi||'|'||en FROM system_lang_keys WHERE lang_key='site_front_page_description'") == "Oma kuvaus|Reviewed description"
        assert value(run, "SELECT translation FROM system_lang_key_translations t JOIN system_lang_keys k ON k.id=t.lang_key_id WHERE k.lang_key='site_front_page_description' AND language_code='fi'") == "Oma tarkistettu kuvaus"
        assert value(run, "SELECT usage_explanation FROM system_lang_key_sources WHERE source_high='site_front_page_description'") == "Reviewed explanation"
