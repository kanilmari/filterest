"""test_app_log_search_terms.py
Prove one private default across upgrades and fresh installations.
Connect the versioned setting migration, bootstrap seed and release metadata.
Offline replay proves idempotence; PostgreSQL proofs are explicitly opted in.
"""
from contextlib import closing
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import unittest

APP = Path(__file__).resolve().parents[2]
MIGRATION = APP / "server_tools/migrations/20261105000001_add_app_log_search_terms.sql"
KEY = "app_log_search_terms"
CONFIG_SCHEMA = """
CREATE TABLE system_config (key TEXT PRIMARY KEY, boolean_value BOOLEAN,
    json_value JSONB, text_value TEXT, value_type INT, creation_spec TEXT);
"""


def release_owner():
    return MIGRATION.parent / re.search(r"^-- VERSION_DB_OWNER: (.+)$", MIGRATION.read_text(), re.M)[1]


def setting_seed():
    seed = (APP / "server_tools/public_bootstrap/seed_data.sql").read_text()
    # Replay the exact setting block shipped in the fresh-installation seed.
    return re.search(r"INSERT INTO public.system_config[^\n]*\nSELECT 'app_log_search_terms'.*?WHERE NOT EXISTS[^;]*;", seed, re.S)[0]


class AppLogSearchTermsTests(unittest.TestCase):
    def test_one_versioned_default_and_bootstrap_evidence(self):
        source = MIGRATION.read_text()
        version = re.search(r"^-- VERSION_DB: (.+)$", source, re.M)[1]
        # Derive the version so gate restamping needs no test edits.
        assert re.fullmatch(r"[0-9]+[.][0-9]+[.][0-9]+", version)
        current_version = (APP / "VERSION_DB").read_text().strip()
        assert release_owner().name > MIGRATION.name
        assert f"-- VERSION_DB: {version}" in release_owner().read_text()
        assert f"SELECT '{version}'," in release_owner().read_text()
        assert f"WHERE version = '{version}'" in release_owner().read_text()
        assert f"SELECT '{KEY}', false, '{{\"value\":false}}'::jsonb, 'false', 2," in source
        assert not re.search(r"\b(?:UPDATE|DELETE)\s+(?:public\.)?system_config", source, re.I)
        bootstrap = APP / "server_tools/public_bootstrap"
        seed = (bootstrap / "seed_data.sql").read_text()
        assert source in seed
        manifest = json.loads((bootstrap / "manifest.json").read_text())
        assert manifest["db_version"] == current_version
        for path in (MIGRATION, release_owner()):
            assert path.name in manifest["migration_ledger_baseline"]
            assert hashlib.sha256(path.read_bytes()).hexdigest() in seed
        assert (APP / f"server_tools/versioning/schema_snapshots/db-{current_version}.sql").read_bytes() == (bootstrap / "schema.sql").read_bytes()

    def test_migration_and_fresh_seed_insert_once_and_preserve_choices_offline(self):
        for source in (MIGRATION.read_text(), setting_seed()):
            for existing in (None, False, True):
                with self.subTest(source="migration" if source == MIGRATION.read_text() else "seed", existing=existing):
                    # Only the schema qualifier and JSON cast differ in this narrow SQLite proof.
                    sql = source.replace("public.", "").replace("::jsonb", "")
                    with closing(sqlite3.connect(":memory:")) as connection:
                        connection.executescript(CONFIG_SCHEMA)
                        connection.execute("CREATE TABLE system_db_version (version TEXT, description TEXT)")
                        owner_sql = release_owner().read_text().replace("public.", "")
                        if existing is not None:
                            connection.execute("INSERT INTO system_config VALUES (?, ?, ?, ?, 2, ?)",
                                               (KEY, existing, json.dumps({"value": existing}), str(existing).lower(), "Site choice"))
                        connection.executescript(sql)
                        connection.executescript(owner_sql)
                        before = connection.execute("SELECT * FROM system_config").fetchall()
                        connection.executescript(sql)
                        connection.executescript(owner_sql)
                        assert connection.execute("SELECT * FROM system_config").fetchall() == before
                        assert len(before) == 1
                        assert connection.execute("SELECT count(*) FROM system_db_version").fetchone()[0] == 1
                        expected = False if existing is None else existing
                        key, boolean, document, text, kind, _ = before[0]
                        assert [key, bool(boolean), json.loads(document), text, kind] == [KEY, expected, {"value": expected}, str(expected).lower(), 2]
                        if existing is not None:
                            assert before[0][-1] == "Site choice"


if __name__ == "__main__":
    unittest.main()
