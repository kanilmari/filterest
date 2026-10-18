"""test_database_restore_check_postgres.py: real, disposable restore-check proof.

Reuse recovery's opt-in Unix-socket cluster and generated temporary TEST key.
Check archive counts, fail-closed authentication, disposal and live fingerprints.
No installed database, packet, key, role or settings path is ever opened.
"""
import hashlib
import inspect
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

import pytest

from server_tools.lib import database_recovery as recovery
from test_database_recovery_postgres import cluster, site  # noqa: F401


def fingerprint(site):
    """Hash fixture data, objects, roles, properties/settings without printing them."""
    result = site["cluster"]("""SELECT md5(jsonb_build_object(
      'payload',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM payload p),
      'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_authid r),
      'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m),
      'database',(SELECT to_jsonb(d) FROM pg_database d WHERE datname='site'),
      'settings',(SELECT jsonb_agg(to_jsonb(s) ORDER BY setdatabase,setrole) FROM pg_db_role_setting s),
      'objects',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relkind,c.relowner,c.relacl) ORDER BY c.oid)
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema')
      )::text);""", "site").stdout.strip()
    data = site["cluster"]("""SELECT format(
      $row_hash$SELECT jsonb_build_array(%L,%L,count(*),md5(COALESCE(string_agg(to_jsonb(t)::text, chr(10) ORDER BY to_jsonb(t)::text),'')))
       FROM ONLY %I.%I t;$row_hash$, n.nspname,c.relname,n.nspname,c.relname)
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind IN ('r','p','m') AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
      ORDER BY n.nspname,c.relname
\\gexec
""", "site").stdout
    return result, hashlib.sha256(data.encode()).hexdigest(), hashlib.sha256(site["settings"].read_bytes()).hexdigest()


def check(site, target="auto"):
    result = site["run"]("restore-check", "--backup", str(site["folder"]), "--target", target)
    report = json.loads(result.stdout)
    return result, report


def assert_untouched_and_disposed(site, before):
    assert fingerprint(site) == before
    assert not (site["root"] / "stop.log").exists()
    assert site["cluster"]("SELECT count(*) FROM pg_database WHERE datname LIKE '%_restorecheck_%'").stdout.strip() == "0"


def test_restore_check_round_trip_matches_dump_and_keeps_live_data(site):
    sql = site["cluster"]
    sql("""CREATE SEQUENCE sample_sequence;
      CREATE VIEW sample_view AS SELECT * FROM payload;
      CREATE MATERIALIZED VIEW sample_materialized AS SELECT * FROM payload;
      CREATE FUNCTION sample_function() RETURNS integer LANGUAGE sql AS 'SELECT 42';
      CREATE PUBLICATION sample_publication FOR TABLE payload;
      CREATE TYPE sample_range AS RANGE(subtype=integer);
      CREATE TABLE empty_table(id integer);
      CREATE SCHEMA "odd schema";
      CREATE TABLE "odd schema"."a.b"(id integer, value text);
      INSERT INTO "odd schema"."a.b" VALUES(1,E'first\\nsecond'),(2,'\\.');
      CREATE TABLE partitioned(id integer) PARTITION BY RANGE(id);
      CREATE TABLE partition_child PARTITION OF partitioned FOR VALUES FROM (0) TO (10);
      INSERT INTO partitioned VALUES(1),(2);""", "site")
    site["backup"]()
    # Old format-2 packets have no per-table manifest. Expectations must come
    # from the saved archive even after the live dataset changes.
    record = json.loads((site["folder"] / recovery.RECORD).read_text())
    assert "row_counts" not in record
    sql("UPDATE payload SET value='live-after-backup'; INSERT INTO payload VALUES(2,'new-live-row')", "site")
    before = fingerprint(site)
    packet_before = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in site["folder"].iterdir()}
    result, report = check(site)
    assert result.returncode == 0, result.stderr
    assert report["status"] == "ok" and report["verified"] and report["cleanup"] == "dropped"
    objects = report["comparison"]["objects"]
    assert {name: item["expected"] for name, item in objects.items()} == dict(tables=9, views=2, functions=1, sequences=1)
    assert all(item["matched"] for item in objects.values())
    assert report["comparison"]["tables_checked"] == 9
    assert report["comparison"]["rows_expected"] == report["comparison"]["rows_actual"] == 5
    assert report["comparison"]["tables_mismatched"] == 0
    assert report["comparison"]["materialized_views_definition_only"] == 1
    assert report["comparison"]["materialized_view_row_counts_checked"] is False
    assert packet_before == {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in site["folder"].iterdir()}
    assert_untouched_and_disposed(site, before)


