"""test_sql_identifier_validator.py
Prove reserved schema names are refused before bootstrap artifacts are replaced.
Connect PostgreSQL's pinned vocabulary to offline generation and migration tests.
Cover declaration positions, quoted history, nested expressions and inert SQL text.
"""
from pathlib import Path
import sys

import pytest

from test_public_bootstrap_independence import copy_public_inputs, generate

BOOTSTRAP = Path(__file__).resolve().parents[2] / "server_tools/public_bootstrap"
sys.path.insert(0, str(BOOTSTRAP))
from sql_identifier_validator import RESERVED_IDENTIFIER_KEYWORDS, declared_identifiers, validate_sql_identifiers


@pytest.mark.parametrize("name", sorted(RESERVED_IDENTIFIER_KEYWORDS))
def test_reserved_object_names_fail_offline(name):
    for statement in (f"CREATE TABLE public.{name} (id integer)",
                      f"CREATE UNIQUE INDEX {name} ON public.items (id)",
                      f"CREATE OR REPLACE FUNCTION public.{name}() RETURNS text AS $$SELECT 'x'$$ LANGUAGE sql"):
        with pytest.raises(ValueError, match="reserved PostgreSQL identifier"):
            validate_sql_identifiers(statement, "migration.sql")


@pytest.mark.parametrize("name", ["authorization", "select", "user", "binary", "collation", "group", "table", "check"])
def test_reserved_column_names_fail_with_source_line(name):
    source = f"-- column declaration\nCREATE TABLE public.items (\n    {name.upper()} jsonb\n);"
    with pytest.raises(ValueError, match=f"migration.sql:3: reserved PostgreSQL identifier '{name}'"):
        validate_sql_identifiers(source, "migration.sql")


def test_nested_expressions_comments_and_quoted_history_are_allowed():
    source = '''
        /* outer /* CREATE TABLE user (authorization jsonb); */ inner */
        CREATE TABLE IF NOT EXISTS public.items (
            "authorization" jsonb CHECK (jsonb_typeof("authorization") = 'object'),
            payload jsonb DEFAULT '{"sql": "CREATE TABLE user (authorization jsonb)"}',
            id integer CHECK (id IN (1, 2)),
            CONSTRAINT items_pk PRIMARY KEY (id),
            CHECK (id > 0), UNIQUE (id)
        );
        -- CREATE TABLE user (authorization jsonb);
        CREATE FUNCTION public.check_items() RETURNS text LANGUAGE sql
        AS $body$SELECT 'CREATE TABLE user (authorization jsonb)'$body$;
    '''
    validate_sql_identifiers(source, "migration.sql")
    assert [item.name for item in declared_identifiers(source)] == [
        "public", "items", "authorization", "payload", "id", "items_pk", "public", "check_items"]


@pytest.mark.parametrize("source", ["/* unfinished", "SELECT $body$unfinished", "SELECT 'unfinished"])
def test_unterminated_constructs_refuse_the_guard(source):
    with pytest.raises(ValueError, match="unterminated"):
        validate_sql_identifiers(source, "migration.sql")


@pytest.mark.parametrize("input_kind", ["migration", "bootstrap_source"])
def test_generation_refuses_reserved_column_and_preserves_every_artifact(tmp_path, input_kind):
    root = copy_public_inputs(tmp_path)
    output = root / "app/server_tools/public_bootstrap"
    originals = {name: (output / name).read_bytes() for name in ("schema.sql", "seed_data.sql", "manifest.json")}
    if input_kind == "migration":
        source = root / "app/server_tools/migrations/20261009000050_create_application_update_admission.sql"
        source.write_text(source.read_text().replace("authorization_context", "authorization"))
    else:
        with (output / "source/base.schema.sql").open("a") as stream:
            stream.write("\nCREATE TABLE public.system_application_update_jobs (authorization jsonb);\n")
    result = generate(root)
    assert result.returncode != 0
    assert "reserved PostgreSQL identifier 'authorization'" in result.stderr
    for name, original in originals.items():
        assert (output / name).read_bytes() == original
