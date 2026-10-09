"""test_dataset_appearance_offline_postgres.py
Checks fresh/upgrade migration SQL using native PostgreSQL without sockets.
Connects the reviewed bootstrap to disposable single-user PostgreSQL clusters.
Supplements, without replacing, the Go transaction and concurrency fixtures.
"""
from pathlib import Path
import os
import subprocess

import pytest

APP = Path(__file__).resolve().parents[2]
ROOT = APP.parent
BOOTSTRAP = APP / "server_tools/public_bootstrap"
MIGRATIONS = APP / "server_tools/migrations"
MIGRATION = MIGRATIONS / "20261009000003_create_system_dataset_appearance.sql"
OWNER = MIGRATIONS / "20261009000099_record_database_release_9_10_2.sql"


@pytest.fixture
def offline_postgres(tmp_path):
    if os.environ.get("FILTEREST_TEST_DISPOSABLE_POSTGRES") != "1":
        pytest.skip("set FILTEREST_TEST_DISPOSABLE_POSTGRES=1 for isolated PostgreSQL checks")
    binary = Path(os.environ.get("PG_TEST_BIN", "/usr/lib/postgresql/16/bin"))
    if not (binary / "initdb").is_file():
        pytest.skip("PostgreSQL test binaries unavailable")
    data = tmp_path / "postgres"
    initialized = subprocess.run([str(binary / "initdb"), "-D", str(data), "-A", "trust", "-U", "fixture_owner",
                                  "--no-locale", "--encoding=UTF8"], capture_output=True, text=True)
    assert initialized.returncode == 0, initialized.stderr

    def run(sql, expected_error=None):
        # Single-user -j treats semicolon + two newlines as a command delimiter
        # even inside dollar quotes. Insert insignificant SQL whitespace so one
        # input is one transaction; EOF terminates it. No server or socket opens.
        source = sql.replace(";\n\n", ";\n \n")
        result = subprocess.run([str(binary / "postgres"), "--single", "-j", "-D", str(data),
                                 "-c", "exit_on_error=true", "postgres"],
                                input=source, text=True, capture_output=True)
        if expected_error:
            assert result.returncode != 0 and expected_error in result.stderr, result.stderr
        else:
            assert result.returncode == 0, result.stderr
        return result

    return run


@pytest.mark.parametrize("installation", ["fresh", "upgrade"])
def test_dataset_appearance_offline_fresh_upgrade_replay_and_lifecycle(offline_postgres, installation):
    run = offline_postgres
    for name in ("schema.sql", "seed_data.sql"):
        if installation == "fresh":
            sql = (BOOTSTRAP / name).read_text()
        else:
            sql = subprocess.run(["git", "show", f"e314e34:app/server_tools/public_bootstrap/{name}"],
                                 cwd=ROOT, capture_output=True, text=True, check=True).stdout
        run(sql)
    if installation == "upgrade":
        run(MIGRATION.read_text())
        run(OWNER.read_text())
    run("""DO $proof$
        BEGIN
            IF EXISTS (SELECT 1 FROM app_check_dataset_appearance_storage()) THEN
                RAISE EXCEPTION 'appearance final check failed';
            END IF;
            IF EXISTS (SELECT 1 FROM system_dataset_appearance) THEN
                RAISE EXCEPTION 'appearance bootstrap must be empty';
            END IF;
            IF (SELECT count(*) FROM pg_constraint WHERE conrelid='system_dataset_appearance'::regclass) <> 6 THEN
                RAISE EXCEPTION 'appearance constraints differ';
            END IF;
        END $proof$;
        UPDATE system_db_tables SET card_style_variant='modern',card_detail_columns=3 WHERE table_name='tiketit';
        INSERT INTO system_dataset_appearance(table_uid,overrides,revision)
            SELECT table_uid,'{"light.image_blur":0,"light.oval_enabled":false,"shared.card_detail_columns":2}',7
            FROM system_db_tables WHERE table_name='tiketit';""")
    for _ in range(2):
        run(MIGRATION.read_text())
        run(OWNER.read_text())
        run("""DO $proof$
            BEGIN
                IF EXISTS (SELECT 1 FROM app_check_dataset_appearance_storage())
                   OR (SELECT count(*) FROM system_data_repair_records
                       WHERE migration='system_dataset_appearance_table' AND action='completed') <> 1
                   OR (SELECT count(*) FROM system_db_version WHERE version='9.10.2') <> 1 THEN
                    RAISE EXCEPTION 'appearance migration replay proof failed';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM system_dataset_appearance WHERE revision=7 AND
                    overrides='{"light.image_blur":0,"light.oval_enabled":false,"shared.card_detail_columns":2}') THEN
                    RAISE EXCEPTION 'migration changed explicit overrides';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM system_db_tables WHERE table_name='tiketit'
                    AND card_style_variant='modern' AND card_detail_columns=3) THEN
                    RAISE EXCEPTION 'migration changed legacy card settings';
                END IF;
            END $proof$;""")
    run("UPDATE system_dataset_appearance SET overrides='{}',revision=8;")
    run(MIGRATION.read_text())
    run("""DO $proof$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM system_dataset_appearance WHERE overrides='{}' AND revision=8) THEN
                RAISE EXCEPTION 'empty override row not retained';
            END IF;
        END $proof$;
        ALTER TABLE public.tiketit RENAME TO wl160_renamed;
        UPDATE system_db_tables SET table_name='wl160_renamed' WHERE table_name='tiketit';
        DO $proof$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM system_dataset_appearance a JOIN system_db_tables d USING(table_uid)
                WHERE d.table_name='wl160_renamed' AND a.revision=8 AND a.overrides='{}') THEN
                RAISE EXCEPTION 'rename lost appearance identity';
            END IF;
        END $proof$;""")
    for statement, message in (
        ("UPDATE system_dataset_appearance SET overrides='null'", "ck_system_dataset_appearance_object"),
        ("UPDATE system_dataset_appearance SET overrides='[]'", "ck_system_dataset_appearance_object"),
        ("UPDATE system_dataset_appearance SET overrides='{\"light.image_blur\":null}'", "ck_system_dataset_appearance_no_null"),
        ("UPDATE system_dataset_appearance SET revision=0", "ck_system_dataset_appearance_revision"),
        ("UPDATE system_dataset_appearance SET schema_version=2", "ck_system_dataset_appearance_schema_version"),
        ("INSERT INTO system_dataset_appearance(table_uid) VALUES(2147483647)", "system_dataset_appearance_table_uid_fkey"),
    ):
        run(statement + ";", expected_error=message)
    # Real dataset deletion has other metadata references; cascade those fixture
    # dependencies too, then confirm that the appearance FK cascades its row.
    run("""DROP TABLE wl160_renamed CASCADE;
        DELETE FROM system_db_tables WHERE table_name='wl160_renamed';
        DO $proof$ BEGIN
            IF EXISTS (SELECT 1 FROM system_dataset_appearance) THEN
                RAISE EXCEPTION 'dataset deletion retained appearance row';
            END IF;
        END $proof$;""")
