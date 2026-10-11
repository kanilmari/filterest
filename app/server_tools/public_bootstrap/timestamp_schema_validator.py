"""timestamp_schema_validator.py
Refuse naive timestamp types in the schema assembled for fresh installations.
Connect the existing SQL lexer to bootstrap generation without evaluating SQL.
Keep platform storage zoned; inert comments, literals and function bodies are skipped.
"""
from sql_identifier_validator import _tokens


def _qualified_name_end(tokens, start):
    end = start
    while end + 2 < len(tokens) and tokens[end + 1].name == ".":
        end += 2
    return end


def _column_type_positions(tokens, opening, function_arguments=False):
    """Read type names after column names, leaving quoted identifiers alone."""
    positions = set()
    depth, entry_start = 1, True
    for index in range(opening + 1, len(tokens)):
        token = tokens[index]
        if depth == 1 and entry_start and token.name != ")":
            if function_arguments:
                argument = index
                if not token.quoted and token.name in {"in", "out", "inout", "variadic"}:
                    argument += 1
                following = tokens[argument + 1].name if argument + 1 < len(tokens) else ""
                # Function parameters may omit their name. Qualified types and
                # type modifiers delimit that case; otherwise skip the name.
                type_start = argument if following in {".", "(", ")", "[", ",", "default", "="} else argument + 1
                positions.add(_qualified_name_end(tokens, type_start))
            elif token.quoted or token.name not in {
                "constraint", "primary", "foreign", "check", "unique", "exclude", "like"
            }:
                positions.add(_qualified_name_end(tokens, index + 1))
            entry_start = False
        if token.name == "(":
            depth += 1
        elif token.name == ")":
            depth -= 1
            if depth == 0:
                break
        elif token.name == "," and depth == 1:
            entry_start = True
    return positions


def _quoted_type_positions(tokens):
    """Locate static declaration/cast types rather than treating names as types.

    CREATE TABLE and ALTER TABLE share PostgreSQL's qualified type-name syntax.
    The broad unquoted keyword guard also covers static expressions; quoted
    references need context so a column or table named "timestamp" stays legal.
    """
    positions = set()
    parentheses = []
    statement_start = 0
    for index, token in enumerate(tokens):
        if token.quoted:
            continue
        if token.name == "(":
            parentheses.append(tokens[index - 1].name if index else "")
        elif token.name == ")" and parentheses:
            parentheses.pop()
        elif token.name == ";":
            statement_start = index + 1
        names = [item.name for item in tokens[index:index + 3]]
        if token.name == "create":
            following = index + 1
            while following < len(tokens) and tokens[following].name in {
                "temp", "temporary", "unlogged", "or", "replace"
            }:
                following += 1
            if following < len(tokens) and tokens[following].name in {"table", "function", "procedure", "type"}:
                kind = tokens[following].name
                following += 1
                if [item.name for item in tokens[following:following + 3]] == ["if", "not", "exists"]:
                    following += 3
                following = _qualified_name_end(tokens, following) + 1
                if kind == "type" and following < len(tokens) and tokens[following].name == "as":
                    following += 1
                if following < len(tokens) and tokens[following].name == "(":
                    positions.update(_column_type_positions(tokens, following, kind in {"function", "procedure"}))
        if names == ["returns", "table", "("]:
            positions.update(_column_type_positions(tokens, index + 2))
        elif token.name == "returns" and index + 1 < len(tokens):
            following = index + 1
            if not tokens[following].quoted and tokens[following].name == "setof":
                following += 1
            if following < len(tokens):
                positions.add(_qualified_name_end(tokens, following))
        # A colon pair marks a static cast. AS is a type introducer in CAST
        # and CREATE DOMAIN, but an ordinary quoted alias remains an identifier.
        if names[:2] == [":", ":"]:
            positions.add(_qualified_name_end(tokens, index + 2))
        type_after_as = token.name == "as" and (
            (parentheses and parentheses[-1] == "cast")
            or [item.name for item in tokens[statement_start:statement_start + 2]] == ["create", "domain"]
        )
        alter_type = token.name == "type" and tokens[statement_start].name == "alter"
        if (type_after_as or alter_type) and index + 1 < len(tokens):
            positions.add(_qualified_name_end(tokens, index + 1))
        if token.name == "add":
            following = index + 1
            if following < len(tokens) and tokens[following].name == "column":
                following += 1
            if [item.name for item in tokens[following:following + 3]] == ["if", "not", "exists"]:
                following += 3
            if following < len(tokens) and not tokens[following].quoted and tokens[following].name in {
                "constraint", "primary", "foreign", "check", "unique", "exclude"
            }:
                continue
            if following + 1 < len(tokens):
                positions.add(_qualified_name_end(tokens, following + 1))
    return positions


def validate_zoned_timestamp_schema(sql: str, source: str) -> None:
    """Refuse known naive spellings early, including Unicode-quoted precision types.

    Static CREATE/ALTER declarations and casts are checked without executing SQL.
    Historical migrations and site data are outside this fresh-schema guard.
    The disposable PostgreSQL catalog test is authoritative for every spelling.
    """
    tokens = _tokens(sql)
    quoted_types = _quoted_type_positions(tokens)
    for index, token in enumerate(tokens):
        if token.name != "timestamp" or (token.quoted and index not in quoted_types):
            continue
        # Quoted/catalog-qualified timestamp names denote the naive catalog
        # type itself; WITH TIME ZONE is only the unquoted SQL keyword syntax.
        following = index + 1
        if following < len(tokens) and tokens[following].name == "(":
            while following < len(tokens) and tokens[following].name != ")":
                following += 1
            following += 1
        zone_words = tokens[following:following + 3]
        zoned_keyword = (not token.quoted and (index == 0 or tokens[index - 1].name != ".")
                         and [item.name for item in zone_words] == ["with", "time", "zone"]
                         and not any(item.quoted for item in zone_words))
        if not zoned_keyword:
            raise ValueError(f"{source}:{token.line}: naive timestamp; use timestamptz or timestamp with time zone")
