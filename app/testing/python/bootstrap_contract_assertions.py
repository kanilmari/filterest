"""bootstrap_contract_assertions.py
Assert migration source evidence in the generated public bootstrap's ledger.
Connect historical migration tests to the current acceptance-block contract.
Keep filename, byte hash, baseline outcome and bootstrap provenance checked together.
"""
import functools
import hashlib
import re
import subprocess
import sys
import tempfile
from pathlib import Path

APP = Path(__file__).resolve().parents[2]
BOOTSTRAP = APP / "server_tools/public_bootstrap"
SEED_FILE = BOOTSTRAP / "seed_data.sql"
LEDGER_TABLE = "system_schema_migrations"
ACCEPTANCE_OPEN = "DO $filterest_acceptance$\n"
ACCEPTANCE_CLOSE = "$filterest_acceptance$;"
LEDGER_INSERT = "INSERT INTO public.system_schema_migrations (filename, content_sha256, outcome, provenance) VALUES"
LEDGER_END = "ON CONFLICT (filename) DO NOTHING;"
ROW = r"\('([^'\s]+)', '([0-9a-f]{64})', '([a-z_]+)', '([a-z_]+)'\)"
CHECK = r"        SELECT '(public\.[a-z0-9_]+\(\)): ' \|\| result FROM (public\.[a-z0-9_]+\(\)) AS result"
# The whole acceptance block exactly as generate_bootstrap.py assembles it, as the seed's last statement:
# declarations, marker check, final checks, ledger write and version row, all top-level and in this order.
# Only data varies (markers, checks, tuples, version), so an early exit, a wrapper or a reordering cannot match.
ACCEPTANCE_BLOCK = re.compile(
    re.escape(
        "\n-- Generated migration-ledger baseline and version row, written by this acceptance block only after\n"
        "-- every completion marker is present and every final check comes back empty. These migrations are\n"
        "-- already embodied by this bootstrap. Hashes identify folded-in sources, not executed SQL.\n"
        "DO $filterest_acceptance$\nDECLARE\n    missing_markers text;\n    findings text;\nBEGIN\n"
        "    SELECT string_agg(marker, ', ' ORDER BY marker) INTO missing_markers\n      FROM unnest(ARRAY[")
    + r"(?P<markers>'[a-z0-9_]+'(?:, '[a-z0-9_]+')*)"
    + re.escape(
        "]::text[]) AS marker\n"
        "     WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records AS record\n"
        "                        WHERE record.migration = marker AND record.action = 'completed');\n"
        "    IF missing_markers IS NOT NULL THEN\n"
        "        RAISE EXCEPTION 'bootstrap import is incomplete; missing completion markers: %', missing_markers;\n"
        "    END IF;\n"
        "    SELECT string_agg(finding, '; ') INTO findings FROM (\n")
    + r"(?P<checks>" + CHECK + r"(?:\n        UNION ALL\n" + CHECK + r")*)\n"
    + re.escape(
        "    ) AS checks (finding);\n"
        "    IF findings IS NOT NULL THEN\n"
        "        RAISE EXCEPTION 'bootstrap import failed its final checks: %', findings;\n"
        "    END IF;\n"
        "    " + LEDGER_INSERT + "\n")
    + r"(?P<rows>(?:      " + ROW + r",\n)*      " + ROW + r"\n)"
    + re.escape(
        "    " + LEDGER_END + "\n"
        "    INSERT INTO public.system_db_version (version, description)\n"
        "    VALUES ('")
    + r"(?P<version>[0-9]+\.[0-9]+\.[0-9]+)"
    + re.escape("', 'Filterest generated public bootstrap');\nEND\n" + ACCEPTANCE_CLOSE + "\n")
    + r"\Z")
