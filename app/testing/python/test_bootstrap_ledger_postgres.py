"""test_bootstrap_ledger_postgres.py
Verify the generated bootstrap's complete migration evidence on PostgreSQL.
Connect the public generator and current migration bytes to the existing disposable cluster harness.
Prove the installed ledger and version directly, independent of SQL spellings or static scans.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

from test_row_actor_support import cluster

APP = Path(__file__).resolve().parents[2]
BOOTSTRAP = APP / "server_tools/public_bootstrap"
MIGRATIONS = APP / "server_tools/migrations"


def test_generated_bootstrap_installs_exact_migration_evidence_and_version(cluster, tmp_path) -> None:
    """One fresh database must contain every baseline once, with current bytes and no additional history."""
    generated = subprocess.run(
        [sys.executable, str(BOOTSTRAP / "generate_bootstrap.py"), "--target", str(tmp_path)],
        capture_output=True, text=True,
    )
    assert generated.returncode == 0, generated.stderr
    package = tmp_path / "app/server_tools/public_bootstrap"
    migration_files = sorted(MIGRATIONS.glob("*.sql"))
    assert migration_files, "the public migration baseline must not be empty"
    # Build expectations from source files, never the generated acceptance SQL or manifest.
    expected = [
        [migration.name, hashlib.sha256(migration.read_bytes()).hexdigest(), "bootstrap_baseline", "bootstrap"]
        for migration in migration_files
    ]

    cluster("CREATE DATABASE bootstrap_ledger")
    for filename in ("schema.sql", "seed_data.sql"):
        cluster((package / filename).read_text(encoding="utf-8"), "bootstrap_ledger")

    rows = cluster("""
        SELECT json_build_array(filename, content_sha256, outcome, provenance)
        FROM public.system_schema_migrations ORDER BY filename COLLATE "C"
    """, "bootstrap_ledger").stdout.splitlines()
    # List equality retains duplicates and catches missing, extra, NULL or conflicting evidence rows.
    assert [json.loads(row) for row in rows] == expected
    versions = cluster("SELECT version FROM public.system_db_version", "bootstrap_ledger").stdout.splitlines()
    assert versions == [(APP / "VERSION_DB").read_text(encoding="utf-8").strip()]
