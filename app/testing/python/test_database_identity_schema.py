"""test_database_identity_schema.py
Check identity schema ownership, native initialization and reference admission offline.
Connect the migration, generated bootstrap and supported setup without accessing a database.
Keep installation values out of shared bootstrap seeds and preserve strict inventory admission.
"""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

from test_schema_drift import drift_module, snapshot, table

APP = Path(__file__).resolve().parents[2]
ROOT = APP.parent
BOOTSTRAP = APP / "server_tools/public_bootstrap"
NAME = "20261009000079_reconcile_system_database_identity_schema.sql"
MIGRATION = APP / "server_tools/migrations" / NAME
SETUP = APP / "server_tools/setup_local_dev_environment.sh"


def test_migration_owns_identity_schema_and_setup_owns_only_the_first_row():
    sql = MIGRATION.read_text()
    assert "-- VERSION_DB: 9.11.0" in sql
    assert "-- VERSION_DB_OWNER: 20261009000099_record_database_release_9_11_0.sql" in sql
    assert "INSERT INTO public.system_database_identity" not in sql
    assert not re.search(r"\b(?:UPDATE|DELETE FROM)\s+public\.system_database_identity\b", sql)
    assert not re.search(r"\bGRANT\b", sql)
    assert "readeronly" not in sql
    setup = SETUP.read_text() + (APP / "server_tools/lib/setup_native_database.sh").read_text()
    assert not re.search(r"CREATE\s+(?:TABLE|TRIGGER).*system_database_identity", setup)
    assert "CREATE OR REPLACE FUNCTION set_system_database_identity" not in setup
    assert NAME in setup
    assert setup.index(NAME) < setup.index("INSERT INTO system_database_identity")
    assert '"Database identity schema migration" --single-transaction' in setup
    assert "WHERE NOT EXISTS (SELECT 1 FROM system_database_identity)" in setup


def test_schema_matches_the_original_installer_oracle():
    original = (Path(__file__).parent / "fixtures/database_identity_installer.sql").read_text()
    table_sql = re.search(r"CREATE TABLE IF NOT EXISTS (?:public\.)?system_database_identity \(.*?\n\);", MIGRATION.read_text(), re.S)
    original_sql = re.search(r"CREATE TABLE IF NOT EXISTS system_database_identity \(.*?\n\);", original, re.S)
    assert table_sql.group().replace("public.", "") == original_sql.group()
    body = original[original.index("RETURNS TRIGGER AS $$"):original.index("$$ LANGUAGE plpgsql;")]
    assert body in MIGRATION.read_text()


def test_bootstrap_includes_identity_schema_without_an_installation_row():
    manifest = json.loads((BOOTSTRAP / "manifest.json").read_text())
    assert "public.system_database_identity" in manifest["allowed_schema_tables"]
    assert "public.system_database_identity" not in manifest["allowed_seed_tables"]
    assert NAME in manifest["migration_ledger_baseline"]
    assert NAME < "20261009000099_record_database_release_9_11_0.sql"
    assert NAME > "20261009000078"
    assert MIGRATION.read_text() in (BOOTSTRAP / "schema.sql").read_text()
    assert manifest["source_files"]["filterest/app/server_tools/migrations/" + NAME]["sha256"] == hashlib.sha256(MIGRATION.read_bytes()).hexdigest()
    version = (APP / "VERSION_DB").read_text().strip()
    assert (APP / f"server_tools/versioning/schema_snapshots/db-{version}.sql").read_bytes() == (BOOTSTRAP / "schema.sql").read_bytes()


def test_started_native_reference_is_admitted_and_identity_stays_managed():
    # Bind the simulated started catalogue to the REAL checkout manifest; a
    # synthetic manifest containing the extra table would hide the regression.
    manifest = json.loads((BOOTSTRAP / "manifest.json").read_text())
    reference = snapshot((APP / "VERSION_DB").read_text().strip())
    names = set(manifest["allowed_schema_tables"]) | {"public.system_database_identity"}
    reference["tables"] = [table(name) for name in sorted(names)]
    reference["ledger"] = [
        {"filename": name, "content_sha256": manifest["source_files"]["filterest/app/server_tools/migrations/" + name]["sha256"],
         "outcome": "bootstrap_baseline", "provenance": "bootstrap"}
        for name in manifest["migration_ledger_baseline"]
    ]
    # Even registration by a site must not turn the shared table into site data.
    reference["metadata"]["datasets"] = [{"name": "public.system_database_identity", "table_uid": 99999}]
    report, status = drift_module().check_exports(deepcopy(reference), reference, ROOT)
    assert status == 0, report["errors"]
    assert "public.system_database_identity" not in report["site_owned"]["classification"]
    site = deepcopy(reference)
    site["tables"] = [t for t in site["tables"] if t["name"] != "public.system_database_identity"]
    report, status = drift_module().check_exports(site, reference, ROOT)
    assert status == 1
    assert next(t for t in report["tables"] if t["name"] == "public.system_database_identity")["structural_state"] == "missing"


def test_bootstrap_check_refuses_stale_outputs_without_writing(tmp_path):
    target = tmp_path / "checkout"
    command = [sys.executable, str(BOOTSTRAP / "generate_bootstrap.py"), "--target", str(target)]
    generated = subprocess.run(command, capture_output=True, text=True)
    assert generated.returncode == 0, generated.stderr
    package = target / "app/server_tools/public_bootstrap"
    schema = package / "schema.sql"
    schema.write_text(schema.read_text() + "-- stale output\n")
    before = {name: (package / name).read_bytes() for name in ("schema.sql", "seed_data.sql", "manifest.json")}
    checked = subprocess.run(command + ["--check"], capture_output=True, text=True)
    assert checked.returncode != 0
    assert "schema.sql" in checked.stderr
    assert {name: (package / name).read_bytes() for name in before} == before