DOLLAR_TAG = re.compile(r"\$(?:[A-Za-z_\x80-\U0010ffff][A-Za-z0-9_\x80-\U0010ffff]*)?\$")
BARE_NAME = re.compile(r"[A-Za-z_\x80-\U0010ffff][A-Za-z0-9_$\x80-\U0010ffff]*")
LEXING_SETTINGS = {"standard_conforming_strings", "client_encoding", "names"}
SQL_SPACE = " \t\n\r\f\v"
LINE_END = re.compile(r"[\r\n]")


class _LexingError(AssertionError):
    """Malformed SQL ends a lenient body scan but fails the seed's strict top-level scan."""


def _skip_comment(sql: str, i: int) -> int:
    """Index after the comment at i: -- to the line end, or nested /* */; unterminated block comments fail."""
    if sql.startswith("--", i):
        end = LINE_END.search(sql, i)
        return len(sql) if end is None else end.start()
    depth, j = 1, i + 2
    while depth and j < len(sql):
        if sql.startswith("/*", j):
            depth, j = depth + 1, j + 2
        elif sql.startswith("*/", j):
            depth, j = depth - 1, j + 2
        else:
            j += 1
    if depth:
        raise _LexingError("unterminated block comment")
    return j


def _skip_spacing(sql: str, i: int) -> int:
    """Comments are whitespace around UESCAPE, including nested blocks and line comments."""
    while i < len(sql):
        if sql[i] in SQL_SPACE:
            i += 1
        elif sql.startswith("--", i) or sql.startswith("/*", i):
            i = _skip_comment(sql, i)
        else:
            break
    return i


def _quoted(sql: str, i: int, quote: str, backslash: bool) -> tuple[str, int]:
    """The raw contents of the literal or identifier opened by sql[i] and the index after it."""
    j, parts = i + 1, []
    while True:
        if j >= len(sql):
            raise _LexingError("unterminated literal or quoted identifier")
        if backslash and sql[j] == "\\":
            parts.append(sql[j:j + 2])
            j += 2
        elif sql.startswith(quote * 2, j):
            parts.append(quote)
            j += 2
        elif sql[j] == quote:
            return "".join(parts), j + 1
        else:
            parts.append(sql[j])
            j += 1


def _unicode_unescape(text: str, escape: str) -> str:
    """Decode U& identifiers/strings, including doubled escapes and UTF-16 surrogate pairs."""
    out, i = [], 0
    while i < len(text):
        if text[i] != escape:
            out.append(text[i])
            i += 1
        elif text.startswith(escape * 2, i):
            out.append(escape)
            i += 2
        else:
            start = i + (2 if text.startswith(escape + "+", i) else 1)
            width = 6 if start == i + 2 else 4
            digits = text[start:start + width]
            if len(digits) != width or not re.fullmatch(r"[0-9a-fA-F]+", digits):
                raise _LexingError("invalid Unicode escape")
            out.append(chr(int(digits, 16)))
            i = start + width
    return _unicode_characters("".join(out))


def _unicode_characters(text: str) -> str:
    """PostgreSQL joins escaped high/low surrogates and rejects lone surrogates and NUL."""
    text = text.encode("utf-16-le", errors="surrogatepass").decode("utf-16-le")
    if "\0" in text:
        raise _LexingError("NUL in string or identifier")
    return text


