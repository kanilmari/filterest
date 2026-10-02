"""Verify the DB 9.9.2 seed of the missing media files section on install and upgrade.

Runs 20260929000005 and the 9.9.2 release record on disposable PostgreSQL clusters
loaded from the reviewed public bootstrap, as a new installation and rewound to a
9.9.1 site whose keys the retired startup routine wrote. Keeps the seeded copy equal
to the section's own fallback copy, covers every text the section renders, ends a
fresh and an upgraded installation the same, replaces only the exact wording of the
routine that was reworded, protects reviewed translations, and changes nothing when
run again.
"""
from __future__ import annotations

from pathlib import Path
import re

import pytest

from test_field_settings_language_seed import database  # noqa: F401  (disposable cluster fixture)
from test_interface_language_seed_981 import (
    STRING,
    _columns,
    _js_string,
    _key_list,
    _literal,
    _literals,
    _normalized,
    _snapshot,
)

APP = Path(__file__).resolve().parents[2]
MIGRATIONS = APP / "server_tools/migrations"
SEED = MIGRATIONS / "20260929000005_seed_missing_media_check_language_keys.sql"
RELEASE = MIGRATIONS / "20260929000006_record_database_release_9_9_2.sql"
PREVIOUS_SEED = MIGRATIONS / "20260929000001_seed_connect_two_fields_language_keys.sql"
BOOTSTRAP = APP / "server_tools/public_bootstrap"
ADMIN_TOOLS = APP / "frontend/core_components/admin_tools"
FALLBACKS = ADMIN_TOOLS / "missing_media_check_translation_fallbacks.js"
SECTION = (ADMIN_TOOLS / "missing_media_check_panel.js", ADMIN_TOOLS / "missing_media_check_result_printer.js")
TRANSLATOR = APP / "frontend/core_components/lang/translation_handler.js"
STARTUP = APP / "backend/core_components/startup"
LANGUAGES = ("fi", "en", "ch", "yue")
# The keys the retired startup routine wrote at every start, in all four languages and
# without a description or normalized rows. Sites hold them in the seeded wording, except
# the two keys of the unused-file list, which the seed rewords (SUPERSEDED_KEYS).
RETIRED_ROUTINE_KEYS = frozenset("""
    missing_media_check missing_media_check_description missing_media_check_run_now
    missing_media_check_running missing_media_check_never_run missing_media_check_disabled
    missing_media_check_last_run missing_media_check_rows_checked missing_media_check_datasets_checked
    missing_media_check_missing_files missing_media_check_all_present missing_media_check_row_budget_reached
    missing_media_check_time_budget_reached missing_media_check_datasets_exceed_budget
    missing_media_check_enabled_setting missing_media_check_max_rows_setting
    missing_media_check_max_seconds_setting missing_media_check_unused_files_setting
    missing_media_check_unused_files missing_media_check_save_settings missing_media_check_settings_saved
    missing_media_check_legacy_filename missing_media_check_unresolved_reference
""".split())
SUPERSEDED_KEYS = frozenset({"missing_media_check_unused_files", "missing_media_check_unused_files_setting"})


def _authored_rows() -> dict[str, tuple[str, ...]]:
    block = SEED.read_text().split("WITH authored_keys", 1)[1].split("), written_keys", 1)[0]
    rows = {}
    for row in _literals(block, 6):
        assert row[0] not in rows, f"{row[0]} is seeded twice"
        rows[row[0]] = row[1:]
    return rows


def _superseded_rows() -> dict[str, tuple[str, ...]]:
    """The fi, en, ch and yue wording of the retired routine that step 1 withdraws."""
    block = SEED.read_text().split("WITH superseded_copy", 1)[1].split("), withdrawn_translations", 1)[0]
    return {row[0]: row[1:] for row in _literals(block, 5)}


