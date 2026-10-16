"""Exercise R1–R7 on permitted and forbidden component fixture imports.
Connect the single Python checker to shared discovery, shell callers and pins.
Keep policy changes reviewable without application services or new dependencies.
"""

import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from component_canary_fixture import write_canary
from import_boundary_checker import R4_PINNED, check
import relevant_check_discovery as discovery
from relevant_check_discovery import frontend_imports, frontend_tests, go_imports

ROOT = Path(__file__).resolve().parents[3]


def put(root, path, source):
    file = root / path
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(source)
    return file


@pytest.fixture
def tree(tmp_path):
    write_canary(tmp_path)
    put(tmp_path, "app/components/other/README.md", "# Other\n")
    put(tmp_path, "app/components/other/frontend/index.js", "export const value = 1;\n")
    put(tmp_path, "app/components/other/frontend/lib/index.js", "export const value = 1;\n")
    put(tmp_path, "app/components/other/frontend/private.js", "export const value = 1;\n")
    put(tmp_path, "app/components/other/backend/other.go", "package other\n")
    return tmp_path


@pytest.mark.parametrize("source", [
    "export { key } from '../components/canary/frontend/index.js';",
    "export * from '../components/canary/frontend/index.js';",
    "import '../components/canary/frontend/index.js';",
    "const load = () => import('../components/canary/frontend/index.js');",
    "const load = () => import(`../components/canary/frontend/index.js`);",
    "import { key } /* edge comment */ from '../components/./canary/frontend/index.js?dev#key';",
    "// import '../components/canary/backend/secret.js';\nexport {};",
    "/* export * from '../components/canary/frontend/private.js'; */ export {};",
    "const example = `import '../components/canary/frontend/private.js'`;",
    "export * from '../components/other/frontend/lib/index.js';",
    "export * from '../components/canary/frontend';",
])
def test_permitted_public_surfaces_and_comments(tree, source):
    put(tree, "app/frontend/consumer.js", source)
    assert check(tree) == []


@pytest.mark.parametrize("source", [
    "import '../components/canary/frontend/private.js';",
    "export * from '/components/canary/frontend/private.js';",
    "import { x } from '../components/other/../canary/frontend/private.js?x';",
    "await import('../components/canary/frontend/private.js');",
    "await import(`../components/canary/frontend/private.js`);",
    "require('../components/canary/frontend/private.js');",
    "import '../components/canary/frontend/%70rivate.js';",
    r"import '../components/canary/frontend/\u0070rivate.js';",
    r"import '../components/canary/frontend/\x70rivate.js';",
])
def test_external_component_internals_fail(tree, source):
    put(tree, "app/frontend/consumer.js", source)
    assert any("R2" in finding for finding in check(tree))


