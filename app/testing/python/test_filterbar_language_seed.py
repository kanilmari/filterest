"""test_filterbar_language_seed.py
Protects filter-panel labels from blank legacy and canonical translations.
Connects migration 74, bootstrap evidence and its unreleased database owner.
Keeps authored bytes and replay state verifiable on disposable PostgreSQL.
"""
import json
from pathlib import Path

import pytest

from bootstrap_contract_assertions import assert_bootstrap_baseline
from test_field_settings_language_seed import database

APP = Path(__file__).resolve().parents[2]
MIGRATION = APP / "server_tools/migrations/20261009000074_seed_filterbar_style_language_key.sql"
OWNER = "20261009000099_record_database_release_9_11_0.sql"
STYLE = "filterbar_style_and_colors"
LOCALES = ("fi", "en", "zh-CN", "zh-TW", "zh-HK")
DEFAULTS = {
    STYLE: ("Tyyli- ja väriasetukset", "Style and color settings", "样式和颜色设置", "樣式與色彩設定", "樣式及顏色設定"),
    "filterbar_show_search": ("Näytä haku", "Show search", "显示搜索", "顯示搜尋", "顯示搜尋"),
    "filterbar_hide_search": ("Piilota haku", "Hide search", "隐藏搜索", "隱藏搜尋", "隱藏搜尋"),
}
BLANKS = (None, "", "   ", "\t", "\n", "\r", "\f", "\v", " \t\n\r\f\v ")
TRIM_CHARACTERS = r"E' \t\n\r\f' || chr(11)"


def test_filterbar_seed_requires_nonblank_candidates_and_repairs_blank_copy():
    """Offline guard; the PostgreSQL tests below prove the resulting rows."""
    source = MIGRATION.read_text()
    for column in ("fi", "en", "ch", "yue"):
        assert f"NULLIF(btrim(s.{column}, {TRIM_CHARACTERS}), '') IS NULL" in source
    assert f"WHERE NULLIF(btrim(translated.translation, {TRIM_CHARACTERS}), '') IS NOT NULL" in source
    assert f"WHERE NULLIF(btrim(existing.translation, {TRIM_CHARACTERS}), '') IS NULL" in source


def test_filterbar_seed_declares_actual_filename_and_database_owner():
    source = MIGRATION.read_text()
    assert source.splitlines()[0] == "-- " + MIGRATION.name
    assert "-- VERSION_DB: 9.11.0" in source
    assert "-- VERSION_DB_OWNER: " + OWNER in source
    assert MIGRATION.name < OWNER


def test_filterbar_guide_uses_assigned_database_release():
    # The toolbar section moved with the frontend guide split (#921) into the dataset appearance guide.
    guide = (APP / "docs/instructions_and_documentation/Frontend_Dataset_Appearance.md").read_text()
    paragraph = next(line for line in guide.splitlines() if MIGRATION.name in line)
    assert "unreleased DB 9.11.0" in paragraph
    assert OWNER in paragraph
    assert "assign its next database release" not in paragraph


def test_filterbar_bootstrap_contains_exact_seed_and_migration_evidence():
    bootstrap = APP / "server_tools/public_bootstrap"
    assert MIGRATION.read_text() in (bootstrap / "seed_data.sql").read_text()
    assert_bootstrap_baseline((bootstrap / "seed_data.sql").read_text(), MIGRATION)


def sql_text(value):
    return "NULL" if value is None else "'" + value.replace("'", "''") + "'"


@pytest.fixture
def language_database(database):
    """Use the existing isolated harness, with all canonical locales registered."""
    database("""
        CREATE TABLE system_languages (language_code TEXT PRIMARY KEY);
        INSERT INTO system_languages VALUES ('fi'),('en'),('zh-CN'),('zh-TW'),('zh-HK');
        CREATE FUNCTION stamp_language_update() RETURNS trigger AS $$
        BEGIN NEW.updated = clock_timestamp(); RETURN NEW; END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER stamp_keys BEFORE UPDATE ON system_lang_keys
            FOR EACH ROW EXECUTE FUNCTION stamp_language_update();
        CREATE TRIGGER stamp_translations BEFORE UPDATE ON system_lang_key_translations
            FOR EACH ROW EXECUTE FUNCTION stamp_language_update();
    """)
    return database


def translation_rows(database):
    return json.loads(database("""
        SELECT json_agg(json_build_array(k.lang_key,t.language_code,t.translation,
                                        t.source_kind,t.review_status)
                        ORDER BY k.lang_key,t.language_code)
        FROM system_lang_keys k JOIN system_lang_key_translations t ON t.lang_key_id=k.id
    """))


