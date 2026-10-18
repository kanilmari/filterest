"""database_recovery_check.py: authenticated restores into disposable native DBs.

Connect the recovery CLI and packet snapshot to archive-derived comparisons.
Never stop the app, import roles/settings, or select the live DB as a target.
Keep cleanup in the creation scope and report its observed result in JSON.
"""
from __future__ import annotations

from contextlib import contextmanager, redirect_stdout
import json
from pathlib import Path
import re
import secrets
import signal
import sys
import time

if __package__:
    from . import database_recovery as recovery
    from .database_recovery_archive_guard import RESTORE_SCOPE_FLAGS
    from .database_recovery_counts import archive_counts, restored_counts, comparison
    from .database_recovery_packet_io import configured_credentials, credential_diagnostics, safe_diagnostic
else:
    import database_recovery as recovery
    from database_recovery_archive_guard import RESTORE_SCOPE_FLAGS
    from database_recovery_counts import archive_counts, restored_counts, comparison
    from database_recovery_packet_io import configured_credentials, credential_diagnostics, safe_diagnostic


STEPS = ("Authenticate packet", "Read archive counts", "Create disposable database",
         "Restore disposable database", "Compare counts", "Drop disposable database")


def scratch_name(live, requested, hidden=()):
    """Accept explicit automatic disposal only; never accept an existing DB name."""
    if requested == live:
        raise recovery.RecoveryError("The live database cannot be a restore-check target")
    if requested != "auto":
        raise recovery.RecoveryError("restore-check requires --target auto for a generated disposable database")
    prefix = re.sub(r"[^a-z0-9_]", "_", live.lower())[:16] or "database"
    for attempt in range(64):
        # A credential may be the live prefix or even the usual fixed suffix.
        # Subsequent candidates contain random hex only, without either part.
        name = prefix + "_restorecheck_" + secrets.token_hex(16) if not attempt else secrets.token_hex(24)
        if name != live and len(name.encode()) <= 63 and not any(value in name for value in hidden):
            return name
    raise recovery.RecoveryError("Cannot generate a safe disposable database name; nothing was changed")


@contextmanager
def deferred_interrupts():
    """Let bounded CREATE/disposal finish before reporting cancellation."""
    pending = []
    def remember(signum, frame):
        pending.append(signum)
    previous = {sig: signal.signal(sig, remember) for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        yield
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)
    # Preserve an operation failure (especially unproven disposal) over a
    # pending signal. Successful disposal records 'dropped' before release.
    if pending:
        raise InterruptedError


@contextmanager
def bounded_connection(database, *, creating=None):
    """Bound server/connection waits and identify only this CREATE's backend."""
    previous = database.environment
    database.environment = dict(previous, PGCONNECT_TIMEOUT="5",
        PGOPTIONS=previous.get("PGOPTIONS", "") + " -c statement_timeout=" + ("30000" if creating else "5000"))
    if creating:
        database.environment["PGAPPNAME"] = creating
        # Both startup settings defeat an inherited PGOPTIONS application_name.
        # The backend is tagged before libpq can send its first CREATE query.
        database.environment["PGOPTIONS"] += " -c application_name=" + creating
    try:
        yield
    finally:
        database.environment = previous


CREATOR_ABSENT_SQL = """SELECT NOT EXISTS(SELECT 1 FROM pg_stat_activity
 WHERE application_name=:'scratch' AND pid<>pg_backend_pid());"""
SCRATCH_ABSENT_SQL = "SELECT NOT EXISTS(SELECT 1 FROM pg_database WHERE datname=:'scratch');"


def dispose_scratch(database, variables):
    """An absent catalogue row alone cannot prove an interrupted CREATE is over."""
    with bounded_connection(database):
        deadline = time.monotonic() + 35
        while database.sql(CREATOR_ABSENT_SQL, variables=variables, sensitive=True).strip() != "t":
            if time.monotonic() >= deadline:
                raise recovery.RecoveryError("Disposable database creation backend has not exited")
            time.sleep(0.1)
        database.sql('DROP DATABASE IF EXISTS :"scratch" WITH (FORCE);', variables=variables, sensitive=True)
        # Fresh connections/snapshots: require both absence and no late creator.
        if (database.sql(SCRATCH_ABSENT_SQL, variables=variables, sensitive=True).strip() != "t" or
                database.sql(CREATOR_ABSENT_SQL, variables=variables, sensitive=True).strip() != "t"):
            raise recovery.RecoveryError("Disposable database disposal could not be proven")


