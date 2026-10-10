"""test_application_update_migrations.py
Verify public migration ordering, bootstrap evidence and private update storage.
Connect fresh installations and upgrades to the same reviewed admission migrations.
Use only generated artifacts and the opt-in disposable PostgreSQL harness.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import pytest

from test_row_actor_support import cluster

APP = Path(__file__).resolve().parents[2]
BOOTSTRAP = APP / "server_tools/public_bootstrap"
MIGRATIONS = APP / "server_tools/migrations"
OWNER = "20261009000099_record_database_release_9_10_2.sql"
NAMES = (
    "20261009000050_create_application_update_admission.sql",
    "20261009000051_register_application_update_capability.sql",
    "20261009000052_seed_application_update_refusal_keys.sql",
)
sys.path.insert(0, str(BOOTSTRAP))
from sql_identifier_validator import RESERVED_IDENTIFIER_KEYWORDS, declared_identifiers, validate_sql_identifiers


def test_application_update_identifiers_are_safe_offline():
    for name in NAMES:
        source = (MIGRATIONS / name).read_text()
        validate_sql_identifiers(source, name)
    source = (MIGRATIONS / NAMES[0]).read_text()
    names = [item.name for item in declared_identifiers(source)]
    assert names.count("authorization_context") == 3
    # Restoring the round-A bug fails offline, before any SQL is installed.
    with pytest.raises(ValueError, match="reserved PostgreSQL identifier 'authorization'"):
        validate_sql_identifiers(source.replace("authorization_context", "authorization"), NAMES[0])


def test_application_update_bootstrap_evidence_is_complete_and_reproducible(tmp_path):
    manifest = json.loads((BOOTSTRAP / "manifest.json").read_text())
    schema = (BOOTSTRAP / "schema.sql").read_text()
    seed = (BOOTSTRAP / "seed_data.sql").read_text()
    acceptance = seed[seed.index("DO $filterest_acceptance$"):]
    for name in NAMES:
        source = (MIGRATIONS / name).read_text()
        assert name < OWNER
        assert "-- VERSION_DB: 9.10.2" in source
        assert f"-- VERSION_DB_OWNER: {OWNER}" in source
        marker = source.split("-- COMPLETION_MARKER: ", 1)[1].splitlines()[0]
        check = source.split("-- FINAL_CHECK: ", 1)[1].splitlines()[0]
        assert marker in acceptance and check in acceptance
        assert (schema + seed).count(source) == 1
        evidence = manifest["source_files"]["filterest/app/server_tools/migrations/" + name]
        assert evidence["sha256"] == hashlib.sha256((MIGRATIONS / name).read_bytes()).hexdigest()
    assert schema == (APP / "server_tools/versioning/schema_snapshots/db-9.10.2.sql").read_text()
    result = subprocess.run([sys.executable, str(BOOTSTRAP / "generate_bootstrap.py"), "--target", str(tmp_path)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    for name in ("schema.sql", "seed_data.sql", "manifest.json"):
        assert (tmp_path / "app/server_tools/public_bootstrap" / name).read_bytes() == (BOOTSTRAP / name).read_bytes()


def test_application_update_fresh_bootstrap_and_migration_replay_postgres(cluster):
    cluster("CREATE DATABASE update_admission")
    for name in ("schema.sql", "seed_data.sql"):
        cluster((BOOTSTRAP / name).read_text(), "update_admission")
    for _ in range(2):
        for name in NAMES:
            cluster((MIGRATIONS / name).read_text(), "update_admission")
    query = """
        SELECT (SELECT count(*) FROM restricted.system_application_update_control),
            (SELECT count(*) FROM public.system_group_table_func_rights r JOIN public.system_functions f ON f.id=r.function_id WHERE f.name='capability.application_update'),
            (SELECT count(*) FROM public.system_db_tables WHERE table_name LIKE 'system_application_update_%'),
            (SELECT count(*) FROM public.app_check_application_update_admission()),
            (SELECT count(*) FROM public.app_check_application_update_capability()),
            (SELECT count(*) FROM public.app_check_application_update_refusal_keys());
    """
    assert cluster(query, "update_admission").stdout.strip() == "0|0|0|0|0|0"
    # Confirm the offline guard's vocabulary against the server's own categories.
    forbidden = cluster("SELECT word FROM pg_get_keywords() WHERE catcode IN ('R','T') ORDER BY word", "update_admission")
    assert set(forbidden.stdout.splitlines()) == RESERVED_IDENTIFIER_KEYWORDS
    columns = cluster("""
        SELECT count(*) FROM pg_catalog.pg_attribute
        WHERE attrelid IN ('restricted.system_application_update_jobs'::regclass,
            'restricted.system_application_update_decisions'::regclass,
            'restricted.system_application_update_events'::regclass)
        AND attname='authorization_context' AND atttypid='jsonb'::regtype
        AND attnotnull AND attnum>0 AND NOT attisdropped
    """, "update_admission")
    assert columns.stdout.strip() == "3"
    result = cluster('BEGIN; ALTER TABLE restricted.system_application_update_jobs RENAME COLUMN authorization_context TO "authorization"; SELECT count(*) FROM public.app_check_application_update_admission(); ROLLBACK;', "update_admission")
    assert "1" in result.stdout.splitlines()
    # A completion marker alone cannot conceal a missing single-active-job constraint.
    result = cluster("BEGIN; DROP INDEX restricted.system_application_update_one_active; SELECT count(*) FROM public.app_check_application_update_admission(); ROLLBACK;", "update_admission")
    assert "1" in result.stdout.splitlines()
