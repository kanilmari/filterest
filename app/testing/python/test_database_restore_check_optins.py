"""test_database_restore_check_optins.py: fixed legacy-extension authorization.

Connect explicit profile/CLI choices to the real guard, JSON and private evidence.
Use synthetic packet fixtures only; never load installed settings or a database.
Prove the opt-in cannot widen language, native-code or stored-code permissions.
"""
import json

import pytest

from server_tools.lib import database_recovery_archive_guard as guard
from server_tools.lib import database_recovery_check as check
from server_tools.lib import database_recovery_counts as counts
from server_tools.lib import database_recovery_packet_io as packet_io
from server_tools.lib.database_recovery_cli import database_parser, validate_database_arguments
import test_database_restore_check as unit
from test_database_restore_check import harness, packet, cli_tools  # noqa: F401


@pytest.fixture
def legacy_archive(monkeypatch):
    monkeypatch.setattr(unit, "LISTING", unit.LISTING + b"8; 3079 8 EXTENSION - pgcrypto \n9; 3079 9 EXTENSION - unaccent \n")
    monkeypatch.setattr(unit, "SCHEMA_SQL", unit.SCHEMA_SQL +
                        b"CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public; "
                        b"CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;")


@pytest.fixture
def legacy_tools(legacy_archive, cli_tools):
    return cli_tools


@pytest.fixture(autouse=True)
def private_evidence(tmp_path, monkeypatch):
    # Retained TEST diagnostics belong to pytest's temporary tree, on failure too.
    monkeypatch.setattr(packet_io.tempfile, "tempdir", str(tmp_path))
    monkeypatch.setenv("TMPDIR", str(tmp_path))
    return tmp_path


def test_fixed_optin_list_does_not_change_the_installation_defaults():
    assert guard.OPTIN_EXTENSIONS == frozenset({"pgcrypto", "unaccent"})
    assert guard.ALLOWED_EXTENSIONS == frozenset({"plpgsql", "vector", "postgis", "uuid-ossp", "pg_trgm"})


@pytest.mark.parametrize("name", ["pgcrypto", "unaccent"])
@pytest.mark.parametrize("schema", ["public", '"legacy schema"'])
def test_guard_requires_the_exact_named_optin(name, schema):
    definition = f'CREATE EXTENSION IF NOT EXISTS "{name}" WITH SCHEMA {schema};'.encode()
    entry = guard.inspect_entry(f"EXTENSION - {name} ")
    with pytest.raises(unit.recovery.RecoveryError, match=f"--allow-extension {name}") as error:
        guard.inspect_definitions(definition, [entry])
    assert f"DATABASE_RECOVERY_ALLOW_EXTENSIONS={name}" in str(error.value)
    guard.inspect_definitions(definition, [entry], allowed_optins={name})
    with pytest.raises(unit.recovery.RecoveryError, match=name):
        guard.inspect_definitions(definition, [entry], allowed_optins=guard.OPTIN_EXTENSIONS - {name})


@pytest.mark.parametrize("name", ["pgcrypto", "unaccent"])
@pytest.mark.parametrize("statement", [
    "CREATE EXTENSION IF NOT EXISTS {name} WITH SCHEMA public VERSION '1.0';",
    "CREATE EXTENSION IF NOT EXISTS {name} WITH SCHEMA public CASCADE;",
    "CREATE EXTENSION IF NOT EXISTS {name} WITH SCHEMA public FROM 'unpackaged';",
    "CREATE EXTENSION {name} WITH SCHEMA public;",
    "CREATE EXTENSION IF NOT EXISTS {name};",
    "CREATE EXTENSION IF NOT EXISTS {name} WITH SCHEMA public.extra;",
    "ALTER EXTENSION {name} UPDATE;",
    "DROP EXTENSION {name};",
])
def test_opted_in_extensions_require_the_pg_dump_statement_shape(name, statement):
    entry = guard.inspect_entry(f"EXTENSION - {name} ")
    with pytest.raises(unit.recovery.RecoveryError, match="pg_dump statement shape"):
        guard.inspect_definitions(statement.format(name=name).encode(), [entry], allowed_optins={name})


