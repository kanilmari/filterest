"""Verify the DB 9.8.1 request-notice and interface language seeds on install and upgrade.

Runs 20260922000004 to 000007 on disposable PostgreSQL clusters loaded
from the reviewed public bootstrap, as a new installation and rewound to an older
site. Keeps the seeded copy equal to the frontend fallback copy, ends a fresh and
an upgraded installation the same, replaces only the exact superseded wording,
protects reviewed translations, and changes nothing when run again.
"""
from __future__ import annotations

import json
from pathlib import Path
import re

import pytest

from test_field_settings_language_seed import database  # noqa: F401  (disposable cluster fixture)

APP = Path(__file__).resolve().parents[2]
MIGRATIONS = APP / "server_tools/migrations"
NOTICE_SEED = MIGRATIONS / "20260922000004_seed_request_notice_and_interface_language_keys.sql"
INTERFACE_SEED = MIGRATIONS / "20260922000005_seed_interface_language_keys_of_9_8_1.sql"
LATE_SEED = MIGRATIONS / "20260922000006_seed_dataset_creation_warning_language_key.sql"
SCREEN_SEED = MIGRATIONS / "20260922000007_seed_embedding_refresh_and_dataset_header_language_keys.sql"
SEEDS = (NOTICE_SEED, INTERFACE_SEED, LATE_SEED, SCREEN_SEED)
# The seeds that withdraw exactly superseded wording before they fill.
SUPERSEDING_SEEDS = (INTERFACE_SEED, SCREEN_SEED)
BOOTSTRAP = APP / "server_tools/public_bootstrap"
# Every frontend file whose bootstrap copy a seeded key must equal.
FALLBACK_FILES = (
    APP / "frontend/core_components/error_and_status_handling/error_monitor_handler_helpers.js",
    APP / "frontend/core_components/general_tables/dataset_form/dataset_form_translation_fallbacks.js",
    APP / "frontend/reusable_components/modal/confirm_prompt_translation_fallbacks.js",
    APP / "frontend/core_components/ai_features/table_chat/table_chat_coding_agent_copy.js",
    APP / "frontend/custom_views/embedding_status_translation_fallbacks.js",
    APP / "frontend/core_components/admin_tools/foreign_keys_translation_fallbacks.js",
    APP / "frontend/core_components/admin_tools/dataset_header_config_translation_fallbacks.js",
)
# Earlier seeds that wrote some of these keys in Finnish and English only.
EARLIER_SEEDS = (
    MIGRATIONS / "20260918000002_seed_site_assistant_language_keys.sql",
    MIGRATIONS / "20260920000003_name_site_assistant_runtimes.sql",
)
# Keys whose only copy is the database row: the screen has no fallback for them.
DATABASE_ONLY_KEYS = {"confirm_save_permissions"}
LANGUAGES = ("fi", "en", "ch", "yue")
STRING = r"\"(?:[^\"\\]|\\.)*\"|'(?:[^'\\]|\\.)*'"
LITERAL = r"(NULL|'(?:''|[^'])*')"


def _js_string(token: str) -> str:
    """Decode one double- or single-quoted JavaScript string literal."""
    if token.startswith('"'):
        return json.loads(token)
    return json.loads('"' + token[1:-1].replace("\\'", "'").replace('"', '\\"') + '"')


def _literals(block: str, width: int) -> list[tuple[str | None, ...]]:
    pattern = r"\(\s*" + r"\s*,\s*".join([LITERAL] * width) + r"\s*\)"
    return [
        tuple(None if value == "NULL" else value[1:-1].replace("''", "'") for value in row)
        for row in re.findall(pattern, block, re.S)
    ]


def _authored_rows() -> dict[str, tuple[str, ...]]:
    rows = {}
    for seed in SEEDS:
        block = seed.read_text().split("WITH authored_keys", 1)[1].split("), written_keys", 1)[0]
        for row in _literals(block, 6):
            assert row[0] not in rows, f"{row[0]} is seeded twice"
            rows[row[0]] = row[1:]
    return rows


def _earlier_rows() -> dict[str, tuple[str, str, str]]:
    """fi, en and creation_spec of the keys the earlier seeds wrote."""
    rows = {}
    for seed in EARLIER_SEEDS:
        block = seed.read_text().split("WITH authored_keys", 1)[1].split("\n)\n", 1)[0]
        rows.update({row[0]: row[1:] for row in _literals(block, 4)})
    return rows


