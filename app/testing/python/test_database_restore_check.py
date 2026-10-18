"""test_database_restore_check.py: disposable recovery contracts without PostgreSQL.

Use generated TEST packets, temporary keys and controlled database transports.
Cover authentication, argument safety, COPY counts, cleanup and JSON outcomes.
Never load an installed settings file, signing key, backup or database.
"""
from argparse import Namespace
import json
import signal
import sys

import pytest

from server_tools.lib import database_recovery as recovery
from server_tools.lib import database_recovery_check as check
from server_tools.lib import database_recovery_counts as counts
from server_tools.lib import database_recovery_packet_io as packet_io
from server_tools.lib.database_recovery_cli import database_parser, validate_database_arguments
from test_database_recovery import packet, create_packet, run_packet  # noqa: F401


LISTING = b"""; Archive created at a test time
1; 1259 1 TABLE public payload test_owner
2; 0 1 TABLE DATA public payload test_owner
3; 1259 2 VIEW public summary test_owner
4; 1255 3 FUNCTION public sample() test_owner
5; 1259 4 SEQUENCE public sample_seq test_owner
6; 0 0 SEQUENCE OWNED BY public sample_seq test_owner
7; 0 0 SEQUENCE SET public sample_seq test_owner
"""
TABLE_SQL = b"CREATE TABLE public.payload (\n id integer\n);\nCOPY public.payload (id) FROM stdin;\n1\n2\n\\.\n"
SCHEMA_SQL = b"CREATE FUNCTION public.sample() RETURNS integer LANGUAGE sql AS $$SELECT 42$$;\n"
OBJECTS = dict(tables=1, views=1, functions=1, sequences=1)


@pytest.fixture
def harness(packet, monkeypatch, request):
    overrides = getattr(request, "param", {})
    with packet["settings"].open("a") as destination:
        destination.write("".join(f"{name}={value}\n" for name, value in overrides.items()))
    create_packet(packet)  # Only this temporary installation can create its TEST key.
    events, state = [], dict(exists=False, fail=None, rows=2, creators=[])

    class Database:
        def __init__(self, root, profile, paths, folder):
            self.folder, self.key = folder, recovery.packet_key(root, profile, paths)
            self.name = overrides.get("DB_NAME", "site_database")
            self.environment = {}

        def command(self, tool, *options, database=None):
            return [tool, *options, *(["--dbname=" + database] if database else [])]

        def run(self, command, *, source=None, destination=None, sensitive=False):
            assert sensitive
            events.append(command)
            if "--list" in command:
                return LISTING
            if "--schema-only" in command:
                assert not any(arg.startswith("--dbname") for arg in command)
                return SCHEMA_SQL
            if "--file=-" in command:
                destination.write(TABLE_SQL)
                return b""
            assert "--no-owner" in command and "--no-privileges" in command
            assert all(flag in command for flag in check.RESTORE_SCOPE_FLAGS)
            selection = next(arg.split("=", 1)[1] for arg in command if arg.startswith("--use-list="))
            state["restore_entries"] = self.folder.joinpath(selection).read_text()
            assert not any(arg == "--dbname=site_database" for arg in command)
            if state["fail"] in ("restore", "interrupt"):
                raise InterruptedError if state["fail"] == "interrupt" else recovery.RecoveryError("Synthetic restore failure")
            return b""

        def sql(self, sql, *, database=None, variables=None, sensitive=False):
            assert sensitive
            events.append(sql)
            assert database != self.name
            if sql.startswith("CREATE DATABASE"):
                assert not state["exists"]
                assert self.environment["PGAPPNAME"] == variables["scratch"]
                assert "statement_timeout=30000" in self.environment["PGOPTIONS"]
                assert self.environment["PGOPTIONS"].endswith(" -c application_name=" + variables["scratch"])
                state["target"] = variables["scratch"]
                if state["fail"] == "late_create":
                    state["creators"] = ["f", "t", "t"]
                    raise InterruptedError
                if state.get("signal"):
                    signal.raise_signal(state["signal"])
                state["exists"] = True
                if state["fail"] == "create_interrupt":
                    raise InterruptedError
                return ""
            if sql.startswith("DROP DATABASE"):
                if state.get("cleanup_signal"):
                    signal.raise_signal(state["cleanup_signal"])
                if state["fail"] == "drop":
                    raise recovery.RecoveryError("Synthetic drop failure")
                if state["fail"] != "retained":
                    state["exists"] = False
                return ""
            if sql.startswith("SELECT EXISTS"):
                return "t\n" if state["exists"] else "f\n"
            if sql == check.CREATOR_ABSENT_SQL:
                result = state["creators"].pop(0) if state["creators"] else "t"
                if result == "t" and state["fail"] == "late_create":
                    state["exists"] = True
                    state["fail"] = None
                return result
            if sql == check.SCRATCH_ABSENT_SQL:
                return "f" if state["exists"] else "t"
            if sql == counts.OBJECTS_SQL:
                return json.dumps(OBJECTS)
            assert "FROM ONLY %I.%I" in sql
            return str(state["rows"])

    monkeypatch.setattr(recovery, "Database", Database)
    args = Namespace(root=str(packet["root"]), profile="native", settings=[str(packet["settings"])],
                     backup=str(packet["backup"]), target="auto")
    return args, events, state


