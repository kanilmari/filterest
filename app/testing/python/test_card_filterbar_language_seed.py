"""test_card_filterbar_language_seed.py
Verify card/filterbar migration copy, bootstrap evidence and safe replay.
Connect the authored four-language rows with upgrades and public installations.
Use only the existing disposable PostgreSQL harness for database proofs.
"""
import json
from pathlib import Path
import re

import pytest
from bootstrap_contract_assertions import assert_bootstrap_baseline
from test_field_settings_language_seed import database  # noqa: F401

APP = Path(__file__).resolve().parents[2]
MIGRATION = APP / 'server_tools/migrations/20261013000002_seed_card_and_filterbar_language_keys.sql'
OWNER = '20261013000099_record_database_release_9_11_1.sql'
LOCALES = ('fi', 'en', 'ch', 'yue', 'zh-CN', 'zh-TW', 'zh-HK')
LEGACY_LOCALES = ('fi', 'en', 'ch', 'yue')
COPY_INDEXES = {'fi': 0, 'en': 1, 'ch': 2, 'yue': 4, 'zh-CN': 2, 'zh-TW': 3, 'zh-HK': 4}


def authored_rows():
    rows = {}
    for line in MIGRATION.read_text().split('), written AS (')[0].splitlines():
        if line.startswith("    ('"):
            values = [value.replace("''", "'") for value in re.findall(r"'((?:''|[^'])*)'", line)]
            rows[values[0]] = values[1:]
    return rows


def test_copy_covers_each_shared_surface_in_every_supported_language():
    rows = authored_rows()
    assert len(rows) == 23
    assert rows['sort_newest'][:2] == ['Uusimmat ensin', 'Newest first']
    assert rows['results_count_singular'][:2] == ['tulos', 'result']
    assert rows['results_count_plural'][:2] == ['tulosta', 'results']
    assert rows['edit_fields_view'][:2] == ['Muokkaa kenttänäkymää', 'Edit fields view']
    assert rows['add_row_to_dataset'][:2] == ['Lisää rivi: $table_name', 'Add row: $table_name']
    assert rows['created_by_name'][0] == 'Luojan nimi'
    assert rows['owner_name (ln)'][0] == 'Omistajan nimi'
    for values in rows.values():
        assert len(values) == 5 and all(value.strip() for value in values)
        assert values[2] != values[1] and values[4] != values[1]


def test_seed_and_exact_migration_evidence_reach_the_public_bootstrap():
    source = MIGRATION.read_text()
    assert source.splitlines()[0] == '-- ' + MIGRATION.name
    assert '-- VERSION_DB: 9.11.1' in source
    assert '-- VERSION_DB_OWNER: ' + OWNER in source and MIGRATION.name < OWNER
    bootstrap = (APP / 'server_tools/public_bootstrap/seed_data.sql').read_text()
    assert source in bootstrap
    assert_bootstrap_baseline(bootstrap, MIGRATION)


@pytest.fixture
def language_database(database):
    database("CREATE TABLE system_languages(language_code TEXT PRIMARY KEY); "
             "INSERT INTO system_languages VALUES " + ','.join("('" + locale + "')" for locale in LOCALES) + ';')
    return database


def state(database):
    return json.loads(database("SELECT json_build_object('keys', "
        "(SELECT json_agg(k ORDER BY id) FROM "
        "(SELECT k.*, xmin::text AS tuple_version FROM system_lang_keys k) k), 'translations', "
        "(SELECT json_agg(t ORDER BY lang_key_id, language_code) FROM "
        "(SELECT t.*, xmin::text AS tuple_version FROM system_lang_key_translations t) t));"))


def served_translations(snapshot):
    """Match lang.go: nonblank legacy copy wins; authored copy fills its gaps.

    The fixture registers every locale and seeds its exact translation, so the
    canonical query has no missing locale to resolve through a fallback chain.
    """
    authored = {(row['lang_key_id'], row['language_code']): row['translation']
                for row in snapshot['translations']}
    served = {}
    for row in snapshot['keys']:
        for locale in LOCALES:
            legacy = row.get(locale) or '' if locale in LEGACY_LOCALES else ''
            served[(row['lang_key'], locale)] = (
                legacy if legacy.strip() else authored.get((row['id'], locale), '') or '')
    return served