def _escape_bytes(raw: str) -> bytes:
    """Decode one E-string segment: C escapes, octal/hex bytes, Unicode, and backslash-anything."""
    out, i = bytearray(), 0
    while i < len(raw):
        if raw[i] != "\\":
            out.extend(raw[i].encode("utf-8"))
            i += 1
            continue
        i += 1
        if i == len(raw):
            raise _LexingError("unterminated escape")
        c = raw[i]
        if c in "01234567":
            digits = re.match(r"[0-7]{1,3}", raw[i:]).group()
            out.append(int(digits, 8) & 255)
            i += len(digits)
        elif c == "x" and (digits := re.match(r"[0-9a-fA-F]{1,2}", raw[i + 1:])):
            out.append(int(digits.group(), 16))
            i += 1 + len(digits.group())
        elif c in "uU":
            width = 4 if c == "u" else 8
            digits = raw[i + 1:i + 1 + width]
            if len(digits) != width or not re.fullmatch(r"[0-9a-fA-F]+", digits):
                raise _LexingError("invalid Unicode escape")
            char = chr(int(digits, 16))
            i += 1 + width
            if 0xD800 <= ord(char) <= 0xDBFF:
                pair = re.match(r"\\(?:u([0-9a-fA-F]{4})|U([0-9a-fA-F]{8}))", raw[i:])
                if pair is None:
                    raise _LexingError("unpaired Unicode surrogate")
                char += chr(int(pair.group(1) or pair.group(2), 16))
                i += len(pair.group())
            out.extend(_unicode_characters(char).encode("utf-8"))
        else:
            out.extend({"b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t"}.get(c, c).encode("utf-8"))
            i += 1
    return bytes(out)


def _continued_quote(sql: str, i: int) -> int | None:
    """Only whitespace containing CR/LF (line comments allowed, block comments excluded) joins strings."""
    start = i
    while i < len(sql):
        if sql[i] in SQL_SPACE:
            i += 1
        elif sql.startswith("--", i):
            i = _skip_comment(sql, i)
        else:
            break
    if i < len(sql) and sql[i] == "'" and any(c in "\r\n" for c in sql[start:i]):
        return i
    return None


def _string_constant(sql: str, i: int, style: str) -> tuple[str, int]:
    """Decode the complete constant, preserving the first segment's escape style across continuation."""
    parts = []
    while True:
        raw, i = _quoted(sql, i, "'", style == "escape")
        parts.append(_escape_bytes(raw) if style == "escape" else raw)
        continuation = _continued_quote(sql, i)
        if continuation is None:
            break
        i = continuation
    if style == "escape":
        value = b"".join(parts).decode("utf-8")
    else:
        value = "".join(parts)
    if style == "unicode":
        escape, i = _uescape(sql, i)
        value = _unicode_unescape(value, escape)
    if "\0" in value:
        raise _LexingError("NUL in string")
    return value, i


def _uescape(sql: str, i: int) -> tuple[str, int]:
    start = _skip_spacing(sql, i)
    word = BARE_NAME.match(sql, start)
    if word is None or word.group().lower() != "uescape":
        return "\\", i
    operand = _skip_spacing(sql, word.end())
    if sql.startswith("'", operand):
        escape, end = _string_constant(sql, operand, "ordinary")
    elif sql[operand:operand + 2].lower() == "e'":
        escape, end = _string_constant(sql, operand + 1, "escape")
    elif (tag := DOLLAR_TAG.match(sql, operand)):
        escape, end = _dollar_constant(sql, tag)
    else:
        raise _LexingError("missing UESCAPE operand")
    if len(escape) != 1 or escape in "0123456789abcdefABCDEF+'\"" or escape in SQL_SPACE:
        raise _LexingError("invalid UESCAPE character")
    return escape, end


def _dollar_constant(sql: str, tag: re.Match) -> tuple[str, int]:
    close = sql.find(tag.group(), tag.end())
    if close < 0:
        raise _LexingError("unterminated dollar quote")
    return sql[tag.end():close], close + len(tag.group())


