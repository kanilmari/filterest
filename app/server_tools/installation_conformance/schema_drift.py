#!/usr/bin/env python3
"""schema_drift.py
Compare saved installation and matching fresh-install catalogue exports read-only.
Connect bootstrap provenance and physical database contracts to batch 2's inventory.
Report managed differences, site-owned datasets and extension objects separately.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from server_tools.installation_conformance.schema_drift_catalogue import (
    CatalogueError, canonical, normalize_catalogue, read_catalogue, validate_catalogue, verify_reference,
)
from server_tools.installation_conformance.schema_drift_equivalence import (
    named_definition_findings, table_views_unique_equivalence,
)

SQL_TOKEN = re.compile(r"""'(?:''|[^'])*'|"(?:""|[^"])*"|(?:[^\W\d]|_)[\w$]*|::|[^\s]""")
SQL_IDENTIFIER = re.compile(r'"(?:""|[^"])+"|(?:[^\W\d]|_)[\w$]*')
SEQUENCE_FUNCTIONS = {"nextval", "currval", "setval", "lastval", "pg_sequence_last_value"}


def new_report():
    return {"format_version": 2, "report_type": "filterest_schema_drift", "verdict": "could_not_compare",
            "db_version": None, "reference": None, "inputs": None, "tables": [], "managed_objects": [],
            "site_owned": {}, "extensions": {}, "errors": [],
            "renamed": [], "equivalences": [], "column_order": [], "scope_conflicts": [],
            "counts": {"matched": 0, "drift": 0, "could_not_compare": 0},
            "category_counts": {label: {"objects": 0, "differences": 0, "tables": 0}
                                for label in ("structural", "ownership", "privileges")},
            "structural_table_counts": {label: 0 for label in ("matched", "changed", "extra", "missing")},
            "scope": "Physical schema and privilege definitions; dataset metadata rows are site data, not schema drift",
            "steps": [{"number": 1, "name": "Validate exported catalogues", "result": "not_run"},
                      {"number": 2, "name": "Verify matching fresh bootstrap", "result": "not_run"},
                      {"number": 3, "name": "Compare physical schema", "result": "not_run"}]}


def differences(expected, observed, path):
    if expected == observed:
        return []
    if isinstance(expected, dict) and isinstance(observed, dict):
        result = []
        for key in sorted(set(expected) | set(observed)):
            result.extend(differences(expected.get(key), observed.get(key), f"{path}.{key}" if path else key))
        return result
    return [{"path": path, "expected": expected, "observed": observed}]


def named_differences(expected, observed, path):
    wanted = {row["name"]: row for row in expected}
    actual = {row["name"]: row for row in observed}
    return [item for name in sorted(set(wanted) | set(actual))
            for item in differences(wanted.get(name), actual.get(name), f"{path}.{name}")]


def site_dataset_classification(name, managed, registry, reference_registry):
    if name in managed or name in reference_registry:
        return None
    if registry:
        return "dataset_registry" if name in registry else None
    # Legacy/empty registry evidence cannot classify a nonprefixed table. Keep
    # the old prefix heuristic only here, and expose its weaker basis in reports.
    if re.match(r'^public\.(?:"app_|app_)', name):
        return "app_prefix_fallback"
    return None


def unparenthesized(tokens):
    while tokens and tokens[0] == "(" and tokens[-1] == ")":
        depth = 0
        for position, token in enumerate(tokens):
            depth += (token == "(") - (token == ")")
            if depth == 0:
                break
        if position != len(tokens) - 1:
            break
        tokens = tokens[1:-1]
    return tokens


def before_cast(tokens, cast):
    tokens = unparenthesized(tokens)
    for suffix in (["::", cast], ["::", "pg_catalog", ".", cast]):
        if tokens[-len(suffix):] == suffix:
            return unparenthesized(tokens[:-len(suffix)])
    return None


