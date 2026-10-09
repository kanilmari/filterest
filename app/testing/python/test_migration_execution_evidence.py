"""test_migration_execution_evidence.py
Verify the migration ledger's nullable evidence and generated bootstrap baselines.
Connect reviewed migration bytes to the public generator, manifest and schema snapshot.
Keep source checks offline and SQL replay confined to opt-in disposable clusters.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

import pytest

from test_field_settings_language_seed import database  # noqa: F401
from test_public_bootstrap_independence import copy_public_inputs, generate

APP = Path(__file__).resolve().parents[2]
MIGRATIONS = APP / "server_tools/migrations"
MIGRATION = MIGRATIONS / "20261009000020_add_migration_execution_evidence.sql"
BOOTSTRAP = APP / "server_tools/public_bootstrap"
OWNER = "20261009000099_record_database_release_9_10_2.sql"
EVIDENCE_ROWS = re.compile(
    r"\('([^']+\.sql)', '([0-9a-f]{64})', 'bootstrap_baseline', 'bootstrap'\)"
)


def test_evidence_migration_joins_unreleased_version_and_has_no_history_backfill():
    sql = MIGRATION.read_text()
    assert MIGRATION.name.startswith("2026100900002") and MIGRATION.name < OWNER
    assert "-- VERSION_DB: 9.10.2" in sql
    assert f"-- VERSION_DB_OWNER: {OWNER}" in sql
    assert "-- COMPLETION_MARKER: wl157_migration_execution_evidence" in sql
    assert "system_db_version" not in sql
    assert not re.search(r"\bUPDATE\b|\bDEFAULT\b|ADD COLUMN[^\n]*\bNOT NULL\b", sql)
    for column in ("content_sha256", "outcome", "provenance"):
        assert f"ADD COLUMN IF NOT EXISTS {column} text" in sql
    assert "interrupted_self_managed" in sql and "optional_failure_skipped" in sql and "failed_self_managed" in sql


def test_bootstrap_evidence_binds_every_source_and_matching_snapshot():
    manifest = json.loads((BOOTSTRAP / "manifest.json").read_text())
    seed = (BOOTSTRAP / "seed_data.sql").read_text()
    rows = EVIDENCE_ROWS.findall(seed)
    expected = [(path.name, hashlib.sha256(path.read_bytes()).hexdigest())
                for path in sorted(MIGRATIONS.glob("*.sql"))]
    assert rows == expected
    assert manifest["migration_ledger_baseline"] == [name for name, _ in expected]
    for name, digest in expected:
        assert manifest["source_files"]["filterest/app/server_tools/migrations/" + name]["sha256"] == digest
    for filename in ("schema.sql", "seed_data.sql"):
        digest = hashlib.sha256((BOOTSTRAP / filename).read_bytes()).hexdigest()
        assert manifest["generated_files"]["server_tools/public_bootstrap/" + filename]["sha256"] == digest
    assert (BOOTSTRAP / "schema.sql").read_bytes() == (
        APP / "server_tools/versioning/schema_snapshots/db-9.10.2.sql").read_bytes()
    assert (BOOTSTRAP / "schema.sql").read_text().count(MIGRATION.read_text()) == 1
    acceptance = seed[seed.index("DO $filterest_acceptance$"):]
    assert "wl157_migration_execution_evidence" in acceptance
    assert acceptance.index("missing completion markers") < acceptance.index("INSERT INTO public.system_schema_migrations")


def test_regenerated_evidence_package_is_reproducible(tmp_path):
    root = copy_public_inputs(tmp_path)
    result = generate(root)
    assert result.returncode == 0, result.stderr
    for name in ("schema.sql", "seed_data.sql", "manifest.json"):
        assert (root / "app/server_tools/public_bootstrap" / name).read_bytes() == (BOOTSTRAP / name).read_bytes()


@pytest.mark.parametrize("tamper", ["hash", "outcome", "provenance", "null"])
def test_bootstrap_audit_refuses_fabricated_execution_evidence(tmp_path, tamper):
    root = copy_public_inputs(tmp_path)
    bootstrap = root / "app/server_tools/public_bootstrap"
    seed = (bootstrap / "seed_data.sql").read_text()
    row = EVIDENCE_ROWS.search(seed)
    original = row.group(0)
    replacement = {
        "hash": original.replace(row[2], "0" * 64),
        "outcome": original.replace("bootstrap_baseline", "applied"),
        "provenance": original.replace("'bootstrap'", "'runner'"),
        "null": original.replace("'" + row[2] + "'", "NULL"),
    }[tamper]
    (bootstrap / "seed_data.sql").write_text(seed.replace(original, replacement, 1))
    # Adjust the artifact checksum so the content contract, beyond file hashing,
    # must independently refuse the fabricated execution claim.
    manifest = json.loads((bootstrap / "manifest.json").read_text())
    manifest["generated_files"]["server_tools/public_bootstrap/seed_data.sql"]["sha256"] = hashlib.sha256(
        (bootstrap / "seed_data.sql").read_bytes()).hexdigest()
    (bootstrap / "manifest.json").write_text(json.dumps(manifest))
    result = subprocess.run([sys.executable, str(root / "app/server_tools/public_slice_export/audit_public_bootstrap.py"),
                             "--target", str(root)], capture_output=True, text=True)
    assert result.returncode != 0
    assert "bootstrap ledger must bind every folded-in source hash" in result.stdout + result.stderr


def test_evidence_extension_replays_without_verifying_historical_rows(database):
    database("""CREATE TABLE system_schema_migrations(filename text PRIMARY KEY, applied_at timestamptz DEFAULT now());
        CREATE TABLE system_data_repair_records(migration text, action text);
        INSERT INTO system_schema_migrations VALUES ('old_success.sql','2026-01-01'),('old_optional_failure.sql','2026-01-02');""")
    for _ in range(2):
        database(MIGRATION.read_text())
    assert database("SELECT count(*) FROM system_schema_migrations WHERE content_sha256 IS NULL AND outcome IS NULL AND provenance IS NULL") == "2"
    assert database("SELECT min(applied_at)::date||'|'||max(applied_at)::date FROM system_schema_migrations") == "2026-01-01|2026-01-02"
    assert database("SELECT count(*) FROM system_data_repair_records WHERE migration='wl157_migration_execution_evidence' AND action='completed'") == "1"
    assert database("SELECT count(*) FROM system_db_version") == "0"
    digest = "a" * 64
    for outcome, provenance in (("applied", "runner"), ("optional_failure_skipped", "runner"),
                                ("interrupted_self_managed", "runner"), ("failed_self_managed", "runner"),
                                ("bootstrap_baseline", "bootstrap")):
        database(f"INSERT INTO system_schema_migrations(filename,content_sha256,outcome,provenance) VALUES('{outcome}.sql','{digest}','{outcome}','{provenance}')")
    for values in (f"'{digest}',NULL,'runner'", f"NULL,'applied','runner'", f"'{digest}','applied',NULL",
                   f"'{digest}','applied','bootstrap'", f"'{digest}','bootstrap_baseline','runner'",
                   "'invalid','applied','runner'", f"'{digest}','unknown','runner'"):
        with pytest.raises(subprocess.CalledProcessError):
            database(f"INSERT INTO system_schema_migrations(filename,content_sha256,outcome,provenance) VALUES('invalid.sql',{values})")
    assert database("SELECT count(*) FROM system_schema_migrations") == "7"