def test_process_environment_alone_cannot_opt_in_through_public_cli(packet, legacy_tools, private_evidence, monkeypatch):
    monkeypatch.setenv("DATABASE_RECOVERY_ALLOW_EXTENSIONS", "pgcrypto,unaccent")
    paths = unit.recovery.setting_paths(packet["root"], "native", [str(packet["development"]), str(packet["settings"])])
    values = unit.recovery.environment_values(paths, "native")
    assert "DATABASE_RECOVERY_ALLOW_EXTENSIONS" not in values
    assert check.extension_optins(values) == frozenset()
    result = unit.run_packet(packet, "restore-check", "--backup", str(packet["backup"]), "--target", "auto",
        changes={"RESTORE_CHECK_MARKER": str(legacy_tools), "RESTORE_CHECK_FAILURE": "0",
                 "DATABASE_RECOVERY_ALLOW_EXTENSIONS": "pgcrypto,unaccent"})
    report = json.loads(result.stdout)
    assert result.returncode == 1 and report["verified"] and report["extension_optins"] == []
    assert "--allow-extension pgcrypto" in result.stderr
    assert report["cleanup"] == "not_created" and report["steps"][2]["status"] == "not_run"
    assert not legacy_tools.exists()
    [folder] = private_evidence.glob("filterest-database-restore-check-*")
    assert json.loads((folder / "restore-check.json").read_text())["extension_optins"] == []
    logs = list(folder.glob("database-tool-*.log"))
    assert logs and all(json.loads(log.read_text().splitlines()[0])["extension_optins"] == [] for log in logs)


@pytest.mark.parametrize("requested,missing", [([], "pgcrypto"), (["pgcrypto"], "unaccent"),
    (["unaccent"], "pgcrypto"), (["unaccent", "pgcrypto", "pgcrypto"], None)])
def test_public_cli_allows_exactly_the_requested_names_and_records_them(packet, legacy_tools, private_evidence, requested, missing):
    flags = [part for name in requested for part in ("--allow-extension", name)]
    result = unit.run_packet(packet, "restore-check", "--backup", str(packet["backup"]), "--target", "auto", *flags,
        changes={"RESTORE_CHECK_MARKER": str(legacy_tools), "RESTORE_CHECK_FAILURE": "0",
                 "DATABASE_RECOVERY_ALLOW_EXTENSIONS": "dblink"})
    report = json.loads(result.stdout)
    expected = sorted(set(requested))
    assert report["extension_optins"] == expected
    assert result.returncode == (1 if missing else 0), result.stderr
    assert not legacy_tools.exists()
    if missing:
        assert report["cleanup"] == "not_created" and report["steps"][2]["status"] == "not_run"
        assert f"--allow-extension {missing}" in result.stderr
        [folder] = private_evidence.glob("filterest-database-restore-check-*")
        assert json.loads((folder / "restore-check.json").read_text()) == dict(extension_optins=expected)
        assert (folder / "restore-check.json").stat().st_mode & 0o777 == 0o600
        logs = list(folder.glob("database-tool-*.log"))
        assert logs
        assert all(json.loads(log.read_text().splitlines()[0]) == dict(extension_optins=expected) for log in logs)
    else:
        assert report["status"] == "ok" and report["cleanup"] == "dropped"
        assert not list(private_evidence.glob("filterest-database-restore-check-*"))


@pytest.mark.parametrize("profile,flags", [("pgcrypto, unaccent,pgcrypto", []),
    ("pgcrypto", ["unaccent"]), ("unaccent", ["pgcrypto"]), ("", ["unaccent", "pgcrypto"])])
def test_profile_and_cli_are_an_additive_union(harness, packet, legacy_archive, capsys, profile, flags):
    with packet["settings"].open("a") as destination:
        destination.write(f"DATABASE_RECOVERY_ALLOW_EXTENSIONS={profile}\n")
    harness[0].allow_extension = flags
    result, report, _ = unit.invoke(harness, capsys)
    assert result == 0 and report["extension_optins"] == ["pgcrypto", "unaccent"]