def invoke(harness, capsys):
    result = check.restore_check_main(harness[0])
    output = capsys.readouterr()
    assert "synthetic-login-secret" not in output.out + output.err
    return result, json.loads(output.out), output.err


def test_round_trip_summary_and_disposal_use_archive_counts(harness, capsys):
    result, report, _ = invoke(harness, capsys)
    assert result == 0 and report["status"] == "ok" and report["verified"]
    assert report["cleanup"] == "dropped" and not harness[2]["exists"]
    assert all(step["status"] == "ok" for step in report["steps"])
    assert report["comparison"]["tables_mismatched"] == 0
    assert report["comparison"]["rows_expected"] == report["comparison"]["rows_actual"] == 2
    assert all(value["matched"] for value in report["comparison"]["objects"].values())


@pytest.mark.parametrize("failure", ["restore", "interrupt", "create_interrupt", "drop", "rows"])
def test_cleanup_and_failure_summary(harness, capsys, failure):
    harness[2]["fail"] = failure
    if failure == "rows":
        harness[2]["rows"] = 3
    result, report, _ = invoke(harness, capsys)
    assert result == 1 and report["status"] != "ok" and report["verified"]
    assert report["cleanup"] == ("failed" if failure == "drop" else "dropped")
    assert harness[2]["exists"] == (failure == "drop")
    assert any(isinstance(event, str) and event.startswith("DROP DATABASE") for event in harness[1])
    if failure == "rows":
        assert report["comparison"]["tables_mismatched"] == 1
    if "interrupt" in failure:
        assert report["status"] == "interrupted"


@pytest.mark.parametrize("failure", ["tampered", "missing_key", "live", "docker", "collision"])
def test_refusal_before_database_creation(harness, packet, capsys, failure):
    if failure == "tampered":
        (packet["backup"] / "database.dump").write_bytes(b"tampered archive")
    elif failure == "missing_key":
        recovery.key_path(packet["root"], "native", [packet["settings"]]).unlink()
    elif failure == "live":
        harness[0].target = "site_database"
    elif failure == "docker":
        harness[0].profile = "docker"
    elif failure == "collision":
        harness[2]["exists"] = True
    result, report, diagnostics = invoke(harness, capsys)
    assert result == 1 and report["cleanup"] == "not_created"
    assert not any(isinstance(event, str) and event.startswith(("CREATE", "DROP")) for event in harness[1])
    if failure == "missing_key":
        assert not recovery.key_path(packet["root"], "native", [packet["settings"]]).exists()
        assert "authentication cannot be bypassed" in diagnostics
        assert "--allow-unauthenticated-restore" not in diagnostics
    if failure == "live":
        assert "live database" in diagnostics
    if failure == "docker":
        assert "Docker is not supported" in diagnostics


@pytest.mark.parametrize("extra", [[], ["--target", "auto", "--yes"], ["--target", "auto", "--legacy"],
    ["--target", "auto", "--allow-unauthenticated-restore"], ["--target", "auto", "--archive", "anything"],
    ["--target", "auto", "--output", "anything"], ["--target", "auto", "--dump-options", "--create"]])
