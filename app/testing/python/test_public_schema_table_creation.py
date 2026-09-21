"""Prove that only the application's role can create tables in schema public.

Runs the DB 9.8.1 migrations on disposable PostgreSQL clusters shaped like a
database first created before PostgreSQL 15, and like a new installation.
Protects the read-only role's inability to create tables while datasets can
still be created, and keeps the public bootstrap on the same migration text.
"""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile

import pytest

APP = Path(__file__).resolve().parents[2]
MIGRATIONS = APP / "server_tools/migrations"
WITHDRAW = MIGRATIONS / "20260921000001_withdraw_public_table_creation.sql"
RECORD = MIGRATIONS / "20260921000002_record_public_table_creation_release.sql"
BOOTSTRAP = APP / "server_tools/public_bootstrap"
GENERATOR = BOOTSTRAP / "generate_bootstrap.py"

RUNTIME_ROLES = ("readeronly", "basic_user", "guest_user", "limited_user")

# The public-schema permissions of the full dump taken from production in
# February 2026 on PostgreSQL 16.11, statement for statement. PostgreSQL 16's
# pg_dump wrote them because the source database still had the ownership and
# PUBLIC CREATE right that PostgreSQL 14 and older gave every new database.
LEGACY_PUBLIC_SCHEMA_ACL = """
ALTER SCHEMA public OWNER TO postgres;
REVOKE USAGE ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO PUBLIC;
GRANT USAGE ON SCHEMA public TO readeronly;
GRANT USAGE ON SCHEMA public TO basic_user;
GRANT USAGE ON SCHEMA public TO guest_user;
GRANT ALL ON SCHEMA public TO admin_user;
GRANT USAGE ON SCHEMA public TO limited_user;
"""

# The grants the local installer gives a new database after the bootstrap.
INSTALLER_PUBLIC_SCHEMA_GRANTS = """
GRANT USAGE, CREATE ON SCHEMA public TO admin_user;
GRANT USAGE ON SCHEMA public TO readeronly;
GRANT USAGE ON SCHEMA public TO basic_user;
GRANT USAGE ON SCHEMA public TO guest_user;
GRANT USAGE ON SCHEMA public TO limited_user;
"""

VERSION_TABLE = """
CREATE TABLE IF NOT EXISTS public.system_db_version (
    id BIGSERIAL PRIMARY KEY, version TEXT, applied_at TIMESTAMPTZ DEFAULT now(), description TEXT
);
"""

DATASET_DDL = """
CREATE TABLE public.app_probe_dataset (id SERIAL PRIMARY KEY, name TEXT);
ALTER TABLE public.app_probe_dataset ADD COLUMN description TEXT;
CREATE INDEX app_probe_dataset_name_idx ON public.app_probe_dataset (name);
COMMENT ON TABLE public.app_probe_dataset IS 'disposable dataset';
INSERT INTO public.app_probe_dataset (name, description) VALUES ('row', 'kept');
DROP TABLE public.app_probe_dataset;
"""


def test_bootstrap_runs_the_same_withdrawal_and_baselines_both_files():
    """A new installation must reach the upgraded state from the same text."""
    assert "20260921000001_withdraw_public_table_creation.sql" in GENERATOR.read_text()
    assert WITHDRAW.read_text() in (BOOTSTRAP / "schema.sql").read_text()
    seed = (BOOTSTRAP / "seed_data.sql").read_text()
    assert f"('{WITHDRAW.name}')" in seed
    assert f"('{RECORD.name}')" in seed