def test_profile_resolution_keeps_native_first_nonempty_precedence(tmp_path):
    primary, fallback = tmp_path / "primary.settings", tmp_path / "fallback.settings"
    primary.write_text("DATABASE_RECOVERY_ALLOW_EXTENSIONS=pgcrypto\n")
    fallback.write_text("DATABASE_RECOVERY_ALLOW_EXTENSIONS=unaccent\n")
    values = unit.recovery.environment_values([primary, fallback], "native")
    assert check.extension_optins(values) == {"pgcrypto"}
    assert check.extension_optins(values, ["unaccent"]) == {"pgcrypto", "unaccent"}
    primary.write_text("DATABASE_RECOVERY_ALLOW_EXTENSIONS=\n")
    assert check.extension_optins(unit.recovery.environment_values([primary, fallback], "native")) == {"unaccent"}


@pytest.mark.parametrize("source", ["cli", "profile"])
@pytest.mark.parametrize("name", ["plperlu", "dblink", "postgis", "PGCRYPTO", "pgcrypto probe"])
def test_unsupported_requests_fail_before_any_database_tool(harness, packet, capsys, source, name):
    harness[0].allow_extension = [name] if source == "cli" else ["pgcrypto", "unaccent"]
    profile = name if source == "profile" else "pgcrypto,unaccent"
    with packet["settings"].open("a") as destination:
        destination.write(f"DATABASE_RECOVERY_ALLOW_EXTENSIONS={profile}\n")
    result, report, diagnostics = unit.invoke(harness, capsys)
    assert result == 1 and not report["verified"] and report["cleanup"] == "not_created"
    assert report["extension_optins"] == [] and not harness[1]
    assert name in diagnostics and "Unsupported extension opt-in" in diagnostics
    assert all(step["status"] == "not_run" for step in report["steps"])


@pytest.mark.parametrize("source", ["cli", "profile"])
def test_public_cli_unknown_requests_emit_failed_json_before_authentication(packet, legacy_tools, source):
    flags = ["--allow-extension", "plperlu"] if source == "cli" else ["--allow-extension", "pgcrypto"]
    profile = "pgcrypto,unaccent" if source == "cli" else "dblink"
    with packet["settings"].open("a") as destination:
        destination.write(f"DATABASE_RECOVERY_ALLOW_EXTENSIONS={profile}\n")
    result = unit.run_packet(packet, "restore-check", "--backup", str(packet["backup"]), "--target", "auto", *flags)
    report = json.loads(result.stdout)
    assert result.returncode == 1 and not report["verified"] and report["extension_optins"] == []
    assert report["cleanup"] == "not_created" and not legacy_tools.exists()
    assert ("plperlu" if source == "cli" else "dblink") in result.stderr
    assert "Unsupported extension opt-in" in result.stderr


def test_unknown_optin_redacts_configured_values_before_quoting(harness, packet, capsys):
    with packet["settings"].open("a") as destination:
        destination.write("SMTP_PASSWORD=fixture-å-value\n")
    harness[0].allow_extension = ["fixture-å-value"]
    result, report, diagnostics = unit.invoke(harness, capsys)
    assert result == 1 and report["extension_optins"] == [] and not harness[1]
    assert "Unsupported extension opt-in" in diagnostics
    assert "fixture-" not in diagnostics and "\\u00e5" not in diagnostics


@pytest.mark.parametrize("boundary", ["definitions", "counts"])
def test_callable_boundaries_validate_unknown_requests_up_front(boundary):
    with pytest.raises(unit.recovery.RecoveryError, match="dblink"):
        if boundary == "definitions":
            guard.inspect_definitions(b"", allowed_optins={"dblink"})
        else:
            counts.archive_counts(None, None, allowed_optins={"dblink"})


