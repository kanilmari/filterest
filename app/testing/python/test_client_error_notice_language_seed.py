"""test_client_error_notice_language_seed.py
Verify the WO35 generic notice on install, upgrade and replay.
Connect the DB 9.12.0 migration to runtime fallbacks and generated bootstrap.
Keep disposable PostgreSQL proofs explicit; never change a running site.
"""
import json
from pathlib import Path

import pytest

from test_field_settings_language_seed import database  # noqa: F401

APP = Path(__file__).resolve().parents[2]
MIGRATION = APP / "server_tools/migrations/20261015000007_seed_client_error_notice_language_key.sql"
BOOTSTRAP = APP / "server_tools/public_bootstrap"
FI = "Sovelluksessa tapahtui virhe. Kokeile ladata sivu uudelleen."
EN = "The application ran into an error. Try reloading the page."


def test_seed_matches_fallback_and_fresh_install_packaging():
    sql = MIGRATION.read_text()
    fallback = (APP / "frontend/core_components/error_and_status_handling/error_monitor_handler_helpers.js").read_text()
    assert FI in sql and EN in sql and FI in fallback and EN in fallback
    assert "-- VERSION_DB: 9.12.0" in sql
    owner = "20261015000099_record_database_release_9_12_0.sql"
    assert f"-- VERSION_DB_OWNER: {owner}" in sql and MIGRATION.name < owner
    assert "system_db_version" not in sql
    assert sql in (BOOTSTRAP / "seed_data.sql").read_text()
    assert MIGRATION.name in (BOOTSTRAP / "generate_bootstrap.py").read_text()
    assert MIGRATION.name in json.loads((BOOTSTRAP / "manifest.json").read_text())["migration_ledger_baseline"]


def snapshot(database):
    return database("""SELECT jsonb_build_array(
        (SELECT jsonb_agg(k ORDER BY lang_key) FROM system_lang_keys k),
        (SELECT jsonb_agg(t ORDER BY lang_key_id,language_code) FROM system_lang_key_translations t),
        (SELECT jsonb_agg(s ORDER BY lang_key_id,source_type,source_high) FROM system_lang_key_sources s))""")


@pytest.mark.parametrize("store", ["new", "columns", "normalized", "both"])
def test_notice_fills_empty_copy_preserves_site_copy_and_replays(database, store):
    database("CREATE TABLE system_languages(language_code text PRIMARY KEY); INSERT INTO system_languages VALUES('fi'),('en');")
    if store != "new":
        fi, en = ("Sivuston ilmoitus", "Site notice") if store != "normalized" else (" ", "")
        database(f"INSERT INTO system_lang_keys(lang_key,fi,en) VALUES('client_error_notice','{fi}','{en}')")
        if store != "columns":
            database("""INSERT INTO system_lang_key_translations(lang_key_id,language_code,translation,source_kind,review_status)
                SELECT id,copy.code,copy.text,'manual','approved' FROM system_lang_keys
                CROSS JOIN (VALUES('fi','Sivuston ilmoitus'),('en','Site notice')) copy(code,text)""")
    database(MIGRATION.read_text())
    expected = (FI, EN) if store == "new" else ("Sivuston ilmoitus", "Site notice")
    assert database("SELECT fi||'|'||en FROM system_lang_keys WHERE lang_key='client_error_notice'") == "|".join(expected)
    assert database("SELECT string_agg(translation,'|' ORDER BY language_code DESC) FROM system_lang_key_translations") == "|".join(expected)
    assert database("SELECT count(*) FROM system_lang_key_sources WHERE NULLIF(btrim(usage_explanation),'') IS NOT NULL") == "1"
    before = snapshot(database)
    database(MIGRATION.read_text())
    assert snapshot(database) == before
    assert database("SELECT count(*) FROM system_db_version") == "0"
