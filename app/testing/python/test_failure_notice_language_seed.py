"""Verify the failed-request notice and dataset form copy on install and upgrade.

Runs the DB 9.8.1 language seed on disposable PostgreSQL clusters loaded from the
reviewed public bootstrap, as a new installation and rewound to an older site.
Protects reviewed translations, replaces only the exact unreviewed placeholder,
and keeps the seeded copy equal to the frontend fallback copy. The folder hint
this file wrote is superseded by 20260922000005, whose test covers its current copy.
"""
from __future__ import annotations

import json
from pathlib import Path
import re

import pytest

from test_field_settings_language_seed import database  # noqa: F401  (disposable cluster fixture)

APP = Path(__file__).resolve().parents[2]
MIGRATION = APP / "server_tools/migrations/20260922000001_seed_failure_notice_and_dataset_form_language_keys.sql"
BOOTSTRAP = APP / "server_tools/public_bootstrap"
NOTICE_FALLBACKS = APP / "frontend/core_components/error_and_status_handling/error_monitor_handler_helpers.js"
FORM_FALLBACKS = APP / "frontend/core_components/general_tables/dataset_form/dataset_form_translation_fallbacks.js"
NOTICE_KEYS = ("server_error_notice", "network_error_notice")
FORM_KEYS = ("dataset_column_type_parameters", "actions", "table_folder_hint")
KEYS = NOTICE_KEYS + FORM_KEYS
# Rewritten by a later seed of the same release; a new installation holds that copy.
SUPERSEDED_KEYS = ("table_folder_hint",)
LANGUAGES = ("fi", "en", "ch", "yue")
PLACEHOLDER = {"fi": "Taulukon kansion vihje", "en": "Table folder hint"}
KEY_LIST = ", ".join(f"'{key}'" for key in KEYS)

# The state the local development database had before this migration: two
# keys only in frontend fallbacks, "actions" without Chinese copy, and the
# folder hint holding the wording made from its own name in both stores.
OLDER_SITE = f"""
DELETE FROM system_lang_keys
 WHERE lang_key IN ('server_error_notice', 'network_error_notice', 'dataset_column_type_parameters');
UPDATE system_lang_keys SET fi = 'Toiminnot', en = 'Actions', ch = NULL, yue = NULL, creation_spec = NULL
 WHERE lang_key = 'actions';
UPDATE system_lang_keys
   SET fi = '{PLACEHOLDER["fi"]}', en = '{PLACEHOLDER["en"]}', ch = NULL, yue = NULL, creation_spec = NULL
 WHERE lang_key = 'table_folder_hint';
UPDATE system_lang_key_translations AS stored
   SET translation = CASE stored.language_code WHEN 'fi' THEN keys.fi ELSE keys.en END,
       source_kind = 'legacy_' || stored.language_code
  FROM system_lang_keys AS keys
 WHERE keys.id = stored.lang_key_id AND keys.lang_key IN ('actions', 'table_folder_hint');
"""


def _authored_rows() -> dict[str, tuple[str, ...]]:
    block = MIGRATION.read_text().split("WITH authored_keys", 1)[1].split("), written_keys", 1)[0]
    literal = r"'((?:''|[^'])*)'"
    pattern = r"\(\s*" + r"\s*,\s*".join([literal] * 6) + r"\s*\)"
    return {
        row[0]: tuple(value.replace("''", "'") for value in row[1:])
        for row in re.findall(pattern, block, re.S)
    }


def _frontend_fallback(path: Path, key: str) -> tuple[str, ...]:
    """The fi, en, ch and yue copy of one key, written either as an object
    ({ fi: "...", ... }) or as a [Finnish, English, Chinese, Cantonese] array."""
    text = path.read_text()
    string = r"\"(?:[^\"\\]|\\.)*\""
    head = r"(?<![A-Za-z0-9_])[\"']?" + key + r"[\"']?\s*:\s*"
    array = re.search(head + r"\[\s*((?:" + string + r"\s*,?\s*){4})\]", text, re.S)
    if array:
        return tuple(json.loads(value) for value in re.findall(string, array[1]))
    member = r"[\"']?[A-Za-z]+[\"']?\s*:\s*" + string + r"\s*,?\s*"
    block = re.search(head + r"\{\s*((?:" + member + r")+)\}", text, re.S)[1]
    return tuple(
        json.loads(re.search(r"(?<![A-Za-z0-9_])[\"']?" + language + r"[\"']?\s*:\s*(" + string + ")", block)[1])
        for language in LANGUAGES
    )


def _columns(run, key: str) -> tuple[str, ...]:
    row = run(f"SELECT json_build_array(fi, en, ch, yue) FROM system_lang_keys WHERE lang_key = '{key}'")
    return tuple(json.loads(row))


def _normalized(run, key: str) -> dict[str, tuple[str, str, str]]:
    rows = run(
        "SELECT coalesce(json_agg(json_build_array(stored.language_code, stored.translation, "
        "stored.source_kind, stored.review_status) ORDER BY stored.language_code), '[]') "
        "FROM system_lang_key_translations AS stored JOIN system_lang_keys AS keys "
        f"ON keys.id = stored.lang_key_id WHERE keys.lang_key = '{key}'"
    )
    return {row[0]: tuple(row[1:]) for row in json.loads(rows)}


def _snapshot(run, where: str = "TRUE") -> str:
    """Every column of every selected row in both stores, timestamps included."""
    return run(
        "SELECT json_build_array("
        f"(SELECT json_agg(keys ORDER BY keys.id) FROM system_lang_keys AS keys WHERE {where}),"
        "(SELECT json_agg(stored ORDER BY stored.id) FROM system_lang_key_translations AS stored "
        f"JOIN system_lang_keys AS keys ON keys.id = stored.lang_key_id WHERE {where}))"
    )


