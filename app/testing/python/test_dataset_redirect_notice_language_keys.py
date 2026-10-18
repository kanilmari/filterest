# test_dataset_redirect_notice_language_keys.py
# Verifies redirect copy packaging, replay and fresh/upgrade equality.
# Connects the DB 9.12.0 Finnish/English seed to bootstrap and toast startup copy.
# Keeps reviewed site translations intact; PostgreSQL proofs are explicitly opt-in.

import json
from pathlib import Path
import re

import pytest

from test_field_settings_language_seed import database  # noqa: F401
from test_row_actor_support import cluster, installed, value  # noqa: F401

APP = Path(__file__).resolve().parents[2]
MIGRATIONS = APP / "server_tools/migrations"
MIGRATION = MIGRATIONS / "20261015000014_seed_redirect_notice_language_keys.sql"
RELEASE_RECORD = MIGRATIONS / "20261015000099_record_database_release_9_12_0.sql"
BOOTSTRAP = APP / "server_tools/public_bootstrap"
STARTUP_COPY = APP / "frontend/core_components/navigation/dataset_redirect_notice_copy.js"


def authored_keys():
    return {key: (fi.replace("''", "'"), en.replace("''", "'")) for key, fi, en in re.findall(
        r"\('(dataset_redirect_[^']+)', '((?:''|[^'])*)', '((?:''|[^'])*)'\)", MIGRATION.read_text())}


def startup_copy():
    return {key: (fi, en) for key, fi, en in re.findall(
        r'(dataset_redirect_\w+): \{\s*fi: "([^"]*)",\s*en: "([^"]*)",\s*\}', STARTUP_COPY.read_text())}


def test_redirect_notice_copy_bootstrap_and_frontend_keys():
    keys = authored_keys()
    assert set(keys) == {"dataset_redirect_missing_named", "dataset_redirect_missing",
                         "dataset_redirect_deleted_named", "dataset_redirect_deleted"}
    for key, texts in keys.items():
        assert all(text and ("$table_name" in text) == key.endswith("_named") for text in texts), key
    assert startup_copy() == keys
    sql = MIGRATION.read_text()
    assert "-- VERSION_DB: 9.12.0" in sql
    assert f"-- VERSION_DB_OWNER: {RELEASE_RECORD.name}" in sql
    assert "system_db_version" not in sql and MIGRATION.name < RELEASE_RECORD.name
    assert "creation_spec" in sql and "system_lang_key_sources" in sql
    assert "('fi', s.fi), ('en', s.en)" in sql
    assert sql in (BOOTSTRAP / "seed_data.sql").read_text()
    ledger = json.loads((BOOTSTRAP / "manifest.json").read_text())["migration_ledger_baseline"]
    assert {MIGRATION.name, RELEASE_RECORD.name} <= set(ledger)
    generator = (BOOTSTRAP / "generate_bootstrap.py").read_text()
    assert MIGRATION.name in re.search(r"language_seed_migrations = \((.*?)\n\)", generator, re.S)[1]
    assert RELEASE_RECORD.name in re.search(r"release_record_migrations = \((.*?)\n\)", generator, re.S)[1]
    handler = (APP / "frontend/core_components/navigation/root_redirect_handler.js").read_text()
    assert not any(text in handler for texts in keys.values() for text in texts)
    assert "data-lang-variable" in handler and "content.textContent = notice.message" in handler
    catalogue = APP / "frontend/core_components/lang/local_translation_fallback_catalog.js"
    assert "DATASET_REDIRECT_NOTICE_TRANSLATION_FALLBACKS" in catalogue.read_text()
    translator = (APP / "frontend/core_components/lang/translation_handler.js").read_text()
    assert "import { LOCAL_TRANSLATION_FALLBACKS } from './local_translation_fallback_catalog.js'" in translator
    # Publishing refuses growth beyond this handler's legacy main baseline.
    assert len(translator.splitlines()) <= 916


