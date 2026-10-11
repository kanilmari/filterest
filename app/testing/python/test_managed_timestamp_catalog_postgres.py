"""test_managed_timestamp_catalog_postgres.py
Prove freshly generated bootstrap types contain no undeferred naive clocks.
Connect public source generation to PostgreSQL's resolved type catalog.
Keep the authoritative spelling-independent proof on disposable clusters only.
"""
import json

from test_managed_timestamp_bootstrap import BOOTSTRAP, validate_zoned_timestamp_schema
from test_public_bootstrap_independence import copy_public_inputs, generate
from test_row_actor_support import cluster, value  # noqa: F401

# WL167 batch 3b's complete reviewed site-owned inventory, not a prefix rule.
# These columns are absent from the public bootstrap today. No views, domains,
# composites or routines inherit an exclusion merely by referencing them.
DEFERRED_SITE_COLUMNS = {
    ("public", "app_dating_profiles", "created"),
    ("public", "app_dating_profiles", "updated"),
    ("public", "dev_todo", "created"),
    ("public", "dev_todo", "updated"),
    ("public", "system_file_structure", "created"),
    ("public", "system_file_structure", "updated"),
    ("public", "system_styles", "created"),
    ("public", "system_styles", "updated"),
    ("public", "system_triggers", "created"),
    ("public", "system_triggers", "updated"),
    ("public", "app_service_catalog_lang_embeddings", "updated"),
}

# OIDs, not format_type text, decide which types contain the naive catalog type.
# UNION terminates shared/cyclic paths. Reverse edges cover arrays of domains,
# domains over arrays, domain chains and composites containing any such type.
NAIVE_TIMESTAMP_CATALOG_SQL = """
WITH RECURSIVE type_edges(parent, child) AS (
    SELECT oid, typbasetype FROM pg_catalog.pg_type WHERE typbasetype <> 0
    UNION
    SELECT oid, typelem FROM pg_catalog.pg_type WHERE typelem <> 0
    UNION
    SELECT t.oid, a.atttypid FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_attribute a ON a.attrelid = t.typrelid
    WHERE t.typtype = 'c' AND a.attnum > 0 AND NOT a.attisdropped
), naive_types(oid) AS (
    SELECT 'pg_catalog.timestamp'::pg_catalog.regtype::oid
    UNION
    SELECT edge.parent FROM type_edges edge JOIN naive_types naive ON edge.child = naive.oid
), application_schemas AS (
    SELECT oid, nspname FROM pg_catalog.pg_namespace
    WHERE nspname NOT IN ('pg_catalog', 'information_schema') AND nspname !~ '^pg_'
), uses AS (
    SELECT CASE c.relkind
        WHEN 'v' THEN 'view column' WHEN 'm' THEN 'materialized view column'
        WHEN 'c' THEN 'composite column' WHEN 'f' THEN 'foreign table column'
        ELSE 'table column' END AS kind,
        n.nspname AS schema, c.relname AS object, a.attname AS member, '' AS signature
    FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN application_schemas n ON n.oid = c.relnamespace
    JOIN naive_types naive ON naive.oid = a.atttypid
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'c', 'f') AND a.attnum > 0 AND NOT a.attisdropped
    UNION ALL
    SELECT 'domain', n.nspname, t.typname, 'base', ''
    FROM pg_catalog.pg_type t JOIN application_schemas n ON n.oid = t.typnamespace
    JOIN naive_types naive ON naive.oid = t.typbasetype WHERE t.typtype = 'd'
    UNION ALL
    SELECT CASE p.prokind WHEN 'p' THEN 'procedure argument' WHEN 'a' THEN 'aggregate argument'
        WHEN 'w' THEN 'window function argument' ELSE 'function argument' END,
        n.nspname, p.proname,
        'argument ' || arg.position || ' (' || COALESCE(p.proargmodes[arg.position::integer]::text, 'i') || ')',
        pg_catalog.pg_get_function_identity_arguments(p.oid)
    FROM pg_catalog.pg_proc p JOIN application_schemas n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL unnest(COALESCE(p.proallargtypes, p.proargtypes::oid[]))
        WITH ORDINALITY AS arg(type_oid, position)
    JOIN naive_types naive ON naive.oid = arg.type_oid
    WHERE p.prokind IN ('f', 'p', 'a', 'w')
    UNION ALL
    SELECT CASE p.prokind WHEN 'p' THEN 'procedure result' WHEN 'a' THEN 'aggregate result'
        WHEN 'w' THEN 'window function result' ELSE 'function result' END,
        n.nspname, p.proname, 'result', pg_catalog.pg_get_function_identity_arguments(p.oid)
    FROM pg_catalog.pg_proc p JOIN application_schemas n ON n.oid = p.pronamespace
    JOIN naive_types naive ON naive.oid = p.prorettype WHERE p.prokind IN ('f', 'p', 'a', 'w')
)
SELECT COALESCE(jsonb_agg(to_jsonb(uses) ORDER BY kind, schema, object, member, signature), '[]'::jsonb)
FROM uses
"""


