"""Guard the dataset registry's reference key in migrations and runtime SQL sources.

Connects WL144's table_uid rule with Go/Python SQL literals and future migrations.
Historical violations are named explicitly; runtime exceptions must identify the
exact SQL and explain why another workline owns it. Tests exercise alias binding,
quotes and reversed comparisons so unrelated tables' row IDs stay legal.
"""
from __future__ import annotations

import ast
from pathlib import Path
import re

import pytest

APP = Path(__file__).resolve().parents[2]
CHANGE = "20261005000050_require_registry_reference_key.sql"
# Preserved history: 000002 converts these marks to table_uid. Never rewrite 000001.
HISTORICAL_MIGRATIONS = {"20261005000001_add_row_actor_support.sql"}
# No runtime occurrences existed when the guard was introduced. A future exception
# must be (relative file, normalized SQL occurrence): reason, never a whole file.
RUNTIME_BASELINE: dict[tuple[str, str], str] = {
    ("testing/python/test_row_actor_support.py", "REFERENCES system_db_tables(id)"):
        "WL58 deliberately malformed creator FK fixture proves preflight refuses incompatible references.",
}
IDENTIFIER = r'"?[a-z_][a-z0-9_]*"?'
REGISTRY = r'(?:"?[a-z_][a-z0-9_]*"?\s*\.\s*)?"?system_db_tables"?'
REFERENCE = re.compile(rf'\bREFERENCES\s+{REGISTRY}\s*\(\s*"?id"?\s*\)', re.I)
BINDING = re.compile(rf'\b(?:FROM|JOIN|UPDATE|INTO)\s+{REGISTRY}(?:\s+(?:AS\s+)?({IDENTIFIER}))?', re.I)
UID = rf'(?:{IDENTIFIER}\s*\.\s*)?"?[a-z_][a-z0-9_]*_uid"?'
COMPARISON = re.compile(
    rf'({UID})\s*=\s*({IDENTIFIER})\s*\.\s*"?id"?(?![a-z0-9_])'
    rf'|({IDENTIFIER})\s*\.\s*"?id"?\s*=\s*({UID})', re.I,
)
KEYWORDS = {'where', 'on', 'join', 'left', 'right', 'inner', 'outer', 'full',
            'cross', 'group', 'order', 'limit', 'union', 'having', 'set'}


def registry_id_occurrences(sql: str):
    # Comments preserve offsets for useful source line references.
    sql = re.sub(r'--[^\n]*|/\*[\s\S]*?\*/', lambda m: re.sub(r'[^\n]', ' ', m[0]), sql)
    for statement in sql.split(';'):
        aliases = {'system_db_tables'}
        for match in BINDING.finditer(statement):
            alias = (match[1] or '').strip('"').lower()
            if alias and alias not in KEYWORDS:
                aliases.add(alias)
        for match in REFERENCE.finditer(statement):
            yield re.sub(r'\s+', ' ', match[0]).strip()
        for match in COMPARISON.finditer(statement):
            alias = (match[2] or match[3]).strip('"').lower()
            if alias in aliases:
                yield re.sub(r'\s+', ' ', match[0]).strip()


