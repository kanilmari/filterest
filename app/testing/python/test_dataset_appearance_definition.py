"""test_dataset_appearance_definition.py
Checks raw appearance ownership and unchanged version-one defaults.
Connects Python definition consumers to the paired Go/browser examples.
Protects explicit storage places without turning compatibility values into fields.
"""

import json
from pathlib import Path


APP = Path(__file__).resolve().parents[2]
DEFINITION = APP / "frontend/shared/dataset_appearance/definition.json"
CONTRACTS = APP / "testing/shared_contracts"


def test_raw_definition_has_exactly_three_complete_places():
    definition = json.loads(DEFINITION.read_text())
    examples = json.loads((CONTRACTS / "dataset_appearance_v2_examples.json").read_text())
    inventories = {place: [] for place in examples["places"]}
    for owner in [*definition["theme_owners"], "shared"]:
        fields = definition["shared_fields" if owner == "shared" else "theme_fields"]
        for key, field in fields.items():
            path = f"{owner}.{key}"
            if "derived_from" in field:
                assert path in examples["derived"]
                assert "place" not in field
                continue
            assert field["place"] in inventories
            inventories[field["place"]].append(path)
    assert {place: sorted(paths) for place, paths in inventories.items()} == examples["places"]
    assert [len(inventories[place]) for place in ("tab_only", "site_only", "site_default")] == [28, 7, 9]
    for path, example in examples["aliases"].items():
        owner, key = path.split(".")
        alias = definition["aliases"][key]
        assert owner in alias["owners"]
        assert f"{owner}.{alias['field']}" == example["canonical"]
        assert definition["theme_fields"][alias["field"]]["place"] == example["place"]
        assert "place" not in alias  # The canonical value alone owns its place.


def test_raw_definition_preserves_all_version_one_defaults():
    definition = json.loads(DEFINITION.read_text())
    legacy = json.loads((CONTRACTS / "dataset_appearance_examples.json").read_text())
    expected = json.loads(legacy["baseline_browser_json"])
    assert expected == json.loads(legacy["baseline_go_json"])
    for owner, values in expected.items():
        fields = definition["shared_fields" if owner == "shared" else "theme_fields"]
        assert set(fields) == set(values)
        for key, value in values.items():
            field = fields[key]
            if "rule_from" in field:
                source_owner, source_key = field["rule_from"].split(".")
                assert source_owner == "light"
                field = definition["theme_fields"][source_key]
            actual = field.get("dark_default", field["default"]) if owner == "dark" else field["default"]
            assert actual == value
