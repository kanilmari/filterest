"""test_table_cell_lines_seed.py
Verify WO30 seed/bootstrap parity, default three and authored-copy preservation.
Connect the single upgrade seed to generated installation inputs and translations.
Run SQL only in the shared opt-in disposable PostgreSQL fixture.
"""
import hashlib
import json
from pathlib import Path

import pytest
from test_field_settings_language_seed import database  # noqa: F401
from test_row_actor_support import cluster  # noqa: F401

APP = Path(__file__).resolve().parents[2]
BOOTSTRAP = APP / 'server_tools/public_bootstrap'
MIGRATION = APP / 'server_tools/migrations/20261015000008_seed_table_cell_max_lines.sql'
COPY = {
    'table_view_settings': ('Taulukkonäkymän asetukset', 'Table view settings'),
    'table_cell_max_lines_label': ('Taulukon solun rivimäärä', 'Table cell line limit'),
    'table_cell_max_lines_help': ('Pidemmät solut vierivät solun sisällä.', 'Longer cells scroll inside the cell.'),
    'table_cell_max_lines_invalid': ('Anna kokonaisluku väliltä 1–30.', 'Enter a whole number from 1 to 30.'),
}


def test_seed_bootstrap_parity_and_default():
    sql = MIGRATION.read_text()
    assert '-- VERSION_DB: 9.12.0' in sql
    assert '-- VERSION_DB_OWNER: 20261015000099_record_database_release_9_12_0.sql' in sql
    assert "SELECT 'table_cell_max_lines', 3, 1," in sql
    assert 'WHERE NOT EXISTS' in sql
    assert sql in (BOOTSTRAP / 'seed_data.sql').read_text()
    generator = (BOOTSTRAP / 'generate_bootstrap.py').read_text()
    settings_list = generator.split('setting_seed_migrations = (')[1].split('\n)')[0]
    assert MIGRATION.name in settings_list
    manifest = json.loads((BOOTSTRAP / 'manifest.json').read_text())
    assert manifest['migration_ledger_baseline'].count(MIGRATION.name) == 1
    source = 'filterest/app/server_tools/migrations/' + MIGRATION.name
    assert manifest['source_files'][source]['sha256'] == hashlib.sha256(MIGRATION.read_bytes()).hexdigest()
    for key, (fi, en) in COPY.items():
        assert f"('{key}', '{fi}', '{en}')" in sql


@pytest.mark.parametrize('authored', ['new', 'columns', 'normalized', 'both'])
def test_seed_default_and_authored_copy_replay(database, authored):
    database('''CREATE TABLE system_config (key text UNIQUE, int_value integer, value_type integer, creation_spec text);
        CREATE TABLE system_languages(language_code text PRIMARY KEY);
        INSERT INTO system_languages VALUES ('fi'), ('en');''')
    if authored != 'new':
        database("INSERT INTO system_config VALUES ('table_cell_max_lines', 7, 1, 'Site choice')")
        for key in COPY:
            fi, en = ('Sivuston teksti', 'Site copy') if authored != 'normalized' else (' ', '')
            database(f"INSERT INTO system_lang_keys(lang_key,fi,en) VALUES ('{key}','{fi}','{en}')")
        if authored != 'columns':
            database('''INSERT INTO system_lang_key_translations(lang_key_id,language_code,translation,source_kind,review_status)
                SELECT id,copy.code,copy.text,'manual','approved' FROM system_lang_keys
                CROSS JOIN (VALUES('fi','Sivuston teksti'),('en','Site copy')) copy(code,text)''')
    database(MIGRATION.read_text())
    assert database("SELECT int_value||'|'||value_type FROM system_config WHERE key='table_cell_max_lines'") == ('3|1' if authored == 'new' else '7|1')
    for key, expected in COPY.items():
        values = expected if authored == 'new' else ('Sivuston teksti', 'Site copy')
        assert database(f"SELECT fi||'|'||en FROM system_lang_keys WHERE lang_key='{key}'") == '|'.join(values)
        assert database(f"SELECT string_agg(translation,'|' ORDER BY language_code DESC) FROM system_lang_key_translations t JOIN system_lang_keys k ON k.id=t.lang_key_id WHERE k.lang_key='{key}'") == '|'.join(values)
    snapshot_sql = '''SELECT jsonb_build_array(
        (SELECT jsonb_agg(c ORDER BY key) FROM system_config c),
        (SELECT jsonb_agg(k ORDER BY lang_key) FROM system_lang_keys k),
        (SELECT jsonb_agg(t ORDER BY lang_key_id,language_code) FROM system_lang_key_translations t),
        (SELECT jsonb_agg(s ORDER BY lang_key_id,source_type,source_high) FROM system_lang_key_sources s))'''
    before = database(snapshot_sql)
    database(MIGRATION.read_text())
    assert database(snapshot_sql) == before
    assert database('SELECT count(*) FROM system_db_version') == '0'


def test_generated_fresh_install_matches_upgrade_for_table_cell_lines(cluster):
    """Replay the exact upgrade file over the same bootstrap without this seed."""
    schema = (BOOTSTRAP / 'schema.sql').read_text()
    seed = (BOOTSTRAP / 'seed_data.sql').read_text()
    migration = MIGRATION.read_text()
    assert seed.count(migration) == 1
    for name, initial in [('wo30_fresh', seed), ('wo30_upgrade', seed.replace(migration, '', 1))]:
        cluster(f'CREATE DATABASE {name}')
        cluster(schema, name)
        cluster(initial, name)
    cluster(migration, 'wo30_upgrade')
    cluster(migration, 'wo30_upgrade')
    query = """SELECT jsonb_build_object(
        'setting', (SELECT jsonb_build_array(int_value,value_type) FROM system_config WHERE key='table_cell_max_lines'),
        'copy', (SELECT jsonb_agg(jsonb_build_array(k.lang_key,k.fi,k.en) ORDER BY k.lang_key)
                 FROM system_lang_keys k WHERE k.lang_key IN
                 ('table_view_settings','table_cell_max_lines_label','table_cell_max_lines_help','table_cell_max_lines_invalid')),
        'translations', (SELECT jsonb_agg(jsonb_build_array(k.lang_key,t.language_code,t.translation) ORDER BY k.lang_key,t.language_code)
                         FROM system_lang_key_translations t JOIN system_lang_keys k ON k.id=t.lang_key_id
                         WHERE k.lang_key IN ('table_view_settings','table_cell_max_lines_label','table_cell_max_lines_help','table_cell_max_lines_invalid')))
    """
    fresh = json.loads(cluster(query, 'wo30_fresh').stdout)
    upgraded = json.loads(cluster(query, 'wo30_upgrade').stdout)
    assert fresh == upgraded
    assert fresh['setting'] == [3, 1]
    assert len(fresh['copy']) == 4 and len(fresh['translations']) == 8