def sequence_targets(default):
    """Read only literal regclass/text-to-regclass targets; mark other calls unknown.

    Token boundaries keep SQL string contents out of function discovery. Inspect
    the complete first argument, so a regclass literal inside a computation can
    never be mistaken for its result. This is deliberately not a SQL evaluator.
    """
    tokens = SQL_TOKEN.findall(default or "")
    for position, token in enumerate(tokens[:-1]):
        function = token[1:-1] if token.startswith('"') else token.lower()
        if function not in SEQUENCE_FUNCTIONS or tokens[position + 1] != "(":
            continue
        start, end, depth = position + 2, position + 2, 0
        while end < len(tokens):
            current = tokens[end]
            if depth == 0 and current in {",", ")"}:
                break
            depth += (current == "(") - (current == ")")
            end += 1
        target = before_cast(tokens[start:end], "regclass")
        if target is not None:
            text_target = before_cast(target, "text")
            if text_target is not None:
                target = text_target
        yield (target[0][1:-1].replace("''", "'") if target and len(target) == 1
               and target[0].startswith("'") else None)


def sequence_identifier(name):
    """Compare qualified SQL identifiers by meaning without guessing a search path."""
    tokens = SQL_TOKEN.findall(name)
    if len(tokens) != 3 or tokens[1] != "." or any(
            not SQL_IDENTIFIER.fullmatch(token) for token in (tokens[0], tokens[2])):
        return None
    return tuple(token[1:-1].replace('""', '"') if token.startswith('"') else token.lower()
                 for token in (tokens[0], tokens[2]))


def sequence_tables(catalogue, managed, reference_registry):
    """Discover complete users or uncertainty before owned identities are normalized.

    Ownership includes identity sequences with no column default. Discovery uses
    physical names, then keys users by the same logical identities as the catalogue
    normalizer. No SQL rewrite or sequence-name ownership heuristic is involved.
    """
    users, identities, unresolved = {}, {}, []
    for row in catalogue["sequences"]:
        name = f"sequence:{row['table']}.{row['column']}" if row["table"] and row["column"] else row["name"]
        users[name] = {row["table"]} if row["table"] else set()
        if (identity := sequence_identifier(row["name"])) is not None:
            identities[identity] = name
    registry = {row["name"] for row in catalogue["metadata"]["datasets"]}
    for row in catalogue["tables"]:
        for col in row["columns"]:
            unknown = False
            for target in sequence_targets(col["default"]):
                name = identities.get(sequence_identifier(target)) if target is not None else None
                if name is not None:
                    users[name].add(row["name"])
                else:
                    unknown = True
            if unknown and not row["extension"] and site_dataset_classification(
                    row["name"], managed, registry, reference_registry) is None:
                unresolved.append({"category": "sequences", "reason": "unresolved sequence reference",
                                   "table": row["name"], "column": col["name"]})
    return users, unresolved