def _setting_argument(tokens: list[tuple[str, str]], start: int) -> str | None:
    """Find set_config's positional or named setting name, allowing grouping and reordered named arguments."""
    arguments, argument, depth = [], [], 0
    for token in tokens[start:]:
        if token == ("symbol", ")") and depth == 0:
            arguments.append(argument)
            break
        if token == ("symbol", ",") and depth == 0:
            arguments.append(argument)
            argument = []
            continue
        argument.append(token)
        if token == ("symbol", "("):
            depth += 1
        elif token == ("symbol", ")"):
            depth -= 1
    else:
        arguments.append(argument)
    for i, argument in enumerate(arguments):
        named = len(argument) >= 3 and argument[1:3] in (
            [("symbol", ":"), ("symbol", "=")], [("symbol", "="), ("symbol", ">")])
        if named:
            if argument[0][0] not in ("word", "identifier") or argument[0][1].lower() != "setting_name":
                continue
            argument = argument[3:]
        elif i != 0:
            continue
        j = 0
        while j < len(argument) and argument[j] == ("symbol", "("):
            j += 1
        if argument[j:j + 2] == [("word", "cast"), ("symbol", "(")]:
            j += 2
            while j < len(argument) and argument[j] == ("symbol", "("):
                j += 1
        # Type-prefixed constants (TEXT 'name', pg_catalog.text 'name') are static values too.
        while j < len(argument) and (argument[j][0] in ("word", "identifier") or argument[j] == ("symbol", ".")):
            j += 1
        if j < len(argument) and argument[j][0] == "value":
            return argument[j][1].lower()
    return None


def _refuse_parser_changes(tokens: list[tuple[str, str]]) -> None:
    """Refuse static COPY input and setting changes before default SQL/psql lexing can diverge."""
    for i, (kind, value) in enumerate(tokens):
        word = value.lower()
        if kind == "word" and word in ("set", "reset"):
            j = i + 1
            if j < len(tokens) and tokens[j] in (("word", "session"), ("word", "local")):
                j += 1
            if j < len(tokens) and tokens[j][0] in ("word", "identifier"):
                setting = tokens[j][1].lower()
                assert setting not in LEXING_SETTINGS and not (word == "reset" and setting == "all"), (
                    "the seed changes a parser setting")
        if kind in ("word", "identifier") and word == "set_config" and tokens[i + 1:i + 2] == [("symbol", "(")]:
            assert _setting_argument(tokens, i + 2) not in LEXING_SETTINGS, "the seed changes a parser setting"
        if kind == "word" and word == "copy":
            depth = 0
            for j in range(i + 1, len(tokens)):
                token = tokens[j]
                if token == ("symbol", ";") and depth == 0:
                    break
                if depth == 0 and token == ("word", "from"):
                    assert tokens[j + 1:j + 2] != [("word", "stdin")], "COPY FROM STDIN changes psql input handling"
                if token == ("symbol", "("):
                    depth += 1
                elif token == ("symbol", ")"):
                    depth -= 1


def _scan_identifiers(sql: str, *, strict: bool, top_level: bool) -> list[str]:
    names, tokens, i = [], [], 0
    while i < len(sql):
        c, kind = sql[i], "symbol"
        try:
            if sql.startswith("--", i) or sql.startswith("/*", i):
                i = _skip_comment(sql, i)
                continue
            if c in SQL_SPACE:
                i += 1
                continue
            if c == "'":
                value, i = _string_constant(sql, i, "ordinary")
                kind = "value"
            elif c == '"':
                value, i = _quoted(sql, i, '"', False)
                kind = "identifier"
            elif (tag := DOLLAR_TAG.match(sql, i)):
                value, i = _dollar_constant(sql, tag)
                kind = "value"
            elif (word := BARE_NAME.match(sql, i)):
                value, i = word.group(), word.end()
                if value.lower() == "e" and sql.startswith("'", i):
                    value, i = _string_constant(sql, i, "escape")
                    kind = "value"
                elif value.lower() == "u" and sql.startswith("&'", i):
                    value, i = _string_constant(sql, i + 1, "unicode")
                    kind = "value"
                elif value.lower() == "u" and sql.startswith('&"', i):
                    raw, i = _quoted(sql, i + 1, '"', False)
                    escape, i = _uescape(sql, i)
                    value = _unicode_unescape(raw, escape)
                    kind = "identifier"
                else:
                    value = "".join(ch.lower() if "A" <= ch <= "Z" else ch for ch in value)
                    kind = "word"
            else:
                assert not (top_level and c == "\\"), "top-level backslash changes psql input handling"
                value, i = c, i + 1
        except (ValueError, _LexingError) as error:
            if strict:
                raise _LexingError(str(error)) from error
            break
        tokens.append((kind, value))
        if kind in ("word", "identifier"):
            names.append(value)
        elif kind == "value" and not BARE_NAME.fullmatch(value):
            names.extend(_scan_identifiers(value, strict=False, top_level=False))
    _refuse_parser_changes(tokens)
    return names