def _superseded_rows() -> dict[str, tuple[str | None, ...]]:
    rows = {}
    for seed in SUPERSEDING_SEEDS:
        block = seed.read_text().split("WITH superseded_copy", 1)[1].split("), withdrawn_translations", 1)[0]
        rows.update({row[0]: row[1:] for row in _literals(block, 5)})
    return rows


def _frontend_fallback(key: str) -> tuple[str, ...] | None:
    """The fi, en, ch and yue copy of one key in the one fallback file naming it, as an
    object ({ fi: "...", ... }, frozen or not) or a [Finnish, English, Chinese, Cantonese] array."""
    head = r"(?<![A-Za-z0-9_])[\"']?" + re.escape(key) + r"[\"']?\s*:\s*"
    member = r"[\"']?[A-Za-z]+[\"']?\s*:\s*(?:" + STRING + r")\s*,?\s*"
    found = []
    for path in FALLBACK_FILES:
        text = path.read_text()
        array = re.search(head + r"\[\s*((?:(?:" + STRING + r")\s*,?\s*){4})\]", text, re.S)
        block = re.search(head + r"(?:Object\.freeze\(\s*)?\{\s*((?:" + member + r")+)\}", text, re.S)
        if array:
            found.append(tuple(_js_string(value) for value in re.findall(STRING, array[1])))
        elif block:
            found.append(tuple(
                _js_string(re.search(r"(?<![A-Za-z0-9_])[\"']?" + language + r"[\"']?\s*:\s*(" + STRING + ")",
                                     block[1])[1])
                for language in LANGUAGES
            ))
    assert len(set(found)) <= 1, f"{key} has differing bootstrap copy in more than one file"
    return found[0] if found else None


def _key_list(keys) -> str:
    return ", ".join(f"'{key}'" for key in sorted(keys))


def _state(run, keys) -> str:
    """Both stores of the given keys, without generated ids and timestamps.

    Where superseded wording was replaced, an upgraded site records its new
    Finnish and English as manual copy while a new installation keeps the
    bootstrap row it was written with (legacy_fi, legacy_en): the text and the
    review status must agree, the provenance label of those rows may not."""
    selected = _key_list(keys)
    replaced = _key_list(_superseded_rows())
    return run(
        "SELECT json_build_array("
        "(SELECT json_agg(json_build_array(lang_key, fi, en, ch, yue, creation_spec) ORDER BY lang_key) "
        f" FROM system_lang_keys WHERE lang_key IN ({selected})),"
        "(SELECT json_agg(json_build_array(keys.lang_key, stored.language_code, stored.translation, "
        f"  CASE WHEN keys.lang_key IN ({replaced}) AND stored.language_code IN ('fi', 'en') "
        "       THEN NULL ELSE stored.source_kind END, stored.review_status) "
        "  ORDER BY keys.lang_key, stored.language_code) "
        " FROM system_lang_key_translations AS stored JOIN system_lang_keys AS keys "
        f" ON keys.id = stored.lang_key_id WHERE keys.lang_key IN ({selected})))"
    )


def _snapshot(run, where: str = "TRUE") -> str:
    """Every column of every selected row in both stores, timestamps included."""
    return run(
        "SELECT json_build_array("
        f"(SELECT json_agg(keys ORDER BY keys.id) FROM system_lang_keys AS keys WHERE {where}),"
        "(SELECT json_agg(stored ORDER BY stored.id) FROM system_lang_key_translations AS stored "
        f"JOIN system_lang_keys AS keys ON keys.id = stored.lang_key_id WHERE {where}))"
    )


def _columns(run, key: str) -> tuple[str, ...]:
    return tuple(json.loads(run(f"SELECT json_build_array(fi, en, ch, yue) FROM system_lang_keys WHERE lang_key = '{key}'")))


def _normalized(run, key: str) -> dict[str, tuple[str, str, str]]:
    rows = run(
        "SELECT coalesce(json_agg(json_build_array(stored.language_code, stored.translation, "
        "stored.source_kind, stored.review_status) ORDER BY stored.language_code), '[]') "
        "FROM system_lang_key_translations AS stored JOIN system_lang_keys AS keys "
        f"ON keys.id = stored.lang_key_id WHERE keys.lang_key = '{key}'"
    )
    return {row[0]: tuple(row[1:]) for row in json.loads(rows)}


