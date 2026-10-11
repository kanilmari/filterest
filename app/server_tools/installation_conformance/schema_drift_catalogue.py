"""schema_drift_catalogue.py
Validate saved catalogue exports and same-version fresh bootstrap evidence.
Connect the read-only exporter with installation drift comparison.
Keep incomplete evidence and environmental normalization from producing a pass.
"""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re


class CatalogueError(ValueError):
    """The saved evidence cannot establish a complete comparison."""


TABLE_FIELDS = {"name", "kind", "owner", "extension", "columns", "constraints", "indexes",
                "triggers", "policies", "rls_enabled", "rls_forced", "privileges", "definition",
                "partition_key", "partition_bound", "parents", "replica_identity"}
COLUMN_FIELDS = {"name", "position", "type", "not_null", "default", "identity", "generated",
                 "collation", "privileges"}
SEQUENCE_FIELDS = {"name", "owner", "extension", "table", "column", "type", "start", "increment",
                   "minimum", "maximum", "cache", "cycle", "privileges"}
FUNCTION_FIELDS = {"name", "owner", "extension", "definition", "privileges", "tables"}
METADATA_FIELDS = {"datasets", "columns", "aliases", "relations_1_m", "relations_m_m"}


def require(value, fields, label):
    if not isinstance(value, dict) or not fields.issubset(value):
        raise CatalogueError(f"Missing or invalid {label} fields")


def named_rows(value, label):
    if not isinstance(value, list):
        raise CatalogueError(f"Missing or invalid {label} list")
    names = []
    for row in value:
        require(row, {"name"}, label)
        if not isinstance(row["name"], str) or not row["name"]:
            raise CatalogueError(f"Invalid {label} name")
        names.append(row["name"])
    if len(names) != len(set(names)):
        raise CatalogueError(f"Duplicate {label} names")


def privileges(value):
    if not isinstance(value, list):
        raise CatalogueError("Missing privilege evidence")
    for row in value:
        require(row, {"grantee", "grantor", "privilege", "grantable"}, "privilege")
        if any(not isinstance(row[k], str) or not row[k] for k in ("grantee", "grantor", "privilege")):
            raise CatalogueError("Invalid privilege identity")
        if type(row["grantable"]) is not bool:
            raise CatalogueError("Invalid grant option")


def text_fields(row, required, nullable=()):
    for key in required:
        value = row[key]
        if value is None and key in nullable:
            continue
        if not isinstance(value, str):
            raise CatalogueError(f"Invalid {key} definition")


