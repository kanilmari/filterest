"""test_bootstrap_contract_assertions.py
Prove the shared bootstrap ledger assertion refuses every altered, ambiguous or inert baseline.
Connects the generated public seed with the historical migration tests that rely on it.
Each case changes the real seed in memory only; nothing on disk changes.
"""
import hashlib
from pathlib import Path

import pytest

import bootstrap_contract_assertions as contract
from bootstrap_contract_assertions import (
    ACCEPTANCE_CLOSE, ACCEPTANCE_OPEN, LEDGER_END, LEDGER_INSERT, assert_bootstrap_baseline, checked_in_seed,
    generated_seed, ledger_baseline_rows, sql_identifiers,
)

APP = Path(__file__).resolve().parents[2]
SEED = APP / "server_tools/public_bootstrap/seed_data.sql"
MIGRATION = APP / "server_tools/migrations/20261005000070_drop_column_label_value_layout.sql"
MARKER_CHECK = "    SELECT string_agg(marker, ', ' ORDER BY marker) INTO missing_markers\n"
FINAL_CHECKS = "    SELECT string_agg(finding, '; ') INTO findings FROM (\n"
VERSION_ROW = "    INSERT INTO public.system_db_version (version, description)\n"


def baseline_row(migration: Path, digest: str | None = None, outcome: str = "bootstrap_baseline",
                 provenance: str = "bootstrap") -> str:
    digest = digest or hashlib.sha256(migration.read_bytes()).hexdigest()
    return f"('{migration.name}', '{digest}', '{outcome}', '{provenance}')"


def test_checked_in_seed_is_the_generators_and_baselines_the_migration_once() -> None:
    seed = SEED.read_text(encoding="utf-8")
    assert checked_in_seed() == generated_seed() == seed.encode("utf-8")
    assert_bootstrap_baseline(seed, MIGRATION)
    names = [row[0] for row in ledger_baseline_rows(seed)]
    assert len(names) == len(set(names)) > 100


BLOCK_HEADER = "-- Generated migration-ledger baseline and version row"


def before_block(seed: str, insert_into: str) -> str:
    """A filename-only ledger insert before the whole acceptance block (its header comment included), as a generator
    might write it: the pinned block stays unchanged, so only the single-write check can refuse it."""
    insert = f"{insert_into} (filename) VALUES ('{MIGRATION.name}');\n"
    assert seed.count(BLOCK_HEADER) == 1
    return seed.replace(BLOCK_HEADER, insert + BLOCK_HEADER, 1)


def before_acceptance(seed: str, sql: str) -> str:
    """Keep the pinned acceptance block unchanged while prepending competing code or input/lexing changes."""
    assert seed.count(BLOCK_HEADER) == 1
    return seed.replace(BLOCK_HEADER, sql + "\n" + BLOCK_HEADER, 1)