def _literal(value: str | None) -> str:
    return "NULL" if value is None else "'" + value.replace("'", "''") + "'"


def _older_site() -> str:
    """A site before 9.8.1: none of the keys these seeds created, the chat keys as
    the earlier seeds wrote them in Finnish and English only, and the superseded
    wording where it was. Keys the bootstrap already seeded before 9.8.1 keep
    their own description, so only rows carrying a seed's description are removed."""
    authored = _authored_rows()
    superseded = _superseded_rows()
    earlier = {key: row for key, row in _earlier_rows().items() if key in authored}
    statements = []
    for key in set(authored) - set(superseded) - set(earlier):
        statements.append(
            f"DELETE FROM system_lang_keys WHERE lang_key = '{key}' AND creation_spec = {_literal(authored[key][4])};"
        )
    for key, (fi, en, creation_spec) in earlier.items():
        statements.append(f"""
            DELETE FROM system_lang_keys WHERE lang_key = '{key}';
            INSERT INTO system_lang_keys (lang_key, fi, en, creation_spec)
            VALUES ('{key}', {_literal(fi)}, {_literal(en)}, {_literal(creation_spec)});
            INSERT INTO system_lang_key_translations (lang_key_id, language_code, translation, source_kind, review_status)
            SELECT id, code, text, 'manual', 'approved'
              FROM system_lang_keys CROSS JOIN LATERAL (VALUES ('fi', fi), ('en', en)) AS copy(code, text)
             WHERE lang_key = '{key}';
        """)
    for key, (fi, en, ch, yue) in superseded.items():
        values = ", ".join(_literal(value) for value in (fi, en, ch, yue))
        # Only the superseded columns are rewound; the rest and the description stay.
        statements.append(f"""
            INSERT INTO system_lang_keys AS keys (lang_key, fi, en, ch, yue) VALUES ('{key}', {values})
            ON CONFLICT (lang_key) DO UPDATE
            SET fi = COALESCE(EXCLUDED.fi, keys.fi), en = COALESCE(EXCLUDED.en, keys.en),
                ch = COALESCE(EXCLUDED.ch, keys.ch), yue = COALESCE(EXCLUDED.yue, keys.yue);
        """)
        for code, text in (("fi", fi), ("en", en)):
            if text is not None:
                statements.append(f"""
                    DELETE FROM system_lang_key_translations
                     WHERE language_code = '{code}'
                       AND lang_key_id = (SELECT id FROM system_lang_keys WHERE lang_key = '{key}');
                    INSERT INTO system_lang_key_translations
                        (lang_key_id, language_code, translation, source_kind, review_status)
                    SELECT id, '{code}', {_literal(text)}, 'legacy_{code}', 'approved'
                      FROM system_lang_keys WHERE lang_key = '{key}';
                """)
    return "\n".join(statements)


def _upgrade(run):
    for seed in SEEDS:
        run(seed.read_text())


