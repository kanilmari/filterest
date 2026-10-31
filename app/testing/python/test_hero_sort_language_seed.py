"""test_hero_sort_language_seed.py
Prove exact-default sort-label repair in isolated PostgreSQL and bootstrap.
Connect WO50's upgrade migration, both dictionary stores and release ownership.
Preserve site copy, untouched locales, metadata and replay timestamps.
"""
import hashlib
import json
from pathlib import Path

import pytest

from bootstrap_contract_assertions import assert_bootstrap_baseline
from test_field_settings_language_seed import database  # noqa: F401

APP = Path(__file__).resolve().parents[2]
MIGRATION = APP / 'server_tools/migrations/20261029000001_seed_hero_sort_language_keys.sql'
RELEASED = APP / 'server_tools/migrations/20261013000002_seed_card_and_filterbar_language_keys.sql'
OWNER = '20261029000099_record_database_release_9_13_2.sql'
COPY = {
    'sort_newest': ('Sort newest', 'Uusimmat ensin', 'Newest first'),
    'sort_oldest': ('Sort oldest', 'Vanhimmat ensin', 'Oldest first'),
    'sort_updated_newest': ('Sort updated newest', 'Viimeksi päivitetyt ensin', 'Recently updated first'),
    'sort_updated_oldest': ('Sort updated oldest', 'Vanhimmin päivitetyt ensin', 'Least recently updated first'),
    'sort_images_first': ('Sort images first', 'Kuvalliset ensin', 'Rows with images first'),
}


def test_packaging_reviewed_copy_owner_marker_and_bootstrap():
    sql = MIGRATION.read_text()
    assert sql.splitlines()[0] == '-- ' + MIGRATION.name
    assert '-- VERSION_DB: 9.13.2' in sql
    assert '-- VERSION_DB_OWNER: ' + OWNER in sql and MIGRATION.name < OWNER
    assert '-- COMPLETION_MARKER: wo50_hero_sort_language_keys' in sql
    assert 'system_db_version' not in sql
    for key, (old, fi, en) in COPY.items():
        assert f"('{key}', '{old}', '{fi}', '{en}')" in sql
        assert f"('{key}', '{fi}', '{en}'," in RELEASED.read_text()
    assert 'btrim' not in sql
    bootstrap = APP / 'server_tools/public_bootstrap'
    assert sql in (bootstrap / 'seed_data.sql').read_text()
    assert_bootstrap_baseline((bootstrap / 'seed_data.sql').read_text(), MIGRATION)
    assert MIGRATION.name in (bootstrap / 'generate_bootstrap.py').read_text().split('setting_seed_migrations')[0]
    manifest = json.loads((bootstrap / 'manifest.json').read_text())
    assert manifest['source_files'][f'filterest/app/server_tools/migrations/{MIGRATION.name}']['sha256'] == hashlib.sha256(MIGRATION.read_bytes()).hexdigest()


@pytest.fixture
def language_database(database):
    database("""CREATE TABLE system_languages(language_code text PRIMARY KEY);
        INSERT INTO system_languages VALUES ('fi'),('en'),('ch'),('yue'),('zh-CN'),('zh-TW'),('zh-HK');
        CREATE TABLE system_data_repair_records(migration text, action text, detail jsonb);
        CREATE FUNCTION stamp_update() RETURNS trigger AS $$
        BEGIN NEW.updated = clock_timestamp(); RETURN NEW; END; $$ LANGUAGE plpgsql;
        CREATE TRIGGER stamp_keys BEFORE UPDATE ON system_lang_keys FOR EACH ROW EXECUTE FUNCTION stamp_update();
        CREATE TRIGGER stamp_translations BEFORE UPDATE ON system_lang_key_translations FOR EACH ROW EXECUTE FUNCTION stamp_update();
    """)
    return database


def quote(value):
    return 'NULL' if value is None else "'" + value.replace("'", "''") + "'"


def snapshot(database):
    return database("""SELECT jsonb_build_array(
        (SELECT jsonb_agg(k ORDER BY id) FROM system_lang_keys k),
        (SELECT jsonb_agg(t ORDER BY lang_key_id,language_code) FROM system_lang_key_translations t),
        (SELECT jsonb_agg(s ORDER BY lang_key_id,source_type,source_high) FROM system_lang_key_sources s),
        (SELECT jsonb_agg(r) FROM system_data_repair_records r),
        (SELECT last_value FROM system_lang_keys_id_seq))""")


