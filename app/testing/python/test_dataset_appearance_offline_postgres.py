"""Proves three-place upgrades and bootstrap in disposable single-user PostgreSQL.
No sockets, credentials or installation database are used. Go owns live races.
The shared migration fixture is also checked by Go's legacy normalizer.
"""
from pathlib import Path
import json
import os
import subprocess

import pytest

APP = Path(__file__).resolve().parents[2]
ROOT = APP.parent
BOOTSTRAP = APP / "server_tools/public_bootstrap"
MIGRATIONS = APP / "server_tools/migrations"
SCHEMA = MIGRATIONS / "20261009000060_extend_dataset_appearance_three_places.sql"
BACKFILL = MIGRATIONS / "20261009000061_backfill_dataset_appearance_three_places.sql"


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
        source = sql.replace(";\n\n", ";\n \n")
        result = subprocess.run([str(binary / "postgres"), "--single", "-j", "-D", str(data),
                                 "-c", "exit_on_error=true", "postgres"],
                                input=source, text=True, capture_output=True)
        diagnostic = result.stderr.split("STATEMENT:", 1)[0]
        if expected_error:
            assert result.returncode != 0 and expected_error in diagnostic, diagnostic
        else:
            assert result.returncode == 0, diagnostic
        return result

    return run


def source_before_cutover(name):
    return subprocess.run(["git", "show", f"3b7c160:app/server_tools/public_bootstrap/{name}"],
                          cwd=ROOT, capture_output=True, text=True, check=True).stdout


def install(run, upgrade=False):
    for name in ("schema.sql", "seed_data.sql"):
        run(source_before_cutover(name) if upgrade else (BOOTSTRAP / name).read_text())


def literal(value):
    return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"


def assert_sql(run, condition, message="assertion failed"):
    run(f"DO $p$ BEGIN IF NOT ({condition}) THEN RAISE EXCEPTION '{message}'; END IF; END $p$;")


def test_three_places_fresh_bootstrap_and_lifecycle(offline_postgres):
    run = offline_postgres
    install(run)
    assert_sql(run, "NOT EXISTS (SELECT 1 FROM app_check_dataset_appearance_storage()) AND "
               "NOT EXISTS (SELECT 1 FROM app_check_dataset_appearance_three_places())")
    assert_sql(run, "(SELECT count(*) FROM system_dataset_appearance)=(SELECT count(*) FROM system_db_tables)")
    # Temp tables do not survive single-user sessions: durable synthetic proof copy.
    run("CREATE TABLE fixture_before AS SELECT * FROM system_dataset_appearance;")
    for _ in range(2):
        run(SCHEMA.read_text())
        run(BACKFILL.read_text())
        assert_sql(run, "NOT EXISTS ((SELECT * FROM fixture_before EXCEPT SELECT * FROM system_dataset_appearance) "
                   "UNION ALL (SELECT * FROM system_dataset_appearance EXCEPT SELECT * FROM fixture_before))", "replay changed revisions")
    run("UPDATE system_db_tables SET table_name='renamed_fixture' WHERE table_name='tiketit';")
    assert_sql(run, "EXISTS(SELECT 1 FROM system_dataset_appearance a JOIN system_db_tables d USING(table_uid) WHERE d.table_name='renamed_fixture')")
    run("DELETE FROM system_db_tables WHERE table_name='renamed_fixture';")
    assert_sql(run, "NOT EXISTS(SELECT 1 FROM system_dataset_appearance a LEFT JOIN system_db_tables d USING(table_uid) WHERE d.table_uid IS NULL)")


