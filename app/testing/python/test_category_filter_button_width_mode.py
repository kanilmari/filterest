"""test_category_filter_button_width_mode.py
Prove one category button default across upgrades and fresh installations.
Connect the setting migration, release owner and bootstrap evidence.
Replay proofs use disposable PostgreSQL; SQLite checks the foreign key offline.
"""
from contextlib import closing
import hashlib
import json
from pathlib import Path
import re
import sqlite3

import pytest

from test_field_settings_language_seed import database  # noqa: F401

APP = Path(__file__).resolve().parents[2]
MIGRATION = APP / 'server_tools/migrations/20261030000346_add_category_filter_button_width_mode.sql'
KEY = 'category_filter_button_width_mode'
DEFAULT = 'fill_row_with_centered_label'
CONFIG_SCHEMA = '''
CREATE TABLE system_config_value_data_types (id INT PRIMARY KEY);
INSERT INTO system_config_value_data_types VALUES (1),(2),(3),(4),(5);
CREATE TABLE system_config (key TEXT PRIMARY KEY, boolean_value BOOLEAN,
    json_value JSONB, text_value TEXT, value_type INT, creation_spec TEXT,
    CONSTRAINT fk_system_config_value_type FOREIGN KEY (value_type)
        REFERENCES system_config_value_data_types(id));
'''


def release_owner():
    return MIGRATION.parent / re.search(r'^-- VERSION_DB_OWNER: (.+)$', MIGRATION.read_text(), re.M)[1]


def test_one_versioned_text_default_and_last_release_owner():
    source = MIGRATION.read_text()
    version = re.search(r'^-- VERSION_DB: (.+)$', source, re.M)[1]
    assert version == '9.13.4'
    assert release_owner().name > MIGRATION.name
    assert f'-- VERSION_DB: {version}' in release_owner().read_text()
    assert f"SELECT '{version}'," in release_owner().read_text()
    assert f"WHERE version = '{version}'" in release_owner().read_text()
    assert f"SELECT '{KEY}', NULL, '{{\"value\":\"{DEFAULT}\"}}'::jsonb, '{DEFAULT}', NULL," in source
    assert f"WHERE NOT EXISTS (SELECT 1 FROM public.system_config WHERE key = '{KEY}')" in source
    assert not re.search(r'\b(?:UPDATE|DELETE)\s+(?:public\.)?system_config', source, re.I)
    assert 'system_lang_key' not in source


def test_fresh_bootstrap_contains_exact_default_and_migration_evidence():
    bootstrap = APP / 'server_tools/public_bootstrap'
    seed = (bootstrap / 'seed_data.sql').read_text()
    manifest = json.loads((bootstrap / 'manifest.json').read_text())
    assert MIGRATION.read_text() in seed
    assert manifest['db_version'] == (APP / 'VERSION_DB').read_text().strip()
    for path in (MIGRATION, release_owner()):
        assert path.name in manifest['migration_ledger_baseline']
        assert hashlib.sha256(path.read_bytes()).hexdigest() in seed


def test_replay_foreign_key_rejects_type_6_and_accepts_null_offline():
    # Only PostgreSQL's schema qualifier and JSON cast need adapting for SQLite.
    source = MIGRATION.read_text().replace('public.', '').replace('::jsonb', '')
    wrong_type = source.replace(f"'{DEFAULT}', NULL,", f"'{DEFAULT}', 6,", 1)
    assert wrong_type != source
    with closing(sqlite3.connect(':memory:')) as connection:
        connection.execute('PRAGMA foreign_keys = ON')
        connection.executescript(CONFIG_SCHEMA)
        with pytest.raises(sqlite3.IntegrityError, match='FOREIGN KEY constraint failed'):
            connection.executescript(wrong_type)
        for _ in range(2):
            connection.executescript(source)
        rows = connection.execute('SELECT boolean_value,json_value,text_value,value_type FROM system_config').fetchall()
        assert len(rows) == 1
        boolean_value, json_value, text_value, value_type = rows[0]
        assert [boolean_value, json.loads(json_value), text_value, value_type] == [None, {'value': DEFAULT}, DEFAULT, None]


@pytest.mark.parametrize('existing', [None, DEFAULT, 'fit_to_label'])
def test_seed_default_once_and_replay_keeps_administrator_choice(database, existing):
    database(CONFIG_SCHEMA)
    if existing is not None:
        database(f"INSERT INTO system_config VALUES ('{KEY}',NULL,'{{\"value\":\"{existing}\"}}','{existing}',NULL,'Site choice')")
    for _ in range(2):
        database(MIGRATION.read_text())
        database(release_owner().read_text())
    expected = existing or DEFAULT
    actual = json.loads(database(f"SELECT json_build_array(boolean_value,json_value,text_value,value_type) FROM system_config WHERE key='{KEY}'"))
    assert actual == [None, {'value': expected}, expected, None]
    assert database(f"SELECT count(*) FROM system_config WHERE key='{KEY}'") == '1'
    assert database('SELECT count(*) FROM system_db_version') == '1'
