"""test_dataset_appearance_bootstrap.py
Proves private WL160 storage is included, accepted and repeatable in bootstrap.
Connects the reviewed migration with fresh and pre-slice-2 disposable databases.
Never connects to an installation database or uses protected credentials.
"""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import sys

import pytest
from test_front_page_bootstrap import cluster, installed  # noqa: F401
from test_row_actor_support import value

APP = Path(__file__).resolve().parents[2]
ROOT = APP.parent
BOOTSTRAP = APP / "server_tools/public_bootstrap"
MIGRATIONS = APP / "server_tools/migrations"
MIGRATION = MIGRATIONS / "20261009000003_create_system_dataset_appearance.sql"
CUTOVER = MIGRATIONS / "20261009000040_cut_over_dataset_card_appearance.sql"
SCHEMA = MIGRATIONS / "20261009000060_extend_dataset_appearance_three_places.sql"
BACKFILL = MIGRATIONS / "20261009000061_backfill_dataset_appearance_three_places.sql"
HEADING_ORDER = MIGRATIONS / "20261015000020_add_row_group_heading_order_appearance_field.sql"
ROW_PRESENTATION = MIGRATIONS / "20261105000985_add_row_article_default_presentation.sql"
DISCLOSURES = MIGRATIONS / "20261106000100_move_disclosure_defaults_to_appearance.sql"
OWNER = MIGRATIONS / "20261009000099_record_database_release_9_11_0.sql"
BASE = "e314e34"


def test_dataset_appearance_migration_version_and_generated_artifacts():
    sql = MIGRATION.read_text()
    assert "-- VERSION_DB: 9.11.0" in sql
    assert f"-- VERSION_DB_OWNER: {OWNER.name}" in sql
    assert MIGRATION.name < OWNER.name
    assert "-- COMPLETION_MARKER: system_dataset_appearance_table" in sql
    assert "-- FINAL_CHECK: public.app_check_dataset_appearance_storage()" in sql
    assert "system_db_version" not in sql
    assert "card_style_variant" not in sql and "card_detail_columns" not in sql
    assert sql in (BOOTSTRAP / "schema.sql").read_text()
    current = (APP / "VERSION_DB").read_text().strip()
    assert (BOOTSTRAP / "schema.sql").read_bytes() == (APP / f"server_tools/versioning/schema_snapshots/db-{current}.sql").read_bytes()
    manifest = json.loads((BOOTSTRAP / "manifest.json").read_text())
    assert manifest["db_version"] == current
    assert "public.system_dataset_appearance" in manifest["allowed_schema_tables"]
    assert "public.system_dataset_appearance" in manifest["allowed_seed_tables"]
    assert MIGRATION.name in manifest["migration_ledger_baseline"]
    acceptance = (BOOTSTRAP / "seed_data.sql").read_text().split("DO $filterest_acceptance$", 1)[1]
    assert "'system_dataset_appearance_table'" in acceptance
    assert "FROM public.app_check_dataset_appearance_storage() AS result" in acceptance
    for name, metadata in manifest["source_files"].items():
        path = ROOT / name.removeprefix("filterest/")
        assert hashlib.sha256(path.read_bytes()).hexdigest() == metadata["sha256"], name
    for name, metadata in manifest["generated_files"].items():
        assert hashlib.sha256((APP / name).read_bytes()).hexdigest() == metadata["sha256"], name