def find_naive_timestamp_uses(run):
    """Report every resolved naive type use outside PostgreSQL's system schemas.

    TABLE outputs and OUT/INOUT arguments live in proallargtypes; SETOF uses
    prorettype like scalar results. Keep signatures to identify overloads.
    Exclusions are applied by assertions, never hidden inside the finder.
    """
    return json.loads(value(run, NAIVE_TIMESTAMP_CATALOG_SQL))


def undeferred_uses(uses):
    return [hit for hit in uses if hit["kind"] != "table column"
            or (hit["schema"], hit["object"], hit["member"]) not in DEFERRED_SITE_COLUMNS]


def test_deferrals_allow_only_the_named_site_table_columns():
    deferred = [{"kind": "table column", "schema": schema, "object": table, "member": column}
                for schema, table, column in DEFERRED_SITE_COLUMNS]
    assert len(deferred) == 11
    assert undeferred_uses(deferred) == []
    other_uses = [dict(deferred[0], kind="view column"), dict(deferred[0], schema="restricted"),
                  dict(deferred[0], member="review_clock"), dict(deferred[0], kind="domain")]
    assert undeferred_uses(other_uses) == other_uses


def generated_bootstrap(tmp_path, injection=""):
    root = copy_public_inputs(tmp_path)
    source = root / "app/server_tools/public_bootstrap/source/app_tables.schema.sql"
    source.write_text(source.read_text() + injection)
    result = generate(root)
    assert result.returncode == 0, result.stdout + result.stderr
    return root / "app/server_tools/public_bootstrap"


def load_bootstrap(cluster, bootstrap):
    cluster("CREATE DATABASE timestamp_catalog")
    for name in ("schema.sql", "seed_data.sql"):
        cluster((bootstrap / name).read_text(), "timestamp_catalog")

    def run(sql, check=True):
        return cluster(sql, "timestamp_catalog", check)

    return run


def test_freshly_generated_bootstrap_has_no_undeferred_naive_catalog_types(cluster, tmp_path):
    bootstrap = generated_bootstrap(tmp_path)
    for name in ("schema.sql", "seed_data.sql", "manifest.json"):
        assert (bootstrap / name).read_bytes() == (BOOTSTRAP / name).read_bytes()
    run = load_bootstrap(cluster, bootstrap)
    uses = find_naive_timestamp_uses(run)
    assert undeferred_uses(uses) == [], json.dumps(uses, indent=2)


