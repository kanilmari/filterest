"""Run the revoked sign-in migration and the application's own statements on real PostgreSQL.

Connects the DB 9.9.0 migrations that create the store and the sign-in limit with the
two statements the sign-out handler and the authentication boundary actually send.
Protects the promise the repair rests on: a signed-out sign-in is refused until the
deadline it was given, only that one sign-in is, a sign-in past its deadline is
refused whether or not anyone signed it out, and the records go away by themselves.
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
LIMIT_MIGRATION = APP / "server_tools/migrations/20260927000001_add_absolute_sign_in_limit.sql"
DEADLINE_SOURCE = APP / "backend/core_components/sign_in_deadline/sign_in_deadline.go"

# What the two statements are handed: a moment, in whole seconds since the epoch,
# or a negative marker for a sign-in that was given no deadline at all.
NO_DEADLINE = -1


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


def test_the_built_in_limit_and_the_seeded_one_agree():
    """A site born with the row and one that falls back to the built-in get the same ceiling.

    The two are written in different languages in different files, and nothing but
    this test makes them say the same thing.
    """
    built_in = re.search(
        r"DefaultPolicy = Policy\{Enabled: true, Unit: \"(\w+)\", Amount: (\d+)\}",
        DEADLINE_SOURCE.read_text(),
    )
    assert built_in, "the built-in sign-in limit is no longer stated where the code reads it"

    migration = LIMIT_MIGRATION.read_text()
    seeded_enabled = re.search(r"'limit_enabled', (\w+)", migration)
    seeded_unit = re.search(r"'limit_unit', '(\w+)'", migration)
    seeded_amount = re.search(r"'limit_amount', (\d+)", migration)
    assert seeded_enabled and seeded_unit and seeded_amount, (
        "the migration no longer seeds a sign-in limit"
    )

    # All three, not only the length: a site seeded with the ceiling switched off
    # while the built-in has it on would disagree about the one thing that matters.
    assert seeded_enabled.group(1).upper() == "TRUE", (
        "a new installation would be born with no sign-in ceiling"
    )
    assert built_in.group(1) == seeded_unit.group(1)
    assert built_in.group(2) == seeded_amount.group(1)

    # And the bootstrap has to carry that migration, or a new installation gets no
    # row at all and falls back silently instead of being born configured.
    assert "20260927000001_add_absolute_sign_in_limit.sql" in GENERATOR.read_text(), (
        "the public bootstrap no longer seeds the sign-in limit for a new installation"
    )


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
    # The sign-in limit's own migration is read for its seeded value but not run
    # here: it edits system_config, which this cluster deliberately does not have.
    preamble = (
        f"PREPARE record_sign_out AS {_statement_sent_by_the_application('ExecContext')};\n"
        f"PREPARE is_revoked AS {_statement_sent_by_the_application('QueryRowContext')};\n"
    )
    return lambda sql: database(preamble + sql)


def _in(seconds):
    """A deadline that many seconds from the database's own now, as the session carries it.

    Floored, not rounded, because that is what the application does: Go's Unix()
    truncates, while PostgreSQL's ::bigint rounds to nearest. Rounding here made
    `_in(0)` land up to half a second in the future whenever the clock happened to
    be past the half-second, so the test that a sign-in is refused exactly at its
    deadline passed or failed by the fraction of the second it ran in.
    """
    return f"(floor(extract(epoch from now()))::bigint + {seconds})"


def _sign_out(store, sign_in_id, deadline=None):
    deadline = _in(7 * 24 * 3600) if deadline is None else deadline
    unlimited = "true" if deadline == NO_DEADLINE else "false"
    store(f"EXECUTE record_sign_out('{sign_in_id}', {deadline}, {unlimited})")


def _usable(store, sign_in_id, deadline=None):
    deadline = _in(7 * 24 * 3600) if deadline is None else deadline
    unlimited = "true" if deadline == NO_DEADLINE else "false"
    return store(f"EXECUTE is_revoked('{sign_in_id}', {deadline}, {unlimited})") == "t"


def _refused(store, sign_in_id, deadline=None):
    return not _usable(store, sign_in_id, deadline)


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
    # The record ends when the sign-in it refuses ends, not a moment later.
    assert database("""
        SELECT expires_at BETWEEN now() + interval '7 days' - interval '5 seconds'
                             AND now() + interval '7 days' + interval '5 seconds'
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

    plan = store(
        "EXPLAIN EXECUTE is_revoked('the-signed-out-sign-in', "
        + _in(7 * 24 * 3600)
        + ", false)"
    )
    assert "Index" in plan, plan
    assert "Seq Scan" not in plan, plan


def test_a_sign_in_is_refused_at_its_deadline_without_any_sign_out(database):
    """The deadline alone finishes a sign-in, whatever has signed its cookie since.

    This is what the revocation record on its own could not do: a stolen cookie can
    be signed afresh through any route that writes a session, so the record would
    eventually be outlived. The deadline inside the cookie never moves.
    """
    store = _installed(database)

    assert _usable(store, "a-sign-in-nobody-ended", _in(60))
    assert _refused(store, "a-sign-in-nobody-ended", _in(0)), (
        "a sign-in exactly at its deadline was still accepted, leaving one instant open"
    )
    assert _refused(store, "a-sign-in-nobody-ended", _in(-1))
    assert database("SELECT count(*) FROM public.system_revoked_sign_ins") == "0", (
        "refusing a finished sign-in should need no record at all"
    )


def test_signing_out_a_finished_sign_in_writes_nothing(database):
    """Its deadline already refuses it, from here to forever."""
    store = _installed(database)
    _sign_out(store, "a-finished-sign-in", _in(-3600))
    assert database("SELECT count(*) FROM public.system_revoked_sign_ins") == "0"
    assert _refused(store, "a-finished-sign-in", _in(-3600))


def test_a_sign_in_given_no_deadline_is_refused_for_good_once_signed_out(database):
    """With the limit switched off there is no honest date to stop refusing on."""
    store = _installed(database)

    assert _usable(store, "an-unlimited-sign-in", NO_DEADLINE)
    _sign_out(store, "an-unlimited-sign-in", NO_DEADLINE)

    assert database("""
        SELECT expires_at = 'infinity'::timestamptz
        FROM public.system_revoked_sign_ins WHERE sign_in_id = 'an-unlimited-sign-in'
    """) == "t"
    assert _refused(store, "an-unlimited-sign-in", NO_DEADLINE)

    # A later sign-out sweeps what has run out and must not sweep this.
    _sign_out(store, "a-later-sign-out")
    assert _refused(store, "an-unlimited-sign-in", NO_DEADLINE)
