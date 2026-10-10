"""sql_identifier_validator.py
Reject unquoted reserved names in static PostgreSQL schema declarations.
Connect migration/bootstrap generation to PostgreSQL 16's identifier rules.
Catch declaration mistakes offline; execution and dynamic SQL still need PostgreSQL.
"""
import re
from typing import NamedTuple

# PostgreSQL 16 src/include/parser/kwlist.h, categories RESERVED_KEYWORD and
# TYPE_FUNC_NAME_KEYWORD: both are forbidden as unquoted column identifiers.
# Verified offline against the installed PostgreSQL 16.15 ScanKeywordCategories.
# https://www.postgresql.org/docs/16/sql-keywords-appendix.html
# Refresh this pinned vocabulary when changing the supported PostgreSQL major.
RESERVED_IDENTIFIER_KEYWORDS = frozenset("""
all analyse analyze and any array as asc asymmetric authorization binary both
case cast check collate collation column concurrently constraint create cross
current_catalog current_date current_role current_schema current_time
current_timestamp current_user default deferrable desc distinct do else end
except false fetch for foreign freeze from full grant group having ilike in
initially inner intersect into is isnull join lateral leading left like limit
localtime localtimestamp natural not notnull null offset on only or order outer
overlaps placing primary references returning right select session_user similar
some symmetric system_user table tablesample then to trailing true union unique
user using variadic verbose when where window with
""".split())

_TOKEN = re.compile(
    r"(?P<space>\s+)|(?P<comment>--[^\r\n]*|/\*)|"
    r"(?P<dollar>\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$)|"
    r"(?P<literal>[Ee]'(?:\\.|''|[^'\\])*'|'(?:''|[^'])*')|"
    r'(?P<quoted>"(?:""|[^"])*")|(?P<word>[A-Za-z_][A-Za-z_0-9$]*)|(?P<symbol>.)',
    re.DOTALL,
)


class Identifier(NamedTuple):
    name: str
    quoted: bool
    line: int


def _tokens(sql: str) -> list[Identifier]:
    """Skip comments and inert quoted bodies, retaining declaration token positions."""
    tokens, pos, line = [], 0, 1
    while pos < len(sql):
        match = _TOKEN.match(sql, pos)
        kind, value, end = match.lastgroup, match.group(), match.end()
        if value == "/*":
            depth = 1
            while depth:
                delimiter = re.search(r"/\*|\*/", sql[end:])
                if delimiter is None:
                    raise ValueError(f"line {line}: unterminated block comment")
                depth += 1 if delimiter.group() == "/*" else -1
                end += delimiter.end()
        elif kind == "dollar":
            close = sql.find(value, end)
            if close < 0:
                raise ValueError(f"line {line}: unterminated dollar quote")
            end = close + len(value)
        elif kind == "symbol" and value in ("'", '"'):
            raise ValueError(f"line {line}: unterminated quote")
        elif kind not in ("space", "comment", "literal"):
            quoted = kind == "quoted"
            tokens.append(Identifier(value[1:-1].replace('""', '"') if quoted else value.lower(), quoted, line))
        line += sql.count("\n", pos, end)
        pos = end
    return tokens


def declared_identifiers(sql: str) -> list[Identifier]:
    """Read static CREATE TABLE columns/constraints and table/index/function names.

    Quoted names remain legal for historical schemas. SQL bodies, expressions,
    aliases and dynamic SQL are outside this focused declaration guard.
    """
    tokens = _tokens(sql)
    names = []
    for i, token in enumerate(tokens):
        if token.name != "create" or token.quoted:
            continue
        j = i + 1
        while j < len(tokens) and tokens[j].name in ("or", "replace", "unique", "temp", "temporary", "unlogged"):
            j += 1
        if j == len(tokens) or tokens[j].name not in ("table", "index", "function"):
            continue
        kind = tokens[j].name
        j += 1
        if [t.name for t in tokens[j:j + 3]] == ["if", "not", "exists"]:
            j += 3
        if j == len(tokens):
            continue
        names.append(tokens[j])
        j += 1
        while j + 1 < len(tokens) and tokens[j].name == ".":
            names.append(tokens[j + 1])
            j += 2
        if kind != "table" or j == len(tokens) or tokens[j].name != "(":
            continue
        depth, entry_start = 1, True
        for k in range(j + 1, len(tokens)):
            item = tokens[k]
            if depth == 1 and entry_start and item.name != ")":
                following = tokens[k + 1].name if k + 1 < len(tokens) else ""
                if not item.quoted and item.name == "constraint":
                    names.append(tokens[k + 1])
                elif item.quoted or not (
                    (item.name in ("primary", "foreign") and following == "key")
                    or (item.name in ("check", "unique") and following in ("(", "nulls"))
                    or (item.name == "exclude" and following in ("(", "using"))
                    or item.name == "like"
                ):
                    names.append(item)
                entry_start = False
            if item.name == "(":
                depth += 1
            elif item.name == ")":
                depth -= 1
                if depth == 0:
                    break
            elif item.name == "," and depth == 1:
                entry_start = True
    return names


def validate_sql_identifiers(sql: str, source: str) -> None:
    """Refuse declaration names that PostgreSQL cannot accept without quoting."""
    for identifier in declared_identifiers(sql):
        if not identifier.quoted and identifier.name in RESERVED_IDENTIFIER_KEYWORDS:
            raise ValueError(f"{source}:{identifier.line}: reserved PostgreSQL identifier {identifier.name!r}; rename it")
