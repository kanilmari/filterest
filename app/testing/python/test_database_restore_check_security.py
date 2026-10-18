"""test_database_restore_check_security.py: authenticated archive refusal proofs.

Use the synthetic packet/transport harness; never connect to an installed DB.
Keep the allowlist aligned with installation bootstrap and migration sources.
Prove every security refusal precedes CREATE, without exposing stored expressions.
"""
import base64
import json
from pathlib import Path
import random
import re
from types import SimpleNamespace

import pytest

from server_tools.lib import database_recovery_archive_guard as guard
from server_tools.lib import database_recovery as recovery
from server_tools.lib import database_recovery_tools as tools
from server_tools.lib.recovery_key_safety import KeyScanner
import test_database_restore_check as unit
from test_database_restore_check import harness, packet  # noqa: F401


TRIPWIRE_WORDS = (
    "PROGRAM", "lo_import", "lo_export", "pg_read_file", "pg_read_binary_file",
    "pg_ls_dir", "pg_file_write", "ALTER SYSTEM", "ALTER ROLE", "CREATE ROLE",
    "DROP ROLE", "SET ROLE", "SET SESSION AUTHORIZATION", "pg_terminate_backend", "dblink",
)


def refused(harness, capsys, reason):
    result, report, diagnostics = unit.invoke(harness, capsys)
    assert result == 1 and report["verified"] and report["cleanup"] == "not_created"
    assert report["target"] is None and report["steps"][2]["status"] == "not_run"
    assert reason in diagnostics and "refused before creation" in diagnostics
    assert "private-body-value" not in diagnostics
    # There are no SQL calls at all, including catalogue checks, before refusal.
    assert not any(isinstance(event, str) for event in harness[1])
    return diagnostics


def test_allowlist_equals_extensions_created_by_bootstrap_and_migrations():
    root = Path(__file__).resolve().parents[2] / "server_tools"
    sources = [root / "public_bootstrap/schema.sql", root / "db_init/01_init_extensions.sh",
               *sorted((root / "migrations").glob("*.sql"))]
    creation = re.compile(r'\bCREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?("[^"]+"|[\w-]+)', re.I)
    # template0 already has plpgsql without an explicit bootstrap CREATE.
    installed = {"plpgsql"}
    for source in sources:
        installed.update(name.strip('"') for name in creation.findall(source.read_text()))
    assert guard.ALLOWED_EXTENSIONS == installed


@pytest.mark.parametrize("name", ["adminpack", "lo", "pageinspect", "pg_cron", "plv8", "dblink",
    "postgres_fdw", "file_fdw", "custom_fdw", "plpython3u", "plperlu", "pltclu", "plperl", "pltcl",
    "unaccent", "unknown_extension", "POSTGIS"])
def test_all_nonallowlisted_extensions_refused_before_creation(harness, capsys, monkeypatch, name):
    monkeypatch.setattr(unit, "LISTING", unit.LISTING + f"8; 3079 9 EXTENSION - {name} \n".encode())
    monkeypatch.setattr(unit, "SCHEMA_SQL", f'CREATE EXTENSION "{name}";'.encode())
    diagnostics = refused(harness, capsys, "outside the installation allowlist")
    assert name in diagnostics
    assert any(isinstance(event, list) and "--schema-only" in event for event in harness[1])


@pytest.mark.parametrize("kind,name,identifier", [
    ("PROCEDURAL LANGUAGE", "plpgsql probe", '"plpgsql probe"'),
    ("EXTENSION", "postgis probe", '"postgis probe"'),
    ("EXTENSION", "postgis ", '"postgis "'),
    ("EXTENSION", " postgis", '" postgis"'),
    ("EXTENSION", "postgis\tprobe", '"postgis\tprobe"'),
    ("EXTENSION", 'postgis"probe', '"postgis""probe"'),
    ("PROCEDURAL LANGUAGE", 'plpgsql"probe', '"plpgsql""probe"'),
    ("EXTENSION", "PostGIS", '"PostGIS"'),
    ("PROCEDURAL LANGUAGE", "PLpgSQL", '"PLpgSQL"'),
])
def test_complete_nonallowlisted_identities_refused_before_any_sql(harness, capsys, monkeypatch, kind, name, identifier):
    # TOC tags are raw names, not SQL identifiers (even when they contain quotes).
    catalog, owner = ("2612", "test_owner") if kind == "PROCEDURAL LANGUAGE" else ("3079", "")
    monkeypatch.setattr(unit, "LISTING", unit.LISTING + f"8; {catalog} 9 {kind} - {name} {owner}\n".encode())
    monkeypatch.setattr(unit, "SCHEMA_SQL", f"CREATE {kind} {identifier};".encode())
    diagnostics = refused(harness, capsys, "outside the installation allowlist")
    assert json.dumps(name)[1:-1] in diagnostics


