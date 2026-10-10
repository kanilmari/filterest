"""test_migration_execution_evidence.py
Verify the migration ledger's nullable evidence and generated bootstrap baselines.
Connect reviewed migration bytes to the public generator, manifest and schema snapshot.
Keep source checks offline and SQL replay confined to opt-in disposable clusters.
"""
import hashlib
import importlib
import json
from pathlib import Path
import re
import subprocess
import sys

import pytest

from test_field_settings_language_seed import database  # noqa: F401
from test_public_bootstrap_independence import copy_public_inputs, generate

APP = Path(__file__).resolve().parents[2]
MIGRATIONS = APP / "server_tools/migrations"
MIGRATION = MIGRATIONS / "20261009000020_add_migration_execution_evidence.sql"
BOOTSTRAP = APP / "server_tools/public_bootstrap"
OWNER = "20261009000099_record_database_release_9_10_2.sql"
EVIDENCE_ROWS = re.compile(
    r"\('([^']+\.sql)', '([0-9a-f]{64})', 'bootstrap_baseline', 'bootstrap'\)"
)
ACCEPTANCE_HEADER = "\n-- Generated migration-ledger baseline and version row"
# Ledger writes besides the acceptance block's insert, in the spellings a changed generator or source might
# use. Placed before the whole acceptance header, a filename-only row would survive the block's
# ON CONFLICT (filename) DO NOTHING with null evidence.
COMPETING_LEDGER_WRITES = {
    "insert_spaced": f"INSERT  INTO public.system_schema_migrations (filename) VALUES ('{MIGRATION.name}');",
    "insert_lowercase": f"insert into public.system_schema_migrations (filename) values ('{MIGRATION.name}');",
    "insert_block_comment":
        f"INSERT /* baseline */ INTO public.system_schema_migrations (filename) VALUES ('{MIGRATION.name}');",
    "insert_line_comment":
        f"INSERT INTO -- baseline\n    public . system_schema_migrations (filename) VALUES ('{MIGRATION.name}');",
    "insert_quoted": f"INSERT INTO \"public\".\"system_schema_migrations\" (filename) VALUES ('{MIGRATION.name}');",
    "insert_quoted_unspaced": f"INSERT INTO\"system_schema_migrations\"(filename)VALUES('{MIGRATION.name}');",
    "insert_upper_unqualified": f"INSERT INTO SYSTEM_SCHEMA_MIGRATIONS (FILENAME) VALUES ('{MIGRATION.name}');",
    "insert_through_view": "CREATE TEMPORARY VIEW baseline AS SELECT * FROM public.system_schema_migrations;\n"
                           f"INSERT INTO baseline (filename) VALUES ('{MIGRATION.name}');",
    "copy": f"COPY public.system_schema_migrations (filename) FROM stdin;\n{MIGRATION.name}\n\\.",
    "update": "Update  public.system_schema_migrations SET outcome = NULL;",
    "merge": "MERGE INTO public.system_schema_migrations AS ledger\n"
             f"USING (VALUES ('{MIGRATION.name}')) AS source (filename) ON ledger.filename = source.filename\n"
             "WHEN NOT MATCHED THEN INSERT (filename) VALUES (source.filename);",
    "truncate_in_target_list": "TRUNCATE TABLE public.system_db_version, public.system_schema_migrations;",
    "delete_in_function_body":
        "DO $baseline$\nBEGIN\n    DELETE FROM ONLY public.system_schema_migrations;\nEND\n$baseline$;",
    "quoted_do_body": "DO 'BEGIN\nINSERT INTO \"public\".\"system_schema_migrations\" (filename)\n"
                      f"VALUES (''{MIGRATION.name}'');\nEND;';",
    "escaped_letter_in_do_body":
        f"DO E'BEGIN INSERT INTO sy\\stem_schema_migrations (filename) VALUES (\\'{MIGRATION.name}\\'); END';",
    "escaped_newline_before_name":
        f"DO E'BEGIN INSERT INTO\\nsystem_schema_migrations (filename) VALUES (\\'{MIGRATION.name}\\'); END';",
    "continued_function_body": "CREATE FUNCTION public.app_forget_baseline() RETURNS void\n"
                               "    AS 'DELETE FROM public.system_schema_' -- continued\n"
                               "    'migrations' LANGUAGE sql;",
}
# How a statement above spells the ledger's name where that differs from the plain name.
SPELLINGS = {"escaped_letter_in_do_body": "sy\\stem", "continued_function_body": "system_schema_'"}
# Escapes that spell letters without writing them, refused outright; the flag says the plain name shows too.
OPAQUE_ESCAPES = {
    "unicode_identifier":
        (f"INSERT INTO U&\"\\0073ystem_schema_migrations\" (filename) VALUES ('{MIGRATION.name}');", False),
    "unicode_quoted_identifier":
        (f"INSERT INTO \"public\".U&\"system_schema_migrations\" (filename) VALUES ('{MIGRATION.name}');", True),
    "uescape_after_comment": ("INSERT INTO \"public\".U&\"system!005Fschema_migrations\" /* note */ UESCAPE '!'\n"
                              f"(filename) VALUES ('{MIGRATION.name}');", False),
    "unicode_string_body": ("DO U&'BEGIN INSERT INTO \\0073ystem_schema_migrations (filename) "
                            f"VALUES (''{MIGRATION.name}''); END';", False),
    "numeric_escape_in_body": ("DO E'BEGIN INSERT INTO \\x73ystem_schema_migrations (filename) "
                               f"VALUES (\\'{MIGRATION.name}\\'); END';", False),
}

