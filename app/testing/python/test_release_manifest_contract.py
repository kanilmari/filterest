# test_release_manifest_contract.py
# Validates fixtures and rejected contracts through the authoritative Go parser.
# Connects Python release identity/canonical bytes to the shared Go release contracts.
# Keeps repository runtime venv contract tests mandatory without optional dependencies.
"""Cross-language contract verification; Go compilation failures fail tests."""

from copy import deepcopy
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

APP = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP))
from server_tools.versioning.release_contract_v1 import (  # noqa: E402
    canonical_json_line,
    validate_build_identity,
)

SCHEMAS = APP / "server_tools/versioning"
FIXTURES = APP / "backend/core_components/release_updates/testdata/test_only"

# This temporary test bridge has no database or network code. Compilation uses
# the inherited repository caches/settings, with the installed toolchain pinned.
GO_PARSER_BRIDGE = r'''
package main
import (
    "fmt"
    "io"
    "os"
    release "easelect/backend/core_components/release_updates"
)
func main() {
    data, err := io.ReadAll(io.LimitReader(os.Stdin, release.MaxManifestBytes+1))
    if err == nil {
        switch os.Args[1] {
        case "manifest": _, err = release.ParseManifest(data)
        case "policy": _, err = release.ParseTrustPolicy(data)
        case "signatures": _, err = release.ParseSignatures(data, os.Args[2])
        default: panic("unknown test bridge contract")
        }
    }
    if err != nil { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
}
'''


class ReleaseManifestContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="wl157-contract-tests-")
        cls.addClassCleanup(cls.temporary.cleanup)
        source = Path(cls.temporary.name) / "main.go"
        source.write_text(GO_PARSER_BRIDGE)
        cls.parser = Path(cls.temporary.name) / "contract-parser"
        # conftest places Go's module and build caches; modules resolve as in the other Go-compiling tests.
        environment = os.environ.copy()
        environment["GOTOOLCHAIN"] = "local"
        result = subprocess.run(
            ["go", "build", "-o", str(cls.parser), str(source)],
            cwd=APP, env=environment, capture_output=True, timeout=300,
        )
        if result.returncode != 0:
            raise AssertionError("Go contract parser compilation failed:\n" + result.stderr.decode())

    def assert_contract(self, kind, data, accepted=True, domain=None):
        arguments = [str(self.parser), kind]
        if domain is not None:
            arguments.append(domain)
        result = subprocess.run(arguments, input=data, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0 if accepted else 1, result.stderr.decode())

    def test_go_fixtures_preserve_python_identity_and_canonical_bytes(self):
        for name in ("public", "private"):
            data = (FIXTURES / f"{name}_manifest.json").read_bytes()
            manifest = json.loads(data)
            validate_build_identity(manifest["build_identity"])
            self.assertEqual(data, canonical_json_line(manifest))
            self.assertNotEqual(
                manifest["published_commit"], manifest["build_identity"]["source"]["commit"]
            )
            self.assert_contract("manifest", data)

    def test_bridge_panic_is_not_a_contract_refusal(self):
        # The bridge deliberately panics on unknown operations (Go exit 2).
        # A negative contract assertion must accept only a normal refusal (1).
        with self.assertRaises(AssertionError):
            self.assert_contract("unknown", b"{}", accepted=False)

    def test_go_parser_accepts_all_contract_fixtures_and_schemas_name_authority(self):
        for kind, fixtures in {
            "manifest": ("public_manifest.json", "private_manifest.json"),
            "policy": ("trust_policy.json", "rotation_policy.json"),
            "signatures": (
                "public_signatures.json", "private_signatures.json",
                "rotation_policy_signatures.json", "rotation_manifest_signatures.json",
            ),
        }.items():
            for fixture in fixtures:
                data = (FIXTURES / fixture).read_bytes()
                domain = json.loads(data)["domain"] if kind == "signatures" else None
                self.assert_contract(kind, data, domain=domain)
        for name in ("release_manifest", "release_trust_policy", "release_signatures"):
            schema = json.loads((SCHEMAS / f"{name}.v1.schema.json").read_text())
            self.assertIn("Go parser is the authority", schema["description"])
            self.assertFalse(schema["additionalProperties"])

    def test_go_parser_rejects_invalid_manifest_shapes_and_combinations(self):
        original = json.loads((FIXTURES / "public_manifest.json").read_text())
        bad = []
        for path, value in (
            (("schema_version",), 2), (("protocol", "version"), 2),
            (("unexpected",), True), (("health", "exact_installation"), False),
            (("recovery", "off_host_copy"), False),
            (("capacity", "reserve_percent"), 101),
            (("build_identity", "maturity"), "candidate"),
            (("composition", "revision"), 0), (("composition", "id"), "different"),
            (("minimum_trust_policy_revision",), 0), (("publisher",), "INVALID!"),
            (("created_at",), "2026-02-30T00:00:00Z"),
            (("artifacts", 0, "sha256"), "a" * 64 + "\n"),
            (("publisher",), "filterest\n"), (("product",), "filterest\n"),
            (("release_id",), "release\n"), (("release_tag",), "v9.9.9\n"),
            (("artifacts", 0, "name"), "artifact.tar.gz\n"),
            (("build_identity", "app_version"), "9.9.9\n"),
        ):
            changed = deepcopy(original)
            owner = changed
            for field in path[:-1]:
                owner = owner[field]
            owner[path[-1]] = value
            bad.append(changed)
        for value in (None, {}, []):
            changed = deepcopy(original)
            changed["artifacts"] = value
            bad.append(changed)
        changed = deepcopy(original)
        del changed["database"]["migrations"][0]["publishes_database_version"]
        bad.append(changed)
        changed = deepcopy(original)
        changed["capacity"]["allocations"][1]["purpose"] = "staging"
        bad.append(changed)
        changed = deepcopy(original)
        changed["artifacts"][0]["kind"] = "oci_archive"
        bad.append(changed)
        changed = deepcopy(original)
        changed["artifacts"][0]["oci"] = {
            "manifest_digest": "sha256:" + "f" * 64,
            "config_digest": "sha256:" + "e" * 64,
        }
        bad.append(changed)
        for index, document in enumerate(bad):
            with self.subTest(invalid_case=index):
                self.assert_contract("manifest", canonical_json_line(document), accepted=False)

    def test_go_parser_rejects_unknown_keys_versions_and_fingerprint_newlines(self):
        for kind, fixture in (
            ("policy", "trust_policy.json"), ("signatures", "public_signatures.json"),
        ):
            document = json.loads((FIXTURES / fixture).read_text())
            domain = document.get("domain")
            for changed in ({**document, "schema_version": 2}, {**document, "public_key": "adjacent"}):
                self.assert_contract(kind, canonical_json_line(changed), accepted=False, domain=domain)
            changed = deepcopy(document)
            if kind == "policy":
                changed["compositions"][0]["keys"][0]["fingerprint"] += "\n"
            else:
                changed["signatures"][0]["key_fingerprint"] += "\n"
            self.assert_contract(kind, canonical_json_line(changed), accepted=False, domain=domain)

    def test_schema_variable_strings_refuse_trailing_newlines(self):
        manifest = json.loads((SCHEMAS / "release_manifest.v1.schema.json").read_text())
        policy = json.loads((SCHEMAS / "release_trust_policy.v1.schema.json").read_text())
        properties = manifest["properties"]
        for surface, definition, value in (
            ("publisher", properties["publisher"], "filterest"),
            ("product", properties["product"], "filterest"),
            ("release_id", properties["release_id"], "release-1"),
            ("release_tag", properties["release_tag"], "v9.9.9"),
            ("artifact name", manifest["$defs"]["artifact"]["properties"]["name"], "artifact.tar.gz"),
            ("policy publisher", policy["properties"]["compositions"]["items"]["properties"]["publisher"], "filterest"),
            ("build identity version", properties["build_identity"]["allOf"][1]["properties"]["app_version"], "9.9.9"),
        ):
            with self.subTest(surface=surface):
                self.assertIsNotNone(re.search(definition["pattern"], value))
                self.assertIsNone(re.search(definition["pattern"], value + "\n"))


if __name__ == "__main__":
    unittest.main()
