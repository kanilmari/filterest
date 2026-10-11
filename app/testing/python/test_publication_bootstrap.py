"""test_publication_bootstrap.py
Proves Publications are folded into fresh installations without private rows.
Connects migration hashes, acceptance checks, schema snapshots and language copy.
Keeps offline generation and disposable PostgreSQL verification separate.
"""
import hashlib
import json
from pathlib import Path
import re

from test_field_settings_language_seed import database

APP = Path(__file__).resolve().parents[2]
BOOTSTRAP = APP / 'server_tools/public_bootstrap'
MIGRATIONS = (
    '20261009000070_add_publication_fields_to_release_goals.sql',
    '20261009000071_seed_publication_language_keys.sql',
    '20261009000072_register_publication_columns.sql',
    '20261009000073_repair_publication_translations.sql',
)


def publication_language_rows():
    pattern = r"\(" + ','.join([r"'((?:''|[^'])*)'"] * 5) + r"\)"
    sources = [(APP / 'server_tools/migrations' / MIGRATIONS[index]).read_text()
               for index in (1, 3)]
    rows = [{row[0]: tuple(value.replace("''", "'") for value in row[1:])
             for row in re.findall(pattern, source)} for source in sources]
    assert len(rows[0]) == 25 and len(rows[1]) == 26
    assert {key: rows[1][key] for key in rows[0]} == rows[0]
    return rows[1]


def test_publication_bootstrap_matches_sources_and_snapshot():
    manifest = json.loads((BOOTSTRAP / 'manifest.json').read_text())
    schema = (BOOTSTRAP / 'schema.sql').read_bytes()
    seed = (BOOTSTRAP / 'seed_data.sql').read_text()
    current = (APP / 'VERSION_DB').read_text().strip()
    assert schema == (APP / f'server_tools/versioning/schema_snapshots/db-{current}.sql').read_bytes()
    for name in MIGRATIONS:
        source = (APP / 'server_tools/migrations' / name).read_bytes()
        assert source in schema if name == MIGRATIONS[0] else source.decode() in seed
        assert name in manifest['migration_ledger_baseline']
        assert hashlib.sha256(source).hexdigest() in seed
    assert "public.app_check_publications()" in seed
    assert "'wl164_publication_fields'" in seed
    assert "'wl164_publication_column_metadata'" in seed
    assert not re.search(r'INSERT\s+INTO\s+(?:public\.)?dev_agent_release_goals\b', seed, re.I)


def test_publication_language_fallbacks_match_migration():
    copy = (APP / 'frontend/core_components/workline_observatory/publication_copy.js').read_text()
    values = json.loads(re.search(r'const PUBLICATION_COPY = (\{.*?\});', copy, re.S)[1])
    seed = (APP / 'server_tools/migrations' / MIGRATIONS[1]).read_text()
    for name, languages in values.items():
        key = 'workline_publication_' + re.sub('[A-Z]', lambda match: '_' + match[0].lower(), name)
        row = '(' + ','.join("'" + value.replace("'", "''") + "'" for value in [key, *languages]) + ')'
        assert row in seed


def test_publication_fresh_install_and_replay_postgres(database):
    database('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    database((BOOTSTRAP / 'schema.sql').read_text())
    database((BOOTSTRAP / 'seed_data.sql').read_text())
    assert database('SELECT count(*) FROM app_check_publications()') == '0'
    assert database('SELECT count(*) FROM dev_agent_release_goals') == '0'
    assert database("SELECT count(*) FROM system_column_details c JOIN system_db_tables t USING(table_uid) WHERE t.table_name='dev_agent_release_goals' AND c.column_name IN ('publication_version','target_date','reader_description','published','published_at','publication_revision')") == '6'
    keys = publication_language_rows()
    expected = []
    for key, (fi, en, ch, yue) in keys.items():
        for locale, text in (('fi', fi), ('en', en), ('zh-CN', ch), ('zh-TW', yue), ('zh-HK', yue)):
            status = 'approved' if locale in ('fi', 'en') else 'needs_review'
            expected.append('|'.join((key, locale, text, 'manual', status)))
    key_list = ','.join("'" + key + "'" for key in keys)
    query = ("SELECT k.lang_key || '|' || t.language_code || '|' || t.translation || '|' || "
             "t.source_kind || '|' || t.review_status FROM system_lang_key_translations t "
             "JOIN system_lang_keys k ON k.id=t.lang_key_id WHERE k.lang_key IN (" + key_list + ") "
             "ORDER BY k.lang_key,t.language_code")
    # Compare as sorted lines: the database collation and Python order rows differently ('_' against '|').
    assert sorted(database(query).split('\n')) == sorted(expected)
    for name in MIGRATIONS:
        assert database("SELECT outcome || '/' || provenance FROM system_schema_migrations WHERE filename='" + name + "'") == 'bootstrap_baseline/bootstrap'
        database((APP / 'server_tools/migrations' / name).read_text())
    assert database('SELECT count(*) FROM app_check_publications()') == '0'
    assert database("SELECT en || '/' || fi FROM system_lang_keys WHERE lang_key='workline_publication_goal'") == 'Publications/Julkaisut'
    assert sorted(database(query).split('\n')) == sorted(expected)


def test_publication_language_seed_uses_canonical_nonblank_reviewed_candidates():
    publication_language_rows()
    registry = (BOOTSTRAP / 'source/app_tables.lang_keys.sql').read_text()
    for name in (MIGRATIONS[1], MIGRATIONS[3]):
        seed = (APP / 'server_tools/migrations' / name).read_text()
        assert "NULLIF(btrim(c.translation),'') IS NOT NULL" in seed
        assert "JOIN authored a USING(lang_key)" in seed
        for locale, column, status in (
            ('fi', 'fi', 'approved'), ('en', 'en', 'approved'),
            ('zh-CN', 'ch', 'needs_review'), ('zh-TW', 'yue', 'needs_review'),
            ('zh-HK', 'yue', 'needs_review'),
        ):
            assert "('" + locale + "'," in registry
            assert ("('" + locale + "',CASE WHEN NULLIF(btrim(s." + column + "),'') IS NULL THEN a."
                    + column + " ELSE s." + column + " END,'" + status + "')") in seed
        assert "WHERE existing.lang_key_id=s.id AND existing.language_code=c.language_code" in seed
    repair = (APP / 'server_tools/migrations' / MIGRATIONS[3]).read_text()
    assert "('invalid_publication_text'," in repair
    assert 'U+0000' in repair