def mutate(seed: str, case: str) -> str:
    row = baseline_row(MIGRATION)
    wrong = baseline_row(MIGRATION, digest="0" * 64)
    conflicting = baseline_row(MIGRATION, digest="0" * 64, outcome="applied", provenance="runner")
    start = seed.index("    " + LEDGER_INSERT)
    end = seed.index(LEDGER_END, start) + len(LEDGER_END) + 1
    statement = seed[start:end]
    body_start = seed.index("BEGIN\n", seed.index(ACCEPTANCE_OPEN)) + len("BEGIN\n")
    body_end = seed.index("END\n" + ACCEPTANCE_CLOSE)
    markers = seed[seed.index(MARKER_CHECK):seed.index(FINAL_CHECKS)]
    checks = seed[seed.index(FINAL_CHECKS):start]
    version = seed[seed.index(VERSION_ROW):body_end]
    cases = {
        # Edits of the checked-in seed alone.
        "wrong_hash": lambda: seed.replace(row, wrong),
        "wrong_outcome": lambda: seed.replace(row, baseline_row(MIGRATION, outcome="applied")),
        "wrong_provenance": lambda: seed.replace(row, baseline_row(MIGRATION, provenance="runner")),
        "missing": lambda: seed.replace(row + ",\n      ", ""),
        "row_outside_the_ledger": lambda: seed.replace(row, wrong).replace(
            ACCEPTANCE_OPEN, "-- " + row + "\n" + ACCEPTANCE_OPEN),
        # Shapes the generator never writes, whether in the seed alone or in the generator too.
        "duplicate": lambda: seed.replace(row, row + ",\n      " + row),
        "conflicting_row_first": lambda: seed.replace(row, conflicting + ",\n      " + row),
        "expected_row_only_in_comment": lambda: seed.replace(row, wrong + " -- " + row),
        "comment_beside_the_row": lambda: seed.replace(row, row + " /* " + row + " */"),
        "second_ledger_insert": lambda: seed[:start] + statement + seed[start:],
        "ledger_statement_in_block_comment": lambda: seed[:start] + "/* " + statement + " */\n" + seed[end:],
        "ledger_statement_in_nested_comment": lambda: seed[:start] + "/* outer /* inner */\n" + statement + "*/\n"
        + seed[end:],
        "ledger_statement_in_line_comments": lambda: seed[:start] + "".join(
            "-- " + line + "\n" for line in statement.rstrip("\n").split("\n")) + seed[end:],
        "ledger_statement_in_inert_literal": lambda: seed[:start] + "    PERFORM $inert$\n" + statement
        + "    $inert$;\n" + seed[end:],
        "ledger_statement_under_if_false": lambda: seed[:start] + "    IF FALSE THEN\n" + statement + "    END IF;\n"
        + seed[end:],
        "ledger_statement_after_the_block": lambda: seed[:start] + seed[end:] + statement,
        "conflicting_insert_before_the_block": lambda: seed.replace(
            ACCEPTANCE_OPEN, LEDGER_INSERT + "\n" + conflicting + "\n" + LEDGER_END + "\n" + ACCEPTANCE_OPEN, 1),
        "acceptance_block_unterminated": lambda: seed.replace(ACCEPTANCE_CLOSE, "END;"),
        "early_return_after_begin": lambda: seed[:body_start] + "    RETURN;\n" + seed[body_start:],
        "whole_body_under_if_false": lambda: seed[:body_start] + "    IF FALSE THEN\n" + seed[body_start:body_end]
        + "    END IF;\n" + seed[body_end:],
        "marker_check_removed": lambda: seed.replace(markers, ""),
        "final_checks_removed": lambda: seed.replace(checks, ""),
        "version_row_removed": lambda: seed.replace(version, ""),
        "ledger_before_the_checks": lambda: seed.replace(markers + checks + statement, statement + markers + checks),
        "errors_swallowed": lambda: seed[:body_end] + "EXCEPTION WHEN OTHERS THEN NULL;\n" + seed[body_end:],
        "statement_after_the_block": lambda: seed + "SELECT 1;\n",
        "check_runs_another_function": lambda: seed.replace(
            "FROM public.app_check_row_actor_marks() AS result",
            "FROM public.app_check_login_name_protections() AS result"),
        "block_for_another_version": lambda: seed.replace(
            VERSION_ROW + "    VALUES ('", VERSION_ROW + "    VALUES ('0.0.1', 'x'), ('"),
        # A competing ledger write before the block: ON CONFLICT (filename) DO NOTHING would keep its row.
        "filename_only_insert_spaced": lambda: before_block(seed, "INSERT  INTO public.system_schema_migrations"),
        "filename_only_insert_lowercase": lambda: before_block(seed, "insert into public.system_schema_migrations"),
        "filename_only_insert_unqualified": lambda: before_block(seed, "INSERT INTO system_schema_migrations"),
        "filename_only_insert_quoted": lambda: before_block(
            seed, 'INSERT INTO "public" . "system_schema_migrations"'),
        "ledger_copy_before_the_block": lambda: seed.replace(
            BLOCK_HEADER, "COPY public.system_schema_migrations (filename) FROM stdin;\n\\.\n" + BLOCK_HEADER, 1),
        "ledger_update_before_the_block": lambda: seed.replace(
            BLOCK_HEADER, "Update  public.system_schema_migrations SET outcome = NULL;\n" + BLOCK_HEADER, 1),
        # Comments between the words are spacing to PostgreSQL.
        "insert_comment_between_words": lambda: before_block(
            seed, "INSERT /* baseline */ INTO public.system_schema_migrations"),
        "insert_comments_around_the_dot": lambda: before_block(
            seed, "insert into public /* a */ . /* b */ system_schema_migrations"),
        "insert_nested_comment": lambda: before_block(
            seed, "INSERT /* outer /* inner */ still */ INTO system_schema_migrations"),
        "insert_line_comment": lambda: before_block(seed, "INSERT -- note\nINTO public.system_schema_migrations"),
        "insert_empty_comments": lambda: before_block(seed, "insert/**/into/**/system_schema_migrations"),
        # A lenient body scan ends at its open comment; the later top-level insert must still count.
        "dollar_quote_hiding_an_insert": lambda: seed.replace(
            BLOCK_HEADER, f"SELECT $x$ /* $x$;\nINSERT INTO public.system_schema_migrations (filename) "
            f"VALUES ('{MIGRATION.name}');\n-- */\n" + BLOCK_HEADER, 1),
        # Any static reference to the ledger table counts, whatever the statement or identifier spelling.
        "ledger_in_a_truncate_list": lambda: seed.replace(
            BLOCK_HEADER, "TRUNCATE TABLE public.system_db_version, public.system_schema_migrations;\n"
            + BLOCK_HEADER, 1),
        "unicode_quoted_insert": lambda: before_block(seed, 'INSERT INTO "public".U&"system_schema_migrations"'),
        "unicode_escaped_insert": lambda: before_block(seed, 'INSERT INTO u&"\\0073ystem_schema_migrations"'),
        "uescape_insert": lambda: before_block(seed, 'INSERT INTO U&"!+000073ystem_schema_migrations" UESCAPE \'!\''),
        "ledger_altered": lambda: seed.replace(
            BLOCK_HEADER, "ALTER TABLE public.system_schema_migrations DISABLE TRIGGER ALL;\n" + BLOCK_HEADER, 1),
        "trigger_function_writing_the_ledger": lambda: seed.replace(
            BLOCK_HEADER, "CREATE FUNCTION public.f() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN INSERT INTO "
            "system_schema_migrations (filename) VALUES ('x'); RETURN NEW; END $f$;\n" + BLOCK_HEADER, 1),
        "crlf_line_endings": lambda: seed.replace("\n", "\r\n"),
        # Unicode escape clauses treat comments as whitespace on either side of the keyword.
        "uescape_comment_before": lambda: before_block(
            seed, 'INSERT INTO "public".U&"system!005Fschema_migrations" /* note */ UESCAPE \'!\''),
        "uescape_comment_after": lambda: before_block(
            seed, 'INSERT INTO U&"system!005Fschema_migrations" UESCAPE /* note */ \'!\''),
        "uescape_comments_both": lambda: before_block(
            seed, 'INSERT INTO U&"system!005Fschema_migrations" -- before\nUESCAPE /* a /* b */ c */ \'!\''),
        "quoted_do": lambda: before_acceptance(
            seed, 'DO \'BEGIN INSERT INTO "public"."system_schema_migrations" (filename) VALUES (\'\'x\'\'); END;\';'),
        "quoted_do_language": lambda: before_acceptance(
            seed, "DO LANGUAGE plpgsql 'BEGIN INSERT INTO system_schema_migrations (filename) VALUES (''x''); END;';"),
        "quoted_sql_function": lambda: before_acceptance(
            seed, "CREATE FUNCTION public.f() RETURNS void LANGUAGE sql AS "
            "'INSERT INTO system_schema_migrations (filename) VALUES (''x'');';"),
        "escape_do_hex": lambda: before_acceptance(
            seed, r"DO E'BEGIN INSERT INTO system\x5fschema_migrations (filename) VALUES (\'x\'); END;';"),
        "escape_do_octal": lambda: before_acceptance(
            seed, r"DO E'BEGIN INSERT INTO system\137schema_migrations (filename) VALUES (\'x\'); END;';"),
        "escape_do_backslash": lambda: before_acceptance(
            seed, r"DO E'BEGIN INSERT INTO system\_schema_migrations (filename) VALUES (\'x\'); END;';"),
        "escape_do_unicode": lambda: before_acceptance(
            seed, r"DO E'BEGIN INSERT INTO system\u005fschema_migrations (filename) VALUES (\'x\'); END;';"),
        "unicode_do": lambda: before_acceptance(
            seed, r"DO U&'BEGIN INSERT INTO system\005fschema_migrations (filename) VALUES (''x''); END;';"),
        "unicode_do_custom": lambda: before_acceptance(
            seed, "DO U&'BEGIN INSERT INTO system!+00005Fschema_migrations (filename) VALUES (''x''); END;' "
            "/* before */ UESCAPE -- after\n'!';"),
        "continued_do": lambda: before_acceptance(
            seed, "DO 'BEGIN INSERT INTO system_'\n'schema_migrations (filename) VALUES (''x''); END;';"),
        "continued_do_line_comment": lambda: before_acceptance(
            seed, "DO 'BEGIN INSERT INTO system_' -- continuation\r\n"
            "'schema_migrations (filename) VALUES (''x''); END;';"),
        "continued_escape_do": lambda: before_acceptance(
            seed, "DO E'BEGIN INSERT INTO system'\n" + r"'\x5fschema_migrations (filename) VALUES (\'x\'); END;';"),
        "continued_unicode_do": lambda: before_acceptance(
            seed, "DO U&'BEGIN INSERT INTO system!'\n"
            "'005Fschema_migrations (filename) VALUES (''x''); END;' UESCAPE '!';"),
        "static_execute_in_dollar_do": lambda: before_acceptance(
            seed, "DO $q$ BEGIN EXECUTE 'INSERT INTO system_schema_migrations (filename) VALUES (''x'')'; END; $q$;"),
        "psql_include": lambda: before_acceptance(seed, r"\i another_seed.sql"),
        "psql_gexec": lambda: before_acceptance(seed, "SELECT 'SELECT 1';\n" + r"\gexec"),
        "psql_set": lambda: before_acceptance(seed, r"\set some_value 1"),
        "psql_encoding": lambda: before_acceptance(seed, r"\encoding LATIN1"),
        "psql_copy": lambda: before_acceptance(seed, r"\copy public.system_db_version FROM 'another_seed.csv'"),
        "copy_from_stdin_data": lambda: before_acceptance(
            seed, "COPY public.system_db_version (version) FROM /* input */ STDIN;\n9.7.0\n\\.\n"),
        "set_standard_strings": lambda: before_acceptance(seed, "SET standard_conforming_strings = off;"),
        "set_client_encoding": lambda: before_acceptance(seed, "SET client_encoding TO 'LATIN1';"),
        "set_names": lambda: before_acceptance(seed, "SET NAMES 'LATIN1';"),
        "reset_lexing_setting": lambda: before_acceptance(seed, 'RESET "client_encoding";'),
        "reset_all_settings": lambda: before_acceptance(seed, "RESET ALL;"),
        "set_config_lexing_setting": lambda: before_acceptance(
            seed, "SELECT pg_catalog.set_config('standard_conforming_strings', 'off', false);"),
        "alter_lexing_setting": lambda: before_acceptance(seed, 'ALTER ROLE readeronly SET "client_encoding" = \'LATIN1\';'),
        "lexing_setting_in_quoted_body": lambda: before_acceptance(
            seed, "DO $q$ BEGIN EXECUTE 'SET LOCAL standard_conforming_strings = off'; END; $q$;"),
        "set_config_grouped_setting": lambda: before_acceptance(
            seed, "SELECT set_config(('client_encoding')::text, 'LATIN1', false);"),
        "set_config_reordered_setting": lambda: before_acceptance(
            seed, "SELECT set_config(new_value => 'off', setting_name => 'standard_conforming_strings', is_local => false);"),
        "set_config_typed_setting": lambda: before_acceptance(
            seed, "SELECT set_config(TEXT 'client_encoding', 'LATIN1', false);"),
    }
    return cases[case]()