def go_source_strings(text: str):
    # A small lexer keeps comments, raw strings and interpreted strings distinct.
    # Newlines terminate Go assignments unless a + or an open parenthesis continues
    # the expression. Never insert spaces: `registry` + `.id` is `registry.id`.
    lexer = re.compile(r"`[^`]*`|\"(?:\\.|[^\"\\])*\"|'(?:\\.|[^'\\])*'|"
                       r"//[^\n]*|/\*[\s\S]*?\*/|[A-Za-z_]\w*|:=|\+=|==|!=|<=|>=|[^\S\n]+|.", re.S)
    tokens = [(m[0], text.count('\n', 0, m.start()) + 1) for m in lexer.finditer(text)
              if not m[0].startswith(('//', '/*')) and (m[0] == '\n' or not m[0].isspace())]
    scopes = [{}]

    def binding(name):
        return next((scope for scope in reversed(scopes) if name in scope), scopes[-1])

    def literal(token):
        if token.startswith('`'):
            return token[1:-1].replace('\r', '')
        if token.startswith('"'):
            return ast.literal_eval(token)
        return None

    def expression(index, parenthesized=False):
        while index < len(tokens) and tokens[index][0] == '\n':
            index += 1
        if index >= len(tokens):
            return None, index
        token = tokens[index][0]
        if token == '(':
            result, end = expression(index + 1, True)
            if end >= len(tokens) or tokens[end][0] != ')':
                return None, end
            index = end + 1
        elif token == 'fmt' and [t[0] for t in tokens[index:index + 4]] == ['fmt', '.', 'Sprintf', '(']:
            # The format string is SQL source too; argument values stay unknown.
            result, end = expression(index + 4, True)
            depth = 1
            while end < len(tokens) and depth:
                depth += (tokens[end][0] == '(') - (tokens[end][0] == ')')
                end += 1
            index = end
        else:
            result = literal(token) if token.startswith(('`', '"')) else binding(token).get(token)
            index += 1
        while index < len(tokens):
            if parenthesized and tokens[index][0] == '\n':
                index += 1
                continue
            if tokens[index][0] != '+':
                break
            right, index = expression(index + 1, parenthesized)
            result = result + right if result is not None and right is not None else None
        return result, index

    for index, (token, line) in enumerate(tokens):
        if token.startswith(('`', '"')):
            yield line, literal(token)
        if token.startswith(('`', '"')) or token in binding(token):
            value, end = expression(index)
            if value is not None and any(t[0] == '+' for t in tokens[index:end]):
                yield line, value
        if token == '{':
            scopes.append({})
        elif token == '}' and len(scopes) > 1:
            scopes.pop()
        # Include var/const declarations with an explicit string type.
        operator_index = index + 1
        if operator_index < len(tokens) and tokens[operator_index][0] == 'string':
            operator_index += 1
        if not re.fullmatch(r'[A-Za-z_]\w*', token) or operator_index >= len(tokens):
            continue
        operator = tokens[operator_index][0]
        if operator not in (':=', '=', '+='):
            continue
        value, _ = expression(operator_index + 1)
        # := declares in this block; = and += update the existing binding.
        # An append inside a conditional must still reach later query fragments.
        declared = operator == ':=' or (index > 0 and tokens[index - 1][0] in ('var', 'const'))
        variables = scopes[-1] if declared else binding(token)
        if operator == '+=':
            previous = variables.get(token)
            value = previous + value if previous is not None and value is not None else None
        variables[token] = value
        if value is not None:
            yield line, value


def python_source_strings(text: str):
    # Walk statements in execution order so assignments and += use their current
    # constant values. Functions/classes inherit constants but never leak locals.
    class Strings(ast.NodeVisitor):
        def __init__(self):
            self.variables = {}
            self.values = []

        def constant(self, node):
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                return node.value
            if isinstance(node, ast.Name):
                return self.variables.get(node.id)
            if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
                left, right = self.constant(node.left), self.constant(node.right)
                return left + right if left is not None and right is not None else None
            return None

        def record(self, node):
            value = self.constant(node)
            if value is not None:
                self.values.append((node.lineno, value))
            self.generic_visit(node)

        visit_Constant = record
        visit_BinOp = record

        def visit_JoinedStr(self, node):
            self.values.append((node.lineno, ''.join(part.value if isinstance(part, ast.Constant) else 'dynamic'
                                                    for part in node.values)))
            self.generic_visit(node)

        def visit_Assign(self, node):
            self.visit(node.value)
            value = self.constant(node.value)
            for target in node.targets:
                if isinstance(target, ast.Name):
                    self.variables[target.id] = value
                    if value is not None:
                        self.values.append((node.lineno, value))

        def visit_AnnAssign(self, node):
            if node.value is not None:
                self.visit_Assign(ast.Assign(targets=[node.target], value=node.value, lineno=node.lineno))

        def visit_AugAssign(self, node):
            self.visit(node.value)
            if isinstance(node.target, ast.Name):
                previous, right = self.variables.get(node.target.id), self.constant(node.value)
                value = previous + right if isinstance(node.op, ast.Add) and previous is not None and right is not None else None
                self.variables[node.target.id] = value
                if value is not None:
                    self.values.append((node.lineno, value))

        def visit_FunctionDef(self, node):
            outer = self.variables.copy()
            for argument in (*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs):
                self.variables.pop(argument.arg, None)
            self.generic_visit(node)
            self.variables = outer

        visit_AsyncFunctionDef = visit_FunctionDef

        def visit_ClassDef(self, node):
            outer = self.variables.copy()
            self.generic_visit(node)
            self.variables = outer

    visitor = Strings()
    visitor.visit(ast.parse(text))
    yield from visitor.values