# A dollar-quoted body is deliberately outside the early text guard. The actual
# reviewer probe and a domain over timestamp still reach PostgreSQL unchanged.
# The catalog array name (_timestamp) is also an unparsed static spelling. Do
# not disable or patch the validator: the positive control proves its boundary.
POSITIVE_CONTROL_DECLARATIONS = (
    'ALTER TABLE public.palvelukatalogi ADD COLUMN review_clock U&"timestamp"(6)',
    'CREATE DOMAIN public.review_clock_base AS timestamp',
    'CREATE DOMAIN public.review_clock_chain AS public.review_clock_base',
    'CREATE DOMAIN public.review_clock_array_domain AS public.review_clock_chain[]',
    'ALTER TABLE public.palvelukatalogi ADD COLUMN review_array timestamp[]',
    'ALTER TABLE public.palvelukatalogi ADD COLUMN review_domain public.review_clock_chain',
    'ALTER TABLE public.palvelukatalogi ADD COLUMN review_domain_array public.review_clock_chain[]',
    'ALTER TABLE public.palvelukatalogi ADD COLUMN review_array_domain public.review_clock_array_domain',
    'CREATE VIEW public.review_clock_view AS SELECT review_clock, review_array_domain FROM public.palvelukatalogi',
    'CREATE MATERIALIZED VIEW public.review_clock_materialized AS SELECT review_clock, review_domain_array FROM public.palvelukatalogi WITH NO DATA',
    'CREATE TYPE public.review_clock_composite AS (clock timestamp, clocks public.review_clock_chain[])',
    'CREATE DOMAIN public.review_clock_record AS public.review_clock_composite',
    'ALTER TABLE public.palvelukatalogi ADD COLUMN review_record public.review_clock_record[]',
    'CREATE FUNCTION public.review_clock_args(input_clock timestamp, input_clocks public.review_clock_chain[]) RETURNS text LANGUAGE sql AS $$SELECT NULL::text$$',
    # SQL function bodies must return their declared types, so each NULL is cast to it.
    'CREATE FUNCTION public.review_clock_scalar() RETURNS U&"timestamp"(6) LANGUAGE sql AS $$SELECT NULL::timestamp$$',
    'CREATE FUNCTION public.review_clock_setof() RETURNS SETOF pg_catalog."timestamp" LANGUAGE sql AS $$SELECT NULL::timestamp$$',
    'CREATE FUNCTION public.review_clock_array() RETURNS public.review_clock_array_domain LANGUAGE sql AS $$SELECT NULL::public.review_clock_array_domain$$',
    'CREATE FUNCTION public.review_clock_table() RETURNS TABLE(clock timestamp, clocks public.review_clock_chain[]) LANGUAGE sql AS $$SELECT NULL::timestamp,NULL::public.review_clock_chain[]$$',
    'CREATE FUNCTION public.review_clock_out(IN input_clock timestamp[], OUT output_clock public.review_clock_chain, OUT output_clocks timestamp[]) LANGUAGE sql AS $$SELECT NULL::public.review_clock_chain,NULL::timestamp[]$$',
    'CREATE FUNCTION public.review_clock_record_args(value public.review_clock_record[]) RETURNS public.review_clock_composite LANGUAGE sql AS $$SELECT NULL::public.review_clock_composite$$',
    'CREATE FUNCTION public.review_clock_variadic(VARIADIC clocks timestamp[]) RETURNS text LANGUAGE sql AS $$SELECT NULL::text$$',
    'CREATE PROCEDURE public.review_clock_proc(IN input_clock timestamp, INOUT output_clocks public.review_clock_chain[]) LANGUAGE sql AS $$SELECT output_clocks$$',
    'CREATE PROCEDURE public.review_clock_proc_out(OUT output_clock timestamp) LANGUAGE sql AS $$SELECT NULL::timestamp$$',
    # Aggregates and window functions are routines too (prokind 'a' and 'w').
    'CREATE AGGREGATE public.review_clock_max(pg_catalog."timestamp") (SFUNC = pg_catalog.timestamp_larger, STYPE = pg_catalog."timestamp")',
    "CREATE FUNCTION public.review_clock_window(pg_catalog.\"timestamp\") RETURNS pg_catalog.\"timestamp\" LANGUAGE internal WINDOW AS 'window_first_value'",
    'CREATE SCHEMA review_clock_schema',
    'CREATE DOMAIN review_clock_schema.review_clock_domain AS public.review_clock_chain[]',
)
POSITIVE_CONTROL_SQL = ("\nDO $catalog_positive_control$ BEGIN\n"
                        + "\n".join(f"EXECUTE $probe${sql}$probe$;" for sql in POSITIVE_CONTROL_DECLARATIONS)
                        + "\nEND $catalog_positive_control$;\n"
                        + 'ALTER TABLE public.palvelukatalogi ADD COLUMN review_catalog_array pg_catalog."_timestamp";\n')