# Independent scanner inputs, not imported from the policy under test. PostgreSQL's scan.l uses exactly
# these six characters; only line comments can occur inside its quotecontinue rule. Block comments
# (including nesting) are whitespace between SQL tokens, not between continued string parts.
SCANNER_SPACES = dict(zip(("space", "tab", "lf", "cr", "ff", "vt"), " \t\n\r\f\v"))
SCANNER_NEWLINES = {"lf": "\n", "cr": "\r", "crlf": "\r\n"}
SCANNER_COMMENTS = {
    **{f"line_{name}": "-- apostrophe ' and semicolon ;" + newline
       for name, newline in SCANNER_NEWLINES.items()},
    "block": "/* apostrophe ' and semicolon ; */",
    "nested_block": "/* outer /* inner ' ; */ outer */",
    "multiline_block": "/* before\nafter */",
    "nested_multiline_block": "/* before /* inner\r\n */ after */",
}
LEDGER_NAME = "system_schema_migrations"


def generated_ledger_spellings():
    """Cross each token boundary and name split with the scanner's spaces, comments and newlines."""
    for quoted in (False, True):
        ledger = f'"{LEDGER_NAME}"' if quoted else LEDGER_NAME
        schema = '"public"' if quoted else "public"
        for qualified in (False, True):
            tokens = ["DELETE", "FROM", *([schema, "."] if qualified else []), ledger, ";"]
            for boundary in range(len(tokens) - 1):
                for separator_name, separator in (SCANNER_SPACES | SCANNER_COMMENTS).items():
                    gaps = [" "] * (len(tokens) - 1)
                    gaps[boundary] = separator
                    body = "".join(token + gap for token, gap in zip(tokens, [*gaps, ""]))
                    statement = "DO $probe$BEGIN " + body + " END$probe$;"
                    case = f"tokens_q{quoted}_p{qualified}_gap{boundary}_{separator_name}"
                    yield case, statement, statement.index(LEDGER_NAME)
    continuations = {}
    optional_spaces = {"none": "", **SCANNER_SPACES}
    for newline_name, newline in SCANNER_NEWLINES.items():
        for before_name, before in optional_spaces.items():
            for after_name, after in optional_spaces.items():
                continuations[f"{before_name}_{newline_name}_{after_name}"] = before + newline + after
            # Test each whitespace character adjacent to a line comment, on either side of the newline.
            continuations[f"before_{before_name}_comment_{newline_name}"] = before + "-- continued" + newline
            continuations[f"after_{newline_name}_comment_{before_name}"] = newline + "-- continued" + newline + before
        continuations[f"repeated_comment_{newline_name}"] = "-- first" + newline + "-- second" + newline
    for split in range(1, len(LEDGER_NAME)):
        for separator_name, separator in continuations.items():
            statement = f"DO 'BEGIN DELETE FROM public.{LEDGER_NAME[:split]}'{separator}'{LEDGER_NAME[split:]}; END';"
            yield f"split{split}_{separator_name}", statement, statement.index(LEDGER_NAME[:split] + "'")