@pytest.fixture
def cluster():
    """Run SQL on a disposable Unix-socket-only cluster, never a live database."""
    if os.environ.get("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1":
        pytest.skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 for isolated PostgreSQL checks")
    pg_bin = Path(os.environ.get("PG_TEST_BIN", "/usr/lib/postgresql/16/bin"))
    if not (pg_bin / "initdb").exists():
        pytest.skip("PostgreSQL test binaries unavailable")
    with tempfile.TemporaryDirectory(prefix="public-create-test-") as directory:
        base = Path(directory)
        data = base / "pgdata"
        socket = base / "socket"
        socket.mkdir(mode=0o700)
        # The bootstrap superuser is called postgres, as in the databases the
        # legacy permissions come from.
        subprocess.run([str(pg_bin / "initdb"), "-D", str(data), "-A", "trust", "-U", "postgres",
                        "--no-locale", "--encoding=UTF8"], check=True, capture_output=True)
        subprocess.run([str(pg_bin / "pg_ctl"), "-D", str(data), "-l", str(base / "postgres.log"),
                        "-o", f"-h '' -k '{socket}' -p 15471", "-w", "start"],
                       check=True, capture_output=True)
        try:
            def run(sql, *, database="postgres", role="postgres", check=True):
                result = subprocess.run(
                    [str(pg_bin / "psql"), "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
                     "-h", str(socket), "-p", "15471", "-U", role, "-d", database],
                    input=sql, text=True, capture_output=True,
                )
                if check and result.returncode != 0:
                    raise AssertionError(f"{role}@{database} failed: {result.stderr}")
                return result

            run("CREATE ROLE admin_user LOGIN SUPERUSER;"
                + "".join(f"CREATE ROLE {role} LOGIN;" for role in RUNTIME_ROLES))
            yield run
        finally:
            subprocess.run([str(pg_bin / "pg_ctl"), "-D", str(data), "-m", "fast", "-w", "stop"],
                           check=True, capture_output=True)


def _legacy_database(run, name):
    run(f"CREATE DATABASE {name} OWNER admin_user;")
    run(LEGACY_PUBLIC_SCHEMA_ACL + VERSION_TABLE, database=name)
    run("CREATE TABLE public.sample (id INT); INSERT INTO public.sample VALUES (1);"
        "GRANT SELECT ON public.sample TO readeronly;", database=name, role="admin_user")


def _migrate(run, database, role="admin_user"):
    run(WITHDRAW.read_text(), database=database, role=role)
    run(RECORD.read_text(), database=database, role=role)


def _can_create_table(run, database, role):
    result = run("BEGIN; CREATE TABLE public.creation_probe (id INT); ROLLBACK;",
                 database=database, role=role, check=False)
    if result.returncode != 0:
        assert "permission denied for schema public" in result.stderr
    return result.returncode == 0


def _public_acl(run, database):
    """The schema's access list as its individual entries, in stored order."""
    return run("SELECT array_to_string(nspacl, ' ') FROM pg_namespace WHERE nspname = 'public';",
               database=database).stdout.split()


def _effective_privileges(run, database):
    """Privileges each role can actually use, whoever owns the schema."""
    roles = ("public", "admin_user") + RUNTIME_ROLES
    rows = run(
        "SELECT r, has_schema_privilege(r, 'public', 'USAGE'), has_schema_privilege(r, 'public', 'CREATE') "
        "FROM unnest(ARRAY[" + ",".join(f"'{role}'" for role in roles) + "]) AS r ORDER BY r;",
        database=database,
    ).stdout.split()
    return dict(row.split("|", 1) for row in rows)


def test_legacy_database_loses_the_shared_right_and_keeps_dataset_creation(cluster):
    _legacy_database(cluster, "legacy")
    # The fixture reproduces the defect before the repair.
    assert "=UC/postgres" in _public_acl(cluster, "legacy")
    assert _can_create_table(cluster, "legacy", "readeronly")

    _migrate(cluster, "legacy")

    for role in RUNTIME_ROLES:
        assert not _can_create_table(cluster, "legacy", role), role
    # Reading continues: USAGE on the schema stays with PUBLIC and each role.
    assert cluster("SELECT count(*) FROM public.sample;", database="legacy",
                   role="readeronly").stdout.strip() == "1"
    cluster(DATASET_DDL, database="legacy", role="admin_user")
    acl = _public_acl(cluster, "legacy")
    assert "=U/postgres" in acl and "=UC/postgres" not in acl
    assert "admin_user=UC/postgres" in acl
    assert cluster("SELECT count(*) FROM system_db_version WHERE version = '9.8.1';",
                   database="legacy").stdout.strip() == "1"


def test_repeating_the_migrations_changes_nothing(cluster):
    _legacy_database(cluster, "legacy")
    _migrate(cluster, "legacy")
    first = (_public_acl(cluster, "legacy"), _effective_privileges(cluster, "legacy"))

    _migrate(cluster, "legacy")

    assert (_public_acl(cluster, "legacy"), _effective_privileges(cluster, "legacy")) == first
    assert cluster("SELECT count(*) FROM system_db_version WHERE version = '9.8.1';",
                   database="legacy").stdout.strip() == "1"
    cluster(DATASET_DDL, database="legacy", role="admin_user")


def test_new_installation_ends_in_the_same_state_as_an_upgraded_one(cluster):
    _legacy_database(cluster, "legacy")
    _migrate(cluster, "legacy")

    cluster("CREATE DATABASE fresh OWNER admin_user;")
    # PostgreSQL 16 already withholds CREATE from PUBLIC in a new database.
    assert _effective_privileges(cluster, "fresh")["public"] == "t|f"
    cluster(INSTALLER_PUBLIC_SCHEMA_GRANTS + VERSION_TABLE, database="fresh")
    _migrate(cluster, "fresh")

    assert _effective_privileges(cluster, "fresh") == _effective_privileges(cluster, "legacy")
    for role in RUNTIME_ROLES:
        assert not _can_create_table(cluster, "fresh", role), role
    cluster(DATASET_DDL, database="fresh", role="admin_user")


def test_database_owner_without_superuser_keeps_its_right(cluster):
    cluster("CREATE ROLE app_owner LOGIN; CREATE DATABASE hosted OWNER app_owner;")
    cluster(VERSION_TABLE, database="hosted", role="app_owner")

    _migrate(cluster, "hosted", role="app_owner")

    assert "app_owner=UC/pg_database_owner" in _public_acl(cluster, "hosted")
    assert not _can_create_table(cluster, "hosted", "readeronly")
    cluster(DATASET_DDL.replace("public.app_probe_dataset", "public.owner_probe")
            .replace("app_probe_dataset_name_idx", "owner_probe_name_idx"),
            database="hosted", role="app_owner")


def test_role_that_cannot_withdraw_the_right_stops_without_changing_anything(cluster):
    _legacy_database(cluster, "legacy")
    cluster("CREATE ROLE app_plain LOGIN; GRANT USAGE, CREATE ON SCHEMA public TO app_plain;"
            "GRANT ALL ON public.system_db_version, public.system_db_version_id_seq TO app_plain;",
            database="legacy")
    before = _public_acl(cluster, "legacy")

    result = cluster(WITHDRAW.read_text(), database="legacy", role="app_plain", check=False)

    assert result.returncode != 0
    assert "PUBLIC still holds CREATE on schema public" in result.stderr
    assert _public_acl(cluster, "legacy") == before