VALUE_CASES = ["wrong_hash", "wrong_outcome", "wrong_provenance", "missing", "row_outside_the_ledger"]
SHAPE_CASES = [
    "duplicate", "conflicting_row_first", "expected_row_only_in_comment", "comment_beside_the_row",
    "second_ledger_insert", "ledger_statement_in_block_comment", "ledger_statement_in_nested_comment",
    "ledger_statement_in_line_comments", "ledger_statement_in_inert_literal", "ledger_statement_under_if_false",
    "ledger_statement_after_the_block", "conflicting_insert_before_the_block", "acceptance_block_unterminated",
    "early_return_after_begin", "whole_body_under_if_false", "marker_check_removed", "final_checks_removed",
    "version_row_removed", "ledger_before_the_checks", "errors_swallowed", "statement_after_the_block",
    "check_runs_another_function", "block_for_another_version", "filename_only_insert_spaced",
    "filename_only_insert_lowercase", "filename_only_insert_unqualified", "filename_only_insert_quoted",
    "ledger_copy_before_the_block", "ledger_update_before_the_block", "insert_comment_between_words",
    "insert_comments_around_the_dot", "insert_nested_comment", "insert_line_comment", "insert_empty_comments",
    "dollar_quote_hiding_an_insert", "ledger_in_a_truncate_list", "unicode_quoted_insert", "unicode_escaped_insert",
    "uescape_insert", "ledger_altered", "trigger_function_writing_the_ledger", "crlf_line_endings",
    "uescape_comment_before", "uescape_comment_after", "uescape_comments_both", "quoted_do", "quoted_do_language",
    "quoted_sql_function", "escape_do_hex", "escape_do_octal", "escape_do_backslash", "escape_do_unicode",
    "unicode_do", "unicode_do_custom", "continued_do", "continued_do_line_comment", "continued_escape_do",
    "continued_unicode_do", "static_execute_in_dollar_do", "psql_include", "psql_gexec", "psql_set", "psql_encoding",
    "psql_copy", "copy_from_stdin_data", "set_standard_strings", "set_client_encoding", "set_names",
    "reset_lexing_setting", "reset_all_settings", "set_config_lexing_setting", "alter_lexing_setting",
    "lexing_setting_in_quoted_body",
    "set_config_grouped_setting", "set_config_reordered_setting", "set_config_typed_setting",
]