@pytest.mark.parametrize("owner,source,rule", [
    ("app/frontend/reusable_components/widget.js", "import '../core_components/widget.js';", "R1"),
    ("app/frontend/shared/widget.js", "await import('/components/canary/frontend/index.js');", "R1"),
    ("app/frontend/shared/widget.js", "export * from '../core_components/widget.js';", "R1"),
    ("app/frontend/shared/widget.css", '@import url("../core_components/widget.css");', "R1"),
    ("app/frontend/shared/widget.css", '@import url(../core_components/widget.css);', "R1"),
    ("app/frontend/shared/widget.css", r'@import "..\2f core_components/widget.css";', "R1"),
    ("app/components/canary/frontend/index.js", "import '/frontend/core_components/widget.js';", "R5"),
    ("app/components/canary/frontend/index.js", "import '/components/other/frontend/index.js';", "R5"),
    ("app/components/canary/frontend/index.js", "import 'private-package';", "R5"),
    ("app/components/canary/frontend/index.js", "await import('./' + name);", "R5"),
    ("app/components/canary/frontend/index.js", "await import(`./${name}.js`);", "R5"),
    ("app/components/canary/frontend/index.js", "import './canary.css';", "D5"),
    ("app/components/canary/frontend/lib/index.js", "import '../../../../frontend/core_components/widget.js';", "R1"),
    ("app/components/canary/frontend/index.js", "import '../../../../projects/private.js';", "private"),
    ("app/backend/core_components/consumer.go", 'package consumer\nimport "example/components/canary/backend"', "R2"),
    ("app/backend/core_components/router/components.go", 'package router\nimport "example/components/canary/backend/internal/x"', "R2"),
    ("app/backend/reusable_components/widget.go", 'package widget\nimport alias "example/backend/core_components"', "R4"),
    ("app/backend/reusable_components/widget.go", 'package widget\nimport "example/backend/pipeline"', "R4"),
    ("app/backend/reusable_components/widget_test.go", 'package widget\nimport . `example/backend/pipeline/access_control`', "R4"),
    ("app/components/canary/backend/canary.go", 'package canary\nimport _ "example/projects/private"', "private"),
    ("app/components/canary/backend/canary.go", 'package canary\nimport _ "other.invalid/projects/private"', "private"),
    ("app/components/canary/go.mod", 'module example\nreplace x => ../../projects/x', "private"),
    ("app/components/canary/frontend/wrong.test.mjs", "export {};", "R6"),
    ("app/components/canary/frontend/wrong.test.ts", "export {};", "R6"),
    ("app/components/canary/frontend/dist/hidden.test.js", "export {};", "R6"),
    ("app/components/canary/backend/testdata/hidden_test.go", "package hidden", "R6"),
    ("app/components/canary/tests/hidden.test.js", "export {};", "R6"),
    ("app/components/canary/tests/test_hidden.py", "pass", "R6"),
    ("app/components/canary/tests/hidden.spec.ts", "export {};", "R6"),
    ("app/components/canary/backend/canary.go", "package wrong\n", "R6"),
])
def test_forbidden_fixture_imports_and_structure(tree, owner, source, rule):
    put(tree, owner, source)
    # .mjs tests are not collected by **/frontend/**/*.test.js.
    findings = check(tree)
    assert any(rule in finding for finding in findings), findings


def test_registry_is_explicit_and_targets_still_obey_boundaries(tree):
    path = "app/components/canary/frontend/index.js"
    put(tree, path, "await import('./' + name);\n")
    entry = {path + ":1": {"reason": "Fixed locale loaders.", "targets": ["./locale.js"]}}
    assert check(tree, registry=entry) == []
    entry[path + ":1"]["targets"] = ["/components/other/frontend/private.js"]
    assert any("R2" in finding for finding in check(tree, registry=entry))
    assert any("stale" in finding for finding in check(tree, registry={"unused:1": {}}))


def test_cross_component_edges_need_declaration_and_cannot_cycle(tree):
    put(tree, "app/components/canary/frontend/index.js", "export * from '../../other/frontend/index.js';")
    assert any("undeclared" in finding for finding in check(tree))
    put(tree, "app/components/canary/README.md", "# Canary\n\n## Dependencies\n- `components/other`\n")
    assert check(tree) == []
    put(tree, "app/components/other/frontend/index.js", "import '../../canary/frontend/index.js';")
    put(tree, "app/components/other/README.md", "# Other\n\n## Dependencies\n- components/canary\n")
    assert any("cycle" in finding for finding in check(tree))


def test_root_go_entry_and_one_central_css_entry_are_permitted(tree):
    put(tree, "app/backend/core_components/router/components.go", 'package router\nimport _ "example/components/canary/backend"')
    put(tree, "app/frontend/styles/imports.css", '@import "../../components/canary/frontend/canary.css";')
    assert check(tree) == []
    put(tree, "app/frontend/styles/imports.css", '@import "../../components/canary/frontend/canary.css";\n@import "../../components/canary/frontend/other.css";')
    assert any("one central CSS entry" in finding for finding in check(tree))


def test_missing_readme_invalid_name_and_symlink_fail(tree):
    (tree / "app/components/canary/README.md").unlink()
    put(tree, "app/components/Bad-name/README.md", "# Bad\n")
    (tree / "app/components/other/frontend/link.js").symlink_to("index.js")
    findings = check(tree)
    assert any("missing README" in f for f in findings)
    assert any("invalid component name" in f for f in findings)
    assert any("symlinks are forbidden" in f for f in findings)


def test_library_import_cannot_hide_core_behind_a_symlink(tree):
    core = put(tree, "app/frontend/core_components/real.js", "export const value = 1;")
    alias = tree / "app/frontend/shared/alias.js"
    alias.parent.mkdir(parents=True)
    alias.symlink_to(core)
    put(tree, "app/frontend/shared/consumer.js", "import './alias.js';")
    assert any("R1" in finding for finding in check(tree))