def sql_identifiers(sql: str) -> list[str]:
    """Read every place the ledger's name reaches PostgreSQL's parser as an identifier under default lexing.

    Unquoted names fold to lower case; quoted names retain case. Every decoded string constant ('', E'', U&'',
    with continuation/UESCAPE) and dollar-quoted body is also scanned as code, leniently: an unterminated construct
    ends that inner scan. The seed's top level is strict and refuses psql backslashes outside quoted constructs
    and comments. Static COPY FROM STDIN and lexing-setting changes are refused in all code scans.

    Run-time assembly from separate values (concatenation, format(), quote_ident, regclass casts, catalog updates
    through a value) stays out of scope; a constant whose whole decoded content is a single bare name is a value,
    not code. This deliberately counts potential code in other constants too, without proving its execution.
    """
    return _scan_identifiers(sql, strict=True, top_level=True)


def checked_in_seed() -> bytes:
    return SEED_FILE.read_bytes()


@functools.lru_cache(maxsize=1)
def generated_seed() -> bytes:
    """The generator's own seed_data.sql bytes for the current sources, generated once per test run."""
    with tempfile.TemporaryDirectory() as target:
        result = subprocess.run([sys.executable, str(BOOTSTRAP / "generate_bootstrap.py"), "--target", target],
                                capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
        return (Path(target) / "app/server_tools/public_bootstrap/seed_data.sql").read_bytes()


def ledger_baseline_rows(seed: str) -> list[tuple[str, str, str, str]]:
    """Return baseline tuples after proving the ledger has one parser-visible identifier under sql_identifiers'
    default-lexing scope (bare-name values and run-time assembly excluded), in the generated acceptance block."""
    assert sql_identifiers(seed).count(LEDGER_TABLE) == 1, "the migration ledger is referenced outside its one write"
    assert seed.count("$filterest_acceptance$") == 2, "expected one acceptance block"
    block = ACCEPTANCE_BLOCK.search(seed)
    assert block, "the seed does not end with the generated acceptance block (wrapped, reordered or exited early)"
    for label, call in re.findall(CHECK, block.group("checks")):
        assert label == call, f"final check labelled {label} runs {call}"
    assert block.group("version") == (APP / "VERSION_DB").read_text().strip(), "acceptance block for another version"
    rows = re.findall(ROW, block.group("rows"))
    names = [row[0] for row in rows]
    assert len(names) == len(set(names)), "a migration is baselined twice"
    return rows


def assert_bootstrap_baseline(seed: str, migration: Path) -> None:
    """Require the checked-in seed to be the generator's bytes, the seed under test to be those exact bytes, and one
    baseline tuple bound to the migration's current bytes."""
    checked_in = checked_in_seed()
    assert checked_in == generated_seed(), "seed_data.sql differs from the generator's output for the current sources"
    assert seed.encode("utf-8") == checked_in, "the seed under test differs from the checked-in seed_data.sql bytes"
    rows = [row for row in ledger_baseline_rows(seed) if row[0] == migration.name]
    assert len(rows) == 1, f"missing or duplicated bootstrap baseline: {migration.name}"
    digest = hashlib.sha256(migration.read_bytes()).hexdigest()
    assert rows[0] == (migration.name, digest, "bootstrap_baseline", "bootstrap"), (
        f"bootstrap baseline of {migration.name} is not bound to its current bytes: {rows[0]}")
