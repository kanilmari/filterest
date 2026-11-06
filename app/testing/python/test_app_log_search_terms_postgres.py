"""test_app_log_search_terms_postgres.py
Prove the setting and release migrations replay on native disposable PostgreSQL.
Connect the exact upgrade SQL and generated fresh seed to whole-row preservation.
The supervisor opts in; these tests never target an installation database.
"""
import json
import re

import pytest

from test_app_log_search_terms import APP, CONFIG_SCHEMA, KEY, MIGRATION, release_owner, setting_seed
from test_field_settings_language_seed import database  # noqa: F401


@pytest.mark.parametrize("existing", [None, False, True])
def test_postgres_upgrade_and_seed_replay_preserve_whole_row(database, existing):
    database(CONFIG_SCHEMA)
    if existing is not None:
        value = str(existing).lower()
        database(f"INSERT INTO system_config VALUES ('{KEY}',{value},'{{\"value\":{value}}}','{value}',2,'Site choice')")
    database(MIGRATION.read_text())
    database(release_owner().read_text())
    before = database(f"SELECT row_to_json(c) FROM system_config c WHERE key='{KEY}'")
    for source in (MIGRATION.read_text(), setting_seed()):
        for _ in range(2):
            database(source)
            database(release_owner().read_text())
            assert database(f"SELECT row_to_json(c) FROM system_config c WHERE key='{KEY}'") == before
    actual = json.loads(before)
    expected = False if existing is None else existing
    assert actual["boolean_value"] is expected
    assert actual["json_value"] == {"value": expected}
    assert actual["text_value"] == str(expected).lower()
    assert actual["value_type"] == 2
    assert database(f"SELECT count(*) FROM system_config WHERE key='{KEY}'") == "1"
    assert database("SELECT count(*) FROM system_db_version") == "1"


def test_postgres_complete_fresh_bootstrap_has_one_private_default(database):
    database("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    bootstrap = APP / "server_tools/public_bootstrap"
    database((bootstrap / "schema.sql").read_text())
    database((bootstrap / "seed_data.sql").read_text())
    before = database(f"SELECT row_to_json(c) FROM system_config c WHERE key='{KEY}'")
    actual = json.loads(before)
    assert actual["boolean_value"] is False
    assert actual["json_value"] == {"value": False}
    assert actual["text_value"] == "false"
    assert actual["value_type"] == 2
    for _ in range(2):
        database(MIGRATION.read_text())
        database(release_owner().read_text())
        assert database(f"SELECT row_to_json(c) FROM system_config c WHERE key='{KEY}'") == before
        assert database(f"SELECT count(*) FROM system_config WHERE key='{KEY}'") == "1"
    version = re.search(r"^-- VERSION_DB: (.+)$", MIGRATION.read_text(), re.M)[1]
    assert database(f"SELECT count(*) FROM system_db_version WHERE version='{version}'") == "1"
