"""test_home_top_bar_setting.py
Prove Home top-bar seed defaults, reviewed labels and upgrade replay.
Connect one versioned migration to fresh bootstrap and the administrator label.
PostgreSQL proofs use the existing explicit opt-in and an isolated database only.
"""
import json
from pathlib import Path
import re

import pytest

from test_field_settings_language_seed import database  # noqa: F401

APP = Path(__file__).resolve().parents[2]
MIGRATION = APP / 'server_tools/migrations/20261029000100_add_home_top_bar_setting.sql'
KEY = 'show_home_button_in_top_bar_on_wide_screens'


def release_owner():
    return APP / 'server_tools/migrations' / re.search(r'^-- VERSION_DB_OWNER: (.+)$', MIGRATION.read_text(), re.M)[1]


def test_setting_and_label_share_one_versioned_default_and_last_release_owner():
    source = MIGRATION.read_text()
    version = re.search(r'^-- VERSION_DB: (.+)$', source, re.M)[1]
    assert version == '9.13.3'
    assert MIGRATION.name[:14] > '20261029000099'
    assert release_owner().name > MIGRATION.name
    assert f'-- VERSION_DB: {version}' in release_owner().read_text()
    assert f"SELECT '{version}'," in release_owner().read_text()
    assert f"WHERE version = '{version}'" in release_owner().read_text()
    assert f"SELECT '{KEY}', false, '{{\"value\":false}}'::jsonb, 'false', 2," in source
    assert f"WHERE NOT EXISTS (SELECT 1 FROM public.system_config WHERE key = '{KEY}')" in source
    assert not re.search(r'\b(?:UPDATE|DELETE)\s+(?:public\.)?system_config', source, re.I)
    assert 'Näytä Etusivu-painike yläpalkissa leveillä näytöillä' in source
    assert 'Show the Home button in the top bar on wide screens' in source
    assert 'frontend/core_components/admin_tools/front_page_settings_view.js' in source


def test_fresh_installation_contains_the_exact_setting_migration_and_evidence():
    bootstrap = APP / 'server_tools/public_bootstrap'
    assert MIGRATION.read_text() in (bootstrap / 'seed_data.sql').read_text()
    manifest = json.loads((bootstrap / 'manifest.json').read_text())
    assert MIGRATION.name in manifest['migration_ledger_baseline']
    assert release_owner().name in manifest['migration_ledger_baseline']
    assert manifest['db_version'] == (APP / 'VERSION_DB').read_text().strip()


def test_phone_home_width_expansion_is_removed_and_shared_base_reserves_44_pixels():
    css = (APP / 'frontend/core_components/front_page/top_nav_home_button.css').read_text()
    assert 'grid-template-columns' not in css
    shared = (APP / 'frontend/core_components/filterbar/shared_topbar.css').read_text()
    assert 'grid-template-columns: 44px minmax(0, 1fr) 96px' in shared


@pytest.fixture
def site(database):
    database('''
        CREATE TABLE system_languages (language_code TEXT PRIMARY KEY);
        INSERT INTO system_languages VALUES ('fi'),('en');
        CREATE TABLE system_config (key TEXT PRIMARY KEY, boolean_value BOOLEAN,
            json_value JSONB, text_value TEXT, value_type INT, creation_spec TEXT);
    ''')
    return database


@pytest.mark.parametrize('existing', [None, False, True])
def test_upgrade_defaults_false_and_replay_preserves_site_choice(site, existing):
    if existing is not None:
        value = str(existing).lower()
        site(f"INSERT INTO system_config VALUES ('{KEY}',{value},'{{\"value\":{value}}}','{value}',2,'Site choice')")
    for _ in range(2):
        site(MIGRATION.read_text())
        site(release_owner().read_text())
    expected = False if existing is None else existing
    actual = json.loads(site(f"SELECT json_build_array(boolean_value,json_value,text_value,value_type) FROM system_config WHERE key='{KEY}'"))
    assert actual == [expected, {'value': expected}, str(expected).lower(), 2]
    assert site('SELECT count(*) FROM system_db_version') == '1'
    assert site(f"SELECT count(*) FROM system_lang_keys WHERE lang_key='{KEY}' AND fi IS NOT NULL AND en IS NOT NULL") == '1'
    assert site(f"SELECT count(*) FROM system_lang_key_translations t JOIN system_lang_keys k ON k.id=t.lang_key_id WHERE k.lang_key='{KEY}' AND t.source_kind='manual' AND t.review_status='approved'") == '2'


def test_replay_preserves_site_authored_translation_in_both_stores(site):
    site(MIGRATION.read_text())
    site(f"UPDATE system_lang_keys SET fi='Oma teksti' WHERE lang_key='{KEY}'; UPDATE system_lang_key_translations SET translation='Oma teksti' WHERE language_code='fi'")
    site(MIGRATION.read_text())
    assert site(f"SELECT fi FROM system_lang_keys WHERE lang_key='{KEY}'") == 'Oma teksti'
    assert site("SELECT translation FROM system_lang_key_translations WHERE language_code='fi'") == 'Oma teksti'