@pytest.mark.parametrize("listing,definition", [
    ("EXTENSION - vector ", "CREATE EXTENSION postgis;"),
    ("PROCEDURAL LANGUAGE - other test_owner", "CREATE LANGUAGE plpgsql;"),
    ("EXTENSION - postgis probe ", "CREATE EXTENSION postgis;"),
    ("PROCEDURAL LANGUAGE - plpgsql probe test_owner", "CREATE LANGUAGE plpgsql;"),
    ("PROCEDURAL LANGUAGE - plpgsql ", "CREATE LANGUAGE plpgsql;"),
    ("PROCEDURAL LANGUAGE - plpgsql owner with spaces", "CREATE LANGUAGE plpgsql;"),
    ("EXTENSION - postgis probe with spaces ", "CREATE EXTENSION postgis;"),
    ("EXTENSION - postgis", "CREATE EXTENSION postgis;"),
    ("EXTENSION - postgis  ", "CREATE EXTENSION postgis;"),
    ("EXTENSION postgis postgis ", "CREATE EXTENSION postgis;"),
    ("EXTENSION - postgis ", ""),
    ("", "CREATE EXTENSION postgis;"),
    ("EXTENSION - postgis \n9; 3079 10 EXTENSION - postgis ", "CREATE EXTENSION postgis;"),
    ("EXTENSION - postgis ", "CREATE EXTENSION postgis; CREATE EXTENSION postgis;"),
    ("EXTENSION", ""),
    ("PROCEDURAL LANGUAGE", ""),
])
def test_ambiguous_unmatched_or_duplicate_toc_definition_refused_before_any_sql(harness, capsys, monkeypatch, listing, definition):
    if listing:
        monkeypatch.setattr(unit, "LISTING", unit.LISTING + f"8; 3079 9 {listing}\n".encode())
    monkeypatch.setattr(unit, "SCHEMA_SQL", definition.encode())
    refused(harness, capsys, "ambiguous or unmatched TOC/definition identity")


@pytest.mark.parametrize("kind,identifier", [("EXTENSION", "POSTGIS"), ("EXTENSION", '"postgis"'),
    ("LANGUAGE", "PLpgSQL"), ("OR REPLACE TRUSTED PROCEDURAL LANGUAGE", '"plpgsql"'),
    ("TRUSTED LANGUAGE", "plpgsql"), ("OR REPLACE LANGUAGE", "plpgsql"),
    ("OR REPLACE PROCEDURAL LANGUAGE", "plpgsql"), ("EXTENSION IF NOT EXISTS", '"uuid-ossp"')])
def test_exact_allowlisted_definitions_match_raw_toc_tags(harness, capsys, monkeypatch, kind, identifier):
    name, _ = guard.exact_identity([identifier])
    toc_kind = "PROCEDURAL LANGUAGE" if "LANGUAGE" in kind else "EXTENSION"
    catalog, owner = ("2612", "test_owner") if toc_kind == "PROCEDURAL LANGUAGE" else ("3079", "")
    monkeypatch.setattr(unit, "LISTING", unit.LISTING + f"8; {catalog} 9 {toc_kind} - {name} {owner}\n".encode())
    monkeypatch.setattr(unit, "SCHEMA_SQL", f"CREATE {kind} {identifier};".encode())
    result, report, _ = unit.invoke(harness, capsys)
    assert result == 0 and report["cleanup"] == "dropped"