def test_invalid_arguments_are_refused_without_values(extra, capsys):
    parser = database_parser("test")
    args = parser.parse_args(["restore-check", "--root", "private-root", "--profile", "native", "--backup", "private-backup", *extra])
    with pytest.raises(SystemExit) as error:
        validate_database_arguments(parser, args)
    assert error.value.code == 2
    assert "private-" not in capsys.readouterr().err


def test_target_option_cannot_be_used_for_live_restore(capsys):
    parser = database_parser("test")
    args = parser.parse_args(["restore", "--root", "x", "--profile", "native", "--backup", "x", "--target", "auto"])
    with pytest.raises(SystemExit):
        validate_database_arguments(parser, args)


@pytest.mark.parametrize("live", ["SITE", "x" * 100, 'danger"; DROP DATABASE site; --', "åäö", "postgres"])
def test_generated_names_are_bounded_and_never_live(live):
    name = check.scratch_name(live, "auto")
    assert len(name.encode()) <= 63 and "_restorecheck_" in name and name != live
    assert name == name.lower() and all(char in "abcdefghijklmnopqrstuvwxyz0123456789_" for char in name)


@pytest.mark.parametrize("target", ["site", "template0", "postgres", 'x"; DROP DATABASE site;', "auto\n"])
def test_arbitrary_database_names_are_refused(target):
    with pytest.raises(recovery.RecoveryError):
        check.scratch_name("site", target)


def test_copy_stream_counts_escaped_newlines_empty_tables_and_quoted_names():
    stream = counts.ArchiveRows()
    sql = ('CREATE TABLE "odd schema"."a.b" (\n id text\n);\n'
           'CREATE TABLE public.empty (\n id int\n);\n'
           'COPY "odd schema"."a.b" (id) FROM stdin;\nfirst\\nsecond\n\\\\.\n\\.\n').encode()
    for byte in sql:
        stream.write(bytes([byte]))
    assert stream.finish(2, 1) == [dict(schema="odd schema", table="a.b", rows=2),
                                  dict(schema="public", table="empty", rows=0)]


def test_extension_config_data_uses_the_extensions_own_backup_filter():
    stream = counts.ArchiveRows()
    stream.write(b"COPY postgis.spatial_ref_sys (srid) FROM stdin;\n999001\n\\.\n")
    rows = stream.finish(0, 1)
    assert rows == [dict(schema="postgis", table="spatial_ref_sys", rows=1, extension_data=True)]
    class Database:
        def sql(self, sql, **options):
            assert options["database"] == "scratch" and options["sensitive"]
            if sql == counts.OBJECTS_SQL:
                return json.dumps(OBJECTS)
            assert "e.extcondition[member.position]" in sql and "FROM pg_extension" in sql
            return "1\n"
    actual = counts.restored_counts(Database(), "scratch", dict(objects=OBJECTS, rows=rows))
    assert counts.comparison(dict(objects=OBJECTS, rows=rows), actual)["tables_mismatched"] == 0


@pytest.mark.parametrize("sql,tables,copies", [(b"COPY public.x (id) FROM stdin;\n1\n", 0, 1),
    (b"", 1, 0), (b"INSERT INTO public.x VALUES (1);\n", 1, 1),
    (b"COPY public.x (id) FROM stdin;\n\\.\nCOPY public.x (id) FROM stdin;\n", 0, 2)])
def test_incomplete_or_unsupported_inventory_cannot_pass(sql, tables, copies):
    stream = counts.ArchiveRows()
    with pytest.raises(recovery.RecoveryError):
        stream.write(sql)
        stream.finish(tables, copies)


def test_count_comparison_detects_equal_total_but_different_per_table_rows():
    expected = dict(objects=OBJECTS, rows=[dict(schema="public", table="one", rows=1), dict(schema="public", table="two", rows=2)])
    actual = dict(objects={**OBJECTS, "functions": 0}, rows=[dict(schema="public", table="one", rows=2), dict(schema="public", table="two", rows=1)])
    report = counts.comparison(expected, actual)
    assert report["tables_mismatched"] == 2 and report["rows_expected"] == report["rows_actual"]
    assert not report["objects"]["functions"]["matched"]


