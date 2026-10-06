"""Heading migrations, copy, constraints and fresh/upgrade parity.

Only opt-in disposable PostgreSQL fixtures may execute SQL. Database-free
checks also hold both completion markers and generated source hashes to account.
"""
import json
from pathlib import Path
import re

import pytest
from test_field_settings_language_seed import database  # noqa: F401
from test_row_actor_support import cluster, installed, upgrade, value, refused  # noqa: F401

APP = Path(__file__).resolve().parents[2]
MIGRATIONS = APP / "server_tools/migrations"
BOOTSTRAP = APP / "server_tools/public_bootstrap"
A = MIGRATIONS / "20261005000035_add_row_group_classifications.sql"
B = MIGRATIONS / "20261005000036_seed_row_group_classification_language_keys.sql"
C = MIGRATIONS / "20261005000037_register_row_group_classifications.sql"
MARKERS = ("wl103_row_group_classifications", "wl103_row_group_classifications_registry")
KEYS = ("row_group_categories", "row_group_class_single", "row_group_category_multiple",
        "row_group_classes_and_categories", "system_row_group_classifications")


def test_heading_bootstrap_classes_markers_and_snapshot():
    schema = (BOOTSTRAP / "schema.sql").read_bytes()
    seed = (BOOTSTRAP / "seed_data.sql").read_text()
    manifest = json.loads((BOOTSTRAP / "manifest.json").read_text())
    generator = (BOOTSTRAP / "generate_bootstrap.py").read_text()
    assert schema == (APP / "server_tools/versioning/schema_snapshots/db-9.10.0.sql").read_bytes()
    assert A.read_bytes() in schema and B.read_text() in seed and C.read_text() in seed
    assert "public.system_row_group_classifications" in manifest["allowed_schema_tables"]
    assert "public.system_row_group_classifications" not in manifest["allowed_seed_tables"]
    for path, bootstrap_class in ((A, "repair_schema_migrations"), (B, "language_seed_migrations"), (C, "release_data_migrations")):
        assert path.name in re.search(rf"{bootstrap_class} = \((.*?)\n\)", generator, re.S).group(1)
        assert path.name in manifest["migration_ledger_baseline"]
        assert "-- VERSION_DB: 9.10.0" in path.read_text()
        assert "-- VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql" in path.read_text()
    acceptance = seed[seed.index("DO $filterest_acceptance$"):]
    for marker, path in zip(MARKERS, (A, C)):
        assert f"-- COMPLETION_MARKER: {marker}" in path.read_text()
        assert f"'{marker}'" in acceptance
    assert acceptance.index("missing completion markers") < acceptance.index("INSERT INTO public.system_schema_migrations")
    assert "WL103" in (MIGRATIONS / "20261005000099_record_database_release_9_10_0.sql").read_text()


def test_heading_copy_repeats_without_overwriting_reviewed_translations(database):
    database("CREATE TABLE system_languages (language_code text PRIMARY KEY); INSERT INTO system_languages VALUES ('fi'),('en');")
    database("""INSERT INTO system_lang_keys(lang_key,fi,en,creation_spec)
        VALUES ('row_group_categories','Oma otsikko','','oma');
        INSERT INTO system_lang_key_translations(lang_key_id,language_code,translation,source_kind,review_status)
        SELECT id,'fi','Tarkistettu otsikko','manual','approved' FROM system_lang_keys WHERE lang_key='row_group_categories';""")
    for _ in range(2):
        database(B.read_text())
    keys = ",".join(f"'{key}'" for key in KEYS)
    assert database(f"SELECT count(*) FROM system_lang_keys WHERE lang_key IN ({keys})") == "5"
    assert database(f"SELECT count(*) FROM system_lang_key_translations t JOIN system_lang_keys k ON k.id=t.lang_key_id WHERE k.lang_key IN ({keys}) AND language_code IN ('fi','en') AND review_status='approved'") == "10"
    assert database("SELECT fi||'|'||en FROM system_lang_keys WHERE lang_key='row_group_categories'") == "Oma otsikko|Categories"
    assert database("SELECT translation FROM system_lang_key_translations WHERE language_code='fi' AND lang_key_id=(SELECT id FROM system_lang_keys WHERE lang_key='row_group_categories')") == "Tarkistettu otsikko"


