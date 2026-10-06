"""Verify favorites copy and fresh/upgrade parity on disposable PostgreSQL only.

Reuses the public language fixture and WL58's prior-release upgrade fixture.
The generated schema snapshot and bootstrap classes also have database-free checks.
"""
from pathlib import Path
import json

from test_field_settings_language_seed import database  # noqa: F401
from test_row_actor_support import cluster, installed, upgrade, value  # noqa: F401

APP = Path(__file__).resolve().parents[2]
MIGRATIONS = APP / "server_tools/migrations"
BOOTSTRAP = APP / "server_tools/public_bootstrap"
A = MIGRATIONS / "20261005000021_create_system_favorites.sql"
B = MIGRATIONS / "20261005000022_seed_favorites_language_keys.sql"
C = MIGRATIONS / "20261005000023_register_system_favorites.sql"
KEYS = ("favorites_heading", "favorite_add", "favorite_remove", "favorite_save_failed", "system_favorites")


def test_favorites_bootstrap_sources_and_schema_snapshot():
    schema = (BOOTSTRAP / "schema.sql").read_bytes()
    seed = (BOOTSTRAP / "seed_data.sql").read_text()
    assert schema == (APP / "server_tools/versioning/schema_snapshots/db-9.10.0.sql").read_bytes()
    assert A.read_bytes() in schema
    assert B.read_text() in seed and C.read_text() in seed
    assert seed.index(C.read_text()) > seed.index("INSERT INTO public.system_table_folders")
    manifest = json.loads((BOOTSTRAP / "manifest.json").read_text())
    assert "public.system_favorites" in manifest["allowed_schema_tables"]
    for path in (A, B, C):
        assert path.name in manifest["migration_ledger_baseline"]
        assert "-- VERSION_DB: 9.10.0" in path.read_text()
        assert "-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql" in path.read_text()
    assert "-- COMPLETION_MARKER: system_favorites_table" in A.read_text()
    assert "-- COMPLETION_MARKER: system_favorites_registry" in C.read_text()


def test_favorites_copy_preserves_site_translations_and_repeats(database):
    database("""CREATE TABLE system_languages (language_code text PRIMARY KEY);
        INSERT INTO system_languages VALUES ('fi'), ('en');""")
    database("""INSERT INTO system_lang_keys(lang_key,fi,en,creation_spec)
        VALUES ('favorite_add','Sivuston oma nimi','','oma');
        INSERT INTO system_lang_key_translations(lang_key_id,language_code,translation,source_kind,review_status)
        SELECT id,'fi','Tarkistettu nimi','manual','approved' FROM system_lang_keys WHERE lang_key='favorite_add';""")
    for _ in range(2):
        database(B.read_text())
    quoted = ",".join(f"'{key}'" for key in KEYS)
    assert database(f"SELECT count(*) FROM system_lang_keys WHERE lang_key IN ({quoted})") == "5"
    assert database(f"SELECT count(*) FROM system_lang_key_translations t JOIN system_lang_keys k ON k.id=t.lang_key_id WHERE k.lang_key IN ({quoted}) AND language_code IN ('fi','en') AND review_status='approved'") == "10"
    assert database("SELECT fi||'|'||en||'|'||creation_spec FROM system_lang_keys WHERE lang_key='favorite_add'") == "Sivuston oma nimi|Add to favorites|oma"
    assert database("SELECT translation FROM system_lang_key_translations WHERE language_code='fi' AND lang_key_id=(SELECT id FROM system_lang_keys WHERE lang_key='favorite_add')") == "Tarkistettu nimi"


def _favorite_metadata(run):
    return value(run, """SELECT jsonb_build_object(
        'columns', (SELECT jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull) ORDER BY attnum)
            FROM pg_attribute WHERE attrelid='system_favorites'::regclass AND attnum>0 AND NOT attisdropped),
        'constraints', (SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY conname) FROM pg_constraint WHERE conrelid='system_favorites'::regclass),
        'registry', (SELECT jsonb_agg(jsonb_build_array(t.table_name,f.folder_name,t.is_removable)) FROM system_db_tables t
            JOIN system_table_folders f ON f.id=t.folder_id WHERE t.table_name='system_favorites'),
        'metadata', (SELECT jsonb_agg(jsonb_build_array(column_name,data_type,insertable,editable_in_ui) ORDER BY co_number)
            FROM system_column_details WHERE table_uid=(SELECT table_uid FROM system_db_tables WHERE table_name='system_favorites')),
        'markers', (SELECT jsonb_agg(migration ORDER BY migration) FROM system_data_repair_records
            WHERE migration IN ('system_favorites_table','system_favorites_registry') AND action='completed'))""")


def test_fresh_and_previous_release_upgrade_have_same_favorites(installed, upgrade):
    # The shared upgrade fixture imports the actual 9.9.2 schema and seed. Run
    # its pending public release in creation order, as the application does.
    for migration in sorted(MIGRATIONS.glob("202610050000*.sql")):
        upgrade(migration.read_text())
    def assert_favorites_state(run):
        assert value(run, "SELECT count(*) FROM system_favorites") == "0"
        assert value(run, "SELECT count(*) FROM system_data_repair_records WHERE migration IN ('system_favorites_table','system_favorites_registry') AND action='completed'") == "2"
        assert value(run, "SELECT count(*) FROM system_lang_keys WHERE lang_key IN ('favorites_heading','favorite_add','favorite_remove','favorite_save_failed','system_favorites') AND NULLIF(btrim(fi),'') IS NOT NULL AND NULLIF(btrim(en),'') IS NOT NULL") == "5"
        assert value(run, "SELECT count(*) FROM system_lang_key_translations t JOIN system_lang_keys k ON k.id=t.lang_key_id WHERE k.lang_key IN ('favorites_heading','favorite_add','favorite_remove','favorite_save_failed','system_favorites') AND language_code IN ('fi','en')") == "10"
    # Inspect the original bootstrap and first upgrade before a rerun can repair either.
    for run in (installed, upgrade):
        assert_favorites_state(run)
    initial_metadata = _favorite_metadata(installed)
    assert initial_metadata == _favorite_metadata(upgrade)
    metadata = json.loads(initial_metadata)
    assert metadata["registry"] == [["system_favorites", "system", False]]
    assert metadata["markers"] == ["system_favorites_registry", "system_favorites_table"]
    assert len(metadata["columns"]) == len(metadata["metadata"]) == 7
    assert all(not insertable and not editable for _, _, insertable, editable in metadata["metadata"])

    for run in (installed, upgrade):
        for _ in range(2):
            run(A.read_text())
            run(B.read_text())
            run(C.read_text())
            assert_favorites_state(run)
            assert _favorite_metadata(run) == initial_metadata
