"""test_dataset_kind_bootstrap.py
Verify the kind migration's source boundary and exact fresh-install artifacts.
Connect pre-release migration order to the regenerated bootstrap evidence.
Keep fresh-install checks aligned with the accepted migration filenames.
"""
from pathlib import Path
import hashlib
import json

from bootstrap_contract_assertions import assert_bootstrap_baseline

APP = Path(__file__).resolve().parents[2]
ROOT = APP.parent
BOOTSTRAP = APP / "server_tools/public_bootstrap"
MIGRATIONS = APP / "server_tools/migrations"
NAMES = ("20261009000075_add_dataset_kind_contracts.sql", "20261009000076_seed_dataset_kind_language_keys.sql")


def test_kind_migrations_precede_release_and_bootstrap_baselines_exact_bytes():
    manifest = json.loads((BOOTSTRAP / "manifest.json").read_text())
    for name in NAMES:
        migration = MIGRATIONS / name
        assert name < "20261009000099_record_database_release_9_10_2.sql"
        assert "-- VERSION_DB: 9.10.2" in migration.read_text()
        assert "system_db_version" not in migration.read_text()
        assert name in manifest["migration_ledger_baseline"]
        assert_bootstrap_baseline((BOOTSTRAP / "seed_data.sql").read_text(), migration)
    assert (MIGRATIONS / NAMES[0]).read_text() in (BOOTSTRAP / "schema.sql").read_text()
    assert (MIGRATIONS / NAMES[1]).read_text() in (BOOTSTRAP / "seed_data.sql").read_text()
    version = (APP / "VERSION_DB").read_text().strip()
    assert (BOOTSTRAP / "schema.sql").read_bytes() == (APP / f"server_tools/versioning/schema_snapshots/db-{version}.sql").read_bytes()
    for name, evidence in manifest["source_files"].items():
        path = ROOT / name.removeprefix("filterest/")
        assert hashlib.sha256(path.read_bytes()).hexdigest() == evidence["sha256"], name


def test_kind_migration_does_not_convert_history_rights_or_defaults():
    sql = (MIGRATIONS / NAMES[0]).read_text()
    assert "table_kind text NOT NULL DEFAULT 'ordinary'" in sql
    assert "kind_version integer NOT NULL DEFAULT 0" in sql
    assert "COMPLETION_MARKER: wl163_dataset_kind_contracts" in sql
    assert "'chat_messages','chat_settings') OR kind_version=1" in sql
    assert "UPDATE public.system_db_tables" not in sql
    assert "system_group_table_func_rights" not in sql
    assert "default_view_id" not in sql
    assert "GRANT " not in sql


def test_kind_copy_has_every_bundled_language_and_preserves_site_translations():
    sql = (MIGRATIONS / NAMES[1]).read_text()
    assert "authored(lang_key,fi,en,ch,yue)" in sql
    for code in ("fi", "en", "zh-CN", "zh-TW", "zh-HK"):
        assert f"('{code}',CASE WHEN NULLIF(btrim(s." in sql
    assert "'needs_review'" in sql
    assert "WHERE NOT EXISTS" in sql
    assert "DO UPDATE" not in sql


def test_kind_copy_rejects_whitespace_but_keeps_authored_bytes():
    sql = (MIGRATIONS / NAMES[1]).read_text()
    whitespace = r"E' \t\n\r\f' || chr(11)"
    for field in ("fi", "en", "ch", "yue"):
        assert f"NULLIF(btrim(s.{field},{whitespace}),'')" in sql
        assert f"ELSE s.{field} END" in sql
    assert f"WHERE NULLIF(btrim(c.translation,{whitespace}),'') IS NOT NULL" in sql


def test_kind_ordering_comment_matches_execution_order():
    sql = (MIGRATIONS / NAMES[0]).read_text()
    assert "Ordered after 20261009000099" not in sql


def test_kind_upgrade_proof_starts_at_released_9_10_1_and_runs_pending_migrations():
    proof = (APP / "backend/core_components/system_table_tools/dataset_kind_postgres_test.go").read_text()
    helpers = (APP / "backend/core_components/system_table_tools/dataset_kind_upgrade_proof_test.go").read_text()
    assert '"v9.3.23:app/server_tools/public_bootstrap/"' in helpers
    assert "RunMigrations" in proof
    assert "assertKindSchemaParity" in proof
    assert '"cdddc4b:' not in proof
