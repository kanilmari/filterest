"""test_managed_timestamp_bootstrap.py
Prove fresh platform schema cannot reintroduce naive timestamp declarations.
Connect generator refusal, reviewed managed scope and bootstrap execution evidence.
Keep offline checks separate from the supervisor's disposable PostgreSQL proofs.
"""
from pathlib import Path
import re
import sys

import pytest
from bootstrap_contract_assertions import assert_bootstrap_baseline
from test_public_bootstrap_independence import copy_public_inputs, generate

APP = Path(__file__).resolve().parents[2]
BOOTSTRAP = APP / "server_tools/public_bootstrap"
MIGRATION = APP / "server_tools/migrations/20261009000080_zone_platform_managed_timestamps.sql"
sys.path.insert(0, str(BOOTSTRAP))
from timestamp_schema_validator import validate_zoned_timestamp_schema

# The union of reviewed bootstrap columns and the three production inventories.
# Aliases are already zoned in the current bootstrap; fintravel still has naive ones.
MANAGED_COLUMNS = {
    "system_user_group_memberships": ("created", "updated"),
    "system_db_tables": ("created", "updated"),
    "system_functions": ("created", "updated"),
    "system_config": ("created", "updated"),
    "system_lang_keys": ("created", "updated"),
    "system_lang_keys_archive": ("original_created", "original_updated"),
    "system_column_details": ("created", "updated"),
    "system_column_control": ("created", "updated"),
    "system_foreign_key_relations_m_m": ("created", "updated"),
    "system_db_table_aliases": ("created", "updated"),
}


def test_all_bootstrap_schema_declarations_are_zoned_and_snapshot_is_exact():
    schema = (BOOTSTRAP / "schema.sql").read_text()
    validate_zoned_timestamp_schema(schema, "schema.sql")
    for source in (BOOTSTRAP / "source").glob("*.schema.sql"):
        validate_zoned_timestamp_schema(source.read_text(), source.name)
    assert (BOOTSTRAP / "schema.sql").read_bytes() == \
        (APP / "server_tools/versioning/schema_snapshots" / f"db-{(APP / 'VERSION_DB').read_text().strip()}.sql").read_bytes()
    assert_bootstrap_baseline((BOOTSTRAP / "seed_data.sql").read_text(), MIGRATION)
    assert "public.app_check_managed_timestamp_zones() AS result" in (BOOTSTRAP / "seed_data.sql").read_text()


def test_conversion_scope_covers_public_platform_sources_and_excludes_site_datasets():
    pattern = r"CREATE TABLE (?:IF NOT EXISTS )?((?:public|restricted)\.[a-z_0-9]+|[a-z_0-9]+)\s*\("
    public_tables = set()
    for source in [*(BOOTSTRAP / "source").glob("*.schema.sql"), *(APP / "server_tools/migrations").glob("*.sql")]:
        for name in re.findall(pattern, source.read_text(), re.I):
            name = name if "." in name else "public." + name
            if name.startswith(("public.system_", "public.dev_agent_", "restricted.")) \
                    or name in {"public.ai_chat_conversations", "public.deletion_log"}:
                public_tables.add(name)
    scope = set(re.findall(r"'((?:public|restricted)\.[a-z_0-9]+)'", MIGRATION.read_text().split("$scope$")[1]))
    # Bootstrap reserves the migration ledger's definition. Its clocks have
    # always been zoned, and the whole-schema guard above covers them directly.
    # The dataset namespace lock is a one-row revision counter without clocks,
    # so the conversion has nothing there; prove its definition has none.
    clockless = {"public.system_dataset_namespace_lock"}
    for name in clockless:
        bodies = [match.group(1) for source in (APP / "server_tools/migrations").glob("*.sql")
                  for match in re.finditer(rf"CREATE TABLE (?:IF NOT EXISTS )?{re.escape(name)}\s*\((.*?)\);",
                                           source.read_text(), re.S | re.I)]
        assert bodies and not any(re.search(r"\btime(stamp)?\b", body, re.I) for body in bodies), name
    assert public_tables - {"public.system_schema_migrations"} - clockless <= scope
    assert {"public." + name for name in MANAGED_COLUMNS} <= scope
    assert not scope & {"public.system_file_structure", "public.system_styles", "public.system_triggers",
                        "public.dev_todo", "public.app_dating_profiles", "public.palvelukatalogi"}


