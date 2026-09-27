"""Run the revoked sign-in migration and the application's own statements on real PostgreSQL.

Connects the DB 9.9.0 migration that creates the store with the two statements the
sign-out handler and the authentication boundary actually send to it.
Protects the promise the repair rests on: a signed-out sign-in is refused until its
cookies could no longer be read, only that one sign-in is, and the records go away.
Runs on disposable Unix-socket-only clusters, never the native or a production database.
"""
from __future__ import annotations

import os
from pathlib import Path
import re
import subprocess
import tempfile

import pytest

APP = Path(__file__).resolve().parents[2]
MIGRATION = APP / "server_tools/migrations/20260926000003_create_revoked_sign_in_store.sql"
BOOTSTRAP_SCHEMA = APP / "server_tools/public_bootstrap/schema.sql"
GENERATOR = APP / "server_tools/public_bootstrap/generate_bootstrap.py"
REVOCATION_SOURCE = APP / "backend/core_components/sign_in_revocation/sign_in_revocation.go"
SIGN_IN_LIFETIME_SOURCE = APP / "backend/core_components/sessions/auth_cookie_identity.go"

SEVEN_DAYS_IN_SECONDS = 7 * 24 * 60 * 60


def _statement_sent_by_the_application(call: str) -> str:
    """The exact SQL the Go source passes to one database call, backticks stripped."""
    match = re.search(call + r"\(ctx, `(.*?)`", REVOCATION_SOURCE.read_text(), re.S)
    assert match, f"{REVOCATION_SOURCE.name} no longer sends a statement through {call}"
    return match.group(1).strip()


def test_the_application_asks_for_exactly_the_table_the_migration_creates():
    """Neither side may be renamed without the other."""
    created = re.search(
        r"CREATE TABLE (public\.system_revoked_sign_ins) \((.*?)\n        \);",
        MIGRATION.read_text(), re.S,
    )
    assert created, "the migration no longer creates the revoked sign-in table"
    columns = {name for name in re.findall(r"^\s{12}(\w+) ", created.group(2), re.M)}
    assert columns == {"sign_in_id", "revoked_at", "expires_at"}

    for call in ("QueryRowContext", "ExecContext"):
        assert "public.system_revoked_sign_ins" in _statement_sent_by_the_application(call)


def test_the_record_is_kept_for_the_sign_in_lifetime_the_cookies_carry():
    """The record has to outlive the cookies it refuses, and the two are one constant."""
    lifetime = re.search(
        r"const SignInLifetime = (\d+) \* (\d+) \* time\.Hour", SIGN_IN_LIFETIME_SOURCE.read_text()
    )
    assert lifetime, "the sign-in lifetime is no longer stated where the record reads it"
    assert int(lifetime.group(1)) * int(lifetime.group(2)) * 3600 == SEVEN_DAYS_IN_SECONDS


def test_a_new_installation_is_born_with_the_store():
    """An upgraded site and a newly installed one must end with the same table."""
    assert MIGRATION.name in GENERATOR.read_text(), (
        "the public bootstrap does not run the migration, so a new installation would "
        "start without the table and every sign-out would fail to be recorded"
    )
    assert "system_revoked_sign_ins" in BOOTSTRAP_SCHEMA.read_text()