@pytest.mark.parametrize("definition,reason", [
    ("CREATE EXTENSION dblink;", "outside the installation allowlist"),
    ("CREATE LANGUAGE pgcrypto;", "outside the installation allowlist"),
    ("CREATE LANGUAGE unaccent;", "outside the installation allowlist"),
    ("CREATE LANGUAGE plperlu;", "outside the installation allowlist"),
    ("CREATE FUNCTION public.native() RETURNS integer LANGUAGE internal AS 'private-body-value';", "native-code function"),
    ("CREATE FUNCTION public.probe() RETURNS text LANGUAGE sql AS $$SELECT 'private-body-value dblink'$$;", "stored-code tripwire"),
    ("CREATE ROLE private_role;", "globals are unsupported"),
    ("CREATE EVENT TRIGGER private_trigger ON ddl_command_end EXECUTE FUNCTION private_body();", "globals are unsupported"),
])
def test_optins_preserve_other_guard_refusals(harness, capsys, legacy_archive, monkeypatch, definition, reason):
    harness[0].allow_extension = ["pgcrypto", "unaccent"]
    monkeypatch.setattr(unit, "SCHEMA_SQL", unit.SCHEMA_SQL + definition.encode())
    result, report, diagnostics = unit.invoke(harness, capsys)
    assert result == 1 and report["verified"] and report["extension_optins"] == ["pgcrypto", "unaccent"]
    assert report["cleanup"] == "not_created" and not any(isinstance(event, str) for event in harness[1])
    assert reason in diagnostics and "private-body-value" not in diagnostics


@pytest.mark.parametrize("failure", ["tampered", "restore", "interrupt", "drop", "rows"])
def test_every_failure_result_and_evidence_records_optins(harness, packet, capsys, private_evidence, failure):
    harness[0].allow_extension = ["unaccent", "pgcrypto"]
    harness[2]["fail"] = failure
    if failure == "rows":
        harness[2]["rows"] = 3
    elif failure == "tampered":
        (packet["backup"] / "database.dump").write_bytes(b"tampered")
    result, report, _ = unit.invoke(harness, capsys)
    assert result == 1 and report["extension_optins"] == ["pgcrypto", "unaccent"]
    [folder] = private_evidence.glob("filterest-database-restore-check-*")
    assert json.loads((folder / "restore-check.json").read_text())["extension_optins"] == report["extension_optins"]


def test_optin_colliding_with_a_configured_value_preserves_json_without_leaking_it(packet, legacy_tools, private_evidence):
    with packet["settings"].open("a") as destination:
        destination.write("SMTP_PASSWORD=pgcrypto\n")
    result = unit.run_packet(packet, "restore-check", "--backup", str(packet["backup"]), "--target", "auto",
        "--allow-extension", "pgcrypto", "--allow-extension", "unaccent",
        changes={"RESTORE_CHECK_MARKER": str(legacy_tools), "RESTORE_CHECK_FAILURE": "1"})
    assert result.returncode == 1 and "pgcrypto" not in result.stdout + result.stderr
    assert json.loads(result.stdout)["extension_optins"] == ["pgcrypto", "unaccent"]
    [folder] = private_evidence.glob("filterest-database-restore-check-*")
    evidence = (folder / "restore-check.json").read_text()
    assert "pgcrypto" not in evidence and json.loads(evidence)["extension_optins"] == ["pgcrypto", "unaccent"]
    logs = list(folder.glob("database-tool-*.log"))
    assert logs
    for log in logs:
        content = log.read_text()
        assert "pgcrypto" not in content
        assert json.loads(content.splitlines()[0])["extension_optins"] == ["pgcrypto", "unaccent"]


@pytest.mark.parametrize("action", ["backup", "verify", "restore", "preflight", "setup-key"])
def test_flag_is_refused_on_commands_without_this_archive_guard(action, capsys):
    parser = database_parser("test")
    args = parser.parse_args([action, "--root", "private-root", "--profile", "native", "--backup", "private-backup",
                              "--output", "private-output", "--allow-extension", "pgcrypto"])
    with pytest.raises(SystemExit) as error:
        validate_database_arguments(parser, args)
    assert error.value.code == 2 and "private-" not in capsys.readouterr().err