def test_catalog_positive_control_sources_reach_generated_bootstrap(tmp_path):
    # Runnable without sockets: prove both static blind spots reach the artifact,
    # and that the spelling-aware validator has not been disabled for the test.
    validate_zoned_timestamp_schema(POSITIVE_CONTROL_SQL, "showcase control")
    bootstrap = generated_bootstrap(tmp_path, POSITIVE_CONTROL_SQL)
    assert POSITIVE_CONTROL_SQL in (bootstrap / "schema.sql").read_text()


def test_catalog_finder_reports_exactly_the_injected_naive_objects(cluster, tmp_path):
    bootstrap = generated_bootstrap(tmp_path, POSITIVE_CONTROL_SQL)
    run = load_bootstrap(cluster, bootstrap)
    uses = find_naive_timestamp_uses(run)
    expected = [
        ("table column", "public", "palvelukatalogi", column) for column in (
            "review_clock", "review_array", "review_domain", "review_domain_array",
            "review_array_domain", "review_record", "review_catalog_array")
    ] + [
        ("domain", "public", domain, "base") for domain in (
            "review_clock_base", "review_clock_chain", "review_clock_array_domain", "review_clock_record")
    ] + [
        ("domain", "review_clock_schema", "review_clock_domain", "base"),
        ("view column", "public", "review_clock_view", "review_clock"),
        ("view column", "public", "review_clock_view", "review_array_domain"),
        ("materialized view column", "public", "review_clock_materialized", "review_clock"),
        ("materialized view column", "public", "review_clock_materialized", "review_domain_array"),
        ("composite column", "public", "review_clock_composite", "clock"),
        ("composite column", "public", "review_clock_composite", "clocks"),
        ("function argument", "public", "review_clock_args", "argument 1 (i)"),
        ("function argument", "public", "review_clock_args", "argument 2 (i)"),
        ("function result", "public", "review_clock_scalar", "result"),
        ("function result", "public", "review_clock_setof", "result"),
        ("function result", "public", "review_clock_array", "result"),
        ("function argument", "public", "review_clock_table", "argument 1 (t)"),
        ("function argument", "public", "review_clock_table", "argument 2 (t)"),
        ("function argument", "public", "review_clock_out", "argument 1 (i)"),
        ("function argument", "public", "review_clock_out", "argument 2 (o)"),
        ("function argument", "public", "review_clock_out", "argument 3 (o)"),
        ("function argument", "public", "review_clock_record_args", "argument 1 (i)"),
        ("function result", "public", "review_clock_record_args", "result"),
        ("function argument", "public", "review_clock_variadic", "argument 1 (v)"),
        ("procedure argument", "public", "review_clock_proc", "argument 1 (i)"),
        ("procedure argument", "public", "review_clock_proc", "argument 2 (b)"),
        ("procedure argument", "public", "review_clock_proc_out", "argument 1 (o)"),
        ("aggregate argument", "public", "review_clock_max", "argument 1 (i)"),
        ("aggregate result", "public", "review_clock_max", "result"),
        ("window function argument", "public", "review_clock_window", "argument 1 (i)"),
        ("window function result", "public", "review_clock_window", "result"),
    ]
    observed = [(hit["kind"], hit["schema"], hit["object"], hit["member"]) for hit in uses]
    assert sorted(observed) == sorted(expected), json.dumps(uses, indent=2)
    assert undeferred_uses(uses) == uses