def _fallback_copy() -> dict[str, tuple[str, ...]]:
    """The fi, en, ch and yue copy of every key of the section's fallback table."""
    body = FALLBACKS.read_text().split("MISSING_MEDIA_CHECK_TRANSLATION_FALLBACKS = Object.freeze({", 1)[1]
    body = body.split("\n});", 1)[0]
    copy = {}
    for key, block in re.findall(r"\n    ([a-z][a-z0-9_]*): \{(.*?)\}", body, re.S):
        assert key not in copy, f"{key} has two fallbacks"
        copy[key] = tuple(
            _js_string(re.search(r"\b" + language + r": (" + STRING + ")", block)[1]) for language in LANGUAGES
        )
    return copy


def _section_keys() -> set[str]:
    """Every language key the section names as a literal."""
    keys = set()
    for path in SECTION:
        keys |= set(re.findall(r"'(missing_media_check(?:_[a-z0-9]+)*)'", path.read_text()))
    return keys


def _state(run, keys) -> str:
    """Both stores of the given keys, without generated ids and timestamps."""
    selected = _key_list(keys)
    return run(
        "SELECT json_build_array("
        "(SELECT json_agg(json_build_array(lang_key, fi, en, ch, yue, creation_spec) ORDER BY lang_key) "
        f" FROM system_lang_keys WHERE lang_key IN ({selected})),"
        "(SELECT json_agg(json_build_array(keys.lang_key, stored.language_code, stored.translation, "
        "  stored.source_kind, stored.review_status) ORDER BY keys.lang_key, stored.language_code) "
        " FROM system_lang_key_translations AS stored JOIN system_lang_keys AS keys "
        f" ON keys.id = stored.lang_key_id WHERE keys.lang_key IN ({selected})))"
    )


def _older_site() -> str:
    """A 9.9.1 site: the keys of the retired startup routine in four languages and in its
    wording, without a description or normalized rows, none of the keys this release
    adds, and no 9.9.2 version row."""
    authored = _authored_rows()
    retired = _key_list(RETIRED_ROUTINE_KEYS)
    added = _key_list(set(authored) - RETIRED_ROUTINE_KEYS)
    rewound = "\n".join(
        f"UPDATE system_lang_keys SET fi = {_literal(fi)}, en = {_literal(en)}, ch = {_literal(ch)}, "
        f"yue = {_literal(yue)} WHERE lang_key = '{key}';"
        for key, (fi, en, ch, yue) in _superseded_rows().items()
    )
    return f"""
        DELETE FROM system_lang_keys WHERE lang_key IN ({added});
        DELETE FROM system_lang_key_translations
         WHERE lang_key_id IN (SELECT id FROM system_lang_keys WHERE lang_key IN ({retired}));
        UPDATE system_lang_keys SET creation_spec = NULL WHERE lang_key IN ({retired});
        {rewound}
        DELETE FROM system_db_version WHERE version = '9.9.2';
    """


def _upgrade(run):
    run(SEED.read_text())
    run(RELEASE.read_text())