def test_captured_dependency_states_are_validated_before_object_removal():
    sql = MIGRATION.read_text()
    refusal = sql.index('RAISE EXCEPTION \'WL167: cannot restore captured')
    assert "enabled NOT IN ('O', 'D', 'R', 'A')" in sql[:refusal]
    assert "enabled <> 'O' AND relkind NOT IN ('r', 'p')" in sql[:refusal]
    assert "v.qualified_name, v.relkind, r.ev_enabled" in sql[:refusal]
    assert "c.relkind, t.tgname" in sql[:refusal]
    assert refusal < sql.index("EXECUTE format('DROP TRIGGER")
    assert refusal < sql.index("EXECUTE 'DROP VIEW '")
    assert refusal < sql.index("ALTER TABLE %s ALTER COLUMN %I TYPE")


@pytest.mark.parametrize('object_kind, state', [('RULE', 'ev_enabled'), ('TRIGGER', 'tgenabled')])
def test_state_restoration_only_changes_nondefault_table_states(object_kind, state):
    sql = MIGRATION.read_text()
    commands = list(re.finditer(rf"EXECUTE format\('ALTER TABLE %s %s {object_kind} %I'.*?;", sql, re.S))
    assert len(commands) == 1
    command = commands[0]
    guard = re.search(rf"IF item.relkind IN \('r', 'p'\) AND item.{state} <> 'O' THEN\s*$",
                      sql[:command.start()])
    assert guard is not None
    assert sql[command.end():].lstrip().startswith('END IF;')
    assert "ELSE 'ENABLE'" not in command.group()


@pytest.mark.parametrize("type_name", [
    "timestamp", "TIMESTAMP(6)", "timestamp without time zone", "timestamp (3) without time zone",
    '"timestamp"', '"timestamp"(6)', 'pg_catalog.timestamp', 'pg_catalog.timestamp(6)',
    'pg_catalog."timestamp"(6)', '"pg_catalog"."timestamp" (3)',
    'PG_CATALOG."timestamp" /* precision */ (6)',
    'U&"timestamp"', 'U&"timestamp"(6)', r'U&"time\0073tamp"(6)',
    r'U&"\0074ime\+000073tamp"',
    'U&"timestamp" UESCAPE \'!\'',
    'pg_catalog.U&"timestamp" UESCAPE \'!\' (6)',
    r'''U&"t!0069me!+000073tamp" UESCAPE '!' (6)''',
], ids=["bare", "precision", "without_zone", "precision_without_zone", "quoted", "quoted_precision",
        "qualified", "qualified_precision", "pg_catalog_quoted_timestamp_6", "quoted_schema_precision",
        "qualified_commented_precision", "unicode_quoted", "unicode_precision", "unicode_escape_four",
        "unicode_escape_six", "unicode_uescape", "unicode_qualified_uescape_precision",
        "unicode_custom_escape_four_and_six"])
@pytest.mark.parametrize("declaration", [
    "CREATE TABLE public.system_config (created {type_name});",
    "ALTER TABLE public.system_config ADD COLUMN new_clock {type_name};",
    "ALTER TABLE public.system_config ADD IF NOT EXISTS new_clock {type_name};",
    "ALTER TABLE public.system_config ALTER COLUMN created TYPE {type_name};",
    "ALTER TABLE public.system_config ALTER created SET DATA TYPE {type_name};",
], ids=["create", "alter_add", "alter_add_if_missing", "alter_type", "alter_set_data_type"])
def test_naive_declaration_is_refused(type_name, declaration):
    with pytest.raises(ValueError, match="test.sql:1: naive timestamp"):
        validate_zoned_timestamp_schema(declaration.format(type_name=type_name), "test.sql")


