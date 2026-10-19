"""test_filterbar_display_and_clear_language_seed.py
Verify the WO46 display rename and singular clear label on disposable PostgreSQL.
Connect the new upgrade seed, its bootstrap class, completion marker and consumers.
Keep administrator copy and unreviewed languages unchanged across replays.
"""
import hashlib
import json
from pathlib import Path

import pytest

from bootstrap_contract_assertions import assert_bootstrap_baseline
from test_field_settings_language_seed import database  # noqa: F401

APP = Path(__file__).resolve().parents[2]
MIGRATION = APP / 'server_tools/migrations/20261015000021_seed_filterbar_display_and_clear_language_keys.sql'
RELEASED = APP / 'server_tools/migrations/20261009000074_seed_filterbar_style_language_key.sql'
OWNER = '20261015000099_record_database_release_9_12_0.sql'
STYLE = 'filterbar_style_and_colors'


def test_seed_packaging_owner_marker_and_reviewed_copy():
    sql = MIGRATION.read_text()
    assert sql.splitlines()[0] == '-- ' + MIGRATION.name
    assert '-- VERSION_DB: 9.12.0' in sql
    assert '-- VERSION_DB_OWNER: ' + OWNER in sql and MIGRATION.name < OWNER
    assert '-- COMPLETION_MARKER: wo46_filterbar_display_and_clear' in sql
    assert "('Näyttöasetukset', 'Display settings', 'Tyyli- ja väriasetukset', 'Style and color settings')" in sql
    assert "('clear', 'Tyhjennä', 'Clear')" in sql
    assert 'system_db_version' not in sql
    bootstrap = APP / 'server_tools/public_bootstrap'
    assert sql in (bootstrap / 'seed_data.sql').read_text()
    assert_bootstrap_baseline((bootstrap / 'seed_data.sql').read_text(), MIGRATION)
    assert MIGRATION.name in (bootstrap / 'generate_bootstrap.py').read_text().split('setting_seed_migrations')[0]
    manifest = json.loads((bootstrap / 'manifest.json').read_text())
    assert manifest['source_files'][f'filterest/app/server_tools/migrations/{MIGRATION.name}']['sha256'] == hashlib.sha256(MIGRATION.read_bytes()).hexdigest()
    consumer = APP / 'frontend/core_components/filterbar/filter_list/active_filter_tag_printer.js'
    assert "frontend/core_components/filterbar/filter_list/active_filter_tag_printer.js" in sql
    assert '"clear"' in consumer.read_text()


@pytest.fixture
def language_database(database):
    database("""CREATE TABLE system_languages(language_code text PRIMARY KEY);
        INSERT INTO system_languages VALUES ('fi'),('en'),('ch'),('yue'),('zh-CN'),('zh-TW'),('zh-HK');
        CREATE TABLE system_data_repair_records(migration text, action text, detail jsonb);
    """)
    return database


def snapshot(database):
    return database("""SELECT jsonb_build_array(
        (SELECT jsonb_agg(k ORDER BY id) FROM system_lang_keys k),
        (SELECT jsonb_agg(t ORDER BY lang_key_id,language_code) FROM system_lang_key_translations t),
        (SELECT jsonb_agg(s ORDER BY lang_key_id,source_type,source_high) FROM system_lang_key_sources s),
        (SELECT jsonb_agg(r) FROM system_data_repair_records r),
        (SELECT last_value FROM system_lang_keys_id_seq))""")


def assert_replay(database):
    before = snapshot(database)
    database(MIGRATION.read_text())
    assert snapshot(database) == before
    assert database('SELECT count(*) FROM system_db_version') == '0'