def partition_catalogue(catalogue, managed, reference_registry, managed_functions, sequence_scope, scope_uncertain):
    """Retain the complete site-owned inventory and its identifier-only metadata.

    The installation's registry identifies additional datasets regardless of name.
    Seeded/physically bundled datasets stay managed. With registry entries present,
    unknown extra tables remain drift, even if they carry the old app_ prefix.
    """
    extension_tables = {row["name"] for row in catalogue["tables"] if row["extension"]}
    registry = {row["name"] for row in catalogue["metadata"]["datasets"]}
    classification = {row["name"]: basis for row in catalogue["tables"] if not row["extension"]
                      and (basis := site_dataset_classification(row["name"], managed, registry, reference_registry))}
    runtime = set(classification)
    excluded = runtime | extension_tables
    site = {"tables": [row for row in catalogue["tables"] if row["name"] in runtime],
            "sequences": [], "functions": [], "metadata": {}, "classification": classification}
    owned_uids = {row["table_uid"] for row in catalogue["metadata"]["datasets"]
                  if row.get("name") in runtime and row.get("table_uid") is not None}
    for label, rows in catalogue["metadata"].items():
        site["metadata"][label] = [row for row in rows if
            (label == "datasets" and row.get("name") in runtime)
            or any(row.get(field) in owned_uids for field in (
                "table_uid", "source_table_uid", "target_table_uid", "table_a_uid", "table_b_uid", "bridging_table_uid"))]
    # Do not serialize unrelated site metadata (nor its content) into drift evidence.
    tables = [row for row in catalogue["tables"] if row["name"] not in excluded]
    sequence_users, unresolved = sequence_scope
    sequences, functions, conflicts = [], [], list(unresolved)
    for row in catalogue["sequences"]:
        users = sequence_users[row["name"]]
        if row["extension"] or (not scope_uncertain and users and users.issubset(extension_tables)):
            continue
        row = {**row, "tables": sorted(users)}
        # A partial discovered user set never proves exclusive site ownership.
        # Uncertainty in either export keeps every non-extension sequence managed.
        if not scope_uncertain and users and users.issubset(runtime):
            site["sequences"].append(row)
        else:
            sequences.append(row)
            if users & runtime and users - runtime:
                conflicts.append({"category": "sequences", "name": row["name"],
                                  "managed_tables": sorted(users - runtime), "site_owned_tables": sorted(users & runtime)})
    for row in catalogue["functions"]:
        if row["extension"]:
            continue
        if row["name"] not in managed_functions and row["tables"] and set(row["tables"]).issubset(excluded):
            if set(row["tables"]) & runtime:
                site["functions"].append(row)
        else:
            functions.append(row)
    extension_schemas = {row["schema"] for row in catalogue["extensions"] if row.get("schema") != "public"}
    # A relocated extension schema is environment; user objects sharing it still count.
    managed_schemas = {name.split(".", 1)[0] for name in managed}
    schemas = [row for row in catalogue["schemas"] if row["name"] not in extension_schemas or row["name"] in managed_schemas]
    return {"tables": tables, "sequences": sequences, "functions": functions, "schemas": schemas,
            "default_privileges": catalogue["default_privileges"]}, site, conflicts


def table_differences(wanted, actual, annotations):
    if wanted is None or actual is None:
        return [{"path": "table", "expected": wanted, "observed": actual}]
    result = []
    wanted, actual = deepcopy(wanted), deepcopy(actual)
    # Physical order is captured separately; compare column definitions by name.
    # Removing only position preserves type/default/nullability/etc. changes.
    for row in (wanted, actual):
        for col in row["columns"]:
            col.pop("position")
    equivalent = table_views_unique_equivalence(wanted, actual)
    if equivalent:
        annotations["equivalences"].append(equivalent)
    for key in sorted(set(wanted) | set(actual)):
        if key in {"constraints", "indexes"}:
            changes, renames, equivalents = named_definition_findings(wanted["name"], key, wanted[key], actual[key], differences)
            result.extend(changes)
            annotations["renamed"].extend(renames)
            annotations["equivalences"].extend(equivalents)
        elif key in {"columns", "triggers", "policies"}:
            result.extend(named_differences(wanted[key], actual[key], key))
        else:
            result.extend(differences(wanted.get(key), actual.get(key), key))
    return result


def object_differences(wanted, actual, path="", *, table=False, annotations=None):
    """Compare structure, owners and ACLs independently, including missing objects.

    Removing a column/table is structural; its nonempty grants are also access
    evidence. Keep owners/ACLs out of structural blobs so the summary and counts
    never hide privilege-only differences inside an added or removed definition.
    """
    def structure(value):
        if isinstance(value, dict):
            return {key: structure(item) for key, item in value.items() if key not in {"owner", "privileges", "tables"}}
        if isinstance(value, list):
            return [structure(item) for item in value]
        return value
    if annotations is None:
        annotations = {"renamed": [], "equivalences": []}
    structural = (table_differences(structure(wanted), structure(actual), annotations) if table else
                  differences(structure(wanted), structure(actual), path))
    changes = [{**change, "category": "structural"} for change in structural]
    prefix = path + "." if path else ""
    owner = differences(wanted["owner"] if wanted else None, actual["owner"] if actual else None, prefix + "owner")
    changes += [{**change, "category": "ownership"} for change in owner]
    def acl_fields(obj):
        if not obj:
            return {}
        fields = {prefix + "privileges": obj["privileges"]}
        if table:
            fields.update({f"columns.{col['name']}.privileges": col["privileges"] for col in obj["columns"]})
        return fields
    expected_acls, observed_acls = acl_fields(wanted), acl_fields(actual)
    for field in sorted(expected_acls.keys() | observed_acls.keys()):
        changes += [{**change, "category": "privileges"} for change in
                    differences(expected_acls.get(field, []), observed_acls.get(field, []), field)]
    return changes