def test_database_operations_defer_repeated_interrupts_and_restore_handlers():
    before = {sig: signal.getsignal(sig) for sig in (signal.SIGINT, signal.SIGTERM)}
    completed = []
    with pytest.raises(InterruptedError):
        with check.deferred_interrupts():
            for sig in before:
                signal.raise_signal(sig)
            completed.append(True)
    assert completed
    assert {sig: signal.getsignal(sig) for sig in before} == before


@pytest.fixture
def cli_tools(packet):
    """Exercise the actual CLI, signal handlers and scanned subprocess transport."""
    create_packet(packet)
    marker = packet["root"] / "scratch-exists"
    script = f"#!{sys.executable}\n" + f"listing={LISTING!r}\ntables={TABLE_SQL!r}\nschema={SCHEMA_SQL!r}\n" + r'''
import json, os, pathlib, signal, sys, time
source = sys.stdin.buffer.read()
assert '--dbname=site_database' not in sys.argv
marker = pathlib.Path(os.environ['RESTORE_CHECK_MARKER'])
def interrupt(phase):
    if os.environ.get('RESTORE_CHECK_INTERRUPT_PHASE') == phase:
        os.kill(os.getppid(), int(os.environ['RESTORE_CHECK_INTERRUPT_SIGNAL']))
        # CREATE/disposal must finish before releasing cancellation; restore
        # and comparison stall until the parent terminates their process group.
        time.sleep(0.05 if phase in ('create', 'cleanup') else 30)
if pathlib.Path(sys.argv[0]).name == 'pg_restore':
    if '--list' in sys.argv:
        sys.stdout.buffer.write(listing)
    elif '--schema-only' in sys.argv:
        assert not any(arg.startswith('--dbname') for arg in sys.argv)
        sys.stdout.buffer.write(schema)
    elif '--file=-' in sys.argv:
        sys.stdout.buffer.write(tables)
    else:
        assert '--no-owner' in sys.argv and '--no-privileges' in sys.argv
        interrupt('restore')
        if os.environ['RESTORE_CHECK_FAILURE'] == '1':
            print('synthetic-login-secret', file=sys.stderr)
            print('synthetic-login-secret')
            sys.exit(1)
else:
    sql = source.decode()
    if sql.startswith('CREATE DATABASE'):
        marker.touch()
        interrupt('create')
    elif sql.startswith('DROP DATABASE'):
        interrupt('cleanup')
        marker.unlink(missing_ok=True)
    elif sql.startswith('SELECT EXISTS'):
        print('t' if marker.exists() else 'f')
    elif 'FROM pg_stat_activity' in sql:
        print('t')
    elif sql.startswith('SELECT NOT EXISTS'):
        print('f' if marker.exists() else 't')
    elif sql.startswith('WITH relations AS'):
        interrupt('compare')
        print(json.dumps(dict(tables=1, views=1, functions=int(os.environ['RESTORE_CHECK_FAILURE'] != 'objects'), sequences=1)))
    elif 'FROM ONLY %I.%I' in sql:
        print(2)
    else:
        sys.exit(3)
'''
    for tool in ("psql", "pg_restore"):
        (packet["tools"] / tool).write_text(script)
    return marker


@pytest.mark.parametrize("failure", ["0", "1", "objects"])
def test_public_cli_emits_only_json_and_withholds_sensitive_tool_output(packet, cli_tools, failure):
    marker = cli_tools
    result = run_packet(packet, "restore-check", "--backup", str(packet["backup"]), "--target", "auto",
                        changes={"RESTORE_CHECK_MARKER": str(marker), "RESTORE_CHECK_FAILURE": failure})
    report = json.loads(result.stdout)
    fail_restore = failure != "0"
    assert (result.returncode != 0) == fail_restore
    assert report["status"] == ("failed" if fail_restore else "ok")
    assert report["verified"] and report["cleanup"] == "dropped" and not marker.exists()
    assert "synthetic-login-secret" not in result.stdout + result.stderr
    if failure == "objects":
        assert report["comparison"]["objects"]["functions"] == dict(expected=1, actual=0, matched=False)


