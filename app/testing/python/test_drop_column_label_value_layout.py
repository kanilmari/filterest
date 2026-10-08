"""Verify WL52's retired column on fresh bootstrap and a DB 9.9.2 upgrade.

Connects the migration's schema marker with the public package and restore contract.
Protects visibility data, the site wrapping setting and historical schema snapshots.
PostgreSQL checks use only the existing opt-in disposable Unix-socket cluster.
"""
from pathlib import Path
import json
import os
import re
import subprocess
import sys

import pytest
from test_row_actor_support import RELEASE_RECORD, cluster, upgrade, value

APP = Path(__file__).resolve().parents[2]
BOOTSTRAP = APP / "server_tools/public_bootstrap"
MIGRATIONS = APP / "server_tools/migrations"
DROP = MIGRATIONS / "20261005000070_drop_column_label_value_layout.sql"
SNAPSHOTS = APP / "server_tools/versioning/schema_snapshots"
MARKER = "wl52_drop_column_label_value_layout"
# The open database version: a fresh bootstrap records it, and a complete upgrade ends at it.
CURRENT_DB = (APP / "VERSION_DB").read_text(encoding="utf-8").strip()


def _declared_db_version(path):
    match = re.search(r"^-- VERSION_DB: (\d+)\.(\d+)\.(\d+)$", path.read_text(), re.M)
    return tuple(int(part) for part in match.groups()) if match else None


