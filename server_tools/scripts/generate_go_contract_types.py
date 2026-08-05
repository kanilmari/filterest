#!/usr/bin/env python3
# generate_go_contract_types.py
# Generates a tiny frontend TypeScript mirror for selected stable Go JSON structs.
# Bridges backend contract structs and frontend JSDoc consumers without typing dynamic CRUD payloads.
# Exists to keep the typed stable API island allowlisted, reproducible, and low-maintenance.

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_PATH = PROJECT_ROOT / "frontend/generated/go_contract_types.d.ts"


@dataclass(frozen=True)
class StructSpec:
    go_file: str
    go_name: str
    ts_name: str


ALLOWLIST = [
    StructSpec(
        go_file="backend/core_components/httpresponse/httpresponse.go",
        go_name="ErrorBody",
        ts_name="ErrorBody",
    ),
    StructSpec(
        go_file="backend/core_components/auth/get_auth_modes.go",
        go_name="AuthModesResponse",
        ts_name="AuthModesResponse",
    ),
    StructSpec(
        go_file="backend/core_components/auth/user_permissions.go",
        go_name="UserPermissionsResponse",
        ts_name="UserPermissionsResponse",
    ),
    StructSpec(
        go_file="backend/core_components/system_table_tools/fk_cache_triggers_admin.go",
        go_name="FKCacheTriggerInfo",
        ts_name="FKCacheTriggerInfo",
    ),
    StructSpec(
        go_file="backend/core_components/system_table_tools/fk_cache_triggers_admin.go",
        go_name="FKCacheTriggersResponse",
        ts_name="FKCacheTriggersResponse",
    ),
    StructSpec(
        go_file="backend/core_components/system_table_tools/fk_cache_triggers_admin.go",
        go_name="FKCacheRefreshRequest",
        ts_name="FKCacheRefreshRequest",
    ),
    StructSpec(
        go_file="backend/core_components/system_table_tools/fk_cache_triggers_admin.go",
        go_name="FKCacheRefreshResponse",
        ts_name="FKCacheRefreshResponse",
    ),
    StructSpec(
        go_file="backend/core_components/system_table_tools/dataset_header_config.go",
        go_name="datasetHeaderTextConfig",
        ts_name="DatasetHeaderTextConfig",
    ),
    StructSpec(
        go_file="backend/core_components/system_table_tools/dataset_header_config.go",
        go_name="datasetHeaderConfigResponse",
        ts_name="DatasetHeaderConfigResponse",
    ),
    StructSpec(
        go_file="backend/core_components/system_table_tools/child_tab_config.go",
        go_name="childTabConfigRow",
        ts_name="ChildTabConfigRow",
    ),
    StructSpec(
        go_file="backend/core_components/system_table_tools/child_tab_config.go",
        go_name="saveChildTabConfigRequest",
        ts_name="SaveChildTabConfigRequest",
    ),
    StructSpec(
        go_file="backend/core_components/system_table_tools/card_visibility.go",
        go_name="CardVisibilityColumn",
        ts_name="CardVisibilityColumn",
    ),
    StructSpec(
        go_file="backend/core_components/system_table_tools/card_visibility.go",
        go_name="CardVisibilityResponse",
        ts_name="CardVisibilityResponse",
    ),
]


@dataclass
class StructField:
    field_name: str
    go_type: str
    json_name: str
    optional: bool


@dataclass
class ParsedStruct:
    go_name: str
    ts_name: str
    fields: list[StructField]


FIELD_PATTERN = re.compile(
    r"^\s*(?P<field>[A-Za-z_][A-Za-z0-9_]*)\s+"
    r"(?P<type>[^`]+?)\s+"
    r"`(?P<tags>[^`]*)json:\"(?P<json>[^\"]+)\"(?P<after>[^`]*)`"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate a frontend .d.ts mirror for selected stable Go JSON structs."
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit non-zero if the generated output differs from the checked-in file.",
    )
    return parser.parse_args()