@pytest.mark.parametrize("interrupt_signal", [signal.SIGINT, signal.SIGTERM])
@pytest.mark.parametrize("phase", ["create", "restore", "compare", "cleanup"])
def test_public_cli_signals_report_interrupted_with_proven_disposal(packet, cli_tools, phase, interrupt_signal):
    result = run_packet(packet, "restore-check", "--backup", str(packet["backup"]), "--target", "auto",
        changes={"RESTORE_CHECK_MARKER": str(cli_tools), "RESTORE_CHECK_FAILURE": "0",
                 "RESTORE_CHECK_INTERRUPT_PHASE": phase, "RESTORE_CHECK_INTERRUPT_SIGNAL": str(int(interrupt_signal))})
    report = json.loads(result.stdout)
    assert result.returncode == 1 and report["status"] == "interrupted"
    assert report["verified"] and report["cleanup"] == "dropped" and not cli_tools.exists()
    assert report["steps"][5]["status"] == "ok"
    restore_status = {"create": "not_run", "restore": "failed", "compare": "ok", "cleanup": "ok"}[phase]
    assert report["steps"][3]["status"] == restore_status
    assert "synthetic-login-secret" not in result.stdout + result.stderr


def test_cleanup_failure_is_not_hidden_by_a_deferred_signal(harness, capsys):
    harness[2].update(fail="drop", cleanup_signal=signal.SIGTERM)
    result, report, _ = invoke(harness, capsys)
    assert result == 1 and report["status"] == "failed" and report["cleanup"] == "failed"
    assert harness[2]["exists"] and report["target"] == harness[2]["target"]


@pytest.mark.parametrize("interrupt_signal", [signal.SIGINT, signal.SIGTERM])
def test_signal_during_creation_waits_for_outcome_before_cleanup(harness, capsys, interrupt_signal):
    harness[2]["signal"] = interrupt_signal
    result, report, _ = invoke(harness, capsys)
    assert result == 1 and report["status"] == "interrupted"
    assert report["cleanup"] == "dropped" and not harness[2]["exists"]
    assert report["steps"][3]["status"] == "not_run"


def test_cleanup_waits_for_late_create_commit_before_dropping(harness, capsys, monkeypatch):
    harness[2]["fail"] = "late_create"
    monkeypatch.setattr(check.time, "sleep", lambda delay: None)
    result, report, _ = invoke(harness, capsys)
    assert result == 1 and report["status"] == "interrupted" and report["cleanup"] == "dropped"
    assert not harness[2]["exists"]
    events = harness[1]
    drop = next(index for index, event in enumerate(events) if isinstance(event, str) and event.startswith("DROP DATABASE"))
    assert events[:drop].count(check.CREATOR_ABSENT_SQL) == 2


@pytest.mark.parametrize("creators", [["f"], ["t", "f"]])
def test_cleanup_never_reports_dropped_with_creating_backend(harness, capsys, monkeypatch, creators):
    harness[2]["creators"] = creators
    clock = iter([0, 40])
    monkeypatch.setattr(check.time, "monotonic", lambda: next(clock))
    result, report, _ = invoke(harness, capsys)
    assert result == 1 and report["cleanup"] == "failed"
    assert report["target"] == harness[2]["target"]
    assert report["steps"][5]["status"] == "failed"


def test_cleanup_never_reports_dropped_when_database_remains(harness, capsys):
    harness[2]["fail"] = "retained"
    result, report, _ = invoke(harness, capsys)
    assert result == 1 and report["cleanup"] == "failed" and harness[2]["exists"]
    assert report["target"] == harness[2]["target"]


@pytest.mark.parametrize("descriptor", ["SUBSCRIPTION", "SUBSCRIPTION TABLE", "PREPARED TRANSACTION", "REPLICATION SLOT"])
def test_drop_blocking_archive_objects_refused_before_creation(harness, capsys, monkeypatch, descriptor):
    monkeypatch.setitem(globals(), "LISTING", LISTING + f"8; 0 0 {descriptor} - disabled test_owner\n".encode())
    result, report, diagnostics = invoke(harness, capsys)
    assert result == 1 and report["verified"] and report["cleanup"] == "not_created"
    assert "prevent forced database disposal" in diagnostics
    assert not any(isinstance(event, str) and event.startswith(("CREATE", "DROP")) for event in harness[1])