def assert_reviewed_copy(snapshot):
    rows = authored_rows()
    expected = {(key, locale): values[index] for key, values in rows.items()
                for locale, index in COPY_INDEXES.items()}
    assert len(snapshot['keys']) == 23
    assert len(snapshot['translations']) == 23 * len(LOCALES)
    assert served_translations(snapshot) == expected
    keys = {row['id']: row['lang_key'] for row in snapshot['keys']}
    for row in snapshot['keys']:
        for locale in LEGACY_LOCALES:
            assert row[locale] == expected[(row['lang_key'], locale)]
    for row in snapshot['translations']:
        assert row['translation'] == expected[(keys[row['lang_key_id']], row['language_code'])]


def sql_literal(value):
    return 'NULL' if value is None else "'" + value.replace("'", "''") + "'"


def test_fresh_seed_has_all_locales_and_replay_changes_nothing(language_database):
    database = language_database
    database(MIGRATION.read_text())
    before = state(database)
    assert_reviewed_copy(before)
    database(MIGRATION.read_text())
    assert state(database) == before


def test_upgrade_repairs_blanks_and_english_fallbacks_but_preserves_reviewed_copy(language_database):
    database = language_database
    database("INSERT INTO system_lang_keys(lang_key,fi,en,ch,yue) VALUES "
             "('sort_newest','Oma järjestys','Newest first','Newest first',''),"
             "('created_by_name','Created by name','Created by name','',NULL); "
             "INSERT INTO system_lang_key_translations(lang_key_id,language_code,translation,source_kind,review_status) "
             "SELECT id,'fi','  Oma järjestys  ','import','needs_review' FROM system_lang_keys WHERE lang_key='sort_newest'; "
             "INSERT INTO system_lang_key_translations(lang_key_id,language_code,translation) "
             "SELECT id,'zh-CN','Newest first' FROM system_lang_keys WHERE lang_key='sort_newest'; "
             "INSERT INTO system_lang_key_translations(lang_key_id,language_code,translation) "
             "SELECT id,'fi',E' \\t\\n' FROM system_lang_keys WHERE lang_key='created_by_name';")
    database(MIGRATION.read_text())
    before = state(database)
    legacy = {row['lang_key']: row for row in before['keys']}
    served = served_translations(before)
    # Gate cp-gate-125a: updating only the secondary table leaves English served.
    assert served[('created_by_name', 'fi')] == 'Luojan nimi'
    assert legacy['created_by_name']['fi'] == 'Luojan nimi'
    assert served[('sort_newest', 'fi')] == 'Oma järjestys'
    assert legacy['sort_newest']['fi'] == 'Oma järjestys'
    assert served[('sort_newest', 'ch')] == '最新优先'
    assert legacy['sort_newest']['ch'] == '最新优先'
    keys = {row['id']: row['lang_key'] for row in before['keys']}
    translations = {(keys[row['lang_key_id']], row['language_code']): row for row in before['translations']}
    retained = translations[('sort_newest', 'fi')]
    assert retained['translation'] == '  Oma järjestys  '
    assert retained['source_kind'] == 'import' and retained['review_status'] == 'needs_review'
    assert translations[('sort_newest', 'zh-CN')]['translation'] == '最新优先'
    assert translations[('created_by_name', 'fi')]['translation'] == 'Luojan nimi'
    database(MIGRATION.read_text())
    assert state(database) == before
    assert served_translations(state(database)) == served