@pytest.fixture
def database():
    """Run SQL against a disposable Unix-socket-only cluster, never the live DB."""
    if os.environ.get("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1":
        pytest.skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 for isolated PostgreSQL checks")
    pg_bin = Path(os.environ.get("PG_TEST_BIN", "/usr/lib/postgresql/16/bin"))
    if not (pg_bin / "initdb").exists():
        pytest.skip("PostgreSQL test binaries unavailable")
    with tempfile.TemporaryDirectory(prefix="revoked-sign-in-test-") as directory:
        base = Path(directory)
        data = base / "pgdata"
        socket = base / "socket"
        socket.mkdir(mode=0o700)
        subprocess.run([str(pg_bin / "initdb"), "-D", str(data), "-A", "trust", "-U", "test_owner",
                        "--no-locale", "--encoding=UTF8"], check=True, capture_output=True)
        subprocess.run([str(pg_bin / "pg_ctl"), "-D", str(data), "-l", str(base / "postgres.log"),
                        "-o", f"-h '' -k '{socket}' -p 15461", "-w", "start"],
                       check=True, capture_output=True)
        try:
            def execute(sql):
                return subprocess.run(
                    [str(pg_bin / "psql"), "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
                     "-h", str(socket), "-p", "15461", "-U", "test_owner", "-d", "postgres"],
                    input=sql, text=True, check=True, capture_output=True,
                ).stdout.strip()
            yield execute
        finally:
            subprocess.run([str(pg_bin / "pg_ctl"), "-D", str(data), "-m", "fast", "-w", "stop"],
                           check=True, capture_output=True)


def _installed(database):
    """The store as the migration leaves it, reachable through the application's own statements.

    Each call is its own psql session, and a prepared statement lives only in the
    session that made it, so the two statements are prepared again in front of
    every call. Preparing them is also what checks that PostgreSQL accepts the
    exact text the Go source sends.
    """
    database(MIGRATION.read_text())
    preamble = (
        f"PREPARE record_sign_out AS {_statement_sent_by_the_application('ExecContext')};\n"
        f"PREPARE is_revoked AS {_statement_sent_by_the_application('QueryRowContext')};\n"
    )
    return lambda sql: database(preamble + sql)


def _sign_out(store, sign_in_id, lifetime_seconds=SEVEN_DAYS_IN_SECONDS):
    store(f"EXECUTE record_sign_out('{sign_in_id}', {lifetime_seconds})")


def _refused(store, sign_in_id):
    return store(f"EXECUTE is_revoked('{sign_in_id}')") == "t"


def test_the_migration_creates_the_store_and_is_safe_to_run_twice(database):
    database(MIGRATION.read_text())
    database(MIGRATION.read_text())

    assert database("SELECT to_regclass('public.system_revoked_sign_ins') IS NOT NULL") == "t"
    assert database("""
        SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'system_revoked_sign_ins'
    """) == "3"
    assert database("""
        SELECT count(*) FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'system_revoked_sign_ins'
          AND indexname = 'idx_system_revoked_sign_ins_expires_at'
    """) == "1"
    # The identity is the key, so one browser cannot fill the table by repeating.
    assert database("""
        SELECT count(*) FROM pg_constraint
        WHERE conrelid = 'public.system_revoked_sign_ins'::regclass AND contype = 'p'
    """) == "1"
    assert database("""
        SELECT obj_description('public.system_revoked_sign_ins'::regclass) <> ''
    """) == "t"


def test_a_signed_out_sign_in_is_refused_and_only_that_one(database):
    store = _installed(database)
    _sign_out(store, "the-phones-sign-in")

    assert _refused(store, "the-phones-sign-in")
    assert not _refused(store, "the-desktops-sign-in")
    assert database("SELECT count(*) FROM public.system_revoked_sign_ins") == "1"
    assert database("""
        SELECT expires_at - revoked_at = interval '7 days'
        FROM public.system_revoked_sign_ins WHERE sign_in_id = 'the-phones-sign-in'
    """) == "t"


def test_signing_the_same_browser_out_again_records_it_once(database):
    store = _installed(database)
    for _ in range(5):
        _sign_out(store, "one-browser")
    assert database("SELECT count(*) FROM public.system_revoked_sign_ins") == "1"
    assert _refused(store, "one-browser")


def test_a_record_that_has_run_out_refuses_nothing_and_is_swept_away(database):
    store = _installed(database)
    # The state the clock produces seven days after a sign-out.
    database("""
        INSERT INTO public.system_revoked_sign_ins (sign_in_id, revoked_at, expires_at)
        VALUES ('an-old-sign-out', now() - interval '8 days', now() - interval '1 day')
    """)
    assert not _refused(store, "an-old-sign-out"), (
        "a record past its own lifetime still refuses, so the table would only ever grow"
    )

    # Housekeeping is paid for by the next sign-out, with no schedule to miss.
    _sign_out(store, "a-later-sign-out")
    assert database(
        "SELECT count(*) FROM public.system_revoked_sign_ins WHERE sign_in_id = 'an-old-sign-out'"
    ) == "0"
    assert _refused(store, "a-later-sign-out")


def test_the_check_reads_one_row_by_its_key(database):
    """The cost is one indexed lookup even on a busy site, so a per-request check stays cheap.

    A signed-in person's every protected request asks this question, so the answer
    must not get slower as the site gets busier. Ten thousand recorded sign-outs is
    far more than seven days of a real site, and the lookup still goes straight to
    the row through the primary key rather than reading the table.
    """
    store = _installed(database)
    database("""
        INSERT INTO public.system_revoked_sign_ins (sign_in_id, expires_at)
        SELECT md5(series::text), now() + interval '7 days'
        FROM generate_series(1, 10000) AS series
    """)
    _sign_out(store, "the-signed-out-sign-in")
    database("ANALYZE public.system_revoked_sign_ins")

    plan = store("EXPLAIN EXECUTE is_revoked('the-signed-out-sign-in')")
    assert "Index" in plan, plan
    assert "Seq Scan" not in plan, plan