def structural_state(wanted, actual, changes):
    if wanted is None:
        return "extra"
    if actual is None:
        return "missing"
    return "changed" if any(change["category"] == "structural" for change in changes) else "matched"


def count_categories(report):
    """Count each object's own findings once; dependency references never count."""
    for row in report["tables"] + report["managed_objects"]:
        is_table = "category" not in row
        for category, counts in report["category_counts"].items():
            found = sum(change["category"] == category for change in row["differences"])
            if found:
                counts["objects"] += 1
                counts["differences"] += found
                counts["tables"] += int(is_table)
        if is_table:
            report["structural_table_counts"][row["structural_state"]] += 1


def cannot_compare(report, error, reference=None):
    report["verdict"] = "could_not_compare"
    report["errors"].append(str(error))
    if not report["tables"] and isinstance(reference, dict) and isinstance(reference.get("tables"), list):
        report["tables"] = [{"name": row["name"], "verdict": "could_not_compare", "differences": []}
                            for row in reference["tables"] if isinstance(row, dict) and row.get("name") and not row.get("extension")]
    for row in report["tables"]:
        row["verdict"] = "could_not_compare"
    report["counts"] = {"matched": 0, "drift": 0, "could_not_compare": len(report["tables"])}
    return report, 2


def compare_catalogues(installation, reference, *, installation_roles=None, reference_roles=None):
    """Compare complete saved catalogues; callers validate fresh provenance separately."""
    report = new_report()
    try:
        validate_catalogue(installation)
        validate_catalogue(reference)
        if installation["db_version"] != reference["db_version"]:
            raise CatalogueError("Installation and reference database versions differ; select the matching supported bootstrap")
        report["db_version"] = installation["db_version"]
        report["inputs"] = {"hash_algorithm": "sha256:canonical-json-v1",
                            "installation": hashlib.sha256(canonical(installation).encode()).hexdigest(),
                            "reference": hashlib.sha256(canonical(reference).encode()).hexdigest()}
        wanted = normalize_catalogue(reference, reference_roles)
        actual = normalize_catalogue(installation, installation_roles)
        managed = {row["name"] for row in wanted["tables"] if not row["extension"]}
        reference_registry = {row["name"] for row in wanted["metadata"]["datasets"]}
        managed_functions = {row["name"] for row in wanted["functions"] if not row["extension"]}
        wanted_scope = sequence_tables(reference, managed, reference_registry)
        actual_scope = sequence_tables(installation, managed, reference_registry)
        scope_uncertain = bool(wanted_scope[1] or actual_scope[1])
        wanted, _, conflicts = partition_catalogue(wanted, managed, reference_registry, managed_functions,
                                                  wanted_scope, scope_uncertain)
        report["scope_conflicts"] += [{"catalogue": "reference", **row} for row in conflicts]
        actual, report["site_owned"], conflicts = partition_catalogue(actual, managed, reference_registry, managed_functions,
                                                                     actual_scope, scope_uncertain)
        report["scope_conflicts"] += [{"catalogue": "installation", **row} for row in conflicts]
        report["extensions"] = {
            "installation": {"packages": deepcopy(installation["extensions"]), "objects": deepcopy(installation["extension_objects"])},
            "reference": {"packages": deepcopy(reference["extensions"]), "objects": deepcopy(reference["extension_objects"])}}
        wanted_tables = {row["name"]: row for row in wanted["tables"]}
        actual_tables = {row["name"]: row for row in actual["tables"]}
        verdicts = {}
        for name in sorted(set(wanted_tables) | set(actual_tables)):
            expected, observed = wanted_tables.get(name), actual_tables.get(name)
            if expected and observed:
                order = differences([col["name"] for col in expected["columns"]],
                                    [col["name"] for col in observed["columns"]], "column_order")
                report["column_order"] += [{"table": name, "expected": row["expected"], "observed": row["observed"]} for row in order]
            changes = object_differences(expected, observed, table=True, annotations=report)
            state = structural_state(expected, observed, changes)
            verdicts[name] = {"name": name, "verdict": "drift" if changes else "matched", "differences": changes,
                              "structural_state": state, "structural_verdict": "matched" if state == "matched" else "drift",
                              "related_drift": {label: [] for label in ("schemas", "functions", "sequences")}}
        for category in ("sequences", "functions", "schemas"):
            expected_objects = {row["name"]: row for row in wanted[category]}
            observed_objects = {row["name"]: row for row in actual[category]}
            for name in sorted(set(expected_objects) | set(observed_objects)):
                expected, observed = expected_objects.get(name), observed_objects.get(name)
                changes = object_differences(expected, observed, f"{category}.{name}")
                if not changes:
                    continue
                report["managed_objects"].append({"category": category, "name": name, "differences": changes})
                attached = set()
                for obj in (expected, observed):
                    if obj:
                        if category in {"sequences", "functions"}:
                            attached.update(obj["tables"])
                        elif category == "schemas":
                            attached.update(t for t in verdicts if t.split(".", 1)[0] == name)
                for table_name in attached & verdicts.keys():
                    # A shared object's definition belongs to its own finding.
                    # References help batch 2 navigate without contaminating a table's verdict.
                    verdicts[table_name]["related_drift"][category].append(name)
        defaults = differences(wanted["default_privileges"], actual["default_privileges"], "default_privileges")
        if defaults:
            report["managed_objects"].append({"category": "default_privileges", "name": "default_privileges",
                                              "differences": [{**change, "category": "privileges"} for change in defaults]})
        report["tables"] = list(verdicts.values())
        count_categories(report)
        report["counts"] = {"matched": sum(row["verdict"] == "matched" for row in report["tables"]),
                            "drift": sum(row["verdict"] == "drift" for row in report["tables"]), "could_not_compare": 0}
        drift_found = bool(report["counts"]["drift"] or report["managed_objects"] or report["scope_conflicts"])
        report["verdict"] = "managed_drift" if drift_found else "no_managed_drift"
        return report, int(drift_found)
    except (CatalogueError, KeyError, TypeError, ValueError) as error:
        return cannot_compare(report, error, reference)