def test_count_keys_leave_existing_headings_and_search_copy_untouched(language_database):
    database = language_database
    # Installations already use these generic keys for headings and other copy.
    old_keys = ('result', 'results', 'result_in_text_search', 'results_in_text_search',
                'result_in_ai_search', 'results_in_ai_search')
    for key in old_keys:
        finnish = 'Tulokset' if key == 'results' else 'Sivuston otsikko: ' + key
        database('INSERT INTO system_lang_keys(lang_key,fi,en,ch,yue,creation_spec) VALUES ('
                 + ','.join(map(sql_literal, [key, finnish, key, '網站標題', '網站標題', 'site copy'])) + ');')
        for locale in LOCALES:
            database('INSERT INTO system_lang_key_translations '
                     '(lang_key_id,language_code,translation,source_kind,review_status) '
                     f"SELECT id,{sql_literal(locale)},'Site heading','import','needs_review' "
                     f'FROM system_lang_keys WHERE lang_key={sql_literal(key)};')
    before = state(database)
    old_ids = {row['id'] for row in before['keys']}
    database(MIGRATION.read_text())
    after = state(database)
    assert [row for row in after['keys'] if row['id'] in old_ids] == before['keys']
    assert [row for row in after['translations'] if row['lang_key_id'] in old_ids] == before['translations']
    served = served_translations(after)
    assert served[('results', 'fi')] == 'Tulokset'
    assert '1 ' + served[('results_count_singular', 'fi')] == '1 tulos'
    assert '2 ' + served[('results_count_plural', 'fi')] == '2 tulosta'
    assert served[('results_count_text_search_singular', 'fi')] == 'tulos tekstihaulla'
    assert served[('results_count_text_search_plural', 'fi')] == 'tulosta tekstihaulla'
    assert served[('results_count_ai_search_singular', 'fi')] == 'tulos tekoälyhaulla'
    assert served[('results_count_ai_search_plural', 'fi')] == 'tulosta tekoälyhaulla'
    database(MIGRATION.read_text())
    assert state(database) == after


@pytest.mark.parametrize('stored', [None, '', ' \t\n\r\f\v', 'english'],
                         ids=['null', 'empty', 'whitespace', 'exact-english'])
def test_upgrade_repairs_every_key_in_both_representations_and_served_copy(language_database, stored):
    database = language_database
    rows = authored_rows()
    values = []
    for key, copy in rows.items():
        old = copy[1] if stored == 'english' else stored
        values.append('(' + ','.join(map(sql_literal, [key, old, old, old, old])) + ')')
    database('INSERT INTO system_lang_keys(lang_key,fi,en,ch,yue) VALUES ' + ','.join(values) + ';')
    for locale in LOCALES:
        old = 'k.en' if stored == 'english' else sql_literal(stored)
        database('INSERT INTO system_lang_key_translations(lang_key_id,language_code,translation) '
                 f'SELECT k.id,{sql_literal(locale)},{old} FROM system_lang_keys k;')
    database(MIGRATION.read_text())
    before = state(database)
    assert_reviewed_copy(before)
    database(MIGRATION.read_text())
    assert state(database) == before
    assert_reviewed_copy(state(database))


@pytest.mark.parametrize('style', ['site-copy', 'padded-english', 'different-case'])
def test_upgrade_preserves_nonblank_copy_byte_for_byte_in_every_locale(language_database, style):
    database = language_database
    values = []
    expected = {}
    for key, copy in authored_rows().items():
        for locale in LOCALES:
            expected[(key, locale)] = (
                f'Sivuston oma teksti: {locale} / {key}' if style == 'site-copy'
                else '  ' + copy[1] + '  ' if style == 'padded-english' else copy[1].swapcase())
        values.append('(' + ','.join(map(sql_literal, [key] + [expected[(key, locale)]
                      for locale in LEGACY_LOCALES] + ['site-owned description'])) + ')')
    database('INSERT INTO system_lang_keys(lang_key,fi,en,ch,yue,creation_spec) VALUES ' + ','.join(values) + ';')
    for (key, locale), text in expected.items():
        database('INSERT INTO system_lang_key_translations(lang_key_id,language_code,translation,source_kind,review_status) '
                 f"SELECT id,{sql_literal(locale)},{sql_literal(text)},'import','needs_review' "
                 f'FROM system_lang_keys WHERE lang_key={sql_literal(key)};')
    before = state(database)
    for _ in range(2):
        database(MIGRATION.read_text())
        assert state(database) == before
        assert served_translations(state(database)) == expected