def seed(database, value_for):
    for key, (old, _fi, _en) in COPY.items():
        value = quote(value_for(old))
        database(f"""INSERT INTO system_lang_keys(lang_key,fi,en,ch,yue,creation_spec)
            VALUES('{key}',{value},{value},'保留','保留','Site origin');
            INSERT INTO system_lang_key_translations(lang_key_id,language_code,translation,source_kind,review_status)
            SELECT id,code,{value},'import','needs_review' FROM system_lang_keys
                CROSS JOIN (VALUES('fi'),('en'),('zh-CN'),('zh-TW'),('zh-HK'),('ch'),('yue')) codes(code)
            WHERE lang_key='{key}';""")


def replay(database):
    before = snapshot(database)
    database(MIGRATION.read_text())
    assert snapshot(database) == before
    assert database('SELECT count(*) FROM system_db_version') == '0'


def test_exact_defaults_change_independently_in_both_stores(language_database):
    database = language_database
    seed(database, lambda old: old)
    # Opposite store/language edits must never be used to overwrite each other.
    database("""UPDATE system_lang_keys SET en='Site choice' WHERE lang_key='sort_newest';
        UPDATE system_lang_key_translations SET translation='Oma valinta'
        WHERE language_code='fi' AND lang_key_id=(SELECT id FROM system_lang_keys WHERE lang_key='sort_oldest');""")
    before_other = database("SELECT jsonb_agg(t ORDER BY lang_key_id,language_code) FROM system_lang_key_translations t WHERE language_code NOT IN ('fi','en')")
    database(MIGRATION.read_text())
    for key, (_old, fi, en) in COPY.items():
        assert database(f"SELECT fi||'|'||en FROM system_lang_keys WHERE lang_key='{key}'") == fi + '|' + ('Site choice' if key == 'sort_newest' else en)
        assert database(f"SELECT translation FROM system_lang_key_translations t JOIN system_lang_keys k ON k.id=t.lang_key_id WHERE k.lang_key='{key}' AND language_code='fi'") == ('Oma valinta' if key == 'sort_oldest' else fi)
        assert database(f"SELECT translation FROM system_lang_key_translations t JOIN system_lang_keys k ON k.id=t.lang_key_id WHERE k.lang_key='{key}' AND language_code='en'") == en
    assert database("SELECT count(*) FROM system_lang_keys WHERE ch='保留' AND yue='保留' AND creation_spec='Site origin'") == '5'
    assert database("SELECT count(*) FROM system_lang_key_translations WHERE source_kind='import' AND review_status='needs_review'") == '35'
    assert database("SELECT jsonb_agg(t ORDER BY lang_key_id,language_code) FROM system_lang_key_translations t WHERE language_code NOT IN ('fi','en')") == before_other
    replay(database)


@pytest.mark.parametrize('value', [None, '', ' ', '\t\n', '  Site wording  ', 'Sort newest, my preference', ' Sort newest '])
def test_admin_values_blanks_and_whitespace_survive(language_database, value):
    database = language_database
    seed(database, lambda _old: value)
    before = snapshot(database)
    database(MIGRATION.read_text())
    # Only completion evidence may be added; all language rows stay byte-for-byte.
    assert json.loads(snapshot(database))[:3] == json.loads(before)[:3]
    replay(database)


def test_fresh_reviewed_seed_and_upgrade_have_the_same_fi_en(language_database):
    database = language_database
    database(RELEASED.read_text())
    before = snapshot(database)
    database(MIGRATION.read_text())
    assert json.loads(snapshot(database))[:3] == json.loads(before)[:3]
    for key, (_old, fi, en) in COPY.items():
        assert database(f"SELECT fi||'|'||en FROM system_lang_keys WHERE lang_key='{key}'") == fi + '|' + en
    assert database("SELECT fi||'|'||en FROM system_lang_keys WHERE lang_key='search_relevance'") == 'Hakurelevanssi|Search relevance'
    replay(database)
