"""Verify the DB 9.9.1 seed of the dataset form's Connect two fields copy on install and upgrade.

Runs 20260929000001 and the 9.9.1 release record on disposable PostgreSQL clusters loaded
from the reviewed public bootstrap, as a new installation and rewound to a 9.9.0
site. Keeps the seeded copy equal to the frontend fallback copy and the wording a
site already stores, ends a fresh and an upgraded installation the same, protects
reviewed translations, and changes nothing when run again. Also proves that a new
installation receives the dataset form copy of 20260919000005, which the bootstrap
used to mark as applied without running it.
"""
from __future__ import annotations

from pathlib import Path
import re

import pytest

from bootstrap_contract_assertions import assert_bootstrap_baseline
from test_field_settings_language_seed import database  # noqa: F401  (disposable cluster fixture)
from test_interface_language_seed_981 import (
    _columns,
    _frontend_fallback,
    _key_list,
    _literals,
    _normalized,
    _snapshot,
)

APP = Path(__file__).resolve().parents[2]
MIGRATIONS = APP / "server_tools/migrations"
SEED = MIGRATIONS / "20260929000001_seed_connect_two_fields_language_keys.sql"
RELEASE = MIGRATIONS / "20260929000003_record_database_release_9_9_1.sql"
DIMENSION_SEED = MIGRATIONS / "20260919000005_seed_dataset_form_dimension_language_keys.sql"
BOOTSTRAP = APP / "server_tools/public_bootstrap"
PANEL = APP / "frontend/core_components/general_tables/dataset_form/dataset_foreign_keys_panel.js"
# The column labels of the foreign-keys page, which sites hold from before the
# public seeds in Finnish and English only, without a description.
TECHNICAL_WORDING = {
    "referencing_column": ("Viittaava sarake", "Referencing column"),
    "referenced_table": ("Viitattu taulu", "Referenced table"),
    "referenced_column": ("Viitattu sarake", "Referenced column"),
    "select_column": ("Valitse sarake", "Select column"),
}
# A text key handed to one of the panel's text helpers as a literal.
PANEL_KEY = re.compile(
    r"(?:setDatasetFormText\([^,()]*(?:\([^()]*\))?\s*,|labelledSelect\(\s*row\s*,"
    r"|fill\([^,]+,|placeholder\([^,]+,|status\.show\()\s*\"([a-z][a-z0-9_]*)\""
)


def _authored_rows() -> dict[str, tuple[str, ...]]:
    block = SEED.read_text().split("WITH authored_keys", 1)[1].split("), written_keys", 1)[0]
    rows = {}
    for row in _literals(block, 6):
        assert row[0] not in rows, f"{row[0]} is seeded twice"
        rows[row[0]] = row[1:]
    return rows


def _dimension_rows() -> dict[str, tuple[str, str, str]]:
    """fi, en and creation_spec of the keys 20260919000005 wrote."""
    block = DIMENSION_SEED.read_text().split("WITH authored_keys", 1)[1].split("\n)\n", 1)[0]
    return {row[0]: row[1:] for row in _literals(block, 4)}


def _created_here() -> set[str]:
    """The keys no site holds before this seed."""
    return set(_authored_rows()) - set(_dimension_rows()) - set(TECHNICAL_WORDING)


def _state(run, keys) -> str:
    """Both stores of the given keys, without generated ids and timestamps.

    A site keeps the provenance its older Finnish and English rows of the
    technical labels were written with (legacy_fi, legacy_en), while a new
    installation writes them as manual copy: text and review status must agree,
    the provenance label of those rows may not."""
    selected = _key_list(keys)
    legacy = _key_list(TECHNICAL_WORDING)
    return run(
        "SELECT json_build_array("
        "(SELECT json_agg(json_build_array(lang_key, fi, en, ch, yue, creation_spec) ORDER BY lang_key) "
        f" FROM system_lang_keys WHERE lang_key IN ({selected})),"
        "(SELECT json_agg(json_build_array(keys.lang_key, stored.language_code, stored.translation, "
        f"  CASE WHEN keys.lang_key IN ({legacy}) THEN NULL ELSE stored.source_kind END, stored.review_status) "
        "  ORDER BY keys.lang_key, stored.language_code) "
        " FROM system_lang_key_translations AS stored JOIN system_lang_keys AS keys "
        f" ON keys.id = stored.lang_key_id WHERE keys.lang_key IN ({selected})))"
    )