def language_state(database):
    """Include identities, metadata and timestamps so equal text alone cannot pass replay."""
    return json.loads(database("""
        SELECT json_build_object(
            'keys', (SELECT json_agg(k ORDER BY k.id) FROM system_lang_keys k),
            'translations', (SELECT json_agg(t ORDER BY t.lang_key_id,t.language_code)
                             FROM system_lang_key_translations t),
            'key_sequence', (SELECT last_value FROM system_lang_keys_id_seq),
            'versions', (SELECT count(*) FROM system_db_version))
    """))


def assert_default_rows(database, overrides=None):
    expected = {(key, locale): text for key, texts in DEFAULTS.items()
                for locale, text in zip(LOCALES, texts)}
    expected.update(overrides or {})
    rows = translation_rows(database)
    assert len(rows) == len(expected)
    assert {(key, locale): text for key, locale, text, _, _ in rows} == expected
    assert all(text.strip(" \t\n\r\f\v") for _, _, text, _, _ in rows)


def assert_replay_preserves_state(database):
    before = language_state(database)
    for _ in range(2):
        database(MIGRATION.read_text())
        assert language_state(database) == before


@pytest.mark.parametrize("blank", BLANKS)
def test_blank_legacy_copy_uses_nonblank_canonical_defaults(language_database, blank):
    database = language_database
    value = sql_text(blank)
    database("INSERT INTO system_lang_keys(lang_key,fi,en,ch,yue,creation_spec) VALUES ("
             f"'{STYLE}',{value},{value},{value},{value},'Site authored');")
    before = language_state(database)["keys"][0]
    database(MIGRATION.read_text())
    assert_default_rows(database)
    assert language_state(database)["keys"][0] == before
    assert all(source == "manual" and status == "approved"
               for _, _, _, source, status in translation_rows(database))
    assert_replay_preserves_state(database)


@pytest.mark.parametrize("blank", BLANKS)
def test_blank_canonical_copy_is_repaired_without_trimming_authored_legacy(language_database, blank):
    database = language_database
    fi, en, ch, yue = " \tOma otsikko\n ", "\n Our heading\t", " \t本站标题\n", "\n 本站標題 \t"
    database("INSERT INTO system_lang_keys(lang_key,fi,en,ch,yue,creation_spec) VALUES ("
             + ",".join(sql_text(value) for value in (STYLE, fi, en, ch, yue, "Site authored")) + ");")
    for locale in LOCALES:
        database("INSERT INTO system_lang_key_translations"
                 "(lang_key_id,language_code,translation,source_kind,review_status) "
                 f"SELECT id,'{locale}',{sql_text(blank)},'import','needs_review' "
                 f"FROM system_lang_keys WHERE lang_key='{STYLE}';")
    before = language_state(database)["keys"][0]
    database(MIGRATION.read_text())
    assert_default_rows(database, {(STYLE, "fi"): fi, (STYLE, "en"): en,
                                  (STYLE, "zh-CN"): ch, (STYLE, "zh-HK"): yue})
    assert language_state(database)["keys"][0] == before
    assert_replay_preserves_state(database)


def test_authored_canonical_copy_and_metadata_survive_seed_and_replay(language_database):
    database = language_database
    database(f"INSERT INTO system_lang_keys(lang_key,fi,en,ch,yue,creation_spec) "
             f"VALUES ('{STYLE}','  Legacy Finnish  ','Legacy English','旧标题','舊標題','Site authored');")
    authored = {}
    for locale in LOCALES:
        text = f" \tSite's reviewed {locale} heading\n "
        authored[(STYLE, locale)] = text
        database("INSERT INTO system_lang_key_translations"
                 "(lang_key_id,language_code,translation,source_kind,review_status,updated) "
                 f"SELECT id,'{locale}',{sql_text(text)},'import','needs_review','2026-01-01' "
                 f"FROM system_lang_keys WHERE lang_key='{STYLE}';")
    before = language_state(database)
    database(MIGRATION.read_text())
    assert_default_rows(database, authored)
    after = language_state(database)
    assert after["keys"][0] == before["keys"][0]
    assert [row for row in after["translations"] if row["lang_key_id"] == before["keys"][0]["id"]] == before["translations"]
    assert_replay_preserves_state(database)


def test_fresh_filterbar_seed_is_complete_and_replay_is_unchanged(language_database):
    database = language_database
    database(MIGRATION.read_text())
    assert_default_rows(database)
    assert_replay_preserves_state(database)