@pytest.mark.parametrize("damage", ["dump", "key", "live_target"])
def test_restore_check_refuses_before_create_and_never_creates_key(site, damage):
    site["backup"]()
    before = fingerprint(site)
    key = recovery.key_path(site["root"], "native", [site["settings"]])
    if damage == "dump":
        with (site["folder"] / "database.dump").open("ab") as target:
            target.write(b"tampered")
    elif damage == "key":
        key.unlink()
    result, report = check(site, "site" if damage == "live_target" else "auto")
    assert result.returncode != 0 and report["status"] == "failed"
    assert report["cleanup"] == "not_created"
    assert report["steps"][2]["status"] == "not_run"
    if damage == "key":
        assert not key.exists()
    assert_untouched_and_disposed(site, before)


def test_restore_check_ignores_missing_tablespace_after_backup(site, tmp_path):
    sql = site["cluster"]
    tablespace = tmp_path / "tablespace"
    tablespace.mkdir()
    sql(f"CREATE TABLESPACE gone_on_restore LOCATION '{tablespace}'")
    sql("ALTER TABLE payload SET TABLESPACE gone_on_restore", "site")
    site["backup"]()
    sql("ALTER TABLE payload SET TABLESPACE pg_default", "site")
    sql("DROP TABLESPACE gone_on_restore")
    before = fingerprint(site)
    result, report = check(site)
    assert result.returncode == 0, result.stderr
    assert report["verified"] and report["cleanup"] == "dropped"
    assert_untouched_and_disposed(site, before)


def test_restore_check_drops_scratch_after_real_restore_failure(site):
    site["cluster"]("""CREATE FUNCTION fixture_only(value text) RETURNS boolean LANGUAGE plpgsql AS $$
      BEGIN
        IF current_database()<>'site' THEN RAISE EXCEPTION 'Synthetic restore failure'; END IF;
        RETURN true;
      END $$;
      ALTER TABLE payload ADD CONSTRAINT restore_failure CHECK (fixture_only(value));""", "site")
    site["backup"]()
    before = fingerprint(site)
    result, report = check(site)
    assert result.returncode != 0 and report["verified"]
    assert report["steps"][2]["status"] == "ok" and report["steps"][3]["status"] == "failed"
    assert report["cleanup"] == "dropped"
    assert_untouched_and_disposed(site, before)