def test_verbatim_native_postgis_listing_in_own_schema(harness, capsys, monkeypatch):
    # Verbatim pg_restore --list line retained by round 6's native PostGIS test;
    # the SQL uses schema postgis, but dumpExtension has no TOC namespace/owner.
    postgis_line = b"2; 3079 16412 EXTENSION - postgis \n"
    # Keep the verbatim dump ID unique among the synthetic table entries.
    monkeypatch.setattr(unit, "LISTING", unit.LISTING.replace(b"\n2;", b"\n9;") + postgis_line)
    monkeypatch.setattr(unit, "SCHEMA_SQL", unit.SCHEMA_SQL + b"""
CREATE SCHEMA postgis;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA postgis;
""")
    result, report, _ = unit.invoke(harness, capsys)
    assert result == 0 and report["cleanup"] == "dropped"


@pytest.mark.parametrize("language", ["c", "C", "internal", '"c"', '"internal"'])
@pytest.mark.parametrize("name", ["public.sample", 'public."sample probe"', 'public."sample""probe"'])
def test_native_functions_without_extension_ownership_refused_before_creation(harness, capsys, monkeypatch, language, name):
    monkeypatch.setattr(unit, "SCHEMA_SQL", f"""CREATE FUNCTION {name}() RETURNS integer
      LANGUAGE {language} AS 'private-body-value', 'symbol';""".encode())
    assert "public.sample" in refused(harness, capsys, "native-code function")


def test_return_type_named_begin_cannot_bypass_precreation_refusal(harness, capsys, monkeypatch):
    monkeypatch.setattr(unit, "SCHEMA_SQL", b"""CREATE FUNCTION public.sample() RETURNS public.begin
      LANGUAGE c AS 'private-body-value', 'symbol';""")
    refused(harness, capsys, "refused before creation")


@pytest.mark.parametrize("descriptor", ["EVENT TRIGGER - audit", "ROLE - other_role", "ROLE GRANT - other_role",
    "USER - other_user", "GROUP - other_group", "TABLESPACE - external_space"])
@pytest.mark.parametrize("suffix", ["", " probe", '"probe'])
def test_event_triggers_and_globals_refused_from_listing(harness, capsys, monkeypatch, descriptor, suffix):
    monkeypatch.setattr(unit, "LISTING", unit.LISTING + f"8; 0 9 {descriptor}{suffix} test_owner\n".encode())
    refused(harness, capsys, "event triggers and role/tablespace globals")


@pytest.mark.parametrize("definition", ["CREATE ROLE other_role;", "CREATE TABLESPACE external_space LOCATION 'private-body-value';",
    "CREATE EVENT TRIGGER audit ON ddl_command_end EXECUTE FUNCTION public.audit();"])
def test_event_triggers_and_globals_also_refused_from_definitions(harness, capsys, monkeypatch, definition):
    monkeypatch.setattr(unit, "SCHEMA_SQL", definition.encode())
    refused(harness, capsys, "event triggers and role/tablespace globals")


@pytest.mark.parametrize("word", TRIPWIRE_WORDS)
@pytest.mark.parametrize("surface", ["function", "check", "index", "domain", "generated"])
def test_each_tripwire_in_stored_expressions_refused_before_creation(harness, capsys, monkeypatch, word, surface):
    # Mixed case and multiline phrases still match in a single tripwire search.
    phrase = word.swapcase().replace(" ", "\n  ")
    expression = f"length('private-body-value {phrase}'::text)"
    definitions = {
        "function": f"CREATE FUNCTION public.sample() RETURNS integer LANGUAGE sql AS $$SELECT {expression}$$;",
        "check": f"ALTER TABLE ONLY public.payload ADD CONSTRAINT guarded CHECK ({expression}>0);",
        "index": f"CREATE UNIQUE INDEX guarded ON public.payload (({expression}));",
        "domain": f"CREATE DOMAIN public.guarded AS integer CONSTRAINT guarded CHECK ({expression}>0);",
        "generated": f"CREATE TABLE public.guarded(id integer GENERATED ALWAYS AS ({expression}) STORED);",
    }
    monkeypatch.setattr(unit, "SCHEMA_SQL", definitions[surface].encode())
    diagnostics = refused(harness, capsys, "stored-code tripwire")
    assert ("public.sample" if surface == "function" else "public.payload" if surface == "check" else "guarded") in diagnostics
    assert "dynamic SQL can bypass" in diagnostics