def check_packet(args, root, paths, summary, values, hidden):
    if args.profile != "native":
        raise recovery.RecoveryError("restore-check currently supports native installations only; Docker is not supported")
    target = scratch_name(values.get("DB_NAME", "filterest"), args.target, hidden)
    # No create=True fallback: absence or an unsafe key refuses before any DB tool.
    try:
        key = recovery.packet_key(root, args.profile, paths)
    except recovery.RecoveryError:
        raise recovery.RecoveryError("restore-check requires an existing valid protected authentication key; no key is created and authentication cannot be bypassed") from None
    packet = Path(args.backup).absolute()
    with recovery.private_diagnostics("restore-check", packet=packet, key=key) as logs:
        database = recovery.Database(root, args.profile, paths, logs)
        if target == database.name:
            raise recovery.RecoveryError("The live database cannot be a restore-check target")
        folder = recovery.snapshot_packet(packet, logs / "packet_snapshot", key)

        def step(index, operation, *arguments, **options):
            item = summary["steps"][index]
            item["status"] = "running"
            recovery.print_diagnostic(f"{index + 1}/{len(STEPS)} {item['name']}", file=sys.stderr, flush=True)
            result = operation(*arguments, **options)
            item["status"] = "ok"
            return result

        record = step(0, recovery._verify_packet_snapshot, folder, root, args.profile, paths)
        dump = folder / record["dump"]
        expected = step(1, archive_counts, database, dump)
        # The name is generated internally, but still check before arming cleanup.
        exists_sql = "SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname=:'scratch');"
        variables = {"scratch": target}
        if database.sql(exists_sql, variables=variables, sensitive=True).strip() != "f":
            raise recovery.RecoveryError("Disposable database name is already in use; nothing was changed")
        summary["target"] = target
        # Arm before CREATE: cancellation/connection failure can hide its success.
        # Only this unpredictable generated name, checked absent, can be dropped.
        summary["cleanup"] = "pending"
        try:
            with deferred_interrupts(), bounded_connection(database, creating=target):
                step(2, database.sql, 'CREATE DATABASE :"scratch" TEMPLATE template0;',
                     variables=variables, sensitive=True)
            with dump.open("rb") as source:
                step(3, database.run, database.command("pg_restore", "--exit-on-error", "--single-transaction",
                     "--no-owner", "--no-privileges", *RESTORE_SCOPE_FLAGS, "--use-list=" + str(expected["restore_list"]),
                     database=target), source=source, sensitive=True)

            def compare():
                actual = restored_counts(database, target, expected)
                facts = summary["comparison"] = comparison(expected, actual)
                if facts["tables_mismatched"] or not all(item["matched"] for item in facts["objects"].values()):
                    raise recovery.RecoveryError("Restored object or per-table row counts differ from the archive")
            step(4, compare)
        finally:
            with deferred_interrupts():
                try:
                    step(5, dispose_scratch, database, variables)
                    summary["cleanup"] = "dropped"
                except BaseException:
                    summary["cleanup"] = "failed"
                    summary["steps"][5]["status"] = "failed"
                    raise recovery.RecoveryError("Disposable database cleanup failed; remove the reported target before retrying") from None


def restore_check_main(args):
    """One JSON document on stdout, scanned diagnostics on stderr, truthful exit."""
    with credential_diagnostics() as hidden:
        return restore_check_result(args, hidden)


def summary_json(summary, hidden):
    """Encode fixed JSON string vocabulary without changing its decoded values.

    Escape coincident secret substrings in keys/statuses as JSON Unicode, never
    replace serialized JSON with diagnostic text. JSON syntax and typed scalar
    tokens are fixed protocol bytes, not a rendering of configured values.
    """
    if not hidden:
        return json.dumps(summary, sort_keys=True)
    pattern = re.compile("|".join(map(re.escape, sorted(set(hidden), key=len, reverse=True))))

    def literal(match):
        value = json.loads(match[0])
        protected = {index for found in pattern.finditer(value) for index in range(*found.span())}
        return '"' + "".join(
            f"\\u{ord(char):04x}" if index in protected and ord(char) <= 0xFFFF
            else json.dumps(char, ensure_ascii=True)[1:-1] for index, char in enumerate(value)) + '"'

    return re.sub(r'"(?:[^"\\]|\\.)*"', literal, json.dumps(summary, sort_keys=True))


def restore_check_result(args, hidden):
    summary = dict(format_version=1, action="restore-check", status="failed", verified=False,
                   target=None, cleanup="not_created", comparison=None,
                   steps=[dict(name=name, status="not_run") for name in STEPS], error=None)
    try:
        # Snapshot diagnostics also belong on stderr, leaving stdout parseable.
        with redirect_stdout(sys.stderr):
            root = Path(args.root).resolve()
            recovery.prime_diagnostic_key(root)
            if args.profile != "native":
                raise recovery.RecoveryError("restore-check currently supports native installations only; Docker is not supported")
            paths = recovery.setting_paths(root, args.profile, args.settings)
            values = recovery.environment_values(paths, args.profile)
            hidden.extend(configured_credentials(values))
            check_packet(args, root, paths, summary, values, hidden)
        summary["status"] = "ok"
    except recovery.RecoveryError as error:
        # Error paths/log names can contain configured credentials. The JSON
        # deliberately carries fixed content, never exception or table text.
        summary["error"] = "Restore check failed; see protected diagnostics on stderr"
        message = str(error) if hidden else "Restore check refused; sensitive details withheld"
        if args.profile != "native":
            message = "restore-check currently supports native installations only; Docker is not supported"
        recovery.print_diagnostic(message, file=sys.stderr)
    except (InterruptedError, KeyboardInterrupt):
        summary["status"] = "interrupted"
        summary["error"] = "Restore check interrupted"
    except Exception:
        summary["error"] = "Restore check could not complete; sensitive details withheld"
    summary["verified"] = summary["steps"][0]["status"] == "ok"
    for item in summary["steps"]:
        if item["status"] == "running":
            item["status"] = "failed"
    # Only the vetted target, fixed vocabulary and aggregate counts enter this
    # structure; exception, archive and settings text never do. Check fixed
    # error copy against the cached secrets, then serialize exactly once.
    if summary["error"] is not None:
        summary["error"] = safe_diagnostic(summary["error"])
    # Never send JSON through a free-text redactor: it can destroy its syntax
    # or erase a cleanup target. Fixed schema/status words are protocol data.
    print(summary_json(summary, hidden))
    return 0 if summary["status"] == "ok" else 1