def source_strings(path: Path):
    text = path.read_text(encoding='utf-8')
    yield from go_source_strings(text) if path.suffix == '.go' else python_source_strings(text)


def test_registry_references_use_table_uid():
    findings = []
    seen_baseline = set()
    for path in sorted((APP / 'server_tools/migrations').glob('*.sql')):
        occurrences = list(registry_id_occurrences(path.read_text(encoding='utf-8')))
        if path.name in HISTORICAL_MIGRATIONS:
            assert path.name < CHANGE and occurrences, 'remove stale historical exemption'
            continue
        findings.extend(f'{path.relative_to(APP)}: {sql}' for sql in occurrences)
    for path in sorted(list(APP.rglob('*.go')) + list(APP.rglob('*.py'))):
        if path == Path(__file__).resolve() or 'node_modules' in path.parts:
            continue
        for line, value in source_strings(path):
            for sql in registry_id_occurrences(value):
                key = (path.relative_to(APP).as_posix(), sql)
                if key in RUNTIME_BASELINE:
                    assert RUNTIME_BASELINE[key], 'a baseline occurrence needs a reason'
                    seen_baseline.add(key)
                else:
                    findings.append(f'{key[0]}:{line}: {sql}')
    assert not findings, '\n'.join(findings)
    assert seen_baseline == set(RUNTIME_BASELINE), 'remove fixed runtime baseline occurrences'


@pytest.mark.parametrize('sql', [
    'ALTER TABLE sample ADD FOREIGN KEY (dataset) REFERENCES public.system_db_tables (id)',
    'SELECT * FROM system_db_tables AS registry JOIN details c ON c.table_uid = registry.id',
    'SELECT * FROM public."system_db_tables" "s" JOIN details c ON "s"."id" = c."table_uid"',
    'SELECT * FROM details c JOIN public.system_db_tables s ON c.target_uid = s.id',
    'SELECT * FROM system_db_tables WHERE table_uid = system_db_tables.id',
    'UPDATE system_db_tables AS registry SET table_uid = other_uid WHERE x_uid = registry.id',
    'SELECT * FROM system_db_tables AS \"s\" JOIN details c ON c.\"table_uid\" = \"s\".\"id\"',
])
def test_guard_refuses_registry_row_id_references(sql):
    assert list(registry_id_occurrences(sql))


@pytest.mark.parametrize('sql', [
    'SELECT * FROM system_users registry JOIN details c ON c.user_uid = registry.id',
    'SELECT * FROM system_db_tables registry JOIN details c ON c.table_uid = registry.table_uid',
    'SELECT * FROM system_db_tables registry; SELECT * FROM users registry WHERE user_uid = registry.id',
    '-- REFERENCES public.system_db_tables(id)\nSELECT id FROM system_db_tables',
])
def test_guard_keeps_other_row_ids_and_reference_keys_legal(sql):
    assert not list(registry_id_occurrences(sql))