def test_identifiers_are_read_as_postgresql_spells_them() -> None:
    sql = ("SELECT 'system_schema_migrations', E'it\\'s', \"Odd\"\"Name\", U&\"d\\0061t\", u&\"x!0061\" UESCAPE '!', "
           "U&'lit' UESCAPE '#', $q$ SELECT Inner_Ident -- system_schema_migrations\n$q$ "
           "/* a /* b */ system_schema_migrations */ FOO$bar")
    assert sql_identifiers(sql) == ["select", "it", 'Odd"Name', "dat", "xa", "select", "inner_ident", "foo$bar"]
    for broken in ("SELECT /* open", "SELECT 'open", "SELECT $q$ open", 'SELECT "open', "SELECT E'open\\'"):
        with pytest.raises(AssertionError):
            sql_identifiers(broken)
    assert sql_identifiers(SEED.read_text(encoding="utf-8")).count("system_schema_migrations") == 1


@pytest.mark.parametrize("constant, expected", [
    ("'SELECT system_schema_migrations'", ["select", "system_schema_migrations"]),
    (r"E'SELECT system\x5fschema_migrations'", ["select", "system_schema_migrations"]),
    (r"E'SELECT system\137schema_migrations'", ["select", "system_schema_migrations"]),
    (r"E'SELECT system\_schema_migrations'", ["select", "system_schema_migrations"]),
    (r"E'SELECT system\u005Fschema_migrations'", ["select", "system_schema_migrations"]),
    (r"E'SELECT system\U0000005Fschema_migrations'", ["select", "system_schema_migrations"]),
    (r"E'SELECT\tsystem_schema_migrations\nFROM\r\nexample'", ["select", "system_schema_migrations", "from", "example"]),
    (r"E'SELECT a\ab\vc\xd'", ["select", "aabvc"]),
    (r"U&'SELECT system\005Fschema_migrations'", ["select", "system_schema_migrations"]),
    ("U&'SELECT system!+00005Fschema_migrations' /* a */ UESCAPE /* b */ '!'",
     ["select", "system_schema_migrations"]),
    ("'SELECT system_'\n'schema_migrations'", ["select", "system_schema_migrations"]),
    ("'SELECT system_' -- line\r\n'schema_migrations'", ["select", "system_schema_migrations"]),
    ("E'SELECT system'\n" + r"'\x5fschema_migrations'", ["select", "system_schema_migrations"]),
    ("U&'SELECT system\\00'\n'5Fschema_migrations'", ["select", "system_schema_migrations"]),
    (r"E'SELECT \xC3\xA4'", ["select", "ä"]),
    ("E'SELECT \\xC3'\n'\\xA4'", ["select", "ä"]),
    (r"E'SELECT \uD83D\uDE00'", ["select", "😀"]),
    (r"U&'SELECT \D83D\DE00'", ["select", "😀"]),
    (r"U&'SELECT !0061!!b' UESCAPE '!'", ["select", "a", "b"]),
    ("'SELECT system_' 'schema_migrations'", ["select", "system_"]),
    ("'SELECT system_'\n/* no continuation */ 'schema_migrations'", ["select", "system_"]),
    ("'SELECT system_' /* \n */ 'schema_migrations'", ["select", "system_"]),
    ("E'SELECT \\x5'\n'f'", ["select", "f"]),
    ("$body$ SELECT system_schema_migrations $body$", ["select", "system_schema_migrations"]),
    ("$ä$ SELECT system_schema_migrations $ä$", ["select", "system_schema_migrations"]),
    ("'SELECT system_schema_migrations /* open'", ["select", "system_schema_migrations"]),
    ("'SELECT system_schema_migrations ''open'", ["select", "system_schema_migrations"]),
    ("'SELECT system_schema_migrations \"open'", ["select", "system_schema_migrations"]),
    ("$body$ SELECT system_schema_migrations $open$ $body$", ["select", "system_schema_migrations"]),
])
def test_constants_are_decoded_and_read_as_lenient_code(constant: str, expected: list[str]) -> None:
    assert sql_identifiers("SELECT " + constant + "; After_Constant") == ["select", *expected, "after_constant"]