GENERATED_LEDGER_SPELLINGS = list(generated_ledger_spellings())


@pytest.mark.parametrize("source", ["schema.sql", "seed_data.sql"])
@pytest.mark.parametrize("statement,name_start", [pytest.param(statement, start, id=case)
                                                for case, statement, start in GENERATED_LEDGER_SPELLINGS])
def test_generated_ledger_spelling_is_refused(audit, source, statement, name_start):
    sql = {"schema.sql": "", "seed_data.sql": "", source: statement}
    line = statement.count("\n", 0, name_start) + 1
    context = ("its reviewed definition" if source == "schema.sql"
               else "the acceptance block's generated insert")
    assert audit.migration_ledger_mention_findings(sql["schema.sql"], sql["seed_data.sql"], None) == [
        f"{source} names the migration ledger outside {context} on line {line}"]


@pytest.mark.parametrize("source", ["schema.sql", "seed_data.sql"])
def test_full_audit_refuses_every_generated_spelling_with_matching_checksum(audit, monkeypatch, source):
    """Exercise every generated position through the full audit without writing an artifact or database."""
    path = BOOTSTRAP / source
    original = path.read_text()
    offset = original.index(ACCEPTANCE_HEADER) if source == "seed_data.sql" else len(original)
    parts, positions = [], []
    position = offset
    for _, statement, name_start in GENERATED_LEDGER_SPELLINGS:
        part = "\n" + statement + "\n"
        positions.append(position + 1 + name_start)
        parts.append(part)
        position += len(part)
    sql = original[:offset] + "".join(parts) + original[offset:]
    manifest = json.loads((BOOTSTRAP / "manifest.json").read_text())
    digest = hashlib.sha256(sql.encode()).hexdigest()
    manifest["generated_files"][f"server_tools/public_bootstrap/{source}"]["sha256"] = digest
    read_text, sha256_file = audit.read_text, audit.sha256_file
    replacements = {path: sql, BOOTSTRAP / "manifest.json": json.dumps(manifest)}
    monkeypatch.setattr(audit, "read_text", lambda file: replacements[file] if file in replacements else read_text(file))
    monkeypatch.setattr(audit, "sha256_file", lambda file: digest if file == path else sha256_file(file))
    context = ("its reviewed definition" if source == "schema.sql"
               else "the acceptance block's generated insert")
    assert audit.audit_bootstrap(APP.parent).findings == [
        f"{source} names the migration ledger outside {context} on " + audit.line_numbers(sql, positions)]


@pytest.mark.parametrize("separator", list(SCANNER_COMMENTS.values()), ids=list(SCANNER_COMMENTS))
def test_statement_comments_are_whitespace_and_do_not_open_strings(audit, separator):
    statements = audit.split_sql_statements("SELECT" + separator + "1; SELECT '/*literal*/ --value';")
    assert [re.sub(r"[ \t\n\r\f\v]+", " ", statement) for statement in statements] == [
        "SELECT 1;", " SELECT '/*literal*/ --value';"]


@pytest.mark.parametrize("separator", [" ", "\t", "\f", "\v", "/* comment */\n", "\n/* nested /*inner*/ */",
                                      "\u00a0\n", "\u0085\n", "\u001c\n", "\u2028\n"])
def test_continuations_require_scanner_newlines_and_exclude_block_comments(audit, separator):
    statement = "DO 'BEGIN DELETE FROM public.system_schema_'" + separator + "'migrations; END';"
    assert audit.MIGRATION_LEDGER_NAME_PATTERN.search(statement) is None