@pytest.mark.parametrize('suffix,source', [
    ('.go', 'package fixture\nfunc fixture() {\n query := `SELECT * FROM system_db_tables AS registry`\n query += ` JOIN details c ON c.table_uid = registry.id`\n}'),
    ('.go', 'package fixture\nfunc fixture() {\n query := `SELECT * FROM system_db_tables AS registry ` +\n `JOIN details c ON c.table_uid = registry.id`\n}'),
    ('.go', 'package fixture\nfunc fixture() {\n query := "REFERENCES system_db_tables" + "(id)"\n}'),
    ('.go', 'package fixture\nfunc fixture() {\n db.Exec(`REFERENCES system_db_tables` + `(id)`)\n}'),
    ('.go', 'package fixture\nconst prefix string = `REFERENCES system_db_tables`\nfunc fixture() {\n suffix := `(id)`\n query := (prefix + suffix)\n}'),
    ('.go', 'package fixture\nfunc fixture() {\n query := `REFERENCES system_db_tables`\n query += `(id)`\n}'),
    ('.go', 'package fixture\nfunc fixture() {\n query := `REFERENCES system_db_`\n query = query + `tables` + `(id)`\n}'),
    ('.go', 'package fixture\nfunc fixture() {\n query := `REFERENCES system_db_tables`\n if query == "" { return }\n query += `(id)`\n}'),
    ('.go', 'package fixture\nfunc fixture() {\n query := `REFERENCES system_db_`\n if true { query += `tables` }\n query += `(id)`\n}'),
    ('.py', 'query = ("SELECT * FROM system_db_tables AS registry "\n "JOIN details c ON c.table_uid = registry.id")'),
    ('.py', 'query = "SELECT * FROM system_db_tables AS registry " + "JOIN details c ON c.table_uid = registry.id"'),
    ('.py', 'query = "REFERENCES system_db_tables" + "(id)"'),
    ('.py', 'db.execute("REFERENCES system_db_tables" + "(id)")'),
    ('.py', 'query = "SELECT * FROM system_db_tables AS registry "\nquery += "JOIN details c ON c.table_uid = registry.id"'),
    ('.py', 'prefix = "REFERENCES system_db_tables"\nsuffix = "(id)"\nquery = prefix + suffix'),
    ('.py', 'query: str = "REFERENCES system_db_"\nquery = query + "tables"\nquery += "(id)"'),
])
def test_guard_checks_concatenated_runtime_sql(tmp_path, suffix, source):
    path = tmp_path / ('fixture' + suffix)
    path.write_text(source)
    assert any(list(registry_id_occurrences(sql)) for _, sql in source_strings(path))


@pytest.mark.parametrize('suffix,source', [
    ('.go', 'package fixture\nfunc fixture() {\n query := `REFERENCES system_db_`\n query += `tables(id)`\n}'),
    ('.py', 'query = "REFERENCES system_db_"\nquery += "tables(id)"'),
])
def test_guard_concatenates_without_inventing_whitespace(tmp_path, suffix, source):
    path = tmp_path / ('fixture' + suffix)
    path.write_text(source)
    assert 'REFERENCES system_db_tables(id)' in [sql for _, sql in source_strings(path)]


@pytest.mark.parametrize('suffix,source', [
    ('.go', 'package fixture\nfunc fixture() {\n query := `SELECT * FROM system_db_tables AS registry` + `JOIN details c ON c.table_uid = registry.id`\n}'),
    ('.py', 'query = "SELECT * FROM system_db_tables AS registry" + "JOIN details c ON c.table_uid = registry.id"'),
    ('.go', 'package fixture\nfunc one() {\n query := `SELECT * FROM system_db_tables AS registry `\n}\nfunc two() {\n query := `JOIN details c ON c.table_uid = registry.id`\n}'),
    ('.py', 'def one():\n query = "SELECT * FROM system_db_tables AS registry "\ndef two():\n query = ""\n query += "JOIN details c ON c.table_uid = registry.id"'),
])
def test_guard_preserves_token_and_scope_boundaries(tmp_path, suffix, source):
    path = tmp_path / ('fixture' + suffix)
    path.write_text(source)
    assert not any(list(registry_id_occurrences(sql)) for _, sql in source_strings(path))