def test_dataset_appearance_bootstrap_regeneration_is_exact(tmp_path):
    result = subprocess.run([sys.executable, str(BOOTSTRAP / "generate_bootstrap.py"), "--target", str(tmp_path)],
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    for name in ("schema.sql", "seed_data.sql", "manifest.json"):
        assert (tmp_path / "app/server_tools/public_bootstrap" / name).read_bytes() == (BOOTSTRAP / name).read_bytes()


@pytest.fixture
def appearance_upgrade(cluster):
    """Existing main's unreleased 9.11.0 package, before the slice 2 table exists."""
    cluster("CREATE DATABASE appearance_upgrade")
    for name in ("schema.sql", "seed_data.sql"):
        original = subprocess.run(["git", "show", f"{BASE}:app/server_tools/public_bootstrap/{name}"],
                                  cwd=ROOT, capture_output=True, text=True, check=True).stdout
        cluster(original, "appearance_upgrade")

    def run(sql, check=True):
        return cluster(sql, "appearance_upgrade", check)

    assert value(run, "SELECT to_regclass('public.system_dataset_appearance') IS NULL") == "t"
    return run


def appearance_shape(run):
    return value(run, """SELECT jsonb_build_object(
        'columns', (SELECT jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod),attnotnull)
            ORDER BY attnum) FROM pg_attribute WHERE attrelid='system_dataset_appearance'::regclass
            AND attnum>0 AND NOT attisdropped),
        'constraints', (SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY conname)
            FROM pg_constraint WHERE conrelid='system_dataset_appearance'::regclass),
        'markers', (SELECT count(*) FROM system_data_repair_records
            WHERE migration='system_dataset_appearance_table' AND action='completed'),
        'registry', (SELECT count(*) FROM system_db_tables WHERE table_name='system_dataset_appearance'),
        'check', (SELECT count(*) FROM app_check_dataset_appearance_storage()))""")


def test_dataset_appearance_fresh_upgrade_and_twice_replay(installed, appearance_upgrade):
    appearance_upgrade(MIGRATION.read_text())
    appearance_upgrade(CUTOVER.read_text())
    appearance_upgrade(SCHEMA.read_text())
    appearance_upgrade(BACKFILL.read_text())
    appearance_upgrade(HEADING_ORDER.read_text())
    appearance_upgrade(OWNER.read_text())
    expected = appearance_shape(installed)
    assert expected == appearance_shape(appearance_upgrade)
    shape = json.loads(expected)
    assert len(shape["columns"]) == 5 and len(shape["constraints"]) == 8
    assert shape["registry"] == shape["check"] == 0 and shape["markers"] == 1
    # Replay each database's own migrations. Replaying an old validator on a newer
    # schema would replace its live catalogue with a previous release's rules.
    for run, replay in ((installed, (DISCLOSURES,)), (appearance_upgrade, (SCHEMA, HEADING_ORDER, BACKFILL))):
        assert value(run, "SELECT count(*) FROM app_check_dataset_appearance_three_places()") == "0"
        uid = value(run, "SELECT table_uid FROM system_db_tables WHERE table_name='tiketit'")
        run(f"UPDATE system_dataset_appearance SET overrides='{{\"shared.card_detail_columns\":2}}',revision=7 WHERE table_uid={uid}")
        before = value(run, "SELECT jsonb_agg(to_jsonb(a) ORDER BY table_uid) FROM system_dataset_appearance a")
        for _ in range(2):
            for migration in replay:
                run(migration.read_text())
            assert appearance_shape(run) == expected
            assert value(run, "SELECT jsonb_agg(to_jsonb(a) ORDER BY table_uid) FROM system_dataset_appearance a") == before


def test_dataset_appearance_upgrade_refuses_malformed_existing_table(appearance_upgrade):
    # CREATE TABLE IF NOT EXISTS keeps a pre-existing table, so the migration's own final check must refuse a same-named
    # permissive constraint before it records completion.
    appearance_upgrade("""CREATE TABLE public.system_dataset_appearance (
        table_uid integer PRIMARY KEY REFERENCES public.system_db_tables(table_uid) ON DELETE CASCADE,
        schema_version integer NOT NULL DEFAULT 1, overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
        revision bigint NOT NULL DEFAULT 1,
        CONSTRAINT ck_system_dataset_appearance_schema_version CHECK (schema_version = 1),
        CONSTRAINT ck_system_dataset_appearance_object CHECK (jsonb_typeof(overrides) = 'object'),
        CONSTRAINT ck_system_dataset_appearance_no_null CHECK (true),
        CONSTRAINT ck_system_dataset_appearance_revision CHECK (revision > 0))""")
    result = appearance_upgrade(MIGRATION.read_text(), check=False)
    assert result.returncode != 0
    assert "dataset appearance storage final check refused" in result.stderr
    assert value(appearance_upgrade, "SELECT count(*) FROM system_data_repair_records "
                                     "WHERE migration='system_dataset_appearance_table'") == "0"


@pytest.mark.parametrize("fault", ["marker", "check"])
def test_dataset_appearance_bootstrap_refuses_missing_proof(cluster, fault):
    cluster("CREATE DATABASE appearance_broken")
    schema = (BOOTSTRAP / "schema.sql").read_text()
    if fault == "marker":
        schema = schema.replace("SELECT 'system_dataset_appearance_table', 'completed',",
                                "SELECT 'system_dataset_appearance_missing', 'completed',")
    cluster(schema, "appearance_broken")
    if fault == "check":
        cluster("ALTER TABLE system_dataset_appearance DROP CONSTRAINT ck_system_dataset_appearance_no_null", "appearance_broken")
    result = cluster((BOOTSTRAP / "seed_data.sql").read_text(), "appearance_broken", check=False)
    assert result.returncode != 0
    assert ("missing completion markers: system_dataset_appearance_table" if fault == "marker"
            else "dataset appearance storage requires six validated checks") in result.stderr
    assert cluster("SELECT count(*) FROM system_schema_migrations", "appearance_broken").stdout.strip() == "0"
    assert cluster("SELECT count(*) FROM system_db_version", "appearance_broken").stdout.strip() == "0"


def test_three_place_migration_sources_and_definition_snapshot():
    import re
    schema = SCHEMA.read_text()
    backfill = BACKFILL.read_text()
    definition = json.loads((APP / "frontend/shared/dataset_appearance/definition.json").read_text())
    # The latest additive migration owns today's rules; historical migrations stay immutable.
    rules = json.loads(re.search(r"SELECT '\n(.*?)'::jsonb;", DISCLOSURES.read_text(), re.S).group(1))
    assert DISCLOSURES.read_text() in (BOOTSTRAP / "seed_data.sql").read_text()
    expected = {}
    for group in ("light", "dark", "shared"):
        fields = definition["shared_fields" if group == "shared" else "theme_fields"]
        for key, field in fields.items():
            if "derived_from" in field:
                continue
            value = dict(field)
            if group == "dark":
                value["default"] = value.get("dark_default", value["default"])
            expected[f"{group}.{key}"] = value
    assert rules == expected
    previous = json.loads(re.search(r"SELECT '\n(.*?)'::jsonb;", ROW_PRESENTATION.read_text(), re.S).group(1))
    assert {key: rule for key, rule in rules.items() if key in previous} == previous
    assert len(set(rules) - set(previous)) == 15
    for migration in (SCHEMA, BACKFILL):
        source = migration.read_text()
        assert migration.name < OWNER.name and "-- VERSION_DB: 9.11.0" in source
        assert f"-- VERSION_DB_OWNER: {OWNER.name}" in source
        assert "-- COMPLETION_MARKER:" in source and "-- FINAL_CHECK:" in source
        assert "INSERT INTO public.system_db_version" not in source
    assert schema in (BOOTSTRAP / "schema.sql").read_text()
    assert backfill in (BOOTSTRAP / "seed_data.sql").read_text()
    assert "preflight refused" in backfill and "effective appearance or one-time revision preservation failed" in backfill


def test_heading_order_migration_adds_only_its_rule_and_canonicalizes_default_storage():
    import re
    old = SCHEMA.read_text()
    new = HEADING_ORDER.read_text()
    rules = lambda sql: json.loads(re.search(r"SELECT '\n(.*?)\n'::jsonb;", sql, re.S).group(1))
    previous, current = rules(old), rules(new)
    added = current.pop('shared.row_group_heading_order')
    assert current == previous
    assert added == {"place": "site_only", "type": "string", "default": "manual", "values": ["manual", "result_count"]}
    assert '-- VERSION_DB: 9.12.0' in new
    assert '-- VERSION_DB_OWNER: 20261015000099_record_database_release_9_12_0.sql' in new
    assert '-- COMPLETION_MARKER: row_group_heading_order_appearance_field' in new
    assert 'system_db_version' not in new
    schema, canonical = new.split('-- BOOTSTRAP_AFTER_DATA_SEED\n')
    assert not re.search(r'\b(?:UPDATE|DELETE|ALTER|DROP|TRIGGER)\b', schema)
    assert "AND json_value->'site_values'->>'shared.row_group_heading_order'='manual'" in canonical
    assert "(json_value->'site_values')-'shared.row_group_heading_order'" in canonical
    assert 'updated=' not in canonical and 'INSERT INTO public.system_config' not in canonical
    assert schema in (BOOTSTRAP / 'schema.sql').read_text()
    seed = (BOOTSTRAP / 'seed_data.sql').read_text()
    assert canonical in seed and seed.index(canonical) > seed.index(BACKFILL.read_text())


def test_disclosure_upgrade_from_restored_968_keeps_article_choice(cluster, tmp_path):
    """Upgrade an actual previous release backup twice using the server's migration runner."""
    cluster("CREATE DATABASE before_986")
    for name in ("schema.sql", "seed_data.sql"):
        source = subprocess.check_output(
            ["git", "show", f"v9.6.8:app/server_tools/public_bootstrap/{name}"], cwd=ROOT, text=True)
        cluster(source, "before_986")

    def before(sql):
        return cluster(sql, "before_986")

    def upgraded(sql):
        return cluster(sql, "after_986")

    version_query = "SELECT version FROM system_db_version ORDER BY id DESC LIMIT 1"
    ledger_query = "SELECT filename FROM system_schema_migrations ORDER BY filename"
    site_query = "SELECT json_value->'defaults' FROM system_config WHERE key='dataset_cover_theme_config'"
    uid = int(value(before, "SELECT table_uid FROM system_db_tables WHERE table_name='tiketit'"))
    path = 'shared.row_article_default_presentation'
    before(f"""UPDATE system_config SET json_value=jsonb_set(json_value,'{{defaults,{path}}}','"image_first_page_view"')
        WHERE key='dataset_cover_theme_config';
        UPDATE system_dataset_appearance SET overrides=overrides || '{{"{path}":"image_first_page_view",
            "shared.card_image_width":415}}'::jsonb WHERE table_uid={uid};
        INSERT INTO system_config(key,json_value) VALUES ('filterbar_section_layout',
            '{{"section_collapsed":{{"filter":false}},"other":"kept"}}')
        ON CONFLICT (key) DO UPDATE SET json_value=excluded.json_value;
        UPDATE system_db_tables SET article_section_initial_open=jsonb_set(article_section_initial_open,
            '{{article_view,details}}','true') WHERE table_uid={uid}""")
    overrides_query = f"SELECT overrides FROM system_dataset_appearance WHERE table_uid={uid}"
    old_site = json.loads(value(before, site_query))
    old_overrides = json.loads(value(before, overrides_query))
    assert old_site[path] == old_overrides[path] == "image_first_page_view"
    assert value(before, version_query) == "9.13.6"
    old_ledger = set(value(before, ledger_query).splitlines())
    env = os.environ.copy()
    env.update(json.loads(value(before, """SELECT json_build_object('PGHOST',current_setting('unix_socket_directories'),
        'PGPORT',current_setting('port'),'PGUSER',current_user,'PGDATABASE',current_database())""")))
    backup = tmp_path / "before_986.dump"
    subprocess.run(["pg_dump", "--format=custom", "--file", str(backup)], env=env, check=True)
    cluster("CREATE DATABASE after_986")
    env.update(PGDATABASE="after_986", GOTOOLCHAIN="local", EASELECT_MIGRATION_FILE_ALLOWLIST="")
    subprocess.run(["pg_restore", "--exit-on-error", "--dbname", "after_986", str(backup)], env=env, check=True)
    assert value(upgraded, version_query) == "9.13.6"
    assert json.loads(value(upgraded, overrides_query)) == old_overrides
    assert value(upgraded, f"SELECT article_section_initial_open#>>'{{article_view,details}}' "
                          f"FROM system_db_tables WHERE table_uid={uid}") == "true"

    palette_query = "SELECT json_value FROM system_config WHERE key='filterbar_section_layout'"
    assert json.loads(value(upgraded, palette_query))["section_collapsed"] == {"filter": False}
    record = "20261106000199_record_database_release_disclosure_defaults.sql"
    sources = tmp_path / "migrations"
    sources.mkdir()
    for migration in MIGRATIONS.glob("*.sql"):
        if migration.name <= record:
            (sources / migration.name).write_bytes(migration.read_bytes())
    runner = tmp_path / "upgrade.go"
    runner.write_text('''package main
import ("database/sql"; "log"; "os"; "easelect/backend/core_components/migrations"; _ "github.com/lib/pq")
func main() {
    db, err := sql.Open("postgres", "sslmode=disable")
    if err != nil { log.Fatal(err) }
    defer db.Close()
    if err := migrations.RunMigrations(db, os.Args[1]); err != nil { log.Fatal(err) }
}
''')
    details = f"SELECT app_article_disclosure_defaults({uid})#>>'{{article_view,details}}'"
    for expected in ("false", "true"):
        result = subprocess.run(["go", "run", str(runner), str(sources)], cwd=APP, env=env, text=True, capture_output=True)
        assert result.returncode == 0, result.stderr
        assert value(upgraded, version_query) == "9.13.7"
        assert value(upgraded, "SELECT count(*) FROM jsonb_object_keys(app_dataset_appearance_v2_rules())") == "61"
        assert value(upgraded, "SELECT count(*) FROM app_check_disclosure_appearance_defaults()") == "0"
        assert set(value(upgraded, ledger_query).splitlines()) == old_ledger | {DISCLOSURES.name, record}
        new_site = json.loads(value(upgraded, site_query))
        assert {key: new_site[key] for key in old_site} == old_site
        assert len(new_site) == len(old_site) + 15
        current_overrides = json.loads(value(upgraded, overrides_query))
        assert {key: current_overrides[key] for key in old_overrides} == old_overrides
        assert json.loads(value(upgraded, palette_query)) == {"other": "kept"}
        assert json.loads(value(upgraded, """SELECT detail FROM system_data_repair_records WHERE
            migration='disclosure_appearance_defaults' AND action='legacy_palette_values'""")) == {"filter": False}
        assert value(upgraded, details) == expected
        assert value(upgraded, f"""SELECT detail#>>'{{values,article_view,details}}' FROM system_data_repair_records
            WHERE migration='disclosure_appearance_defaults' AND action='legacy_article_values'
                AND detail->>'dataset_uid'='{uid}'""") == "true"
        assert value(upgraded, f"SELECT app_valid_dataset_appearance_v2(({site_query})-'{path}','site_default',true)") == "t"
        if expected == "false":
            upgraded(f"""UPDATE system_dataset_appearance SET overrides=jsonb_set(overrides,
                '{{shared.article_view_details_initial_open}}','true') WHERE table_uid={uid}""")