def test_r4_pins_are_exactly_the_eight_existing_edges_in_three_files(tree):
    put(tree, "app/go.mod", "module easelect\n")
    prefix = "app/backend/reusable_components/vanilla_tree/"
    base = "easelect/backend/"
    assert R4_PINNED == {
        prefix + "vanilla_tree.go": {base + "core_components", base + "core_components/httpresponse",
                                   base + "core_components/sessions", base + "pipeline/access_control"},
        prefix + "get_view_data.go": {base + "core_components", base + "core_components/httpresponse"},
        prefix + "tree_response_fixture_test.go": {base + "core_components", base + "core_components/sessions"},
    }
    for path, imports in R4_PINNED.items():
        assert imports <= {name for _, name in go_imports((ROOT / path).read_text())}
        put(tree, path, 'package vanilla_tree\nimport "easelect/backend/core_components/new_edge"')
    # New edges fail even inside an already pinned file.
    findings = check(tree)
    assert sum("R4" in finding for finding in findings) == 3


def test_fixture_cli_runs_from_unrelated_directory(tree, tmp_path):
    unrelated = tmp_path / "unrelated"
    unrelated.mkdir()
    result = subprocess.run([sys.executable, str(ROOT / "app/testing/python/import_boundary_checker.py"),
                             "--strict", "--root", str(tree)], cwd=unrelated, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def test_frontend_and_go_resolvers_ignore_quoted_examples_and_comments():
    assert frontend_imports("// import './bad.js';\nconst text = \"import './bad.js'\";") == []
    assert go_imports('package x\nvar s = `import "example/private"`\n// import "bad"') == []
    assert go_imports('package x\nimport /* comment */ _ `example/components/canary/backend`')


@pytest.mark.parametrize("owner,specifier,rule", [
    ("app/frontend/shared/probe.js", "../core_components/private.js", "R1"),
    ("app/frontend/consumer.js", "../components/other/frontend/private.js", "R2"),
    ("app/components/canary/frontend/index.js", "../../other/frontend/index.js", "R3"),
    ("app/components/canary/frontend/index.js", "/frontend/core_components/private.js", "R5"),
])
def test_template_expression_forbidden_imports(tree, owner, specifier, rule):
    source = "const value = `text\n${await import('" + specifier + "')}`;"
    put(tree, owner, source)
    assert frontend_imports(source) == [(2, specifier)]
    findings = check(tree)
    assert any(rule in finding for finding in findings), findings


def test_template_text_masks_examples_but_not_expressions():
    text = r'''const example = `import('./text.js') \${import('./escaped.js')}`;
const value = `import('${await import('./real.js')}')`;
const quoted = "import('./quoted.js')";
'''
    assert frontend_imports(text) == [(2, "./real.js")]
    assert frontend_imports(text.splitlines()[0]) == []


@pytest.mark.parametrize("expression", [
    "`${ `${await import('./real.js')}` } ${await import('./outer.js')}`",
    "`${({nested: {load: await import('./real.js')}}).nested}`",
    '''`${(() => { const brace = '}'; /* } ` */
// } ` import('./comment.js')
return import('./real.js'); })()}`''',
    r"`escaped \` and \\${await import('./real.js')}`",
    "`${await import(`./${await import('./real.js')}.js`)}`",
    r"""`${ /[}`]/.test('}') ? await import('./real.js') : '' }`""",
    r"""`${ /}/.test('}') ? await import('./real.js') : '' }`""",
    r"""`${ (() => { return /}/.test('}') && import('./real.js'); })() }`""",
    r"""`${ (() => { if (true) /[}`]/.test('}'); return import('./real.js'); })() }`""",
    "`${ (12 / 3) + await import('./real.js') }`",
])
def test_template_nested_expressions_and_braces(expression):
    expected = [(expression.count("\n", 0, expression.index("import('./real.js')")) + 1, "./real.js")]
    if "import(`" in expression:
        expected.insert(0, (1, None))
    if "./outer.js" in expression:
        expected.append((1, "./outer.js"))
    assert frontend_imports("const value = " + expression) == expected


@pytest.mark.parametrize("value", ["12", "of", "value.return", "value.if(1)", "value. /* property */ in"])
@pytest.mark.parametrize("template", [False, True])
def test_division_imports_remain_visible(value, template):
    expression = value + " / (await import('./real.js')).value / 2"
    source = "const value = " + ("`${" + expression + "}`" if template else expression) + ";"
    assert frontend_imports(source) == [(1, "./real.js")]


@pytest.mark.parametrize("call", ["import('./' + locale)", "import(`./${locale}.js`)"])
def test_template_computed_import_requires_reviewed_registry(tree, call):
    owner = "app/components/canary/frontend/index.js"
    source = "const value = `text\n${\nawait " + call + "\n}`;"
    put(tree, owner, source)
    key = owner + ":3"
    assert frontend_imports(source) == [(3, None)]
    findings = check(tree)
    assert any(key in finding and "computed import" in finding for finding in findings), findings
    registry = {key: {"reason": "Fixed locale loaders.", "targets": ["./locale.js"]}}
    assert check(tree, registry=registry) == []
    registry[key]["targets"] = ["../../other/frontend/private.js"]
    assert any("R2" in finding for finding in check(tree, registry=registry))


@pytest.mark.parametrize("prefix", [
    "@import url(https://example.invalid/base.css); ",
    "/* a ` is ordinary CSS comment text */ @import url(//example.invalid/base.css); ",
])
def test_css_lexical_rules_keep_later_imports_visible(tree, prefix):
    source = prefix + '@import "../core_components/private.css";'
    put(tree, "app/frontend/shared/probe.css", source)
    assert (1, "../core_components/private.css") in frontend_imports(source, css=True)
    assert any("R1" in finding for finding in check(tree))


def test_css_comments_and_quoted_examples_stay_masked():
    source = '''/* @import '../core_components/comment.css'; */
.example { content: "@import '../core_components/quoted.css' ${import('./fake.css')}"; }
@import url("../core_components/real.css");'''
    assert frontend_imports(source, css=True) == [(3, "../core_components/real.css")]


@pytest.mark.parametrize("rule,filename", [
    ('@IMPORT "TARGET";', "private.css"),
    ('@Import "TARGET";', "private.css"),
    (r'@\69mport "TARGET";', "private.css"),
    (r'@\000069 mport "TARGET";', "private.css"),
    ('@\\69\tmport "TARGET";', "private.css"),
    ('@\\69\nmport "TARGET";', "private.css"),
    ('@\\000069\r\nmport "TARGET";', "private.css"),
    ('@\\69\fmport "TARGET";', "private.css"),
    (r'@\i\m\p\o\r\t "TARGET";', "private.css"),
    (r'@\49MPORT "TARGET";', "private.css"),
    ('@import URL("TARGET");', "private.css"),
    ('@import URL(TARGET);', "private.css"),
    (r'@import u\72l("TARGET");', "private.css"),
    (r'@import u\72l(TARGET);', "private.css"),
    (r'@import \000075 rl("TARGET");', "private.css"),
    (r'@\69mport/**/u\72l( "TARGET"/**/)/**/layer(theme) supports(display: grid) screen, print;', "private.css"),
    ('@IMPORT/**/"TARGET"/**/layer supports(display: grid) screen, print;', "private.css"),
    (r'@import "../core_components/pri\"vate.css";', 'pri"vate.css'),
    (r"@import '../core_components/pri\'vate.css';", "pri'vate.css"),
    (r'@import url("../core_components/pri\"vate.css");', 'pri"vate.css'),
    (r'@import url(../core_components/pri\"vate.css);', 'pri"vate.css'),
])
@pytest.mark.parametrize("consumer", ["boundary", "reverse"])
def test_css_syntax_imports_reach_boundaries_and_reverse_selection(tree, rule, filename, consumer):
    owner = "app/frontend/shared/css_syntax.css"
    paired = "app/frontend/shared/css_syntax.test.js"
    target = "app/frontend/core_components/" + filename
    specifier = "../core_components/" + filename
    prefix = ('/* @IMPORT "../core_components/comment.css"; */\n'
              '.example { content: "@import \'../core_components/quoted.css\'"; }\n')
    source = prefix + rule.replace("TARGET", specifier)
    put(tree, owner, source)
    put(tree, paired, "// Paired test with mocked stylesheet dependencies.\n")
    put(tree, target, ":root { --fixture: 1; }\n")
    if consumer == "boundary":
        findings = check(tree)
        assert any("R1" in finding and target in finding for finding in findings), findings
    else:
        assert frontend_tests(tree, {target}) == [paired]
    assert frontend_imports(source, css=True) == [(3, specifier)]


@pytest.mark.parametrize("source", [
    r'@imported "./wrong.css";',
    r'@import\61nt "./wrong.css";',
    r'@import urlish("./wrong.css");',
    r'@import u\72lx("./wrong.css");',
    r'.escaped\@import "./wrong.css";',
    r'/* @\69mport "./wrong.css"; */',
    r'''.example { content: '@IMPORT "./wrong.css"'; }''',
    r'.example { background: url(https://example.invalid/@IMPORT); }',
])
def test_css_syntax_keyword_boundaries_and_examples_are_not_imports(source):
    assert frontend_imports(source, css=True) == []


@pytest.mark.parametrize("source,expected", [
    ('@import/**/"./real.css"/**/layer(theme) supports(display: grid) screen, print;', "./real.css"),
    (r'@import url(./with\)parenthesis.css);', "./with)parenthesis.css"),
    (r'@import "./literal\5c 69.css";', r"./literal\69.css"),
    (r'@import "./\0 \d800 \110000.css";', "./\ufffd\ufffd\ufffd.css"),
    ('@import "./con\\\ntinued.css";', "./continued.css"),
    (r'@import url(./literal/*comment*/path.css);', "./literal/*comment*/path.css"),
])
def test_css_paths_use_css_escapes_once_and_keep_url_contents(source, expected):
    assert frontend_imports(source, css=True) == [(1, expected)]


REGEX_ADJACENT_IMPORTS = [
    # cp-gate-183b: a block-closing brace permits a regex, even in ${...}.
    """const value = `${ (() => {
  if (true) {} /[}}]/.test('');
  return LOAD;
})() }`;""",
    "if (true) {} /[}`]/.test('');\nLOAD;",
    """const value = `${ (() => {
  if (true) {} /[}}`]/.test('');
  return `${ `${ LOAD }` }`;
})() }`;""",
]


@pytest.mark.parametrize("source", REGEX_ADJACENT_IMPORTS)
def test_regex_after_block_imports_reach_boundaries_and_reverse_selection(tree, source):
    owner = "app/frontend/shared/probe.test.js"
    specifier = "../core_components/private.js"
    source = source.replace("LOAD", f"import('{specifier}')")
    put(tree, owner, source)
    line = source.count("\n", 0, source.index("import(")) + 1
    assert frontend_imports(source) == [(line, specifier)]
    assert any("R1" in finding for finding in check(tree))
    assert frontend_tests(tree, {"app/frontend/core_components/private.js"}) == [owner]


@pytest.mark.parametrize("source", REGEX_ADJACENT_IMPORTS)
def test_regex_after_block_computed_imports_still_need_registry(tree, source):
    owner = "app/components/canary/frontend/probe.test.js"
    source = source.replace("LOAD", "import('./' + locale)")
    put(tree, owner, source)
    line = source.count("\n", 0, source.index("import(")) + 1
    key = f"{owner}:{line}"
    assert frontend_imports(source) == [(line, None)]
    assert any(key in finding and "computed import" in finding for finding in check(tree))
    registry = {key: {"reason": "Fixed locale loaders.", "targets": ["./locale.js"]}}
    assert check(tree, registry=registry) == []
    put(tree, "app/testing/python/component_import_registry.json", json.dumps(registry))
    assert owner in frontend_tests(tree, {"app/components/canary/frontend/locale.js"})


def test_import_meta_comments_regex_and_template_text_are_not_imports():
    source = r'''const address = import.meta.url;
// import('./comment.js')
/* import('./block.js') */
if (true) {} /import\(['"`][}}]/.test('');
const text = `import('./text.js') ${`import('./nested-text.js')`}`;
import /* real import */ ('./real.js');'''
    assert frontend_imports(source) == [(6, "./real.js")]


@pytest.mark.parametrize("missing", ["node", "lexer"])
def test_import_checker_fails_loudly_without_node_or_lexer(tree, tmp_path, missing):
    environment = os.environ.copy()
    if missing == "node":
        environment["PATH"] = str(tmp_path / "empty-path")
    else:
        environment["FILTEREST_NODE_MODULES_ROOT"] = str(tmp_path / "empty" / "node_modules")
    result = subprocess.run([sys.executable, str(ROOT / "app/testing/python/import_boundary_checker.py"),
                             "--strict", "--root", str(tree)], env=environment, capture_output=True, text=True)
    assert result.returncode != 0, result.stdout + result.stderr
    assert "JavaScript import discovery failed" in result.stderr
    assert "Import boundaries: 0" not in result.stdout


def test_checker_and_reverse_selection_each_use_one_node_batch(tree, monkeypatch):
    for suffix in ("js", "ts", "mjs"):
        put(tree, f"app/frontend/shared/probe.{suffix}", "import '../core_components/private.js';")
    calls = []
    run = subprocess.run

    def record(command, **kwargs):
        calls.append(command)
        return run(command, **kwargs)

    monkeypatch.setattr(discovery.subprocess, "run", record)
    assert sum("R1" in finding for finding in check(tree)) == 3
    assert len(calls) == 1 and calls[0][0] == "node"
    frontend_tests(tree, {"app/frontend/core_components/private.js"})
    assert len(calls) == 2 and calls[1][0] == "node"


def test_lexer_json_contract_static_dynamic_computed_and_source_lines():
    sources = {
        "typed.ts": "const name: string = '😀';\nimport type { Item } from './types.js';\n"
                    "export { item } from './item.js';\nimport.meta.url;\n"
                    "import(`./literal.js`);\nimport('./' + locale);",
        "other.js": "// import('./fake.js')\nimport('./real.js', { with: { type: 'json' } });",
    }
    result = subprocess.run(["node", str(discovery.IMPORT_LEXER)], input=json.dumps(sources),
                            capture_output=True, text=True, check=True)
    assert json.loads(result.stdout) == {
        "typed.ts": [
            {"specifier": "./types.js", "computed": False, "kind": "static", "line": 2},
            {"specifier": "./item.js", "computed": False, "kind": "static", "line": 3},
            {"specifier": "./literal.js", "computed": False, "kind": "dynamic", "line": 5},
            {"specifier": None, "computed": True, "kind": "dynamic", "line": 6},
        ],
        "other.js": [{"specifier": "./real.js", "computed": False, "kind": "dynamic", "line": 2}],
    }


@pytest.mark.parametrize("output", ["not json", "{}", '{"probe.js": [] , "extra.js": []}',
                                    '{"probe.js": [{"line": 0}]}'])
def test_invalid_lexer_response_cannot_silently_drop_a_file(monkeypatch, output):
    monkeypatch.setattr(discovery.subprocess, "run", lambda *args, **kwargs:
                        subprocess.CompletedProcess(args[0], 0, stdout=output))
    with pytest.raises(ValueError, match="JavaScript import discovery failed"):
        discovery.javascript_imports({"probe.js": "import('./private.js')"})


def test_unparseable_javascript_fails_the_batch():
    with pytest.raises(ValueError, match="JavaScript import discovery failed"):
        discovery.javascript_imports({"good.js": "import('./real.js');", "bad.js": "import('"})


def test_require_compatibility_uses_lexer_contexts_and_preserves_offsets():
    source = r'''const text = `require('./text.js')`;
const pattern = /require\(['"`]/;
function require(value) { return value; }
const object = { require(value) { return value; } };
object.require('./method.js');
const value = `${ (() => { if (true) {} /[}}]/.test('');
return require /* call */ ('./real.js'); })() }`;
require(`./${require('./inner.js')}`);'''
    assert frontend_imports(source) == [(7, "./real.js"), (8, None), (8, "./inner.js")]


def test_require_projection_preserves_literal_data_and_unicode_identifier_boundaries():
    source = """const πrequire = name => name;
πrequire('./not-a-loader.js');
require('./require(example).js');
require(`./require(template).js`);
import('./require(original).js');"""
    assert frontend_imports(source) == [(3, "./require(example).js"), (4, "./require(template).js"),
                                       (5, "./require(original).js")]