CASES = json.loads((APP / "testing/shared_contracts/dataset_appearance_migration_v2.json").read_text())["cases"]


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_three_places_upgrade_normalization_preservation_revisions_and_replay(offline_postgres, case):
    run = offline_postgres
    install(run, upgrade=True)
    if case["raw"] is not None:
        run("INSERT INTO system_config(key,json_value,updated) VALUES('dataset_cover_theme_config'," + literal(case["raw"]) + ",'2020-01-01');")
    run("INSERT INTO system_dataset_appearance(table_uid,overrides,revision) SELECT table_uid,"
        "'{\"shared.card_style_variant\":\"modern\",\"shared.card_detail_columns\":2}',7 FROM system_db_tables WHERE table_name='tiketit';")
    run(SCHEMA.read_text())
    run(BACKFILL.read_text())
    defaults = "(SELECT jsonb_object_agg(key,value->'default') FROM jsonb_each(app_dataset_appearance_v2_rules()))"
    expected = f"({defaults} || {literal(case['normalized'])})"
    assert_sql(run, "NOT EXISTS(SELECT 1 FROM system_dataset_appearance a JOIN system_config c ON c.key='dataset_cover_theme_config' "
               f"WHERE a.tab_values||(c.json_value->'site_values')||(c.json_value->'defaults')||a.overrides IS DISTINCT FROM {expected}||a.overrides)", "visual value changed")
    assert_sql(run, "EXISTS(SELECT 1 FROM system_dataset_appearance a JOIN system_db_tables d USING(table_uid) "
               "WHERE d.table_name='tiketit' AND revision=8 AND overrides='{\"shared.card_style_variant\":\"modern\",\"shared.card_detail_columns\":2}')")
    assert_sql(run, "NOT EXISTS(SELECT 1 FROM system_dataset_appearance a JOIN system_db_tables d USING(table_uid) WHERE d.table_name<>'tiketit' AND revision<>1)")
    assert_sql(run, "(SELECT updated>'2020-01-01' FROM system_config WHERE key='dataset_cover_theme_config') AND "
               "NOT EXISTS(SELECT 1 FROM app_check_dataset_appearance_three_places())")
    run("CREATE TABLE fixture_before AS SELECT * FROM system_dataset_appearance; CREATE TABLE site_before AS SELECT * FROM system_config WHERE key='dataset_cover_theme_config';")
    for _ in range(2):
        run(SCHEMA.read_text())
        run(BACKFILL.read_text())
    assert_sql(run, "NOT EXISTS(SELECT * FROM fixture_before EXCEPT SELECT * FROM system_dataset_appearance) AND "
               "NOT EXISTS(SELECT * FROM site_before EXCEPT SELECT * FROM system_config WHERE key='dataset_cover_theme_config')", "replay changed values or revisions")


def test_three_places_upgrade_preflight_rollback(offline_postgres):
    run = offline_postgres
    install(run, upgrade=True)
    run("INSERT INTO system_dataset_appearance(table_uid,overrides,revision) SELECT table_uid,'{\"light.image_blur\":0}',7 FROM system_db_tables WHERE table_name='tiketit';")
    run(SCHEMA.read_text())
    run(BACKFILL.read_text(), "preflight refused")
    assert_sql(run, "EXISTS(SELECT 1 FROM system_dataset_appearance WHERE schema_version=1 AND revision=7 AND overrides='{\"light.image_blur\":0}') AND "
               "NOT EXISTS(SELECT 1 FROM system_data_repair_records WHERE migration='dataset_appearance_three_place_backfill')", "failed migration changed data")
    assert_sql(run, "NOT EXISTS(SELECT 1 FROM system_config WHERE key='dataset_cover_theme_config')")


@pytest.mark.parametrize("fault", ["marker", "tab", "constraint", "site"])
def test_three_places_bootstrap_final_checks_refuse_corruption(offline_postgres, fault):
    run = offline_postgres
    run((BOOTSTRAP / "schema.sql").read_text())
    if fault == "marker":
        run("DELETE FROM system_data_repair_records WHERE migration='dataset_appearance_three_place_schema';")
    elif fault == "tab":
        run("ALTER TABLE system_dataset_appearance DROP CONSTRAINT ck_system_dataset_appearance_tab_values; ALTER TABLE system_dataset_appearance DROP COLUMN tab_values;")
    elif fault == "constraint":
        run("ALTER TABLE system_dataset_appearance DROP CONSTRAINT ck_system_dataset_appearance_no_null;")
    else:
        # Invalid site JSON is converted using the same legacy normalization on fresh bootstrap.
        # Corrupt after the backfill and before its acceptance block instead.
        sql = (BOOTSTRAP / "seed_data.sql").read_text()
        sql = sql.replace("DO $filterest_acceptance$", "UPDATE system_config SET json_value=json_value||'{\"cover\":true}' WHERE key='dataset_cover_theme_config';\nDO $filterest_acceptance$")
        run(sql, "bootstrap import failed its final checks")
        return
    run((BOOTSTRAP / "seed_data.sql").read_text(), "missing completion markers" if fault == "marker" else "appearance")
    assert_sql(run, "NOT EXISTS(SELECT 1 FROM system_schema_migrations) AND NOT EXISTS(SELECT 1 FROM system_db_version)")