def snapshot(database):
    return database("""SELECT jsonb_build_array(
        (SELECT jsonb_agg(k ORDER BY lang_key) FROM system_lang_keys k),
        (SELECT jsonb_agg(t ORDER BY lang_key_id,language_code) FROM system_lang_key_translations t),
        (SELECT jsonb_agg(s ORDER BY lang_key_id,source_type,source_high) FROM system_lang_key_sources s))""")


@pytest.mark.parametrize("store", ["new", "blank", "columns", "normalized", "both"])
def test_redirect_notice_migration_twice_preserves_reviewed_copy(database, store):
    database("CREATE TABLE system_languages(language_code text PRIMARY KEY); INSERT INTO system_languages VALUES('fi'),('en');")
    if store != "new":
        fi, en = ("Oma $table_name", "Own $table_name") if store in {"columns", "both"} else (" ", "")
        database(f"""INSERT INTO system_lang_keys(lang_key,fi,en,creation_spec)
            VALUES('dataset_redirect_missing_named','{fi}','{en}','reviewed');""")
        if store in {"normalized", "both", "blank"}:
            fi, en = ("Tarkistettu $table_name", "Reviewed $table_name") if store != "blank" else (" ", "")
            database(f"""INSERT INTO system_lang_key_translations(lang_key_id,language_code,translation,source_kind,review_status)
                SELECT id,copy.code,copy.text,'manual','approved' FROM system_lang_keys
                CROSS JOIN (VALUES('fi','{fi}'),('en','{en}')) copy(code,text);""")
    database(MIGRATION.read_text())
    expected = authored_keys()["dataset_redirect_missing_named"] if store in {"new", "blank"} else (
        ("Tarkistettu $table_name", "Reviewed $table_name") if store == "normalized" else ("Oma $table_name", "Own $table_name"))
    assert database("SELECT fi||'|'||en FROM system_lang_keys WHERE lang_key='dataset_redirect_missing_named'") == "|".join(expected)
    normalized = ("Tarkistettu $table_name", "Reviewed $table_name") if store == "both" else expected
    assert database("""SELECT string_agg(translation,'|' ORDER BY language_code DESC)
        FROM system_lang_key_translations WHERE lang_key_id=(SELECT id FROM system_lang_keys
        WHERE lang_key='dataset_redirect_missing_named')""") == "|".join(normalized)
    assert database("SELECT count(*) FROM system_lang_keys WHERE NULLIF(btrim(creation_spec),'') IS NOT NULL") == "4"
    assert database("SELECT count(*) FROM system_lang_key_sources WHERE NULLIF(btrim(usage_explanation),'') IS NOT NULL") == "4"
    assert database("SELECT count(*) FROM system_lang_key_translations WHERE review_status='approved'") == "8"
    before = snapshot(database)
    database(MIGRATION.read_text())
    assert snapshot(database) == before
    assert database("SELECT count(*) FROM system_db_version") == "0"
    if store != "new":
        assert database("SELECT creation_spec FROM system_lang_keys WHERE lang_key='dataset_redirect_missing_named'") == "reviewed"


def test_redirect_notice_fresh_bootstrap_equals_upgrade_and_repeat(installed, database):
    # Compare a full fresh install with the upgrade of an unseeded language store.
    database("CREATE TABLE system_languages(language_code text PRIMARY KEY); INSERT INTO system_languages VALUES('fi'),('en');")
    database(MIGRATION.read_text())
    keys = ",".join(f"'{key}'" for key in authored_keys())
    query = f"""SELECT jsonb_agg(jsonb_build_array(k.lang_key,k.fi,k.en,t.language_code,t.translation,t.review_status)
        ORDER BY k.lang_key,t.language_code) FROM system_lang_keys k JOIN system_lang_key_translations t ON t.lang_key_id=k.id
        WHERE k.lang_key IN ({keys}) AND t.language_code IN ('fi','en')"""
    initial = value(installed, query)
    assert initial == database(query)
    assert len(json.loads(initial)) == 8
    assert value(installed, "SELECT count(*) FROM system_db_version WHERE version='9.12.0'") == "1"
    for _ in range(2):
        installed(MIGRATION.read_text())
        database(MIGRATION.read_text())
        assert value(installed, query) == initial == database(query)