@pytest.fixture
def site(database):  # noqa: F811  (the imported fixture is requested by name)
    """A disposable database installed from the reviewed public bootstrap."""
    database("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    database((BOOTSTRAP / "schema.sql").read_text())
    database((BOOTSTRAP / "seed_data.sql").read_text())
    return database


def test_seeded_copy_is_the_frontend_fallback_copy():
    rows = _authored_rows()
    for key, row in rows.items():
        assert all(value.strip() for value in row), key
        fallback = _frontend_fallback(key)
        if key in DATABASE_ONLY_KEYS:
            assert fallback is None, key
        else:
            assert fallback == row[:4], key


def test_keys_an_earlier_seed_wrote_keep_its_finnish_english_and_description():
    earlier = _earlier_rows()
    rows = _authored_rows()
    reused = set(rows) & set(earlier)
    assert reused, "the chat keys of the earlier seeds gain Chinese and Cantonese here"
    for key in reused:
        assert (rows[key][0], rows[key][1], rows[key][4]) == earlier[key], key


def test_placeholders_stay_literal_in_every_language():
    for key, row in _authored_rows().items():
        placeholders = {tuple(sorted(re.findall(r"\{[a-z_]+\}|\$[a-z_]+", text))) for text in row[:4]}
        assert len(placeholders) == 1, key


def test_bootstrap_runs_both_files_and_baselines_them():
    generator = (BOOTSTRAP / "generate_bootstrap.py").read_text()
    seed = (BOOTSTRAP / "seed_data.sql").read_text()
    for migration in SEEDS:
        assert migration.name in generator
        assert migration.read_text() in seed
        assert f"('{migration.name}')" in seed


def test_new_installation_has_every_key_in_every_language(site):
    for key, row in _authored_rows().items():
        assert _columns(site, key) == row[:4], key
        normalized = _normalized(site, key)
        assert (normalized["fi"][0], normalized["en"][0]) == row[:2], key
        # A key these seeds created is reviewed manual copy; a key the bootstrap
        # seeded earlier keeps the provenance it was written with.
        created_here = site(f"SELECT creation_spec FROM system_lang_keys WHERE lang_key = '{key}'") == row[4]
        if created_here:
            assert normalized == {"en": (row[1], "manual", "approved"), "fi": (row[0], "manual", "approved")}, key


def test_upgraded_site_ends_like_a_new_installation(site):
    keys = set(_authored_rows())
    fresh = _state(site, keys)
    site(_older_site())
    untouched_before = _snapshot(site, f"keys.lang_key NOT IN ({_key_list(keys)})")
    other_locales = (
        "SELECT json_agg(json_build_array(keys.lang_key, stored.language_code, stored.translation, "
        "stored.source_kind, stored.review_status) ORDER BY keys.lang_key, stored.language_code) "
        "FROM system_lang_key_translations AS stored JOIN system_lang_keys AS keys "
        f"ON keys.id = stored.lang_key_id WHERE keys.lang_key IN ({_key_list(keys)}) "
        "AND stored.language_code NOT IN ('fi', 'en')"
    )
    other_locales_before = site(other_locales)

    _upgrade(site)

    assert _state(site, keys) == fresh
    # No other language key changed, and no Chinese locale was written or claimed
    # reviewed: rows the bootstrap seeded earlier (zh-CN, needs_review) stay as they were.
    assert _snapshot(site, f"keys.lang_key NOT IN ({_key_list(keys)})") == untouched_before
    assert site(other_locales) == other_locales_before


def test_reviewed_translations_are_never_overwritten(site):
    site(_older_site())
    site("""
        UPDATE system_lang_keys SET fi = 'Ylläpitäjän tarkistama kansiovihje.' WHERE lang_key = 'table_folder_hint';
        UPDATE system_lang_key_translations AS stored
           SET translation = 'Ylläpitäjän tarkistama kansiovihje.', source_kind = 'manual'
          FROM system_lang_keys AS keys
         WHERE keys.id = stored.lang_key_id AND keys.lang_key = 'table_folder_hint' AND stored.language_code = 'fi';
        INSERT INTO system_lang_keys (lang_key, fi, en) VALUES ('confirm', '', 'OK');
        INSERT INTO system_lang_key_translations (lang_key_id, language_code, translation, source_kind, review_status)
        SELECT id, 'en', 'OK', 'manual', 'approved' FROM system_lang_keys WHERE lang_key = 'confirm';
    """)

    _upgrade(site)

    rows = _authored_rows()
    # The reviewed Finnish hint stays; the superseded English and Chinese give way.
    assert _columns(site, "table_folder_hint") == (
        "Ylläpitäjän tarkistama kansiovihje.", *rows["table_folder_hint"][1:4],
    )
    assert _normalized(site, "table_folder_hint")["fi"] == ("Ylläpitäjän tarkistama kansiovihje.", "manual", "approved")
    # The site's own English button stays; only the empty languages are filled.
    assert _columns(site, "confirm") == (rows["confirm"][0], "OK", *rows["confirm"][2:4])
    assert _normalized(site, "confirm") == {
        "en": ("OK", "manual", "approved"),
        "fi": (rows["confirm"][0], "manual", "approved"),
    }


def test_text_that_only_resembles_superseded_wording_is_kept(site):
    site(_older_site())
    site("UPDATE system_lang_keys SET en = 'Confirm save permissions.' WHERE lang_key = 'confirm_save_permissions';")

    _upgrade(site)

    rows = _authored_rows()
    assert _columns(site, "confirm_save_permissions")[:2] == (
        rows["confirm_save_permissions"][0], "Confirm save permissions.",
    )


def test_running_again_changes_nothing(site):
    site(_older_site())
    _upgrade(site)
    first = _snapshot(site)
    versions = site("SELECT count(*) FROM system_db_version")

    _upgrade(site)

    assert _snapshot(site) == first
    assert site("SELECT count(*) FROM system_db_version") == versions