def test_evidence_migration_joins_unreleased_version_and_has_no_history_backfill():
    sql = MIGRATION.read_text()
    assert MIGRATION.name.startswith("2026100900002") and MIGRATION.name < OWNER
    assert "-- VERSION_DB: 9.10.2" in sql
    assert f"-- VERSION_DB_OWNER: {OWNER}" in sql
    assert "-- COMPLETION_MARKER: wl157_migration_execution_evidence" in sql
    assert "system_db_version" not in sql
    assert not re.search(r"\bUPDATE\b|\bDEFAULT\b|ADD COLUMN[^\n]*\bNOT NULL\b", sql)
    for column in ("content_sha256", "outcome", "provenance"):
        assert f"ADD COLUMN IF NOT EXISTS {column} text" in sql
    assert "interrupted_self_managed" in sql and "optional_failure_skipped" in sql and "failed_self_managed" in sql


def test_bootstrap_evidence_binds_every_source_and_matching_snapshot():
    manifest = json.loads((BOOTSTRAP / "manifest.json").read_text())
    seed = (BOOTSTRAP / "seed_data.sql").read_text()
    rows = EVIDENCE_ROWS.findall(seed)
    expected = [(path.name, hashlib.sha256(path.read_bytes()).hexdigest())
                for path in sorted(MIGRATIONS.glob("*.sql"))]
    assert rows == expected
    assert manifest["migration_ledger_baseline"] == [name for name, _ in expected]
    for name, digest in expected:
        assert manifest["source_files"]["filterest/app/server_tools/migrations/" + name]["sha256"] == digest
    for filename in ("schema.sql", "seed_data.sql"):
        digest = hashlib.sha256((BOOTSTRAP / filename).read_bytes()).hexdigest()
        assert manifest["generated_files"]["server_tools/public_bootstrap/" + filename]["sha256"] == digest
    assert (BOOTSTRAP / "schema.sql").read_bytes() == (
        APP / "server_tools/versioning/schema_snapshots/db-9.10.2.sql").read_bytes()
    assert (BOOTSTRAP / "schema.sql").read_text().count(MIGRATION.read_text()) == 1
    acceptance = seed[seed.index("DO $filterest_acceptance$"):]
    assert "wl157_migration_execution_evidence" in acceptance
    assert acceptance.index("missing completion markers") < acceptance.index("INSERT INTO public.system_schema_migrations")


def test_regenerated_evidence_package_is_reproducible(tmp_path):
    root = copy_public_inputs(tmp_path)
    result = generate(root)
    assert result.returncode == 0, result.stderr
    for name in ("schema.sql", "seed_data.sql", "manifest.json"):
        assert (root / "app/server_tools/public_bootstrap" / name).read_bytes() == (BOOTSTRAP / name).read_bytes()


@pytest.mark.parametrize("tamper", ["hash", "outcome", "provenance", "null"])
def test_bootstrap_audit_refuses_fabricated_execution_evidence(tmp_path, tamper):
    root = copy_public_inputs(tmp_path)
    bootstrap = root / "app/server_tools/public_bootstrap"
    seed = (bootstrap / "seed_data.sql").read_text()
    row = EVIDENCE_ROWS.search(seed)
    original = row.group(0)
    replacement = {
        "hash": original.replace(row[2], "0" * 64),
        "outcome": original.replace("bootstrap_baseline", "applied"),
        "provenance": original.replace("'bootstrap'", "'runner'"),
        "null": original.replace("'" + row[2] + "'", "NULL"),
    }[tamper]
    (bootstrap / "seed_data.sql").write_text(seed.replace(original, replacement, 1))
    # Adjust the artifact checksum so the content contract, beyond file hashing,
    # must independently refuse the fabricated execution claim.
    manifest = json.loads((bootstrap / "manifest.json").read_text())
    manifest["generated_files"]["server_tools/public_bootstrap/seed_data.sql"]["sha256"] = hashlib.sha256(
        (bootstrap / "seed_data.sql").read_bytes()).hexdigest()
    (bootstrap / "manifest.json").write_text(json.dumps(manifest))
    result = subprocess.run([sys.executable, str(root / "app/server_tools/public_slice_export/audit_public_bootstrap.py"),
                             "--target", str(root)], capture_output=True, text=True)
    assert result.returncode != 0
    assert "bootstrap ledger must bind every folded-in source hash" in result.stdout + result.stderr