@pytest.mark.parametrize("body", ["SELECT 'PROGRAM'", "SELECT 'SET ROLE'", "SELECT 'pg_read_file'"])
def test_function_body_cannot_spoof_a_toc_header_to_hide_tripwire(body):
    with pytest.raises(recovery.RecoveryError, match="tripwire"):
        guard.inspect_definitions(f"""CREATE FUNCTION public.guarded() RETURNS text LANGUAGE sql AS $body$
-- Name: innocent; Type: COMMENT; Schema: public; Owner: -
{body};
$body$;""".encode())


def test_quoted_literals_comments_semicolons_and_sql_standard_bodies_are_scanned():
    guard.inspect_definitions(b"""\\restrict fixture_marker
CREATE FUNCTION public.ok() RETURNS text LANGUAGE sql AS 'SELECT ''semi; LANGUAGE c''';
CREATE FUNCTION public.increment(language integer) RETURNS integer LANGUAGE SQL
BEGIN ATOMIC SELECT language + 1; END;
/* outer /* nested */ comment */
COMMENT ON FUNCTION public.ok() IS 'PROGRAM';
\\unrestrict fixture_marker
""")
    with pytest.raises(recovery.RecoveryError, match="tripwire"):
        guard.inspect_definitions(b"""CREATE FUNCTION public.guarded() RETURNS text LANGUAGE SQL
BEGIN ATOMIC SELECT 'safe'; SELECT CASE WHEN true THEN 'pg_ls_dir' ELSE '' END; END;""")


def test_copy_data_is_not_scanned_and_restore_scope_flags_are_applied(harness, capsys, monkeypatch):
    monkeypatch.setattr(unit, "TABLE_SQL", unit.TABLE_SQL.replace(b"\n1\n", b"\nPROGRAM\n"))
    result, report, _ = unit.invoke(harness, capsys)
    assert result == 0 and report["cleanup"] == "dropped"
    restores = [event for event in harness[1] if isinstance(event, list) and any(arg.startswith("--dbname=") for arg in event)]
    assert len(restores) == 1 and set(guard.RESTORE_SCOPE_FLAGS) <= set(restores[0])


@pytest.mark.parametrize("definition", [b"CREATE FUNCTION f() RETURNS text LANGUAGE sql AS $$unfinished;",
    b"CREATE TABLE x(id int)", b"/* incomplete", b"\\connect site\n"])
def test_unparseable_definitions_fail_closed_before_creation(harness, capsys, monkeypatch, definition):
    monkeypatch.setattr(unit, "SCHEMA_SQL", definition)
    refused(harness, capsys, "archive schema")


def test_refusal_names_are_redacted_without_printing_expression(harness, capsys, monkeypatch):
    monkeypatch.setattr(unit, "SCHEMA_SQL", b'''CREATE FUNCTION public."synthetic-login-secret"()
      RETURNS integer LANGUAGE sql AS $$SELECT 'PROGRAM private-body-value'$$;''')
    diagnostics = refused(harness, capsys, "tripwire")
    assert "synthetic-login-secret" not in diagnostics


@pytest.mark.parametrize("harness", [{"SMTP_PASSWORD": "fixture-å-value"}], indirect=True)
def test_object_names_are_redacted_before_diagnostic_escaping(harness, capsys, monkeypatch):
    monkeypatch.setattr(unit, "SCHEMA_SQL", '''CREATE FUNCTION public."fixture-å-value"()
      RETURNS integer LANGUAGE c AS 'private-body-value', 'symbol';'''.encode())
    diagnostics = refused(harness, capsys, "native-code function")
    assert "fixture-" not in diagnostics and "\\u00e5" not in diagnostics


def assert_no_key_material(output, key):
    assert KeyScanner(key).pattern.search(output.encode("utf-8", errors="surrogateescape")) is None
    assert re.search(r"[0-9a-f]{16,}", output, re.I) is None


