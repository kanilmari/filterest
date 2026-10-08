# test_multiselect_language_keys.py
# Verifies shared multiselect copy packaging, replay and fresh/upgrade equality.
# Connects the DB 9.10.1 Finnish/English seed to bootstrap and its column-filter consumer.
# Keeps reviewed translations intact while isolated PostgreSQL checks remain opt-in.

import json
from pathlib import Path
import re

from test_field_settings_language_seed import database  # noqa: F401
from test_row_actor_support import cluster, installed, upgrade, value  # noqa: F401

APP = Path(__file__).resolve().parents[2]
MIGRATION = APP / "server_tools/migrations/20261007000002_seed_multiselect_language_keys.sql"
BOOTSTRAP = APP / "server_tools/public_bootstrap"


def authored_keys():
    return {key: (fi, en) for key, fi, en in re.findall(
        r"\('([^']+)', '((?:''|[^'])*)', '((?:''|[^'])*)'\)", MIGRATION.read_text())}


def test_multiselect_copy_bootstrap_and_frontend_keys():
    keys = authored_keys()
    assert keys == {"selected": ("valittu", "selected"), "excluded": ("poissuljettu", "excluded"),
                    "no_results": ("Ei tuloksia", "No results"), "clear_selection": ("Tyhjennä valinta", "Clear selection")}
    source = (APP / "frontend/core_components/filterbar/filter_list/filter_column_input_builder.js").read_text()
    assert all(f"getTranslationForKey('{key}')" in source for key in keys)
    assert "searchPlaceholder: getTranslationForKey('search')" in source
    sql = MIGRATION.read_text()
    assert "-- VERSION_DB: 9.10.1" in sql
    assert "-- VERSION_DB_OWNER: 20261007000099_record_database_release_9_10_1.sql" in sql
    assert "system_db_version" not in sql and "UPDATE" not in sql and "ON CONFLICT" not in sql
    assert sql in (BOOTSTRAP / "seed_data.sql").read_text()
    assert MIGRATION.name in json.loads((BOOTSTRAP / "manifest.json").read_text())["migration_ledger_baseline"]
    generator = (BOOTSTRAP / "generate_bootstrap.py").read_text()
    assert MIGRATION.name in re.search(r"language_seed_migrations = \((.*?)\n\)", generator, re.S)[1]
    assert "('fi', served.fi), ('en', served.en)" in sql


def test_multiselect_migration_twice_preserves_reviewed_copy(database):
    database("CREATE TABLE system_languages(language_code text PRIMARY KEY); INSERT INTO system_languages VALUES('fi'),('en');")
    database("""INSERT INTO system_lang_keys(lang_key,fi,en,creation_spec)
        VALUES('selected','Oma valinta','My choice','reviewed');
        INSERT INTO system_lang_key_translations(lang_key_id,language_code,translation,source_kind,review_status)
        SELECT id,'fi','Tarkistettu','manual','approved' FROM system_lang_keys WHERE lang_key='selected';""")
    for _ in range(2):
        database(MIGRATION.read_text())
    keys = ",".join(f"'{key}'" for key in authored_keys())
    assert database(f"SELECT count(*) FROM system_lang_keys WHERE lang_key IN ({keys})") == "4"
    assert database(f"SELECT count(*) FROM system_lang_key_translations t JOIN system_lang_keys k ON k.id=t.lang_key_id WHERE k.lang_key IN ({keys}) AND language_code IN ('fi','en')") == "8"
    assert database("SELECT fi||'|'||en FROM system_lang_keys WHERE lang_key='selected'") == "Oma valinta|My choice"
    assert database("SELECT translation FROM system_lang_key_translations WHERE language_code='fi' AND lang_key_id=(SELECT id FROM system_lang_keys WHERE lang_key='selected')") == "Tarkistettu"
    assert database("SELECT count(*) FROM system_db_version") == "0"


def test_multiselect_fresh_bootstrap_equals_upgrade_and_repeat(installed, upgrade):
    migrations = APP / "server_tools/migrations"
    for migration in sorted(migrations.glob("202610050000*.sql")):
        upgrade(migration.read_text())
    upgrade(MIGRATION.read_text())
    keys = ",".join(f"'{key}'" for key in authored_keys())
    query = f"""SELECT jsonb_agg(jsonb_build_array(k.lang_key,k.fi,k.en,t.language_code,t.translation,t.review_status)
        ORDER BY k.lang_key,t.language_code) FROM system_lang_keys k JOIN system_lang_key_translations t ON t.lang_key_id=k.id
        WHERE k.lang_key IN ({keys}) AND t.language_code IN ('fi','en')"""
    initial = value(installed, query)
    assert initial == value(upgrade, query)
    assert len(json.loads(initial)) == 8
    for run in (installed, upgrade):
        for _ in range(2):
            run(MIGRATION.read_text())
            assert value(run, query) == initial