def test_drop_is_schema_classified_and_public_artifacts_match():
    sql = DROP.read_text()
    for header in ("VERSION_DB: 9.10.0",
                   "VERSION_DB_OWNER: 20261005000099_record_database_release_9_10_0.sql",
                   f"COMPLETION_MARKER: {MARKER}"):
        assert "-- " + header in sql
    generator = (BOOTSTRAP / "generate_bootstrap.py").read_text()
    schema_class = generator.split("repair_schema_migrations = (", 1)[1].split("\n)", 1)[0]
    assert DROP.name in schema_class
    assert re.findall(r"INSERT INTO public\.(\w+)", sql) == ["system_data_repair_records"]
    assert "CASCADE;" not in sql
    schema = (BOOTSTRAP / "schema.sql").read_bytes()
    assert schema == (SNAPSHOTS / "db-9.10.0.sql").read_bytes()
    assert b"label_value_layout character varying" not in schema
    assert b"system_column_details_label_value_layout_check" not in schema
    assert b"COMMENT ON COLUMN public.system_column_details.label_value_layout" not in schema
    assert b"label_value_layout character varying" in (SNAPSHOTS / "db-9.9.2.sql").read_bytes()
    seed = (BOOTSTRAP / "seed_data.sql").read_text()
    assert DROP.name in seed and MARKER in seed
    result = subprocess.run([sys.executable, str(APP / "server_tools/public_slice_export/audit_public_bootstrap.py"),
                             "--target", str(APP.parent)], capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def _assert_retired(cluster):
    assert cluster("""SELECT count(*) FROM pg_catalog.pg_attribute
        WHERE attrelid='public.system_column_details'::regclass
          AND attname='label_value_layout' AND NOT attisdropped""").stdout.strip() == "0"
    assert cluster("SELECT count(*) FROM pg_constraint WHERE conname='system_column_details_label_value_layout_check'").stdout.strip() == "0"
    assert cluster("""SELECT count(*) FROM pg_description AS description
        JOIN pg_attribute AS attribute ON attribute.attrelid=description.objoid
          AND attribute.attnum=description.objsubid
        WHERE attribute.attrelid='public.system_column_details'::regclass
          AND attribute.attisdropped""").stdout.strip() == "0"
    assert cluster(f"SELECT count(*) FROM system_data_repair_records WHERE migration='{MARKER}' AND action='completed'").stdout.strip() == "1"


@pytest.mark.parametrize("installation", ["fresh", "upgrade-9.9.2"])
def test_drop_preserves_visibility_and_site_choice_and_is_idempotent(cluster, installation):
    if installation == "fresh":
        cluster((BOOTSTRAP / "schema.sql").read_text())
        cluster((BOOTSTRAP / "seed_data.sql").read_text())
        _assert_retired(cluster)
    else:
        # Use the unchanged released schema, then the release's support migration
        # that supplies the marker store. No live installation is an input.
        cluster((SNAPSHOTS / "db-9.9.2.sql").read_text())
        cluster((MIGRATIONS / "20261005000001_add_row_actor_support.sql").read_text())
    cluster("""
        INSERT INTO system_db_tables(table_uid,table_name) VALUES(50001,'wl52_visibility_fixture');
        INSERT INTO system_column_details(table_uid,column_name,show_key_on_card,show_value_on_card,
            hide_everywhere,hide_on_small_card,hide_false_null_on_sml_crd,hide_false_null_on_big_crd,
            hide_on_bg_crd_if_not_own,hide_in_filter_panel)
        VALUES(50001,'inherited',NULL,true,false,true,false,true,false,true),
              (50001,'hidden',false,false,true,false,true,false,true,false),
              (50001,'shown',true,true,false,false,false,false,false,false);
    """)
    # The actual site row on fresh bootstrap keeps its choice; on the old schema
    # create the same runtime key rather than a second setting authority.
    cluster("""INSERT INTO system_config(key,json_value)
        SELECT 'dataset_cover_theme_config','{"shared":{"label_value_layout":"stacked"}}'
        WHERE NOT EXISTS(SELECT 1 FROM system_config WHERE key='dataset_cover_theme_config')""")
    cluster("""UPDATE system_config SET json_value=jsonb_set(json_value,
        '{shared,label_value_layout}', '"inline"') WHERE key='dataset_cover_theme_config'""")
    if installation != "fresh":
        cluster("UPDATE system_column_details SET label_value_layout='inline' WHERE table_uid=50001")
    visibility = """SELECT jsonb_agg(to_jsonb(details)-'label_value_layout' ORDER BY column_uid)
        FROM system_column_details AS details WHERE table_uid=50001"""
    site = "SELECT json_value FROM system_config WHERE key='dataset_cover_theme_config'"
    before_visibility, before_site = cluster(visibility).stdout, cluster(site).stdout
    for _ in range(2):
        cluster(DROP.read_text())
        _assert_retired(cluster)
        assert cluster(visibility).stdout == before_visibility
        assert cluster(site).stdout == before_site
    assert cluster(f"SELECT count(*) FROM system_db_version WHERE version='{CURRENT_DB}'").stdout.strip() == ("1" if installation == "fresh" else "0")


def test_complete_release_upgrade_preserves_visibility_and_site_choice_and_records_owner(upgrade, tmp_path):
    """Run every pending public file through the application's migration runner.

    The released 9.9.2 package supplies the real starting ledger and version.
    An excluded system dataset keeps the visibility fixture independent of WL58.
    """
    release = sorted(path for path in MIGRATIONS.glob("*.sql")
                     if re.search(r"^-- VERSION_DB: 9\.10\.0$", path.read_text(), re.M))
    assert DROP in release and release[-1] == RELEASE_RECORD
    assert value(upgrade, "SELECT count(*) FROM system_db_version WHERE version='9.10.0'") == "0"
    upgrade("""
        CREATE TABLE system_wl52_visibility_fixture (
            id integer PRIMARY KEY, inherited text, hidden text, shown text
        );
        INSERT INTO system_db_tables(table_uid,table_name)
        VALUES(50001,'system_wl52_visibility_fixture');
        INSERT INTO system_column_details(table_uid,column_name,show_key_on_card,show_value_on_card,
            hide_everywhere,hide_on_small_card,hide_false_null_on_sml_crd,hide_false_null_on_big_crd,
            hide_on_bg_crd_if_not_own,hide_in_filter_panel,label_value_layout)
        VALUES(50001,'inherited',NULL,true,false,true,false,true,false,true,NULL),
              (50001,'hidden',false,false,true,false,true,false,true,false,'inline'),
              (50001,'shown',true,true,false,false,false,false,false,false,'stacked');
        -- The 9.9.2 package has no site presentation row yet; create the runtime key as the isolated test does.
        INSERT INTO system_config(key,json_value)
        SELECT 'dataset_cover_theme_config','{"shared":{}}'
        WHERE NOT EXISTS(SELECT 1 FROM system_config WHERE key='dataset_cover_theme_config');
        UPDATE system_config SET json_value=jsonb_set(json_value, '{shared}',
            coalesce(json_value->'shared','{}'::jsonb) || '{"label_value_layout":"inline"}'::jsonb)
        WHERE key='dataset_cover_theme_config';
    """)
    visibility = """SELECT jsonb_agg(to_jsonb(details)-'label_value_layout' ORDER BY column_uid)
        FROM system_column_details AS details WHERE table_uid=50001"""
    site = "SELECT json_value FROM system_config WHERE key='dataset_cover_theme_config'"
    ledger = """SELECT jsonb_object_agg(filename, to_jsonb(entry))
        FROM system_schema_migrations AS entry"""
    versions = "SELECT jsonb_agg(to_jsonb(entry) ORDER BY id) FROM system_db_version AS entry"
    before_visibility, before_site = value(upgrade, visibility), value(upgrade, site)
    assert json.loads(before_site)["shared"]["label_value_layout"] == "inline"
    before_ledger = json.loads(value(upgrade, ledger))
    migration_names = {path.name for path in MIGRATIONS.glob("*.sql")}
    release_names = {path.name for path in release}
    # The files pending on a 9.9.2 package are 9.10.0's and those of any later open version.
    pending_names = {path.name for path in MIGRATIONS.glob("*.sql") if (_declared_db_version(path) or (0,)) >= (9, 10, 0)}
    assert release_names <= pending_names
    assert migration_names - before_ledger.keys() == pending_names

    # Invoke the real Go runner, including its per-file transaction and ledger
    # insert, instead of manufacturing a successful release ledger in the test.
    runner = tmp_path / "release_upgrade.go"
    runner.write_text("""// release_upgrade.go
// Runs the public migration runner against this test's disposable database.
// Connects the Python release proof to production ordering and ledger writes.
// Exists to prove the complete upgrade without starting the application.
package main

import (
    "database/sql"
    "log"
    "os"
    "easelect/backend/core_components/migrations"
    _ "github.com/lib/pq"
)

func main() {
    db, err := sql.Open("postgres", "sslmode=disable")
    if err != nil { log.Fatal(err) }
    defer db.Close()
    if err := migrations.RunMigrations(db, os.Args[1]); err != nil { log.Fatal(err) }
}
""")
    connection = json.loads(value(upgrade, """SELECT json_build_object(
        'host',current_setting('unix_socket_directories'),
        'port',current_setting('port'),'user',current_user,'database',current_database())"""))
    environment = os.environ.copy()
    environment.update(PGHOST=connection["host"], PGPORT=connection["port"],
                       PGUSER=connection["user"], PGDATABASE=connection["database"],
                       GOTOOLCHAIN="local", EASELECT_MIGRATION_FILE_ALLOWLIST="")
    previous_ledger, previous_versions = None, None
    for _ in range(2):
        result = subprocess.run(["go", "run", str(runner), str(MIGRATIONS)], cwd=APP,
                                env=environment, capture_output=True, text=True)
        assert result.returncode == 0, result.stdout + result.stderr
        _assert_retired(upgrade)
        assert value(upgrade, visibility) == before_visibility
        assert value(upgrade, site) == before_site
        assert value(upgrade, "SELECT version FROM system_db_version ORDER BY id DESC LIMIT 1") == CURRENT_DB
        assert value(upgrade, "SELECT count(*) FROM system_db_version WHERE version='9.10.0'") == "1"
        assert "removed unused per-column field wrapping" in value(upgrade,
            "SELECT description FROM system_db_version WHERE version='9.10.0'")
        assert value(upgrade, "SELECT count(*) FROM app_check_row_actor_marks()") == "0"
        current_ledger = json.loads(value(upgrade, ledger))
        assert set(current_ledger) == migration_names
        assert current_ledger.keys() - before_ledger.keys() == pending_names
        assert RELEASE_RECORD.name in current_ledger
        assert all(current_ledger[name] == entry for name, entry in before_ledger.items())
        current_versions = value(upgrade, versions)
        if previous_ledger is not None:
            assert current_ledger == previous_ledger
            assert current_versions == previous_versions
        previous_ledger, previous_versions = current_ledger, current_versions