@pytest.mark.parametrize("sql", [
    r"SELECT '9\.7\.0', 'system\_%' ESCAPE '\'",
    r"SELECT E'9\\.7\\.0', U&'system\\_%'",
    r"DO $body$ BEGIN PERFORM '9\.7\.0'; END; $body$",
    "SELECT 1; -- \\gexec\n/* \\copy */ SELECT 2",
    r"SELECT $body$ \i file.sql $body$",
    "SELECT set_config('lock_timeout', '5s', true)",
    "SELECT set_config('application_name', 'client_encoding', false)",
    "SELECT set_config(new_value => 'client_encoding', setting_name => 'application_name', is_local => false)",
    "SET LOCAL lock_timeout = '5s'; RESET lock_timeout",
    "ALTER ROLE readeronly SET lock_timeout = '5s'",
    "COPY public.example FROM '/tmp/input.csv'",
    "COPY (SELECT * FROM stdin) TO STDOUT",
])
def test_allowed_values_comments_and_other_settings_still_pass(sql: str) -> None:
    assert "system_schema_migrations" not in sql_identifiers(sql)


@pytest.mark.parametrize("sql", [
    "SET /* a */ SESSION /* b */ standard_conforming_strings TO off",
    'SET LOCAL "CLIENT_ENCODING" = \'LATIN1\'',
    "RESET standard_conforming_strings",
    "RESET client_encoding",
    "RESET ALL",
    "SET NAMES DEFAULT",
    "ALTER DATABASE example SET client_encoding FROM CURRENT",
    "ALTER FUNCTION public.f() SET standard_conforming_strings = off",
    "ALTER SYSTEM RESET client_encoding",
    "ALTER ROLE readeronly IN DATABASE example RESET ALL",
    "SELECT set_config('client_encoding', 'LATIN1', false)",
    "SELECT pg_catalog.\"set_config\"(E'client\\x5fencoding', 'LATIN1', false)",
    "SELECT set_config(U&'client!005Fencoding' UESCAPE '!', 'LATIN1', false)",
    "SELECT set_config($setting$client_encoding$setting$, 'LATIN1', false)",
    "SELECT set_config('client_'\n'encoding', 'LATIN1', false)",
    "SELECT set_config(setting_name => 'client_encoding', new_value => 'LATIN1', is_local => false)",
    "SELECT set_config(setting_name := 'standard_conforming_strings', new_value := 'off', is_local := false)",
    "SELECT set_config(('client_encoding')::text, 'LATIN1', false)",
    'SELECT set_config(new_value => \'off\', "setting_name" => \'standard_conforming_strings\', is_local => false)',
    "SELECT set_config(pg_catalog.text 'client_encoding', 'LATIN1', false)",
    "SELECT set_config(CAST(('standard_conforming_strings') AS text), 'off', false)",
    "DO 'BEGIN SET NAMES ''LATIN1''; END;'",
    "DO $body$ BEGIN PERFORM set_config('client_encoding', 'LATIN1', false); END; $body$",
    "SELECT 'RESET ALL /* open'",
    "COPY public.example FROM /* a */ STDIN",
    "DO 'COPY public.example FROM STDIN'",
    "DO $body$ COPY public.example FROM STDIN $body$",
])
def test_static_input_and_parser_setting_changes_are_refused(sql: str) -> None:
    with pytest.raises(AssertionError, match="parser setting|COPY FROM STDIN"):
        sql_identifiers(sql)