def _heading_metadata(run):
    return value(run, """SELECT jsonb_build_object(
        'columns', (SELECT jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull) ORDER BY attnum)
            FROM pg_attribute WHERE attrelid='system_row_group_classifications'::regclass AND attnum>0 AND NOT attisdropped),
        'constraints', (SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY conname) FROM pg_constraint WHERE conrelid='system_row_group_classifications'::regclass),
        'value_metadata', (SELECT jsonb_agg(jsonb_build_array(column_name,data_type,lang_key,insertable,editable_in_ui))
            FROM system_column_details WHERE column_name='classification_id' AND table_uid=(SELECT table_uid FROM system_db_tables WHERE table_name='system_row_groups')),
        'value_reference', (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='system_row_groups'::regclass AND confrelid='system_row_group_classifications'::regclass),
        'index', (SELECT indexdef FROM pg_indexes WHERE indexname='idx_system_row_groups_classification'),
        'triggers', (SELECT jsonb_agg(pg_get_triggerdef(oid) ORDER BY tgname) FROM pg_trigger WHERE tgrelid='system_row_group_classifications'::regclass AND NOT tgisinternal),
        'registry', (SELECT jsonb_agg(jsonb_build_array(t.table_name,f.folder_name,t.is_removable)) FROM system_db_tables t
            JOIN system_table_folders f ON f.id=t.folder_id WHERE t.table_name='system_row_group_classifications'),
        'metadata', (SELECT jsonb_agg(jsonb_build_array(column_name,data_type,insertable,editable_in_ui) ORDER BY co_number)
            FROM system_column_details WHERE table_uid=(SELECT table_uid FROM system_db_tables WHERE table_name='system_row_group_classifications')),
        'markers', (SELECT jsonb_agg(migration ORDER BY migration) FROM system_data_repair_records
            WHERE migration IN ('wl103_row_group_classifications','wl103_row_group_classifications_registry') AND action='completed'))""")


def test_heading_fresh_install_equals_previous_release_upgrade_and_migrations_repeat(installed, upgrade):
    for migration in sorted(MIGRATIONS.glob("202610050000*.sql")):
        upgrade(migration.read_text())
    initial = _heading_metadata(installed)
    assert initial == _heading_metadata(upgrade)
    metadata = json.loads(initial)
    assert metadata["registry"] == [["system_row_group_classifications", "system", False]]
    assert metadata["markers"] == list(MARKERS)
    assert len(metadata["columns"]) == len(metadata["metadata"]) == 8
    assert all(not insertable and not editable for _, _, insertable, editable in metadata["metadata"])
    assert "ON DELETE RESTRICT" in metadata["value_reference"]
    assert metadata["value_metadata"] == [["classification_id", "bigint", "system_row_group_classifications", False, False]]
    assert len(metadata["triggers"]) == 1
    keys = ",".join(f"'{key}'" for key in KEYS)
    for run in (installed, upgrade):
        assert value(run, "SELECT count(*) FROM system_row_group_classifications") == "0"
        assert value(run, f"SELECT count(*) FROM system_lang_keys WHERE lang_key IN ({keys}) AND NULLIF(btrim(fi),'') IS NOT NULL AND NULLIF(btrim(en),'') IS NOT NULL") == "5"
        assert value(run, "SELECT count(*) FROM system_row_actor_columns WHERE table_uid=(SELECT table_uid FROM system_db_tables WHERE table_name='system_row_group_classifications')") == "0"
        assert value(run, "SELECT count(*) FROM app_check_row_actor_marks()") == "0"
        for _ in range(2):
            for path in (A, B, C):
                run(path.read_text())
            assert _heading_metadata(run) == initial


@pytest.mark.parametrize("column,bad_value", [("slug", "'Bad'"), ("slug", "'a b'"), ("slug", "repeat('a',65)"),
    ("title", "'{}'::jsonb"), ("title", "'[]'::jsonb"), ("title", "'null'::jsonb"),
    ("sort_order", "-100001"), ("sort_order", "100001")])
def test_heading_checks_reject_invalid_values(installed, column, bad_value):
    values = {"slug": "'valid'", "title": "'{\"en\":\"Heading\"}'::jsonb", "sort_order": "0"}
    values[column] = bad_value
    refused(installed, f"INSERT INTO system_row_group_classifications(slug,title,sort_order) VALUES ({values['slug']},{values['title']},{values['sort_order']})", "check constraint")


def test_heading_fk_restrict_and_updated_trigger(installed):
    installed("""INSERT INTO system_row_group_classifications(slug,title,updated) VALUES ('transport','{"en":"Transport"}','2000-01-01');
        INSERT INTO system_row_groups(slug,title,classification_id)
        SELECT 'boat','{"en":"Boat"}',id FROM system_row_group_classifications WHERE slug='transport';""")
    refused(installed, "DELETE FROM system_row_group_classifications WHERE slug='transport'", "foreign key constraint")
    installed("UPDATE system_row_group_classifications SET title='{\"en\":\"Travel\"}' WHERE slug='transport'")
    assert value(installed, "SELECT updated > '2000-01-01' FROM system_row_group_classifications WHERE slug='transport'") == "t"


@pytest.mark.parametrize("marker", MARKERS)
def test_heading_acceptance_refuses_either_missing_marker(installed, marker):
    installed(f"DELETE FROM system_data_repair_records WHERE migration='{marker}'")
    installed("TRUNCATE system_schema_migrations,system_db_version")
    seed = (BOOTSTRAP / "seed_data.sql").read_text()
    result = installed(seed[seed.index("DO $filterest_acceptance$"):], check=False)
    assert result.returncode != 0 and marker in result.stderr
    assert value(installed, "SELECT count(*) FROM system_schema_migrations") == "0"
    assert value(installed, "SELECT count(*) FROM system_db_version") == "0"
