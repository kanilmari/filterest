"""Verify namespace bootstrap phases, snapshot checks and immutable audit inputs.

Runs only offline generators against temporary output; no database or network.
Protects fresh/upgrade source agreement and the check mode's no-repair contract.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

APP = Path(__file__).resolve().parents[2]
GENERATOR = APP / "server_tools/public_bootstrap/generate_bootstrap.py"
MIGRATION = APP / "server_tools/migrations/20261009000078_enforce_dataset_name_namespace.sql"


def generate(target, *options):
    return subprocess.run(
        [sys.executable, str(GENERATOR), "--target", str(target), "--snapshot", *options],
        capture_output=True, text=True, check=False,
    )


def test_namespace_schema_precedes_seeds_and_translations_follow_languages(tmp_path):
    result = generate(tmp_path)
    assert result.returncode == 0, result.stderr
    bootstrap = tmp_path / "app/server_tools/public_bootstrap"
    schema = (bootstrap / "schema.sql").read_text()
    seed = (bootstrap / "seed_data.sql").read_text()
    manifest = json.loads((bootstrap / "manifest.json").read_text())
    assert "CREATE TABLE IF NOT EXISTS public.system_dataset_namespace_lock" in schema
    assert "CREATE TRIGGER dataset_namespace_table_guard" in schema
    assert "CREATE TRIGGER dataset_namespace_alias_guard" in schema
    assert "WITH authored(lang_key,fi,en,ch,yue)" not in schema.split(MIGRATION.name)[-1]
    assert "dataset_namespace_real_name_conflict" in seed
    assert seed.index("'dataset_namespace_conflict'") < seed.index("$filterest_acceptance$")
    source = "filterest/app/server_tools/migrations/" + MIGRATION.name
    assert manifest["source_files"][source]["sha256"] == hashlib.sha256(MIGRATION.read_bytes()).hexdigest()
    assert MIGRATION.name in manifest["migration_ledger_baseline"]
    version = (APP / "VERSION_DB").read_text().strip()
    assert (tmp_path / f"app/server_tools/versioning/schema_snapshots/db-{version}.sql").read_bytes() == (bootstrap / "schema.sql").read_bytes()
    assert generate(tmp_path, "--check").returncode == 0


def test_namespace_bootstrap_check_refuses_drift_without_repair(tmp_path):
    assert generate(tmp_path).returncode == 0
    schema = tmp_path / "app/server_tools/public_bootstrap/schema.sql"
    changed = schema.read_bytes() + b"\n-- counterproof: namespace artifact drift\n"
    schema.write_bytes(changed)
    result = generate(tmp_path, "--check")
    assert result.returncode != 0
    assert "Generated artifacts differ" in result.stderr
    assert schema.read_bytes() == changed


def test_namespace_migration_sorts_before_release_and_does_not_rewrite_timestamps():
    source = MIGRATION.read_text()
    assert "20261009000077" < MIGRATION.name < "20261009000099"
    assert "-- VERSION_DB: 9.11.0" in source
    assert "-- VERSION_DB_OWNER: 20261009000099_record_database_release_9_11_0.sql" in source
    assert "DELETE FROM public.system_db_table_aliases" not in source
    assert "NEW.updated := OLD.updated" in source
    assert "ALTER COLUMN" not in source
    assert "DISABLE TRIGGER" not in source
    assert "pg_advisory_xact_lock(159, 284)" in source
    assert "SET revision = revision + 1" in source