@pytest.fixture
def audit(monkeypatch):
    """The public bootstrap audit, imported so a test compares its findings exactly."""
    monkeypatch.syspath_prepend(str(APP / "server_tools/public_slice_export"))
    return importlib.import_module("audit_public_bootstrap")


def regenerated_with(tmp_path, source, statement):
    """A public copy whose reviewed source gained `statement`, regenerated so the manifest agrees with it."""
    root = copy_public_inputs(tmp_path)
    path = root / "app/server_tools/public_bootstrap/source" / source
    path.write_text(path.read_text() + "\n" + statement + "\n")
    result = generate(root)
    assert result.returncode == 0, result.stderr
    return root


def ledger_line(sql, statement, spelling="system_schema_migrations"):
    """The line on which `statement`, as placed in `sql`, names the migration ledger as `spelling`."""
    return sql.count("\n", 0, sql.index(statement) + statement.lower().index(spelling.lower())) + 1


def test_bootstrap_audit_accepts_the_checked_in_bootstrap(audit):
    assert audit.audit_bootstrap(APP.parent).findings == []


@pytest.mark.parametrize("case", list(COMPETING_LEDGER_WRITES))
def test_bootstrap_audit_refuses_any_other_ledger_write(tmp_path, audit, case):
    statement = COMPETING_LEDGER_WRITES[case]
    root = regenerated_with(tmp_path, "dataset_rights.seed.sql", statement)
    seed = (root / "app/server_tools/public_bootstrap/seed_data.sql").read_text()
    checked_in = (BOOTSTRAP / "seed_data.sql").read_text()
    # The competing write precedes the whole acceptance header; the generated block itself is unchanged.
    assert seed.index(statement) < seed.index(ACCEPTANCE_HEADER)
    assert seed[seed.index(ACCEPTANCE_HEADER):] == checked_in[checked_in.index(ACCEPTANCE_HEADER):]
    line = ledger_line(seed, statement, SPELLINGS.get(case, "system_schema_migrations"))
    # The generator's legacy row inventory does not count an INSERT with a block comment between its
    # keywords. The audit now treats that comment as whitespace and independently reports both refusals.
    expected = ["manifest seed_row_counts does not match generated seed_data.sql"] if case == "insert_block_comment" else []
    expected.append(
        f"seed_data.sql names the migration ledger outside the acceptance block's generated insert on line {line}")
    assert audit.audit_bootstrap(root).findings == expected


@pytest.mark.parametrize("case", list(OPAQUE_ESCAPES))
def test_bootstrap_audit_refuses_unicode_and_numeric_escapes(tmp_path, audit, case):
    statement, names_ledger_plainly = OPAQUE_ESCAPES[case]
    root = regenerated_with(tmp_path, "dataset_rights.seed.sql", statement)
    seed = (root / "app/server_tools/public_bootstrap/seed_data.sql").read_text()
    line = seed.count("\n", 0, seed.index(statement)) + 1
    expected = ["seed_data.sql uses a Unicode or numeric escape, which could spell the migration ledger's name "
                f"unseen, on line {line}"]
    if names_ledger_plainly:
        expected.append("seed_data.sql names the migration ledger outside the acceptance block's generated insert "
                        f"on line {ledger_line(seed, statement)}")
    assert audit.audit_bootstrap(root).findings == expected