def extract_struct_block(go_file: Path, go_name: str) -> list[str]:
    lines = go_file.read_text(encoding="utf-8").splitlines()
    start_pattern = re.compile(rf"^type\s+{re.escape(go_name)}\s+struct\s*\{{")

    index = 0
    while index < len(lines):
        if not start_pattern.match(lines[index]):
            index += 1
            continue

        index += 1
        depth = 1
        block: list[str] = []
        while index < len(lines) and depth > 0:
            line = lines[index]
            depth += line.count("{")
            depth -= line.count("}")
            if depth > 0:
                block.append(line)
            index += 1
        return block

    raise ValueError(f"Could not find struct {go_name} in {go_file}")


def parse_struct(spec: StructSpec) -> ParsedStruct:
    go_file = PROJECT_ROOT / spec.go_file
    block = extract_struct_block(go_file, spec.go_name)
    fields: list[StructField] = []

    for line in block:
        match = FIELD_PATTERN.match(line)
        if not match:
            continue

        json_tag = match.group("json")
        json_name = json_tag.split(",", 1)[0]
        if json_name == "-" or not json_name:
            continue

        optional = "omitempty" in json_tag or match.group("type").strip().startswith("*")
        fields.append(
            StructField(
                field_name=match.group("field"),
                go_type=match.group("type").strip(),
                json_name=json_name,
                optional=optional,
            )
        )

    if not fields:
        raise ValueError(f"Struct {spec.go_name} in {spec.go_file} has no JSON-tagged fields")

    return ParsedStruct(go_name=spec.go_name, ts_name=spec.ts_name, fields=fields)


def map_go_type(go_type: str, name_map: dict[str, str]) -> str:
    normalized = go_type.strip()

    while normalized.startswith("*"):
        normalized = normalized[1:].strip()

    if normalized.startswith("[]"):
        return f"{map_go_type(normalized[2:], name_map)}[]"

    map_match = re.fullmatch(r"map\[\s*string\s*\]\s*(.+)", normalized)
    if map_match:
        return f"Record<string, {map_go_type(map_match.group(1), name_map)}>"

    primitive_map = {
        "string": "string",
        "bool": "boolean",
        "int": "number",
        "int8": "number",
        "int16": "number",
        "int32": "number",
        "int64": "number",
        "uint": "number",
        "uint8": "number",
        "uint16": "number",
        "uint32": "number",
        "uint64": "number",
        "float32": "number",
        "float64": "number",
        "byte": "number",
        "interface{}": "unknown",
        "any": "unknown",
        "time.Time": "string",
        "json.RawMessage": "unknown",
    }
    if normalized in primitive_map:
        return primitive_map[normalized]

    if normalized in name_map:
        return name_map[normalized]

    if "." in normalized:
        package_name, _, type_name = normalized.rpartition(".")
        del package_name
        if type_name in name_map:
            return name_map[type_name]

    raise ValueError(f"Unsupported Go type in allowlisted contract set: {go_type}")


def build_output(parsed_structs: list[ParsedStruct]) -> str:
    name_map = {item.go_name: item.ts_name for item in parsed_structs}
    lines = [
        "// go_contract_types.d.ts",
        "// Generated stable frontend contract mirror for selected Easelect Go JSON structs.",
        "// Bridges backend request/response structs and editor-only JS/JSDoc typing.",
        "// Exists to give the typed stable API island a low-risk allowlisted surface without touching dynamic map-based APIs.",
        "// Code generated by server_tools/scripts/generate_go_contract_types.py. DO NOT EDIT.",
        "",
    ]

    for item in parsed_structs:
        lines.append(f"export interface {item.ts_name} {{")
        for field in item.fields:
            ts_type = map_go_type(field.go_type, name_map)
            optional_marker = "?" if field.optional else ""
            lines.append(f"    {field.json_name}{optional_marker}: {ts_type};")
        lines.append("}")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    args = parse_args()
    parsed_structs = [parse_struct(spec) for spec in ALLOWLIST]
    output = build_output(parsed_structs)

    if args.check:
        current = OUTPUT_PATH.read_text(encoding="utf-8") if OUTPUT_PATH.exists() else ""
        if current != output:
            print(f"{OUTPUT_PATH} is out of date", file=sys.stderr)
            return 1
        return 0

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(output, encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH.relative_to(PROJECT_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