@pytest.mark.parametrize("view_count", [1, 2, 3])
def test_publications_remain_supported_with_exact_view_counts(harness, capsys, monkeypatch, view_count):
    # The native publication fixture also has a materialized view. Its DATA
    # entry describes a refresh, not another view; publication memberships
    # likewise do not add tables to the catalogue inventory.
    monkeypatch.setitem(globals(), "LISTING", LISTING + b"""8; 6104 1 PUBLICATION - test_publication test_owner
9; 0 0 PUBLICATION TABLE public payload test_owner
10; 1259 5 MATERIALIZED VIEW public cached test_owner
11; 0 5 MATERIALIZED VIEW DATA public cached test_owner
""")
    monkeypatch.setitem(OBJECTS, "views", view_count)
    result, report, _ = invoke(harness, capsys)
    assert result == (0 if view_count == 2 else 1) and report["cleanup"] == "dropped"
    assert report["status"] == ("ok" if view_count == 2 else "failed")
    expected = {**OBJECTS, "views": 2}
    assert report["comparison"]["objects"] == {
        name: dict(expected=count, actual=OBJECTS[name], matched=count == OBJECTS[name])
        for name, count in expected.items()}
    assert report["comparison"]["tables_checked"] == 1
    assert report["comparison"]["materialized_views_definition_only"] == 1
    assert report["comparison"]["materialized_view_row_counts_checked"] is False
    assert "MATERIALIZED VIEW DATA" not in harness[2]["restore_entries"]
    expected_list = LISTING.decode().splitlines()
    assert harness[2]["restore_entries"].splitlines() == [
        line for line in expected_list if line and not line.startswith(";") and "MATERIALIZED VIEW DATA" not in line]


@pytest.mark.parametrize("harness", [{"SMTP_PASSWORD": "fixture-mail-value", "CLIENT_SECRET": "fixture-client-value",
    "SERVICE_TOKEN": "fixture-service-value", "PROVIDER_API_KEY": "fixture-provider-value"}], indirect=True)
def test_cached_credentials_redact_helper_diagnostics_and_exception(harness, packet, capsys, monkeypatch):
    values = recovery.environment_values([packet["settings"]], "native")
    hidden = check.configured_credentials(values)
    def refuse(*args, **options):
        recovery.print_diagnostic("Helper diagnostic: " + " ".join(hidden), file=sys.stderr)
        raise recovery.RecoveryError("Exception diagnostic: " + " ".join(hidden))
    monkeypatch.setattr(recovery, "_verify_packet_snapshot", refuse)
    assert check.restore_check_main(harness[0]) == 1
    output = capsys.readouterr()
    assert all(value not in output.out + output.err for value in hidden)
    assert "Helper diagnostic:" in output.err and "Exception diagnostic:" in output.err


def test_public_cli_redacts_password_in_packet_failure_diagnostics(packet):
    create_packet(packet)
    moved = packet["backup"].with_name("synthetic-login-secret")
    packet["backup"].rename(moved)
    (moved / "database.dump").write_bytes(b"tampered")
    result = run_packet(packet, "restore-check", "--backup", str(moved), "--target", "auto")
    report = json.loads(result.stdout)
    assert result.returncode != 0 and report["cleanup"] == "not_created"
    assert "Original packet unchanged" in result.stderr
    assert "synthetic-login-secret" not in result.stdout + result.stderr


@pytest.mark.parametrize("harness", [{"DB_NAME": "client_password", "DB_ADMIN_PASSWORD": "client_password"}], indirect=True)
def test_vetted_target_survives_cleanup_and_later_settings_failure(harness, capsys, monkeypatch):
    harness[2]["fail"] = "drop"
    read = recovery.environment_values
    def unavailable_after_creation(*args, **options):
        if harness[2]["exists"]:
            raise OSError("Synthetic settings read failure")
        return read(*args, **options)
    monkeypatch.setattr(recovery, "environment_values", unavailable_after_creation)
    result, report, _ = invoke(harness, capsys)
    assert result == 1 and report["cleanup"] == "failed" and harness[2]["exists"]
    assert report["target"] == harness[2]["target"] and "client_password" not in report["target"]


