"""Check the allowlisted Go JSON mirror against nil and omission semantics.

Connect real encoding/json output to the frontend's property/type contract.
Keep generated artifacts owned by the normal generator, not by these tests.
"""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest


APP_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = APP_ROOT / "server_tools/scripts/generate_go_contract_types.py"


@pytest.fixture
def generator():
    name = "filterest_contract_generator_test"
    spec = importlib.util.spec_from_file_location(name, SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    try:
        yield module
    finally:
        sys.modules.pop(name, None)


GO_FIXTURE = r"""
package main
import ("encoding/json"; "os")
type Fixture struct {
    Required *string `json:"required"`
    Optional *string `json:"optional,omitempty"`
    RequiredBool *bool `json:"required_bool"`
    OptionalBool *bool `json:"optional_bool,omitempty"`
    RequiredInt *int `json:"required_int"`
    OptionalNumber int `json:"optional_number,omitempty"`
    Named string `json:"text_omitempty_marker"`
    Nested **string `json:"nested,omitempty"`
    OptionalSlice *[]string `json:"optional_slice,omitempty"`
    Values []*string `json:"values"`
}
func main() {
    text, flag, number := "", false, 0
    var inner *string
    var slice []string
    values := []Fixture{
        {},
        {Required:&text, Optional:&text, RequiredBool:&flag, OptionalBool:&flag, RequiredInt:&number,
         Nested:&inner, OptionalSlice:&slice, Values:[]*string{nil,&text}},
    }
    if err:=json.NewEncoder(os.Stdout).Encode(values); err!=nil {panic(err)}
}
"""


def test_nil_and_omitempty_match_real_go_json(generator, monkeypatch, tmp_path):
    go_file = tmp_path / "main.go"
    go_file.write_text(GO_FIXTURE, encoding="utf-8")
    monkeypatch.setattr(generator, "PROJECT_ROOT", tmp_path)
    parsed = generator.parse_struct(generator.StructSpec("main.go", "Fixture", "Fixture"))
    rendered = generator.build_output([parsed])
    expected = [
        "required: string | null;",
        "optional?: string;",
        "required_bool: boolean | null;",
        "optional_bool?: boolean;",
        "required_int: number | null;",
        "optional_number?: number;",
        "text_omitempty_marker: string;",
        "nested?: string | null;",
        "optional_slice?: string[] | null;",
        "values: (string | null)[];",
    ]
    for line in expected:
        assert "    " + line in rendered
    result = subprocess.run(
        ["go", "run", str(go_file)], cwd=tmp_path, check=True,
        text=True, capture_output=True, timeout=30,
        env={**os.environ, "GOWORK": "off"},
    )
    empty, populated = json.loads(result.stdout)
    assert empty["required"] is None
    assert empty["required_bool"] is None
    assert empty["required_int"] is None
    assert empty["text_omitempty_marker"] == ""
    assert "optional" not in empty and "optional_bool" not in empty
    assert "optional_number" not in empty and "nested" not in empty
    assert "optional_slice" not in empty
    assert populated["optional"] == ""
    assert populated["optional_bool"] is False
    assert populated["required_int"] == 0
    assert populated["nested"] is None
    assert populated["optional_slice"] is None
    assert populated["values"] == [None, ""]
    # This bounded correction preserves existing collection-container typing;
    # it fixes pointer nullability, not the separate nil-slice response policy.


@pytest.mark.parametrize(("go_type", "expected"), [
    ("string", "string"), ("*string", "string | null"),
    ("**string", "string | null"), ("*bool", "boolean | null"),
    ("*int64", "number | null"), ("[]*string", "(string | null)[]"),
    ("map[string]*bool", "Record<string, boolean | null>"),
    ("*[]string", "string[] | null"), ("*interface{}", "unknown"),
    ("*Nested", "NestedView | null"),
])
def test_pointer_mapping_preserves_nested_nullability(generator, go_type, expected):
    assert generator.map_go_type(go_type, {"Nested": "NestedView"}) == expected


def test_current_allowlist_preserves_nullable_presentation_overrides(generator):
    parsed = [generator.parse_struct(spec) for spec in generator.ALLOWLIST]
    pointers = [
        (item.ts_name, field.json_name, field.optional)
        for item in parsed for field in item.fields if field.go_type.startswith("*")
    ]
    assert pointers == [
        ("CardVisibilityColumn", "label_value_layout", False),
        ("CardVisibilityColumn", "show_key_on_card_override", False),
        ("CardVisibilityResponse", "card_style_variant", False),
        ("CardVisibilityResponse", "card_detail_columns", False),
    ]
    output = generator.build_output(parsed)
    assert "    label_value_layout: string | null;" in output
    assert "    card_style_variant: string | null;" in output
    assert "    show_key_on_card_override: boolean | null;" in output
    assert "    card_detail_columns: number | null;" in output
    assert generator.OUTPUT_PATH.read_text(encoding="utf-8") == output