@pytest.mark.parametrize("offset", [0, 28, 56], ids=["prefix", "middle", "end"])
def test_public_cli_scans_original_key_path_before_overlapping_credential(packet, offset):
    unit.create_packet(packet)
    key = recovery.packet_key(packet["root"], "native", [packet["settings"]])
    hexadecimal = key.hex()
    overlap = hexadecimal[offset:offset + 8]
    assert hexadecimal.count(overlap) == 1
    with packet["settings"].open("a") as destination:
        destination.write(f"SMTP_PASSWORD={overlap}\n")
    # Exact gate sequence: snapshot_size refuses the key-bearing directory,
    # then recovery_operation wraps its original path before CLI stderr output.
    moved = packet["backup"].parent / hexadecimal / "packet"
    moved.parent.mkdir()
    packet["backup"].rename(moved)
    result = unit.run_packet(packet, "restore-check", "--backup", str(moved), "--target", "auto")
    report = json.loads(result.stdout)
    assert result.returncode == 1 and report["cleanup"] == "not_created"
    assert not report["verified"] and report["target"] is None
    assert "detected representation" in result.stderr
    assert_no_key_material(result.stdout + result.stderr, key)
    assert overlap not in result.stdout + result.stderr


@pytest.mark.parametrize("form", ["raw", "hex", "upper", "utf16le", "utf16be",
    "base64-0", "base64-1", "base64-2", "urlsafe-0", "urlsafe-1", "urlsafe-2"])
@pytest.mark.parametrize("part", ["prefix", "middle", "end"])
def test_direct_diagnostic_scans_every_original_form_before_overlapping_credential(form, part):
    # Generated TEST material only; no installation files or real keys are read.
    key = random.Random(22808).randbytes(32)
    forms = dict(raw=key, hex=key.hex().encode(), upper=key.hex().upper().encode(),
                 utf16le=key.hex().encode("utf-16le"), utf16be=key.hex().encode("utf-16be"))
    if form not in forms:
        encoder = base64.urlsafe_b64encode if form.startswith("urlsafe") else base64.b64encode
        forms[form] = encoder(b"Q" * int(form[-1]) + key + b"end")
    original = forms[form].decode("utf-8", errors="surrogateescape")
    offset = {"prefix": 0, "middle": (len(original) - 8) // 2, "end": len(original) - 8}[part]
    overlap = original[offset:offset + 8]
    with unit.packet_io.credential_diagnostics() as hidden:
        hidden.extend((overlap, "fixture-mail-value"))
        result = unit.packet_io.safe_diagnostic(f"/TEST/{original}/packet: fixture-mail-value", key)
    assert "<redacted: contains the recovery key>" in result
    assert_no_key_material(result, key)
    assert overlap not in result and "fixture-mail-value" not in result


@pytest.mark.parametrize("offset", [0, 28, 56], ids=["prefix", "middle", "end"])
def test_archive_identity_scans_key_before_overlapping_credential(offset):
    key = random.Random(22808).randbytes(32)
    overlap = key.hex()[offset:offset + 8]
    unit.packet_io.diagnostic_key(key)
    with unit.packet_io.credential_diagnostics() as hidden:
        hidden.append(overlap)
        with pytest.raises(recovery.RecoveryError) as error:
            guard.refuse("function", key.hex(), "TEST refusal")
    assert_no_key_material(str(error.value), key)


@pytest.mark.parametrize("offset", [0, 28, 56], ids=["prefix", "middle", "end"])
def test_tool_log_scans_original_spelling_before_overlapping_credential(tmp_path, monkeypatch, offset):
    key = random.Random(22808).randbytes(32)
    hexadecimal = key.hex()
    overlap = hexadecimal[offset:offset + 8]
    # The raw stream check permits this spelling; the diagnostic shadow scanner
    # must recognize it before transport-specific credential replacements.
    original = hexadecimal[:16] + "\\" + hexadecimal[16:]
    content = f"/TEST/{original}/packet: fixture-mail-value".encode()
    KeyScanner(key).check(content)
    monkeypatch.setattr(tools, "checked_tool_streams", lambda *args: (0, content, b""))
    database = SimpleNamespace(folder=tmp_path, key=key, environment={}, hidden=[overlap, "fixture-mail-value"])
    tools.run_database_tool(database, ["TEST-tool"])
    [log] = tmp_path.iterdir()
    result = log.read_text()
    assert_no_key_material(result, key)
    assert overlap not in result and "fixture-mail-value" not in result