@pytest.mark.parametrize("statement", [
    f"INSERT INTO public.system_schema_migrations (filename) VALUES ('{MIGRATION.name}');",
    "CREATE RULE keep_no_baseline AS ON INSERT TO public.system_schema_migrations DO INSTEAD NOTHING;",
])
def test_bootstrap_audit_refuses_a_ledger_write_or_rule_in_the_schema(tmp_path, audit, statement):
    root = regenerated_with(tmp_path, "runtime.schema.sql", statement)
    schema = (root / "app/server_tools/public_bootstrap/schema.sql").read_text()
    assert audit.audit_bootstrap(root).findings == [
        "schema.sql names the migration ledger outside its reviewed definition "
        f"on line {ledger_line(schema, statement)}"]


def test_bootstrap_audit_refuses_the_generated_insert_outside_the_acceptance_block(tmp_path, audit):
    root = copy_public_inputs(tmp_path)
    bootstrap = root / "app/server_tools/public_bootstrap"
    seed = (bootstrap / "seed_data.sql").read_text()
    ledger_end = "    ON CONFLICT (filename) DO NOTHING;\n"
    start = seed.index("    INSERT INTO public.system_schema_migrations ")
    insert = seed[start:seed.index(ledger_end, start) + len(ledger_end)]
    moved = seed.replace(insert, "", 1).replace(ACCEPTANCE_HEADER, "\n" + insert + ACCEPTANCE_HEADER, 1)
    (bootstrap / "seed_data.sql").write_text(moved)
    manifest = json.loads((bootstrap / "manifest.json").read_text())
    manifest["generated_files"]["server_tools/public_bootstrap/seed_data.sql"]["sha256"] = hashlib.sha256(
        (bootstrap / "seed_data.sql").read_bytes()).hexdigest()
    (bootstrap / "manifest.json").write_text(json.dumps(manifest))
    findings = audit.audit_bootstrap(root).findings
    assert "public bootstrap seed must end with the acceptance block's generated migration-ledger baseline" in findings
    assert ("seed_data.sql names the migration ledger outside the acceptance block's generated insert "
            f"on line {ledger_line(moved, insert)}") in findings


def test_evidence_extension_replays_without_verifying_historical_rows(database):
    database("""CREATE TABLE system_schema_migrations(filename text PRIMARY KEY, applied_at timestamptz DEFAULT now());
        CREATE TABLE system_data_repair_records(migration text, action text);
        INSERT INTO system_schema_migrations VALUES ('old_success.sql','2026-01-01'),('old_optional_failure.sql','2026-01-02');""")
    for _ in range(2):
        database(MIGRATION.read_text())
    assert database("SELECT count(*) FROM system_schema_migrations WHERE content_sha256 IS NULL AND outcome IS NULL AND provenance IS NULL") == "2"
    assert database("SELECT min(applied_at)::date||'|'||max(applied_at)::date FROM system_schema_migrations") == "2026-01-01|2026-01-02"
    assert database("SELECT count(*) FROM system_data_repair_records WHERE migration='wl157_migration_execution_evidence' AND action='completed'") == "1"
    assert database("SELECT count(*) FROM system_db_version") == "0"
    digest = "a" * 64
    for outcome, provenance in (("applied", "runner"), ("optional_failure_skipped", "runner"),
                                ("interrupted_self_managed", "runner"), ("failed_self_managed", "runner"),
                                ("bootstrap_baseline", "bootstrap")):
        database(f"INSERT INTO system_schema_migrations(filename,content_sha256,outcome,provenance) VALUES('{outcome}.sql','{digest}','{outcome}','{provenance}')")
    for values in (f"'{digest}',NULL,'runner'", f"NULL,'applied','runner'", f"'{digest}','applied',NULL",
                   f"'{digest}','applied','bootstrap'", f"'{digest}','bootstrap_baseline','runner'",
                   "'invalid','applied','runner'", f"'{digest}','unknown','runner'"):
        with pytest.raises(subprocess.CalledProcessError):
            database(f"INSERT INTO system_schema_migrations(filename,content_sha256,outcome,provenance) VALUES('invalid.sql',{values})")
    assert database("SELECT count(*) FROM system_schema_migrations") == "7"