def _older_site() -> str:
    """A 9.9.0 site: none of the keys this seed creates, the link messages in
    Finnish and English only, the technical labels as older sites hold them,
    and no 9.9.1 version row."""
    created = _key_list(_created_here())
    links = _key_list(_dimension_rows().keys() & _authored_rows().keys())
    technical = _key_list(TECHNICAL_WORDING)
    return f"""
        DELETE FROM system_lang_keys WHERE lang_key IN ({created});
        UPDATE system_lang_keys SET ch = NULL, yue = NULL WHERE lang_key IN ({links});
        UPDATE system_lang_keys SET ch = NULL, yue = NULL, creation_spec = '' WHERE lang_key IN ({technical});
        UPDATE system_lang_key_translations AS stored
           SET source_kind = 'legacy_' || stored.language_code
          FROM system_lang_keys AS keys
         WHERE keys.id = stored.lang_key_id AND keys.lang_key IN ({technical})
           AND stored.language_code IN ('fi', 'en');
        DELETE FROM system_db_version WHERE version = '9.9.1';
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


def test_seeded_copy_is_the_frontend_fallback_copy():
    rows = _authored_rows()
    assert len(rows) == 15
    for key, row in rows.items():
        assert all(value.strip() for value in row), key
        assert _frontend_fallback(key) == row[:4], key


def test_link_messages_keep_the_wording_and_description_of_their_first_seed():
    rows = _authored_rows()
    earlier = _dimension_rows()
    reused = set(rows) & set(earlier)
    assert reused == {
        "dataset_foreign_keys_title", "dataset_foreign_keys_none",
        "dataset_foreign_keys_unavailable", "dataset_foreign_key_save_failed",
    }
    for key in reused:
        assert (rows[key][0], rows[key][1], rows[key][4]) == earlier[key], key


def test_technical_labels_keep_the_wording_sites_already_store():
    rows = _authored_rows()
    for key, wording in TECHNICAL_WORDING.items():
        assert rows[key][:2] == wording, key


def test_bootstrap_runs_the_seeds_in_upgrade_order_and_baselines_them():
    generator = (BOOTSTRAP / "generate_bootstrap.py").read_text()
    listed = generator.split("language_seed_migrations = (", 1)[1].split(")", 1)[0]
    names = re.findall(r"\"([0-9]{14}_[a-z0-9_]+\.sql)\"", listed)
    assert names == sorted(names)
    assert DIMENSION_SEED.name in names and SEED.name in names
    # The version row of a new installation comes from its own seed, not from this file.
    assert RELEASE.name not in generator
    seed = (BOOTSTRAP / "seed_data.sql").read_text()
    for migration in (DIMENSION_SEED, SEED):
        assert migration.read_text() in seed
    for migration in (DIMENSION_SEED, SEED, RELEASE):
        assert_bootstrap_baseline(seed, migration)


def test_new_installation_has_every_key_in_every_language(site):
    for key, row in _authored_rows().items():
        assert _columns(site, key) == row[:4], key
        normalized = _normalized(site, key)
        assert (normalized["fi"][0], normalized["en"][0]) == row[:2], key
    # A new installation records the release it was generated at, 9.9.1 or later.
    current = (APP / "VERSION_DB").read_text().strip()
    assert tuple(int(part) for part in current.split(".")) >= (9, 9, 1)
    assert site(f"SELECT count(*) FROM system_db_version WHERE version = '{current}'") == "1"


def test_new_installation_has_the_dataset_form_copy_of_20260919000005(site):
    for key in _dimension_rows():
        fi, en = _columns(site, key)[:2]
        assert fi and en, key


def test_every_text_of_the_links_panel_is_in_a_new_installation(site):
    keys = set(PANEL_KEY.findall(PANEL.read_text()))
    assert {"connect_two_fields", "connect_two_fields_choose_column", "dataset_foreign_keys_title"} <= keys
    assert not keys & set(TECHNICAL_WORDING), "the form reads its own keys, not the technical page's"
    for key in sorted(keys):
        assert all(value and value.strip() for value in _columns(site, key)), key


def test_upgraded_site_ends_like_a_new_installation(site):
    keys = set(_authored_rows())
    fresh = _state(site, keys)
    site(_older_site())
    untouched_before = _snapshot(site, f"keys.lang_key NOT IN ({_key_list(keys)})")

    _upgrade(site)

    assert _state(site, keys) == fresh
    assert _snapshot(site, f"keys.lang_key NOT IN ({_key_list(keys)})") == untouched_before
    assert site("SELECT count(*) FROM system_db_version WHERE version = '9.9.1'") == "1"


def test_reviewed_translations_are_never_overwritten(site):
    site(_older_site())
    site("""
        UPDATE system_lang_keys SET ch = '站点自己的列标题' WHERE lang_key = 'referenced_table';
        UPDATE system_lang_keys SET yue = '網站自己嘅標題' WHERE lang_key = 'dataset_foreign_keys_title';
        INSERT INTO system_lang_keys (lang_key, fi) VALUES ('connect_two_fields_explanation', 'Sivuston oma selitys.');
    """)

    _upgrade(site)

    rows = _authored_rows()
    assert _columns(site, "referenced_table") == (
        *TECHNICAL_WORDING["referenced_table"], "站点自己的列标题", rows["referenced_table"][3],
    )
    assert _columns(site, "dataset_foreign_keys_title") == (*rows["dataset_foreign_keys_title"][:3], "網站自己嘅標題")
    assert _columns(site, "connect_two_fields_explanation") == (
        "Sivuston oma selitys.", *rows["connect_two_fields_explanation"][1:4],
    )
    assert _normalized(site, "connect_two_fields_explanation") == {
        "en": (rows["connect_two_fields_explanation"][1], "manual", "approved"),
        "fi": ("Sivuston oma selitys.", "manual", "approved"),
    }


def test_running_again_changes_nothing(site):
    site(_older_site())
    _upgrade(site)
    first = _snapshot(site)
    versions = site("SELECT count(*) FROM system_db_version")

    _upgrade(site)

    assert _snapshot(site) == first
    assert site("SELECT count(*) FROM system_db_version") == versions
