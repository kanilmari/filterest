"""Verify the optional field layout on fresh and upgraded PostgreSQL metadata.

Connects the public migration to the real SQL constraint and localized settings copy.
Protects inherited behavior and existing site translations across repeated upgrades.
"""
from pathlib import Path
import subprocess

import pytest
from test_field_settings_language_seed import database

APP = Path(__file__).resolve().parents[2]
MIGRATION = APP / "server_tools/migrations/20260908000003_add_column_label_value_layout.sql"

def test_layout_migration_keeps_inheritance_constraints_and_site_copy(database):
    database("""
        CREATE TABLE system_column_details (
            column_uid BIGINT PRIMARY KEY, column_name TEXT, card_element TEXT
        );
        INSERT INTO system_column_details VALUES (903, 'link', 'details_link');
        INSERT INTO system_lang_keys (lang_key, fi, en, creation_spec)
        VALUES ('label_value_layout', '  Oma nimi  ', '', '  Own context  ');
    """)
    database(MIGRATION.read_text())
    assert database("SELECT label_value_layout IS NULL FROM system_column_details") == "t"
    assert database("SELECT card_element FROM system_column_details") == "details_link"
    for value in ("auto", "inline", "stacked"):
        database(f"UPDATE system_column_details SET label_value_layout='{value}'")
        assert database("SELECT label_value_layout FROM system_column_details") == value
    database(MIGRATION.read_text())
    assert database("SELECT label_value_layout FROM system_column_details") == "stacked"
    for invalid in ("unknown", "", "INLINE"):
        with pytest.raises(subprocess.CalledProcessError):
            database(f"UPDATE system_column_details SET label_value_layout='{invalid}'")
    database("UPDATE system_column_details SET label_value_layout=NULL")
    assert database("SELECT label_value_layout IS NULL FROM system_column_details") == "t"
    assert database("SELECT '['||fi||']' FROM system_lang_keys WHERE lang_key='label_value_layout'") == "[  Oma nimi  ]"
    assert database("SELECT count(*) FROM system_lang_keys WHERE lang_key LIKE 'label_value_layout%'") == "7"
    assert database("SELECT count(*) FROM system_lang_key_translations") == "14"
    assert database("SELECT count(*) FROM system_db_version WHERE version='9.7.6'") == "1"


def test_fresh_public_layout_seed_matches_upgrade_and_is_repeatable(database):
    source = APP / "server_tools/public_bootstrap/source/label_value_layout.lang_keys.sql"
    start = "-- BEGIN label/value layout language seed (shared with fresh bootstrap)."
    end = "-- END label/value layout language seed."
    def block(text):
        return text[text.index(start):text.index(end) + len(end)]
    canonical = block(MIGRATION.read_text())
    assert block(source.read_text()) == canonical
    database(canonical)
    database(canonical)
    assert database("SELECT count(*) FROM system_lang_keys WHERE lang_key LIKE 'label_value_layout%'") == "7"
    assert database("SELECT count(*) FROM system_lang_key_translations") == "14"
    assert database("SELECT count(*) FROM system_lang_keys WHERE NULLIF(btrim(fi),'') IS NULL OR NULLIF(btrim(en),'') IS NULL") == "0"
    assert database("SELECT count(*) FROM system_db_version") == "0"