def validate_catalogue(value):
    """Require all acceptance surfaces, including empty lists for absent objects."""
    fields = {"format_version", "export_type", "db_version", "tables", "sequences", "functions",
              "schemas", "default_privileges", "extensions", "extension_objects", "metadata", "ledger"}
    require(value, fields, "catalogue")
    if value["format_version"] != 1 or value["export_type"] != "filterest_schema_catalogue":
        raise CatalogueError("Unsupported catalogue format; use schema_drift_export.sql through ./db")
    if not isinstance(value["db_version"], str) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", value["db_version"]):
        raise CatalogueError("Recorded database version is missing or invalid")
    for label in ("tables", "sequences", "functions", "schemas", "extensions"):
        named_rows(value[label], label)
    if not value["tables"] or not value["schemas"]:
        raise CatalogueError("Empty installation inventory cannot prove schema completeness")
    for row in value["tables"]:
        require(row, TABLE_FIELDS, "table")
        text_fields(row, ("kind", "owner", "extension", "definition", "partition_key", "partition_bound", "replica_identity"),
                    ("extension", "definition", "partition_key", "partition_bound"))
        if not isinstance(row["owner"], str) or not row["owner"]:
            raise CatalogueError("Missing table owner")
        for flag in ("rls_enabled", "rls_forced"):
            if type(row[flag]) is not bool:
                raise CatalogueError("Invalid row security flag")
        named_rows(row["columns"], "columns")
        positions = []
        for col in row["columns"]:
            require(col, COLUMN_FIELDS, "column")
            if type(col["position"]) is not int or col["position"] <= 0 or not isinstance(col["type"], str):
                raise CatalogueError("Invalid column order or type")
            if type(col["not_null"]) is not bool:
                raise CatalogueError("Invalid column nullability")
            text_fields(col, ("type", "default", "identity", "generated", "collation"), ("default", "collation"))
            positions.append(col["position"])
            privileges(col["privileges"])
        if len(positions) != len(set(positions)):
            raise CatalogueError("Duplicate column positions")
        for label, required in (
            ("constraints", {"name", "definition", "validated"}),
            ("indexes", {"name", "definition", "valid", "ready", "clustered", "replica_identity"}),
            ("triggers", {"name", "definition", "enabled", "function"}),
            ("policies", {"name", "command", "permissive", "roles", "using", "check"}),
        ):
            named_rows(row[label], label)
            for item in row[label]:
                require(item, required, label)
                if label in {"constraints", "indexes", "triggers"}:
                    text_fields(item, ("definition",))
                for flag in {"validated", "valid", "ready", "clustered", "replica_identity", "permissive"} & item.keys():
                    if type(item[flag]) is not bool:
                        raise CatalogueError(f"Invalid {label} flag")
                if label == "triggers":
                    text_fields(item, ("enabled", "function"))
                if label == "policies":
                    text_fields(item, ("command", "using", "check"), ("using", "check"))
                    if not isinstance(item["roles"], list) or any(not isinstance(role, str) for role in item["roles"]):
                        raise CatalogueError("Invalid policy role evidence")
        if not isinstance(row["parents"], list) or any(not isinstance(parent, str) for parent in row["parents"]):
            raise CatalogueError("Missing inheritance evidence")
        privileges(row["privileges"])
    for row in value["sequences"]:
        require(row, SEQUENCE_FIELDS, "sequence")
        text_fields(row, ("owner", "extension", "table", "column", "type"), ("extension", "table", "column"))
        for key in ("start", "increment", "minimum", "maximum", "cache"):
            if type(row[key]) is not int:
                raise CatalogueError("Invalid sequence definition")
        if type(row["cycle"]) is not bool:
            raise CatalogueError("Invalid sequence cycle")
        privileges(row["privileges"])
    for row in value["functions"]:
        require(row, FUNCTION_FIELDS, "function")
        text_fields(row, ("owner", "extension", "definition"), ("extension",))
        if not isinstance(row["definition"], str) or not row["definition"] or not isinstance(row["tables"], list):
            raise CatalogueError("Missing function definition or attachments")
        if any(not isinstance(table, str) for table in row["tables"]):
            raise CatalogueError("Invalid function attachment")
        privileges(row["privileges"])
    for row in value["schemas"]:
        require(row, {"name", "owner", "privileges"}, "schema")
        text_fields(row, ("owner",))
        privileges(row["privileges"])
    for label in ("default_privileges", "extension_objects", "ledger"):
        if not isinstance(value[label], list):
            raise CatalogueError(f"Invalid {label} evidence")
    for row in value["default_privileges"]:
        require(row, {"owner", "schema", "kind", "privileges"}, "default privilege")
        text_fields(row, ("owner", "schema", "kind"))
        privileges(row["privileges"])
    for row in value["extensions"]:
        require(row, {"schema", "version"}, "extension")
        text_fields(row, ("schema", "version"))
    for row in value["extension_objects"]:
        require(row, {"extension", "type", "identity"}, "extension member")
        text_fields(row, ("extension", "type", "identity"))
    for row in value["ledger"]:
        require(row, {"filename", "content_sha256", "outcome", "provenance"}, "ledger")
        text_fields(row, ("filename", "content_sha256", "outcome", "provenance"), ("content_sha256", "outcome", "provenance"))
    require(value["metadata"], METADATA_FIELDS, "dataset metadata")
    for label in METADATA_FIELDS:
        if not isinstance(value["metadata"][label], list) or any(not isinstance(row, dict) for row in value["metadata"][label]):
            raise CatalogueError(f"Invalid dataset {label} metadata")
    named_rows(value["metadata"]["datasets"], "dataset registry")
    for row in value["metadata"]["datasets"]:
        require(row, {"name", "table_uid"}, "dataset registry")
        if type(row["table_uid"]) is not int:
            raise CatalogueError("Invalid dataset registry identity")