@pytest.mark.parametrize("sql", [
    "SELECT 'system_schema_migrations'",
    r"SELECT E'system\x5fschema_migrations'",
    r"SELECT U&'system\005Fschema_migrations'",
    "SELECT $value$system_schema_migrations$value$",
    "EXECUTE 'system_' || 'schema_migrations'",
    "EXECUTE format('INSERT INTO %I', 'system_schema_migrations')",
    "SELECT quote_ident('system_schema_migrations')",
    "SELECT 'system_schema_migrations'::regclass",
    "UPDATE pg_class SET relname = 'system_schema_migrations' WHERE oid = 1",
])
def test_bare_name_values_and_runtime_assembly_stay_out_of_scope(sql: str) -> None:
    assert "system_schema_migrations" not in sql_identifiers(sql)


@pytest.mark.parametrize("sql", [
    r"SELECT U&'\ZZZZ'", r"SELECT U&'\D800'", r"SELECT U&'\0000'",
    r"SELECT E'\uZZZZ'", r"SELECT E'\uD800'", r"SELECT E'\xFF'", r"SELECT E'\0'",
    "SELECT U&'value' UESCAPE 'ab'", "SELECT U&'value' UESCAPE 'a'",
    "SELECT U&'value' UESCAPE /* open", "SELECT U&'value' UESCAPE 'open",
])
def test_top_level_escape_and_unicode_errors_remain_strict(sql: str) -> None:
    with pytest.raises(AssertionError):
        sql_identifiers(sql)


@pytest.mark.parametrize("case", VALUE_CASES + SHAPE_CASES)
def test_every_edit_of_the_checked_in_seed_is_refused(case: str) -> None:
    seed = SEED.read_text(encoding="utf-8")
    assert seed.count(baseline_row(MIGRATION)) == 1
    changed = mutate(seed, case)
    assert changed != seed
    with pytest.raises(AssertionError):
        assert_bootstrap_baseline(changed, MIGRATION)


@pytest.mark.parametrize("case", SHAPE_CASES)
def test_a_generator_writing_the_same_shape_is_refused_too(case: str, monkeypatch: pytest.MonkeyPatch) -> None:
    # Models the generator and the checked-in seed changing together: the byte comparison then agrees, so the shape
    # check alone must refuse the inert, wrapped, reordered or competing ledger write.
    changed = mutate(SEED.read_text(encoding="utf-8"), case)
    monkeypatch.setattr(contract, "generated_seed", lambda: changed.encode("utf-8"))
    monkeypatch.setattr(contract, "checked_in_seed", lambda: changed.encode("utf-8"))
    with pytest.raises(AssertionError):
        ledger_baseline_rows(changed)
    with pytest.raises(AssertionError):
        contract.assert_bootstrap_baseline(changed, MIGRATION)