@pytest.mark.parametrize("interrupt_signal", [signal.SIGINT, signal.SIGTERM])
def test_restore_check_drops_scratch_after_interrupt(site, tmp_path, interrupt_signal):
    site["backup"]()
    before = fingerprint(site)
    captured = inspect.getclosurevars(site["cluster"]).nonlocals
    tools = tmp_path / "interrupt-tools"
    tools.mkdir()
    marker = tmp_path / "restoring"
    shim = tools / "pg_restore"
    # Archive inventory/list operations use the real tool. Stall only when the
    # restore command targets the created scratch DB, then signal the public CLI.
    shim.write_text(f"#!{sys.executable}\n" + "import os, pathlib, sys, time\n"
        + f"real = {str(captured['pg_bin'] / 'pg_restore')!r}\n"
        + "if any(arg.startswith('--dbname=') for arg in sys.argv):\n"
        + f"    pathlib.Path({str(marker)!r}).touch()\n    time.sleep(60)\n"
        + "os.execv(real, [real, *sys.argv[1:]])\n")
    shim.chmod(0o700)
    environment = dict(os.environ, PATH=f"{tools}:{captured['pg_bin']}:{os.environ['PATH']}")
    process = subprocess.Popen([sys.executable, recovery.__file__, "restore-check", "--root", str(site["root"]),
        "--profile", "native", "--settings", str(site["settings"]), "--backup", str(site["folder"]),
        "--target", "auto"], env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        deadline = time.monotonic() + 20
        while not marker.exists() and process.poll() is None and time.monotonic() < deadline:
            time.sleep(0.05)
        assert marker.exists(), "Restore did not reach its disposable target"
        process.send_signal(interrupt_signal)
        output, diagnostics = process.communicate(timeout=20)
        report = json.loads(output)
        assert process.returncode != 0, diagnostics
        assert report["status"] == "interrupted" and report["cleanup"] == "dropped"
    finally:
        if process.poll() is None:
            process.send_signal(signal.SIGTERM)
            process.communicate(timeout=20)
    assert_untouched_and_disposed(site, before)


def test_restore_check_compares_filtered_postgis_configuration_data(site):
    sql = site["cluster"]
    if sql("SELECT count(*) FROM pg_available_extensions WHERE name='postgis'", "site").stdout.strip() != "1":
        pytest.skip("PostGIS must be installed for the extension configuration dump proof")
    sql("""CREATE SCHEMA postgis; CREATE EXTENSION postgis WITH SCHEMA postgis;
      INSERT INTO postgis.spatial_ref_sys(srid,srtext,proj4text)
      VALUES(990001,'synthetic restore-check reference','');""", "site")
    site["backup"]()
    before = fingerprint(site)
    result, report = check(site)
    assert result.returncode == 0, result.stderr
    assert report["comparison"]["objects"]["tables"]["expected"] == 5
    assert report["comparison"]["rows_expected"] == report["comparison"]["rows_actual"] == 2
    assert report["comparison"]["tables_mismatched"] == 0
    assert_untouched_and_disposed(site, before)


@pytest.mark.parametrize("interrupt_signal", [signal.SIGINT, signal.SIGTERM])
def test_restore_check_interrupt_during_locked_create_waits_then_disposes(site, interrupt_signal):
    """Hold CREATE's catalog write uncommitted, signal, then allow its outcome."""
    site["backup"]()
    before = fingerprint(site)
    captured = inspect.getclosurevars(site["cluster"]).nonlocals
    pg_bin, socket, port = captured["pg_bin"], captured["socket"], captured["port"]
    blocker = subprocess.Popen([str(pg_bin / "psql"), "-X", "-qAt", "-h", str(socket),
        "-p", port, "-U", "site_admin", "-d", "postgres", "--set=ON_ERROR_STOP=1", "--file=-"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    process = None
    try:
        blocker.stdin.write("BEGIN;\nLOCK TABLE pg_database IN SHARE MODE;\n\\echo locked\n")
        blocker.stdin.flush()
        assert blocker.stdout.readline().strip() == "locked"
        environment = dict(os.environ, PATH=f"{pg_bin}:{os.environ['PATH']}")
        process = subprocess.Popen([sys.executable, recovery.__file__, "restore-check", "--root", str(site["root"]),
            "--profile", "native", "--settings", str(site["settings"]), "--backup", str(site["folder"]),
            "--target", "auto"], env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        deadline = time.monotonic() + 20
        creating = ""
        while time.monotonic() < deadline and process.poll() is None:
            creating = site["cluster"]("""SELECT application_name FROM pg_stat_activity
              WHERE query LIKE 'CREATE DATABASE%' AND wait_event_type='Lock'
                AND application_name LIKE 'site_restorecheck_%';""").stdout.strip()
            if creating:
                break
            time.sleep(0.05)
        assert creating, "CREATE did not reach the controlled catalog lock"
        process.send_signal(interrupt_signal)
        # The transport must stay alive until the creating backend can finish.
        time.sleep(0.2)
        assert process.poll() is None
        blocker.communicate("COMMIT;\n\\q\n", timeout=10)
        assert blocker.returncode == 0
        output, diagnostics = process.communicate(timeout=25)
        report = json.loads(output)
        assert process.returncode != 0, diagnostics
        assert report["status"] == "interrupted" and report["cleanup"] == "dropped"
        assert report["target"] == creating and report["steps"][3]["status"] == "not_run"
        assert site["cluster"]("SELECT count(*) FROM pg_stat_activity WHERE application_name='" + creating + "'").stdout.strip() == "0"
    finally:
        if blocker.poll() is None:
            blocker.communicate("ROLLBACK;\n\\q\n", timeout=10)
        if process is not None and process.poll() is None:
            process.send_signal(signal.SIGTERM)
            process.communicate(timeout=40)
    assert_untouched_and_disposed(site, before)


def test_restore_check_refuses_disabled_subscription_before_creation(site):
    site["cluster"]("""CREATE SUBSCRIPTION fixture_disabled
      CONNECTION 'host=unreachable.invalid dbname=fixture'
      PUBLICATION fixture_publication
      WITH (connect=false, enabled=false, create_slot=false, slot_name=NONE);""", "site")
    site["backup"]()
    before = fingerprint(site)
    result, report = check(site)
    assert result.returncode != 0 and report["verified"]
    assert report["cleanup"] == "not_created" and report["target"] is None
    assert report["steps"][2]["status"] == "not_run"
    assert "prevent forced database disposal" in result.stderr
    assert site["cluster"]("SELECT count(*) FROM pg_subscription", "site").stdout.strip() == "1"
    assert_untouched_and_disposed(site, before)


def test_restore_check_native_failure_diagnostics_redact_packet_path(site):
    site["backup"]()
    moved = site["folder"].with_name("test-admin-password")
    site["folder"].rename(moved)
    site["folder"] = moved
    with (moved / "database.dump").open("ab") as target:
        target.write(b"tampered")
    before = fingerprint(site)
    result, report = check(site)
    assert result.returncode != 0 and report["cleanup"] == "not_created"
    assert "Original packet unchanged" in result.stderr
    assert "test-admin-password" not in result.stdout + result.stderr
    assert_untouched_and_disposed(site, before)


@pytest.mark.parametrize("smtp_value", ["ted", "z", "r"])
def test_restore_check_native_cleanup_failure_keeps_regenerated_target(site, tmp_path, smtp_value):
    # The socket fixture uses trust; changing this TEST password only exercises
    # collision/redaction without changing any installed authentication settings.
    site["settings"].write_text(site["settings"].read_text().replace("test-admin-password", "site"))
    with site["settings"].open("a") as destination:
        destination.write(f"SMTP_PASSWORD={smtp_value}\n")
    site["backup"]()
    before = fingerprint(site)
    captured = inspect.getclosurevars(site["cluster"]).nonlocals
    tools = tmp_path / "drop-failure-tools"
    tools.mkdir()
    shim = tools / "psql"
    shim.write_text(f"#!{sys.executable}\n" + "import subprocess, sys\nsource = sys.stdin.buffer.read()\n"
        + "if source.startswith(b'DROP DATABASE'):\n    sys.exit(1)\n"
        + f"sys.exit(subprocess.run([{str(captured['pg_bin'] / 'psql')!r}, *sys.argv[1:]], input=source).returncode)\n")
    shim.chmod(0o700)
    environment = dict(os.environ, PATH=f"{tools}:{captured['pg_bin']}:{os.environ['PATH']}")
    result = subprocess.run([sys.executable, recovery.__file__, "restore-check", "--root", str(site["root"]),
        "--profile", "native", "--settings", str(site["settings"]), "--backup", str(site["folder"]),
        "--target", "auto"], env=environment, capture_output=True, text=True)
    report = json.loads(result.stdout)
    target = report["target"]
    try:
        assert result.returncode != 0 and report["cleanup"] == "failed" and target
        assert "site" not in target and all(char in "0123456789abcdef" for char in target)
        assert smtp_value not in target + report["error"] + result.stderr
        if smtp_value != "r":  # r is unavoidable in JSON's fixed true token.
            assert smtp_value not in result.stdout
        assert report["steps"][4]["status"] == "ok"
        assert site["cluster"]("SELECT count(*) FROM pg_database WHERE datname='" + target + "'").stdout.strip() == "1"
    finally:
        if target:
            site["cluster"](f'DROP DATABASE "{target}" WITH (FORCE)')
    assert_untouched_and_disposed(site, before)


def test_restore_check_refuses_dblink_before_creation(site):
    sql = site["cluster"]
    if sql("SELECT count(*) FROM pg_available_extensions WHERE name='dblink'", "site").stdout.strip() != "1":
        pytest.skip("dblink must be installed for the outside-connection extension proof")
    sql("CREATE EXTENSION dblink", "site")
    site["backup"]()
    before = fingerprint(site)
    result, report = check(site)
    assert result.returncode != 0 and report["verified"]
    assert report["target"] is None and report["cleanup"] == "not_created"
    assert report["steps"][2]["status"] == "not_run"
    assert "outside the installation allowlist" in result.stderr
    assert_untouched_and_disposed(site, before)


def test_restore_check_refuses_whitespace_language_before_creation(site):
    # Reuse the already installed handler: no custom native library is needed.
    # pg_restore's TOC prints this entire name unquoted, starting with plpgsql.
    site["cluster"]('''CREATE TRUSTED PROCEDURAL LANGUAGE "plpgsql probe"
      HANDLER pg_catalog.plpgsql_call_handler
      INLINE pg_catalog.plpgsql_inline_handler
      VALIDATOR pg_catalog.plpgsql_validator;''', "site")
    site["backup"]()
    before = fingerprint(site)
    result, report = check(site)
    assert result.returncode != 0 and report["verified"]
    assert report["target"] is None and report["cleanup"] == "not_created"
    assert report["steps"][2]["status"] == "not_run"
    assert "plpgsql probe" in result.stderr and "outside the installation allowlist" in result.stderr
    assert "refused before creation" in result.stderr
    assert_untouched_and_disposed(site, before)


def test_restore_check_materialized_view_definitions_never_refresh_data(site):
    # Population succeeds in this throwaway source DB. Replaying the DATA entry
    # in scratch would raise, so a successful restore proves it never ran.
    site["cluster"]("""CREATE TABLE refresh_mark(id integer);
      CREATE FUNCTION view_refresh_probe() RETURNS integer LANGUAGE plpgsql AS $$
      BEGIN
        IF current_database()<>'site' THEN
          RAISE EXCEPTION 'Materialized-view query ran during restore';
        END IF;
        INSERT INTO refresh_mark VALUES(1);
        RETURN 42;
      END $$;
      CREATE MATERIALIZED VIEW guarded_materialized AS SELECT view_refresh_probe() AS value;""", "site")
    assert site["cluster"]("SELECT count(*) FROM refresh_mark", "site").stdout.strip() == "1"
    site["backup"]()
    before = fingerprint(site)
    result, report = check(site)
    assert result.returncode == 0, result.stderr
    facts = report["comparison"]
    assert facts["objects"]["views"] == dict(expected=1, actual=1, matched=True)
    assert facts["materialized_views_definition_only"] == 1
    assert facts["materialized_view_row_counts_checked"] is False
    assert facts["tables_checked"] == 6 and facts["tables_mismatched"] == 0
    assert facts["rows_expected"] == facts["rows_actual"] == 2
    assert_untouched_and_disposed(site, before)


@pytest.mark.parametrize("language", ["c", "internal"])
def test_restore_check_refuses_standalone_native_functions_before_creation(site, language):
    definition = ("CREATE FUNCTION native_probe() RETURNS language_handler LANGUAGE c "
                  "AS '$libdir/plpgsql', 'plpgsql_call_handler';" if language == "c" else
                  "CREATE FUNCTION native_probe(integer) RETURNS integer LANGUAGE internal AS 'int4abs';")
    site["cluster"](definition, "site")
    site["backup"]()
    before = fingerprint(site)
    result, report = check(site)
    assert result.returncode != 0 and report["verified"]
    assert report["target"] is None and report["cleanup"] == "not_created"
    assert report["steps"][2]["status"] == "not_run" and "native-code function" in result.stderr
    assert "native_probe" in result.stderr
    assert_untouched_and_disposed(site, before)


def test_restore_check_refuses_event_trigger_before_creation(site):
    site["cluster"]("""CREATE FUNCTION event_probe() RETURNS event_trigger LANGUAGE plpgsql AS $$
      BEGIN RETURN; END $$;
      CREATE EVENT TRIGGER fixture_event ON ddl_command_end EXECUTE FUNCTION event_probe();""", "site")
    site["backup"]()
    before = fingerprint(site)
    result, report = check(site)
    assert result.returncode != 0 and report["verified"]
    assert report["target"] is None and report["cleanup"] == "not_created"
    assert report["steps"][2]["status"] == "not_run" and "EVENT TRIGGER" in result.stderr
    assert_untouched_and_disposed(site, before)


@pytest.mark.parametrize("surface", ["function", "check", "index", "domain", "generated"])
def test_restore_check_refuses_stored_expression_tripwire_before_creation(site, surface):
    definitions = {
        "function": "CREATE FUNCTION guarded() RETURNS text LANGUAGE sql AS $$SELECT 'pg_read_file'::text$$;",
        "check": "ALTER TABLE payload ADD CONSTRAINT guarded CHECK (value<>'pg_read_file');",
        "index": "CREATE INDEX guarded ON payload ((value||'pg_read_file'::text));",
        "domain": "CREATE DOMAIN guarded AS text CHECK (VALUE<>'pg_read_file');",
        "generated": "CREATE TABLE guarded(value text GENERATED ALWAYS AS ('pg_read_file'::text) STORED);",
    }
    site["cluster"](definitions[surface], "site")
    site["backup"]()
    before = fingerprint(site)
    result, report = check(site)
    assert result.returncode != 0 and report["verified"]
    assert report["target"] is None and report["cleanup"] == "not_created"
    assert report["steps"][2]["status"] == "not_run" and "stored-code tripwire" in result.stderr
    assert_untouched_and_disposed(site, before)