@pytest.mark.parametrize("sql", [
    'SELECT now()::pg_catalog."timestamp"(6);',
    'SELECT CAST(now() AS "pg_catalog"."timestamp"(6));',
    'CREATE DOMAIN public.clock AS pg_catalog."timestamp"(6);',
    'CREATE FUNCTION public.clock(value pg_catalog."timestamp"(6)) RETURNS text LANGUAGE sql AS $$SELECT value::text$$;',
    'CREATE FUNCTION public.clock(pg_catalog."timestamp"(6)) RETURNS text LANGUAGE sql AS $$SELECT $1::text$$;',
    'CREATE FUNCTION public.clock() RETURNS TABLE(value pg_catalog."timestamp"(6)) LANGUAGE sql AS $$SELECT NULL$$;',
    'CREATE TYPE public.clock AS (value pg_catalog."timestamp"(6));',
    'CREATE FUNCTION public.clock() RETURNS SETOF pg_catalog."timestamp" LANGUAGE sql AS $$SELECT NULL$$;',
    'CREATE FUNCTION public.clock() RETURNS SETOF "timestamp"(6) LANGUAGE sql AS $$SELECT NULL$$;',
    'CREATE FUNCTION public.clock() RETURNS SETOF U&"timestamp" LANGUAGE sql AS $$SELECT NULL$$;',
    r'''CREATE FUNCTION public.clock() RETURNS SETOF pg_catalog.U&"time!0073tamp" UESCAPE '!' LANGUAGE sql AS $$SELECT NULL$$;''',
    'CREATE FUNCTION public.clock() RETURNS TABLE(id integer, value U&"timestamp"(6)) LANGUAGE sql AS $$SELECT NULL,NULL$$;',
    r'''CREATE FUNCTION public.clock() RETURNS TABLE("timestamp" text, value pg_catalog.U&"\0074ime\+000073tamp") LANGUAGE sql AS $$SELECT NULL,NULL$$;''',
    r'''CREATE FUNCTION public.clock() RETURNS TABLE(U&"time!0073tamp" UESCAPE '!' text, value U&"timestamp" UESCAPE '!' (6)) LANGUAGE sql AS $$SELECT NULL,NULL$$;''',
    'SELECT now()::U&"timestamp"(6);',
    r'''SELECT CAST(now() AS pg_catalog.U&"time!0073tamp" UESCAPE '!' (6));''',
    r'CREATE DOMAIN public.clock AS U&"\0074ime\+000073tamp";',
    'CREATE FUNCTION public.clock(value U&"timestamp"(6)) RETURNS text LANGUAGE sql AS $$SELECT value::text$$;',
    r'''CREATE FUNCTION public.clock(IN pg_catalog.U&"time!0073tamp" UESCAPE '!' (6)) RETURNS text LANGUAGE sql AS $$SELECT $1::text$$;''',
    'CREATE PROCEDURE public.clock(INOUT value U&"timestamp"(6)) LANGUAGE sql AS $$SELECT NULL$$;',
    'CREATE TYPE public.clock AS (value U&"timestamp"(6));',
], ids=["quoted_cast", "quoted_cast_as", "quoted_domain", "named_function_argument",
        "unnamed_function_argument", "returned_table", "composite_type", "setof_qualified_quoted",
        "setof_quoted_precision", "setof_unicode", "setof_unicode_uescape", "returned_table_unicode_precision",
        "returned_table_unicode_escape", "returned_table_unicode_column_and_uescape",
        "unicode_cast", "unicode_cast_as_uescape", "unicode_domain", "unicode_named_function_argument",
        "unicode_unnamed_function_argument", "unicode_procedure_argument", "unicode_composite_type"])
def test_quoted_naive_static_type_references_are_refused(sql):
    with pytest.raises(ValueError, match="naive timestamp"):
        validate_zoned_timestamp_schema(sql, "test.sql")