@pytest.fixture
def site(database):  # noqa: F811  (the imported fixture is requested by name)
    """A disposable database installed from the reviewed public bootstrap."""
    database("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    database((BOOTSTRAP / "schema.sql").read_text())
    database((BOOTSTRAP / "seed_data.sql").read_text())
    return database


def test_seeded_copy_is_the_frontend_fallback_copy():
    rows = _authored_rows()
    assert set(rows) == set(KEYS)
    for key in NOTICE_KEYS:
        assert rows[key][:4] == _frontend_fallback(NOTICE_FALLBACKS, key), key
    for key in set(FORM_KEYS) - set(SUPERSEDED_KEYS):
        assert rows[key][:4] == _frontend_fallback(FORM_FALLBACKS, key), key
    assert all(row[4].strip() for row in rows.values())


def test_bootstrap_runs_this_same_file_and_baselines_it():
    assert MIGRATION.name in (BOOTSTRAP / "generate_bootstrap.py").read_text()
    seed = (BOOTSTRAP / "seed_data.sql").read_text()
    assert MIGRATION.read_text() in seed
    assert f"('{MIGRATION.name}')" in seed


def test_new_installation_has_every_key_in_every_language(site):
    rows = _authored_rows()
    for key in set(KEYS) - set(SUPERSEDED_KEYS):
        assert _columns(site, key) == rows[key][:4], key
        assert _normalized(site, key) == {
            "en": (rows[key][1], "manual", "approved"),
            "fi": (rows[key][0], "manual", "approved"),
        }, key


def test_upgrade_fills_missing_copy_and_replaces_the_exact_placeholder(site):
    site(OLDER_SITE)
    untouched_before = _snapshot(site, f"keys.lang_key NOT IN ({KEY_LIST})")

    site(MIGRATION.read_text())

    rows = _authored_rows()
    for key in ("server_error_notice", "network_error_notice", "dataset_column_type_parameters",
                "table_folder_hint"):
        assert _columns(site, key) == rows[key][:4], key
        assert _normalized(site, key) == {
            "en": (rows[key][1], "manual", "approved"),
            "fi": (rows[key][0], "manual", "approved"),
        }, key
    # "actions" already had Finnish and English in both stores: only the
    # missing Chinese and Cantonese columns are filled.
    assert _columns(site, "actions") == ("Toiminnot", "Actions", "操作", "操作")
    assert _normalized(site, "actions") == {
        "en": ("Actions", "legacy_en", "approved"),
        "fi": ("Toiminnot", "legacy_fi", "approved"),
    }
    # No other language key changed, and no Chinese locale was claimed reviewed.
    assert _snapshot(site, f"keys.lang_key NOT IN ({KEY_LIST})") == untouched_before
    assert site(
        "SELECT count(*) FROM system_lang_key_translations AS stored JOIN system_lang_keys AS keys "
        f"ON keys.id = stored.lang_key_id WHERE keys.lang_key IN ({KEY_LIST}) "
        "AND stored.language_code NOT IN ('fi', 'en')"
    ) == "0"


def test_reviewed_translations_are_never_overwritten(site):
    site(OLDER_SITE)
    site("""
        UPDATE system_lang_keys SET fi = 'Ylläpitäjän tarkistama kansiovihje.' WHERE lang_key = 'table_folder_hint';
        UPDATE system_lang_key_translations AS stored
           SET translation = 'Ylläpitäjän tarkistama kansiovihje.', source_kind = 'manual'
          FROM system_lang_keys AS keys
         WHERE keys.id = stored.lang_key_id AND keys.lang_key = 'table_folder_hint'
           AND stored.language_code = 'fi';
        INSERT INTO system_lang_keys (lang_key, fi, en) VALUES ('server_error_notice', 'Sivuston oma virheilmoitus.', '');
        INSERT INTO system_lang_key_translations (lang_key_id, language_code, translation, source_kind, review_status)
        SELECT id, 'fi', 'Sivuston oma virheilmoitus.', 'manual', 'approved'
          FROM system_lang_keys WHERE lang_key = 'server_error_notice';
    """)

    site(MIGRATION.read_text())

    rows = _authored_rows()
    # The reviewed Finnish hint stays in both stores; the English placeholder goes.
    assert _columns(site, "table_folder_hint")[:2] == (
        "Ylläpitäjän tarkistama kansiovihje.", rows["table_folder_hint"][1],
    )
    assert _normalized(site, "table_folder_hint") == {
        "en": (rows["table_folder_hint"][1], "manual", "approved"),
        "fi": ("Ylläpitäjän tarkistama kansiovihje.", "manual", "approved"),
    }
    # The site's own notice stays; only the empty English is filled.
    assert _columns(site, "server_error_notice")[:2] == (
        "Sivuston oma virheilmoitus.", rows["server_error_notice"][1],
    )
    assert _normalized(site, "server_error_notice")["fi"] == (
        "Sivuston oma virheilmoitus.", "manual", "approved",
    )


def test_text_that_only_resembles_the_placeholder_is_kept(site):
    site(OLDER_SITE)
    site("UPDATE system_lang_keys SET en = 'Table folder hint.' WHERE lang_key = 'table_folder_hint';")

    site(MIGRATION.read_text())

    rows = _authored_rows()
    assert _columns(site, "table_folder_hint")[:2] == (rows["table_folder_hint"][0], "Table folder hint.")


def test_running_again_changes_nothing(site):
    site(OLDER_SITE)
    site(MIGRATION.read_text())
    first = _snapshot(site)
    versions = site("SELECT count(*) FROM system_db_version")

    site(MIGRATION.read_text())

    assert _snapshot(site) == first
    assert site("SELECT count(*) FROM system_db_version") == versions