@pytest.mark.parametrize('store', ['new', 'blank', 'columns', 'normalized', 'both', 'different'])
def test_clear_fills_only_missing_fi_en_and_preserves_site_copy(language_database, store):
    database = language_database
    if store != 'new':
        fi, en = ('Oma teksti', 'Site text') if store in {'columns', 'both', 'different'} else (' ', '')
        database(f"INSERT INTO system_lang_keys(lang_key,fi,en,ch,yue,creation_spec) VALUES('clear','{fi}','{en}','保留','保留','Site origin')")
        if store in {'normalized', 'both', 'different', 'blank'}:
            fi, en = (' ', '') if store == 'blank' else ('Oma käännös', 'Site translation')
            database(f"""INSERT INTO system_lang_key_translations(lang_key_id,language_code,translation,source_kind,review_status)
                SELECT id,copy.code,copy.text,'import','needs_review' FROM system_lang_keys
                CROSS JOIN (VALUES('fi','{fi}'),('en','{en}'),('zh-CN','保留'),('yue','保留')) copy(code,text)""")
    database(MIGRATION.read_text())
    expected = 'Tyhjennä|Clear' if store in {'new', 'blank'} else \
        'Oma käännös|Site translation' if store == 'normalized' else 'Oma teksti|Site text'
    assert database("SELECT fi||'|'||en FROM system_lang_keys WHERE lang_key='clear'") == expected
    normalized = 'Oma käännös|Site translation' if store in {'normalized', 'both', 'different'} else expected
    assert database("SELECT string_agg(translation,'|' ORDER BY language_code DESC) FROM system_lang_key_translations WHERE language_code IN ('fi','en')") == normalized
    if store == 'new':
        assert database("SELECT ch IS NULL AND yue IS NULL FROM system_lang_keys WHERE lang_key='clear'") == 't'
        assert database("SELECT count(*) FROM system_lang_key_translations WHERE language_code NOT IN ('fi','en')") == '0'
    else:
        assert database("SELECT ch||'|'||yue||'|'||creation_spec FROM system_lang_keys WHERE lang_key='clear'") == '保留|保留|Site origin'
    assert database('SELECT count(*) FROM system_lang_key_sources') == '1'
    assert database("SELECT count(*) FROM system_data_repair_records WHERE action='completed'") == '1'
    assert_replay(database)


@pytest.mark.parametrize('custom', [False, True])
def test_display_updates_exact_defaults_in_each_store_without_touching_other_locales(language_database, custom):
    database = language_database
    database(RELEASED.read_text())
    if custom:
        database(f"""UPDATE system_lang_keys SET fi='  Sivuston otsikko  ' WHERE lang_key='{STYLE}';
            UPDATE system_lang_key_translations SET translation='Site heading', source_kind='import', review_status='needs_review'
            WHERE language_code='en' AND lang_key_id=(SELECT id FROM system_lang_keys WHERE lang_key='{STYLE}');""")
    before = database(f"SELECT jsonb_agg(t ORDER BY language_code) FROM system_lang_key_translations t JOIN system_lang_keys k ON k.id=t.lang_key_id WHERE k.lang_key='{STYLE}' AND language_code NOT IN ('fi','en')")
    database(MIGRATION.read_text())
    # Brackets keep the administrator's edge spaces visible: the database helper strips its output.
    assert database(f"SELECT '['||fi||']|'||en FROM system_lang_keys WHERE lang_key='{STYLE}'") == \
        ('[  Sivuston otsikko  ]|Display settings' if custom else '[Näyttöasetukset]|Display settings')
    assert database(f"SELECT translation FROM system_lang_key_translations WHERE language_code='fi' AND lang_key_id=(SELECT id FROM system_lang_keys WHERE lang_key='{STYLE}')") == 'Näyttöasetukset'
    expected_en = 'Site heading' if custom else 'Display settings'
    assert database(f"SELECT translation FROM system_lang_key_translations WHERE language_code='en' AND lang_key_id=(SELECT id FROM system_lang_keys WHERE lang_key='{STYLE}')") == expected_en
    after = database(f"SELECT jsonb_agg(t ORDER BY language_code) FROM system_lang_key_translations t JOIN system_lang_keys k ON k.id=t.lang_key_id WHERE k.lang_key='{STYLE}' AND language_code NOT IN ('fi','en')")
    assert after == before
    assert_replay(database)


@pytest.mark.parametrize('value', ['', ' ', ' Tyyli- ja väriasetukset '])
def test_display_does_not_fill_blanks_or_trim_an_administrators_copy(language_database, value):
    database = language_database
    database(f"INSERT INTO system_lang_keys(lang_key,fi,en) VALUES('{STYLE}','{value}','Site heading')")
    database(f"""INSERT INTO system_lang_key_translations(lang_key_id,language_code,translation,source_kind,review_status)
        SELECT id,'fi','{value}','import','needs_review' FROM system_lang_keys WHERE lang_key='{STYLE}'""")
    database(MIGRATION.read_text())
    assert database(f"SELECT '['||fi||']' FROM system_lang_keys WHERE lang_key='{STYLE}'") == f'[{value}]'
    assert database(f"SELECT '['||translation||']' FROM system_lang_key_translations WHERE language_code='fi' AND lang_key_id=(SELECT id FROM system_lang_keys WHERE lang_key='{STYLE}')") == f'[{value}]'
    assert_replay(database)