def check_exports(installation, reference, reference_root, **options):
    """Operator boundary: a pass always requires both provenance and schema evidence."""
    progress = new_report()
    step = 0
    try:
        validate_catalogue(installation)
        validate_catalogue(reference)
        if installation["db_version"] != reference["db_version"]:
            raise CatalogueError("Installation and reference database versions differ")
        progress["steps"][0]["result"] = "succeeded"
        step = 1
        provenance = verify_reference(reference, reference_root)
        progress["steps"][1]["result"] = "succeeded"
    except (CatalogueError, OSError, KeyError, TypeError, ValueError) as error:
        progress["steps"][step]["result"] = "failed"
        return cannot_compare(progress, error, reference)
    report, status = compare_catalogues(installation, reference, **options)
    report["reference"] = provenance
    report["steps"] = progress["steps"]
    report["steps"][2]["result"] = "failed" if status == 2 else "succeeded"
    return report, status


def render_summary(report):
    """Show structural findings first; print every owner/ACL/global difference once."""
    lines = [f"Schema drift: {report['verdict']}", f"Database version: {report['db_version'] or 'unknown'}"]
    compared = report["verdict"] != "could_not_compare"
    if compared:
        totals = report["structural_table_counts"]
        lines.append("Structural table inventory: " + ", ".join(f"{count} {label}" for label, count in totals.items()) + ".")
        lines.append("Counts below measure differing objects and difference entries; categories can overlap.")
        for label, counts in report["category_counts"].items():
            lines.append(f"{label.capitalize()}: {counts['objects']} objects ({counts['tables']} tables), {counts['differences']} differences.")
        lines.append(f"Information: {len(report['renamed'])} renamed (same definition), "
                     f"{len(report['equivalences'])} reviewed equivalences, {len(report['column_order'])} column-order differences.")
        lines.append(f"Sequence scope conflicts: {len(report['scope_conflicts'])} (affect the overall verdict).")
    else:
        lines.append("Structural, ownership and privilege counts unavailable: comparison did not finish.")
    lines.append(f"Managed tables (all categories): {report['counts']['matched']} matched, {report['counts']['drift']} drift, "
                 f"{report['counts']['could_not_compare']} could not compare.")
    lines += [f"{step['number']}/3 {step['name']}: {step['result']}" for step in report["steps"]]
    def short_value(value):
        text = canonical(value)
        return text if len(text) <= 240 else text[:237] + "... (full value in JSON)"
    def show_changes(changes, category):
        for change in changes:
            if change["category"] == category:
                lines.append(f"  - {change['path']}: expected {short_value(change['expected'])}; observed {short_value(change['observed'])}")
    lines += ["", "## Structural tables", ""]
    for row in report["tables"]:
        lines.append(f"- {row['name']}: {row['verdict']}; structure {row.get('structural_state', 'could_not_compare')}")
        show_changes(row["differences"], "structural")
        for category, names in row.get("related_drift", {}).items():
            if names:
                lines.append(f"  - Related {category} with drift: {', '.join(names)} (see separate findings)")
    for category in ("schemas", "functions", "sequences"):
        lines += ["", f"## {category.capitalize()}", ""]
        objects = [row for row in report["managed_objects"] if row["category"] == category]
        for row in objects:
            labels = sorted({change["category"] for change in row["differences"]})
            lines.append(f"- {row['name']}: {', '.join(labels)} drift")
            show_changes(row["differences"], "structural")
        if not objects:
            lines.append("No differences." if compared else "Not compared.")
    for category in ("ownership", "privileges"):
        lines += ["", f"## {category.capitalize()}", ""]
        found = False
        for row in report["tables"] + report["managed_objects"]:
            if any(change["category"] == category for change in row["differences"]):
                found = True
                lines.append(f"- {row.get('category', 'tables')}.{row['name']}")
                show_changes(row["differences"], category)
        if not found:
            lines.append("No differences." if compared else "Not compared.")
    lines += ["", "## Renamed (same definition)", ""]
    for row in report["renamed"]:
        lines.append(f"- {row['table']} {row['object_type']}: expected {row['expected_name']}; observed {row['observed_name']}")
    if not report["renamed"]:
        lines.append("No renames." if compared else "Not compared.")
    lines += ["", "## Reviewed equivalences", ""]
    for row in report["equivalences"]:
        lines.append(f"- {row['table']} {row['object_type']}: {row['rule']}")
        lines.append(f"  - Expected {short_value(row['expected'])}; observed {short_value(row['observed'])}")
    if not report["equivalences"]:
        lines.append("No reviewed equivalences." if compared else "Not compared.")
    lines += ["", "## Physical column order (informational)", ""]
    for row in report["column_order"]:
        lines.append(f"- {row['table']}: expected {canonical(row['expected'])}; observed {canonical(row['observed'])}")
    if not report["column_order"]:
        lines.append("No order differences." if compared else "Not compared.")
    lines += ["", "## Sequence scope conflicts", ""]
    for row in report["scope_conflicts"]:
        if row.get("reason") == "unresolved sequence reference":
            lines.append(f"- {row['catalogue']} unresolved sequence reference: {row['table']}.{row['column']}")
        else:
            lines.append(f"- {row['catalogue']} {row['name']}: managed tables {', '.join(row['managed_tables'])}; "
                         f"site-owned tables {', '.join(row['site_owned_tables'])}")
    if not report["scope_conflicts"]:
        lines.append("No conflicts." if compared else "Not compared.")
    site = report["site_owned"]
    lines += ["", "## Site-owned datasets", ""]
    lines.append(f"Site-owned datasets: {len(site.get('tables', []))} (excluded from drift)")
    for row in site.get("tables", []):
        lines.append(f"- {row['name']}: site_owned ({site['classification'][row['name']]})")
    if site:
        lines.append(f"Site-owned attachments: {len(site['sequences'])} sequences, {len(site['functions'])} functions; "
                     + ", ".join(f"{len(rows)} {label}" for label, rows in sorted(site['metadata'].items())))
    lines += ["", "## Extensions", ""]
    for label, data in report["extensions"].items():
        lines.append(f"Extensions ({label}): {len(data['packages'])} packages, {len(data['objects'])} member objects (reported separately)")
        lines += [f"- {package['name']}: version {package.get('version', 'unknown')}, schema {package.get('schema', 'unknown')}"
                  for package in data["packages"]]
    for error in report["errors"]:
        lines.append(f"Could not compare: {error}")
    return "\n".join(lines) + "\n"