def test_random_name_collision_regenerates_and_exhaustion_refuses(monkeypatch):
    candidates = iter(["a" * 32, "b" * 48])
    monkeypatch.setattr(check.secrets, "token_hex", lambda size: next(candidates))
    assert check.scratch_name("site", "auto", ("a" * 32,)) == "b" * 48
    monkeypatch.setattr(check.secrets, "token_hex", lambda size: "a" * (size * 2))
    with pytest.raises(recovery.RecoveryError, match="Cannot generate a safe"):
        check.scratch_name("site", "auto", ("a",))


@pytest.mark.parametrize("harness", [{"SMTP_PASSWORD": value} for value in ("ted", "z", "r", "*")], indirect=True)
def test_cleanup_failure_json_and_vetted_target_survive_short_credentials(harness, packet, capsys):
    harness[2]["fail"] = "drop"
    assert check.restore_check_main(harness[0]) == 1
    output = capsys.readouterr()
    report = json.loads(output.out)
    hidden = check.configured_credentials(recovery.environment_values([packet["settings"]], "native"))
    assert report["status"] == "failed" and report["cleanup"] == "failed"
    assert report["target"] == harness[2]["target"] and harness[2]["exists"]
    assert all(value not in report["target"] + report["error"] + output.err for value in hidden)
    # JSON's mandatory typed tokens can coincide with a one-character value
    # (e.g. r in true). Schema strings can be escaped without losing meaning.
    if "r" not in hidden:
        assert all(value not in output.out for value in hidden)


@pytest.mark.parametrize("hidden", [("ted",), ("e",), ("*",), ("*", "\ue000"), ("ab", "bc")])
def test_free_text_redaction_is_nonempty_and_cannot_recreate_a_secret(hidden):
    with packet_io.credential_diagnostics() as configured:
        configured.extend(hidden)
        result = packet_io.redact_credentials("[redacted] " + " ".join(hidden) + " abc")
        assert result and all(value not in result for value in hidden)
        assert packet_io.redact_credentials(result) == result


def test_summary_json_preserves_protocol_keys_statuses_and_target_on_collisions():
    report = dict(status="interrupted", cleanup="not_created", target="0123456789", error="fixed",
                  comparison=dict(rows_expected=42), verified=True)
    encoded = check.summary_json(report, ("ted",))
    assert "ted" not in encoded and json.loads(encoded) == report


@pytest.mark.parametrize("kind,name", [
    ("EXTENSION", name) for name in ("dblink", "postgres_fdw", "file_fdw", "plpythonu", "plpython3u",
                                     "plperlu", "pltclu", "plcustomu", "plsh")
] + [("PROCEDURAL LANGUAGE", name) for name in ("plpython3u", "plcustomu", "unknown_language")])
def test_outside_extensions_and_untrusted_languages_refused_before_creation(harness, capsys, monkeypatch, kind, name):
    catalog, owner = ("2612", "test_owner") if kind == "PROCEDURAL LANGUAGE" else ("3079", "")
    monkeypatch.setitem(globals(), "LISTING", LISTING + f"8; {catalog} 9 {kind} - {name} {owner}\n".encode())
    monkeypatch.setitem(globals(), "SCHEMA_SQL", f"CREATE {kind} {name};".encode())
    result, report, diagnostics = invoke(harness, capsys)
    assert result == 1 and report["verified"] and report["cleanup"] == "not_created"
    assert report["target"] is None and report["steps"][2]["status"] == "not_run"
    assert "outside the installation allowlist" in diagnostics
    assert not any(isinstance(event, str) for event in harness[1])
    assert not any(isinstance(event, list) and "--file=-" in event and "--schema-only" not in event for event in harness[1])


@pytest.mark.parametrize("name", ["postgis", "vector", "pg_trgm", "plpgsql", "uuid-ossp"])
def test_ordinary_extensions_remain_supported(name):
    entry = counts.inspect_entry(f"EXTENSION - {name} ")
    counts.inspect_definitions(f'CREATE EXTENSION "{name}";'.encode(), [entry])


@pytest.mark.parametrize("name", ['"dblink"', '"plpython3u"'])
def test_quoted_outside_extension_names_are_refused(name):
    with pytest.raises(recovery.RecoveryError, match="refused before creation"):
        counts.inspect_definitions(f"CREATE EXTENSION {name};".encode(),
                                  [counts.inspect_entry(f"EXTENSION - {name[1:-1]} ")])
