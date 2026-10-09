"""Verify the DB 9.9.2 settings row of the missing media files check on install and upgrade.

Runs 20260929000004 on disposable PostgreSQL clusters loaded from the reviewed public
bootstrap, as a new installation and as sites that store the first shape of the
setting, any combination of the run choices, a value that is not an object, or no row
at all. Keeps every stored value except the two run choices, which become after-update
only (K122), gives the row the JSON editor, writes no result row, changes nothing when
run again, and proves a new installation is born with the row from the same file.
"""
from __future__ import annotations

import json
from pathlib import Path
import re

import pytest

from bootstrap_contract_assertions import assert_bootstrap_baseline
from test_field_settings_language_seed import database  # noqa: F401  (disposable cluster fixture)

APP = Path(__file__).resolve().parents[2]
MIGRATIONS = APP / "server_tools/migrations"
MIGRATION = MIGRATIONS / "20260929000004_add_missing_media_check_setting.sql"
RELEASE = MIGRATIONS / "20260929000006_record_database_release_9_9_2.sql"
BOOTSTRAP = APP / "server_tools/public_bootstrap"
SETTINGS_SOURCE = APP / "backend/core_components/missing_media_check/missing_media_settings_reader.go"
KEY = "missing_media_check"
RESULT_KEY = "missing_media_check_last_result"
# The row as the first release of the check wrote it on first use: no editor type.
FIRST_SHAPE = {
    "enabled": True, "run_on_startup": True, "schema_version": 1, "max_run_seconds": 45,
    "report_unused_files": True, "max_reported_missing": 200, "min_rows_per_dataset": 50,
    "startup_delay_seconds": 30, "max_total_rows_checked": 2500, "max_reported_unused_files": 200,
}
FIRST_SPEC = ("Administrator-managed check that verifies media files referenced by rows still exist in "
              "storage. Reports only; never deletes or repairs.")
# What the upgrade stamps over a stored object: the owner's decision K122 runs the
# check on every site after an update and not at every start.
AFTER_UPDATE_ONLY = {"schema_version": 2, "run_on_startup": False, "run_after_update": True}


def _seeded() -> tuple[dict, str]:
    """The defaults and the description the migration writes."""
    match = re.search(r"VALUES \(\s*'(\{[^']*\})'::jsonb,\s*'((?:[^']|'')*)'\s*\)", MIGRATION.read_text())
    assert match, "the migration no longer states its defaults where this test reads them"
    return json.loads(match.group(1)), match.group(2).replace("''", "'")


def _row(run, key: str = KEY):
    stored = run(
        "SELECT json_build_array(json_value, value_type, creation_spec, text_value) "
        f"FROM system_config WHERE key = '{key}'"
    )
    return json.loads(stored) if stored else None


def _full_row(run) -> str:
    return run(f"SELECT row_to_json(config)::text FROM system_config AS config WHERE key = '{KEY}'")


def _literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