def role_mapping(entries):
    result = {}
    for entry in entries:
        if "=" not in entry:
            raise CatalogueError("Role mappings use physical_role=logical_role")
        actual, logical = entry.split("=", 1)
        if not actual or not logical or actual in result:
            raise CatalogueError("Role mappings must have distinct nonempty physical roles")
        result[actual] = logical
    return result


class ReportParser(argparse.ArgumentParser):
    def error(self, message):
        raise CatalogueError(message)


def same_file(first, second):
    """Whether two paths reach one file: the same resolved path, or existing hard links to one inode."""
    try:
        if first.resolve() == second.resolve():
            return True
        return first.exists() and second.exists() and os.path.samefile(first, second)
    except OSError:
        return True  # Identity unknown: treat as the same file rather than risk overwriting evidence.


def main(argv=None):
    parser = ReportParser(description=__doc__)
    parser.add_argument("--installation", required=True, type=Path, help="Saved read-only catalogue JSON from ./db")
    parser.add_argument("--reference", required=True, type=Path, help="Saved complete fresh-install catalogue JSON")
    parser.add_argument("--reference-root", type=Path, default=Path(__file__).resolve().parents[3],
                        help="Checkout whose bootstrap built the reference; must have the recorded DB version")
    parser.add_argument("--installation-role", action="append", default=[], metavar="ACTUAL=LOGICAL")
    parser.add_argument("--reference-role", action="append", default=[], metavar="ACTUAL=LOGICAL")
    parser.add_argument("--json-output", type=Path, help="Report file; otherwise JSON goes to stdout")
    parser.add_argument("--summary-output", type=Path, help="Readable report file; otherwise summary goes to stderr")
    args = None
    inputs = []
    reference_catalogue = None
    try:
        args = parser.parse_args(argv)
        inputs = [args.installation, args.reference]
        destinations = [path for path in (args.json_output, args.summary_output) if path]
        clash = (len(destinations) == 2 and same_file(*destinations)) \
            or any(same_file(destination, source) for destination in destinations for source in inputs)
        if clash:
            args.json_output = args.summary_output = None
            raise CatalogueError("Report destinations must be distinct from each other and from exports")
        reference_catalogue = read_catalogue(args.reference)
        report, status = check_exports(read_catalogue(args.installation), reference_catalogue, args.reference_root,
                                      installation_roles=role_mapping(args.installation_role),
                                      reference_roles=role_mapping(args.reference_role))
    except (CatalogueError, OSError, ValueError, TypeError, RecursionError) as error:
        report, status = cannot_compare(new_report(), error, reference_catalogue)
        report["steps"][0]["result"] = "failed"
    json_text = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    summary = render_summary(report)
    try:
        # Files are the only writes this command performs; no database library,
        # connection, subprocess, migration or repair path exists here.
        if args and args.json_output and not any(same_file(args.json_output, source) for source in inputs):
            args.json_output.write_text(json_text)
        else:
            sys.stdout.write(json_text)
        if args and args.summary_output and not any(same_file(args.summary_output, source) for source in inputs):
            args.summary_output.write_text(summary)
        else:
            sys.stderr.write(summary)
    except OSError as error:
        sys.stderr.write(f"Could not write schema drift report: {error}\n")
        return 2
    return status


if __name__ == "__main__":
    raise SystemExit(main())