def test_quoted_timestamp_identifiers_and_qualified_zoned_types_are_allowed():
    validate_zoned_timestamp_schema(r'''
        CREATE TABLE public."timestamp" ("timestamp" pg_catalog."timestamptz"(6),
            other timestamp(3) with time zone);
        ALTER TABLE public."timestamp" ADD COLUMN "timestamp" timestamptz;
        ALTER TABLE public."timestamp" ALTER COLUMN "timestamp" TYPE pg_catalog.timestamptz(6);
        ALTER TABLE public."timestamp" ADD CONSTRAINT "timestamp" CHECK ("timestamp" IS NOT NULL);
        CREATE TYPE public."timestamp" AS (clock timestamptz);
        CREATE VIEW public.example AS SELECT "timestamp" AS "timestamp" FROM public."timestamp";
        CREATE FUNCTION public.example("timestamp" pg_catalog.timestamptz(6)) RETURNS text
            LANGUAGE sql AS $$SELECT "timestamp"::text$$;
        CREATE TABLE public.U&"time\0073tamp" (
            U&"timestamp" UESCAPE '!' pg_catalog.U&"time!0073tamptz" /* outer /* nested */ comment */
                UESCAPE /* escape comment */ '!' (6));
        CREATE FUNCTION public.U&"timestamp"() RETURNS SETOF pg_catalog.U&"time\0073tamptz"
            LANGUAGE sql AS $$SELECT NULL$$;
        CREATE FUNCTION public.zoned_output() RETURNS TABLE(
            U&"time!0073tamp" UESCAPE '!' text, clock timestamptz)
            LANGUAGE sql AS $$SELECT NULL,NULL$$;
    ''', "test.sql")


def test_zoned_types_and_inert_sql_are_allowed():
    validate_zoned_timestamp_schema("""
        /* outer /* created timestamp */ comment */
        CREATE TABLE public.system_config (created timestamp(6) with time zone,
            updated timestamptz, note text DEFAULT 'timestamp without time zone');
        CREATE FUNCTION public.example() RETURNS text LANGUAGE sql
            AS $$SELECT 'timestamp without time zone'$$;
    """, "test.sql")


@pytest.mark.parametrize("declaration", [
    'ALTER TABLE public.palvelukatalogi ADD COLUMN review_clock timestamp;',
    'ALTER TABLE public.palvelukatalogi ADD COLUMN review_clock pg_catalog."timestamp"(6);',
    'ALTER TABLE public.palvelukatalogi ADD COLUMN review_clock U&"timestamp";',
    'ALTER TABLE public.palvelukatalogi ADD COLUMN review_clock U&"timestamp"(6);',
    r'ALTER TABLE public.palvelukatalogi ADD COLUMN review_clock U&"time\0073tamp"(6);',
    r'ALTER TABLE public.palvelukatalogi ADD COLUMN review_clock U&"\0074ime\+000073tamp";',
    'ALTER TABLE public.palvelukatalogi ADD COLUMN review_clock U&"timestamp" UESCAPE \'!\';',
    r'''ALTER TABLE public.palvelukatalogi ADD COLUMN review_clock pg_catalog.U&"time!0073tamp" UESCAPE '!' (6);''',
    'CREATE FUNCTION public.review_clock() RETURNS SETOF pg_catalog."timestamp" LANGUAGE sql AS $$SELECT NULL$$;',
    'CREATE FUNCTION public.review_clock() RETURNS SETOF "timestamp"(6) LANGUAGE sql AS $$SELECT NULL$$;',
    r'''CREATE FUNCTION public.review_clock() RETURNS SETOF U&"time!0073tamp" UESCAPE '!' LANGUAGE sql AS $$SELECT NULL$$;''',
    'CREATE FUNCTION public.review_clock() RETURNS TABLE(id integer, value U&"timestamp"(6)) LANGUAGE sql AS $$SELECT NULL,NULL$$;',
], ids=["bare", "pg_catalog_quoted_timestamp_6", "unicode_quoted", "unicode_precision",
        "unicode_escape_four", "unicode_escape_six", "unicode_uescape", "unicode_qualified_uescape_precision",
        "setof_qualified_quoted", "setof_quoted_precision", "setof_unicode_uescape", "returned_table_unicode_precision"])
def test_generator_refuses_a_reintroduced_naive_clock_without_replacing_artifacts(tmp_path, declaration):
    root = copy_public_inputs(tmp_path)
    output = root / "app/server_tools/public_bootstrap"
    originals = {name: (output / name).read_bytes() for name in ("schema.sql", "seed_data.sql", "manifest.json")}
    source = output / "source/base.schema.sql"
    # An excluded showcase must not become a loophole in fresh-schema validation.
    source.write_text(source.read_text() + f"\n{declaration}\n")
    result = generate(root)
    assert result.returncode != 0 and "naive timestamp" in result.stderr
    for name, original in originals.items():
        assert (output / name).read_bytes() == original
