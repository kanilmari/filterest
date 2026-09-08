"""Verify reviewed picker copy across fresh and upgraded language catalogs.

Uses a disposable database with non-numeric authored translation keys.
Connects the source seed and versioned migration without touching live settings.
Preserves site copy while supplying clear original-page and clipboard wording.
"""
from pathlib import Path
from test_field_settings_language_seed import database

APP = Path(__file__).resolve().parents[2]
SEED = APP / "server_tools/public_bootstrap/source/image_picker.lang_keys.sql"
MIGRATION = APP / "server_tools/migrations/20260908000007_seed_image_picker_copy.sql"


def test_picker_seed_and_upgrade_preserve_site_copy_and_repeat(database):
    assert SEED.read_text() in MIGRATION.read_text()
    database("INSERT INTO system_lang_keys(lang_key,fi,en) VALUES ('see_original_page','  Oma lähdesivu  ','');")
    database(SEED.read_text())
    assert database("SELECT count(*) FROM system_lang_keys") == "11"
    assert database("SELECT count(*) FROM system_lang_key_translations") == "22"
    database(MIGRATION.read_text())
    database(MIGRATION.read_text())
    assert database("SELECT '['||fi||']|'||en FROM system_lang_keys WHERE lang_key='see_original_page'") == "[  Oma lähdesivu  ]|See original page"
    assert database("SELECT count(*) FROM system_db_version WHERE version='9.7.10'") == "1"