def read_catalogue(path):
    """Accept the existing ./db JSON envelope and a direct psql JSON object."""
    with Path(path).open("rb") as stream:
        raw = stream.read(64 * 1024 * 1024 + 1)
    if len(raw) > 64 * 1024 * 1024:
        raise CatalogueError("Catalogue export exceeds 64 MiB")
    def distinct_keys(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise CatalogueError("Duplicate JSON field")
            result[key] = value
        return result
    def invalid_number(value):
        raise CatalogueError("Invalid JSON number")
    value = json.loads(raw, object_pairs_hook=distinct_keys, parse_constant=invalid_number)
    if isinstance(value, list) and len(value) == 1 and isinstance(value[0], dict):
        value = value[0].get("schema_catalogue")
    validate_catalogue(value)
    return value


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def normalize_catalogue(catalogue, role_names=None):
    """Normalize declared roles and owned sequence identities, preserving SQL bytes.

    Database names, OIDs and current sequence values are environmental. Live column
    order survives dropped physical slots. SQL literals and function bodies remain
    byte-exact; broad whitespace or identifier substitutions could hide real drift.
    """
    result = deepcopy(catalogue)
    roles = role_names or {}
    if len(set(roles.values())) != len(roles):
        raise CatalogueError("Role mappings must preserve distinct privilege principals")
    if "PUBLIC" in roles or "PUBLIC" in roles.values():
        raise CatalogueError("PUBLIC cannot be mapped to an installation role")
    physical_roles = set()
    def collect_roles(value, key=""):
        if isinstance(value, dict):
            for field, item in value.items():
                collect_roles(item, field)
        elif isinstance(value, list):
            for item in value:
                collect_roles(item, key)
        elif isinstance(value, str) and key in {"owner", "grantee", "grantor", "roles"}:
            physical_roles.add(value)
    collect_roles(result)
    if len({roles.get(role, role) for role in physical_roles}) != len(physical_roles):
        raise CatalogueError("Role mapping collides with another privilege principal")
    external_types = {}
    for member in result["extension_objects"]:
        if member.get("type") in {"type", "collation"}:
            identity = member["identity"]
            # Only an extension member's qualified type identity is environmental;
            # never replace a whole schema containing unrelated product objects.
            if "." in identity:
                external_types[identity] = "extension:" + member["extension"] + "." + identity.split(".", 1)[1]
    sequence_names = {}
    for seq in result["sequences"]:
        if seq["table"] and seq["column"]:
            sequence_names[seq["name"]] = f"sequence:{seq['table']}.{seq['column']}"
            seq["name"] = sequence_names[seq["name"]]
        seq.pop("last_value", None)
        seq.pop("is_called", None)
    for row in result["tables"]:
        row["columns"].sort(key=lambda col: col["position"])
        for position, col in enumerate(row["columns"], 1):
            col["position"] = position
            for field in ("type", "collation"):
                if col[field] is not None:
                    for identity, logical in external_types.items():
                        if col[field] == identity or col[field].startswith(identity + "(") or col[field].startswith(identity + "["):
                            col[field] = logical + col[field][len(identity):]
            # Rewrite only a regclass literal denoting a known owned sequence.
            if col["default"] is not None:
                def sequence_literal(match):
                    name = match.group(1).replace("''", "'")
                    return "'" + sequence_names.get(name, name).replace("'", "''") + "'::regclass"
                col["default"] = re.sub(r"'((?:''|[^'])*)'::regclass", sequence_literal, col["default"])
    def walk(value, key=""):
        if isinstance(value, dict):
            return {k: walk(v, k) for k, v in value.items()}
        if isinstance(value, list):
            mapped = [walk(v, key) for v in value]
            return mapped if key == "columns" else sorted(mapped, key=canonical)
        if isinstance(value, str) and key in {"owner", "grantee", "grantor", "roles"}:
            return roles.get(value, value)
        return value
    return walk(result)


def verify_reference(reference, root):
    """Bind a fresh export to an actual same-version checkout, never a relabelled skeleton.

    Hashes establish provenance only. compare_catalogues still compares every
    physical surface, irrespective of matching version or migration hashes.
    """
    root = Path(root)
    package = root / "app/server_tools/public_bootstrap"
    manifest = json.loads((package / "manifest.json").read_text())
    if manifest.get("artifact") != "filterest-public-bootstrap":
        raise CatalogueError("Reference bootstrap manifest is not a Filterest bootstrap")
    version = (root / "app/VERSION_DB").read_text().strip()
    if manifest.get("db_version") != version or reference["db_version"] != version:
        raise CatalogueError("Reference export, bootstrap and checkout database versions must match")
    for name in ("schema.sql", "seed_data.sql"):
        expected = manifest["generated_files"]["server_tools/public_bootstrap/" + name]["sha256"]
        if hashlib.sha256((package / name).read_bytes()).hexdigest() != expected:
            raise CatalogueError("Reference bootstrap generated bytes do not match its manifest")
    for relative, entry in manifest["source_files"].items():
        parts = Path(relative).parts
        if not parts or parts[0] != "filterest" or ".." in parts:
            raise CatalogueError("Invalid bootstrap source path")
        if hashlib.sha256(root.joinpath(*parts[1:]).read_bytes()).hexdigest() != entry["sha256"]:
            raise CatalogueError("Reference bootstrap source bytes do not match its manifest")
    rows = reference["ledger"]
    if any(not isinstance(row, dict) or not isinstance(row.get("filename"), str) for row in rows):
        raise CatalogueError("Invalid reference migration ledger")
    ledger = {row["filename"]: row for row in rows}
    expected_names = manifest["migration_ledger_baseline"]
    if not expected_names or len(ledger) != len(rows) or set(ledger) != set(expected_names):
        raise CatalogueError("Reference must contain exactly the bootstrap migration baseline")
    ledger_columns = {col["name"] for table in reference["tables"]
                      if table["name"] == "public.system_schema_migrations" for col in table["columns"]}
    evidence_columns = {"content_sha256", "outcome", "provenance"}
    evidence_migration = "20261009000020_add_migration_execution_evidence.sql"
    legacy = (bool(ledger_columns) and not (ledger_columns & evidence_columns)
              and evidence_migration not in expected_names)
    for filename in expected_names:
        row = ledger[filename]
        source = "filterest/app/server_tools/migrations/" + filename
        expected_hash = manifest["source_files"][source]["sha256"]
        if legacy:
            if any(row.get(field) is not None for field in evidence_columns):
                raise CatalogueError("Legacy reference ledger contains inconsistent evidence")
        elif (row.get("outcome") != "bootstrap_baseline" or row.get("provenance") != "bootstrap"
                or row.get("content_sha256") != expected_hash):
            raise CatalogueError("Reference ledger does not prove this fresh bootstrap")
    expected_tables = set(manifest["allowed_schema_tables"])
    # The bootstrap manifest inventories CREATE TABLE, while the catalogue also
    # exports views. Keep those definitions managed without calling them tables
    # that the manifest forgot (system_column_supported_views is a shipped view).
    actual_tables = {row["name"] for row in reference["tables"]
                     if not row["extension"] and row["kind"] in {"r", "p"}}
    if actual_tables != expected_tables:
        raise CatalogueError("Reference table inventory does not match the bootstrap inventory")
    return {"db_version": version, "ledger_evidence": "legacy_filename_baseline" if legacy else "bootstrap_baseline",
            "bootstrap_manifest_sha256": hashlib.sha256(canonical(manifest).encode()).hexdigest(),
            "schema_sha256": manifest["generated_files"]["server_tools/public_bootstrap/schema.sql"]["sha256"],
            "seed_sha256": manifest["generated_files"]["server_tools/public_bootstrap/seed_data.sql"]["sha256"]}