@pytest.fixture
def site(database):  # noqa: F811  (the imported fixture is requested by name)
    """A disposable database installed from the reviewed public bootstrap."""
    database("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    database((BOOTSTRAP / "schema.sql").read_text())
    database((BOOTSTRAP / "seed_data.sql").read_text())
    return database


def _first_shape_site(run, value: str = json.dumps(FIRST_SHAPE)) -> None:
    """A 9.9.1 site on which the check has run: the first-shape row and a result row."""
    run(f"""
        DELETE FROM system_config WHERE key IN ('{KEY}', '{RESULT_KEY}');
        INSERT INTO system_config (key, json_value, creation_spec)
        VALUES ('{KEY}', {_literal(value)}::jsonb, {_literal(FIRST_SPEC)});
        INSERT INTO system_config (key, json_value, creation_spec)
        VALUES ('{RESULT_KEY}', '{{"schema_version": 1, "trigger": "startup"}}'::jsonb, 'Latest result');
        DELETE FROM system_db_version WHERE version = '9.9.2';
    """)


def test_the_defaults_run_after_updates_and_not_at_every_start():
    defaults, description = _seeded()
    assert defaults["schema_version"] == 2
    assert defaults["run_after_update"] is True and defaults["run_on_startup"] is False
    assert defaults["sampling"] == "even" and defaults["exact_count_max_rows"] == 100000
    # The Go fallback writes the same description; the Go test compares the values too.
    spec = re.search(r'const settingsCreationSpec = "((?:[^"\\]|\\.)*)"', SETTINGS_SOURCE.read_text())
    assert spec and json.loads('"' + spec.group(1) + '"') == description


def test_the_bootstrap_seeds_the_row_and_marks_the_file_applied():
    generator = (BOOTSTRAP / "generate_bootstrap.py").read_text()
    listed = generator.split("setting_seed_migrations = (", 1)[1].split(")", 1)[0]
    assert MIGRATION.name in listed
    seed = (BOOTSTRAP / "seed_data.sql").read_text()
    assert MIGRATION.read_text() in seed
    for migration in (MIGRATION, RELEASE):
        assert_bootstrap_baseline(seed, migration)


def test_a_new_installation_is_born_with_the_row_and_no_result(site):
    defaults, description = _seeded()
    assert _row(site) == [defaults, 5, description, None]
    assert _row(site, RESULT_KEY) is None
    current = (APP / "VERSION_DB").read_text().strip()
    assert site(f"SELECT count(*) FROM system_db_version WHERE version = '{current}'") == "1"


def test_a_first_shape_row_keeps_its_values_but_runs_only_after_updates(site):
    defaults, description = _seeded()
    _first_shape_site(site)
    result_before = _row(site, RESULT_KEY)

    site(MIGRATION.read_text())

    value, value_type, spec, text_value = _row(site)
    assert value == {**defaults, **FIRST_SHAPE, **AFTER_UPDATE_ONLY}
    # Every other stored choice stays; the two run choices follow the owner's K122.
    assert value["max_total_rows_checked"] == 2500 and value["report_unused_files"] is True
    assert (value_type, spec, text_value) == (5, description, None)
    assert _row(site, RESULT_KEY) == result_before


@pytest.mark.parametrize("on_startup", [True, False])
@pytest.mark.parametrize("after_update", [True, False])
@pytest.mark.parametrize("enabled", [True, False])
def test_every_stored_run_choice_becomes_after_update_only(site, on_startup, after_update, enabled):
    defaults, _ = _seeded()
    stored = {**FIRST_SHAPE, "schema_version": 2, "enabled": enabled, "run_on_startup": on_startup,
              "run_after_update": after_update, "site_note": "kept by this site"}
    _first_shape_site(site, json.dumps(stored))

    site(MIGRATION.read_text())

    value = _row(site)[0]
    assert value == {**defaults, **stored, **AFTER_UPDATE_ONLY}
    # A site that switched the whole check off keeps it off, and its own key stays.
    assert value["enabled"] is enabled and value["site_note"] == "kept by this site"


@pytest.mark.parametrize("on_startup", [True, False])
def test_running_again_changes_nothing(site, on_startup):
    _first_shape_site(site, json.dumps({**FIRST_SHAPE, "run_on_startup": on_startup}))
    site(MIGRATION.read_text())
    first = _full_row(site)

    site(MIGRATION.read_text())

    assert _full_row(site) == first
    assert site(f"SELECT count(*) FROM system_config WHERE key = '{KEY}'") == "1"


def test_a_site_without_the_row_receives_the_defaults_and_no_result(site):
    defaults, description = _seeded()
    site(f"DELETE FROM system_config WHERE key IN ('{KEY}', '{RESULT_KEY}')")

    site(MIGRATION.read_text())

    assert _row(site) == [defaults, 5, description, None]
    assert _row(site, RESULT_KEY) is None


@pytest.mark.parametrize("stored", ['[1, 2]', '"check everything"', 'null'])
def test_a_value_that_is_not_an_object_is_left_for_the_administrator(site, stored):
    _, description = _seeded()
    _first_shape_site(site, stored)

    site(MIGRATION.read_text())
    site(MIGRATION.read_text())

    assert _row(site) == [json.loads(stored), 5, description, None]