@pytest.fixture
def site(database):  # noqa: F811  (the imported fixture is requested by name)
    """A disposable database installed from the reviewed public bootstrap."""
    database("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    database((BOOTSTRAP / "schema.sql").read_text())
    database((BOOTSTRAP / "seed_data.sql").read_text())
    return database


def test_seeded_copy_is_the_section_fallback_copy():
    rows = _authored_rows()
    assert {key: row[:4] for key, row in rows.items()} == _fallback_copy()
    for key, row in rows.items():
        assert all(value and value.strip() for value in row), key


def test_the_section_renders_exactly_the_seeded_keys():
    assert _section_keys() == set(_authored_rows())


def test_the_retired_startup_routine_is_gone_and_its_keys_are_seeded():
    assert len(RETIRED_ROUTINE_KEYS) == 23
    assert RETIRED_ROUTINE_KEYS <= set(_authored_rows())
    # Only keys the routine wrote are withdrawn, and only where the seed rewords them.
    superseded = _superseded_rows()
    assert set(superseded) == SUPERSEDED_KEYS <= RETIRED_ROUTINE_KEYS
    for key, wording in superseded.items():
        assert all(wording), key
        assert all(old != new for old, new in zip(wording, _authored_rows()[key][:4])), key
    assert not (STARTUP / "missing_media_check_lang_keys.go").exists()
    for source in STARTUP.glob("*.go"):
        assert "EnsureMissingMediaCheckLangKeys" not in source.read_text(), source.name


def test_the_page_translator_serves_the_fallback_copy():
    translator = TRANSLATOR.read_bytes()
    assert b"from '../admin_tools/missing_media_check_translation_fallbacks.js'" in translator
    assert b"...MISSING_MEDIA_CHECK_TRANSLATION_FALLBACKS," in translator


def test_bootstrap_runs_the_seed_in_upgrade_order_and_baselines_it():
    generator = (BOOTSTRAP / "generate_bootstrap.py").read_text()
    listed = generator.split("language_seed_migrations = (", 1)[1].split(")", 1)[0]
    names = re.findall(r"\"([0-9]{14}_[a-z0-9_]+\.sql)\"", listed)
    assert names == sorted(names)
    assert names.index(SEED.name) == names.index(PREVIOUS_SEED.name) + 1
    # The version row of a new installation comes from its own seed, not from this file.
    assert RELEASE.name not in generator
    seed = (BOOTSTRAP / "seed_data.sql").read_text()
    assert SEED.read_text() in seed
    for migration in (SEED, RELEASE):
        assert f"('{migration.name}')" in seed


def test_new_installation_has_every_key_in_every_language(site):
    for key, row in _authored_rows().items():
        assert _columns(site, key) == row[:4], key
        assert _normalized(site, key) == {
            "en": (row[1], "manual", "approved"),
            "fi": (row[0], "manual", "approved"),
        }, key


def test_upgraded_site_ends_like_a_new_installation(site):
    keys = set(_authored_rows())
    fresh = _state(site, keys)
    site(_older_site())
    untouched_before = _snapshot(site, f"keys.lang_key NOT IN ({_key_list(keys)})")

    _upgrade(site)

    assert _state(site, keys) == fresh
    assert _snapshot(site, f"keys.lang_key NOT IN ({_key_list(keys)})") == untouched_before
    assert site("SELECT count(*) FROM system_db_version WHERE version = '9.9.2'") == "1"


def test_reviewed_translations_are_never_overwritten(site):
    site(_older_site())
    site("""
        UPDATE system_lang_keys SET fi = 'Kadonneet kuvat' WHERE lang_key = 'missing_media_check';
        INSERT INTO system_lang_keys (lang_key, yue) VALUES ('missing_media_check_details', '網站自己嘅詳情');
    """)

    _upgrade(site)

    rows = _authored_rows()
    assert _columns(site, "missing_media_check") == ("Kadonneet kuvat", *rows["missing_media_check"][1:4])
    assert _columns(site, "missing_media_check_details") == (*rows["missing_media_check_details"][:3], "網站自己嘅詳情")
    assert _normalized(site, "missing_media_check")["fi"] == ("Kadonneet kuvat", "manual", "approved")


def test_only_the_exact_wording_of_the_routine_gives_way(site):
    site(_older_site())
    # The site reworded the English label and the Finnish setting itself; those stay.
    site("""
        UPDATE system_lang_keys SET en = 'Files to review' WHERE lang_key = 'missing_media_check_unused_files';
        UPDATE system_lang_keys SET fi = 'Näytä myös irralliset tiedostot'
         WHERE lang_key = 'missing_media_check_unused_files_setting';
    """)

    _upgrade(site)

    rows = _authored_rows()
    label, setting = rows["missing_media_check_unused_files"], rows["missing_media_check_unused_files_setting"]
    assert _columns(site, "missing_media_check_unused_files") == (label[0], "Files to review", *label[2:4])
    assert _columns(site, "missing_media_check_unused_files_setting") == (
        "Näytä myös irralliset tiedostot", *setting[1:4],
    )
    assert _normalized(site, "missing_media_check_unused_files") == {
        "en": ("Files to review", "manual", "approved"),
        "fi": (label[0], "manual", "approved"),
    }


def test_running_again_changes_nothing(site):
    site(_older_site())
    _upgrade(site)
    first = _snapshot(site)
    versions = site("SELECT count(*) FROM system_db_version")

    _upgrade(site)

    assert _snapshot(site) == first
    assert site("SELECT count(*) FROM system_db_version") == versions
