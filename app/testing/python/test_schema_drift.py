"""test_schema_drift.py
Verify read-only installation comparisons and their evidence boundaries.
Connect catalogue exports, matching bootstrap provenance and per-table verdicts.
Prevent incomplete snapshots, runtime datasets or extension objects from false drift.
"""
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

import pytest

APP = Path(__file__).resolve().parents[2]
TOOLS = APP / "server_tools/installation_conformance"


def drift_module():
    # Import inside checks so the pre-change run records individual failures.
    from server_tools.installation_conformance import schema_drift
    return schema_drift


def grant(role="site_reader", privilege="SELECT"):
    return {"grantee": role, "grantor": "site_owner", "privilege": privilege, "grantable": False}


def column(name, position, data_type="text"):
    return {"name": name, "position": position, "type": data_type, "not_null": False,
            "default": None, "identity": "", "generated": "", "collation": None,
            "privileges": []}


def table(name="public.system_example"):
    return {"name": name, "kind": "r", "owner": "site_owner", "extension": None,
            "columns": [column("id", 1, "bigint"), column("title", 2)],
            "constraints": [], "indexes": [], "triggers": [], "policies": [],
            "rls_enabled": False, "rls_forced": False, "privileges": [grant()],
            "definition": None, "partition_key": None, "partition_bound": None,
            "parents": [], "replica_identity": "d"}


def snapshot(version="9.11.0"):
    return {"format_version": 1, "export_type": "filterest_schema_catalogue",
            "db_version": version, "database": "site_database", "server_version": "160011",
            "tables": [table()], "sequences": [], "functions": [],
            "schemas": [{"name": "public", "owner": "site_owner", "privileges": [grant()]}],
            "default_privileges": [], "extensions": [], "extension_objects": [],
            "metadata": {"datasets": [], "columns": [], "aliases": [],
                         "relations_1_m": [], "relations_m_m": []}, "ledger": []}


def compare(site, reference=None, **options):
    return drift_module().compare_catalogues(site, reference or snapshot(), **options)


def test_identical_schema_requires_physical_comparison():
    report, status = compare(snapshot())
    assert status == 0
    assert report["verdict"] == "no_managed_drift"
    assert report["tables"][0]["verdict"] == "matched"
    assert report["tables"][0]["differences"] == []


@pytest.mark.parametrize("change,path", [
    (lambda t: t["columns"].pop(), "columns.title"),
    (lambda t: t["columns"].append(column("extra", 3)), "columns.extra"),
    (lambda t: t["columns"][1].update(type="bigint"), "columns.title.type"),
    (lambda t: t["columns"][1].update(default="'new'::text"), "columns.title.default"),
    (lambda t: t["columns"][1].update(not_null=True), "columns.title.not_null"),
    (lambda t: t["columns"][0].update(identity="a"), "columns.id.identity"),
    (lambda t: t["columns"][1].update(generated="s"), "columns.title.generated"),
    (lambda t: t["columns"][1].update(collation="public.custom"), "columns.title.collation"),
    (lambda t: t["constraints"].append({"name": "pk", "definition": "PRIMARY KEY (id)",
                                       "validated": True}), "constraints.pk"),
    (lambda t: t["indexes"].append({"name": "public.title_idx", "definition": "CREATE INDEX title_idx ON public.system_example USING btree (title)",
                                   "valid": True, "ready": True, "clustered": False,
                                   "replica_identity": False}), "indexes.public.title_idx"),
    (lambda t: t["triggers"].append({"name": "touch", "definition": "BEFORE UPDATE EXECUTE FUNCTION public.touch()",
                                    "enabled": "O", "function": "public.touch()"}), "triggers.touch"),
    (lambda t: t.update(rls_enabled=True), "rls_enabled"),
    (lambda t: t.update(rls_forced=True), "rls_forced"),
    (lambda t: t["policies"].append({"name": "read", "command": "r", "permissive": True,
                                    "roles": ["PUBLIC"], "using": "true", "check": None}), "policies.read"),
    (lambda t: t.update(privileges=[]), "privileges"),
])
def test_managed_change_is_drift_even_when_version_is_equal(change, path):
    site = snapshot()
    change(site["tables"][0])
    report, status = compare(site)
    assert status == 1
    assert report["verdict"] == "managed_drift"
    assert any(d["path"] == path for d in report["tables"][0]["differences"])


@pytest.mark.parametrize("category,before,after", [
    ("constraints", {"name": "fk", "definition": "FOREIGN KEY (id) REFERENCES public.system_users(id) ON DELETE RESTRICT", "validated": True},
     {"name": "fk", "definition": "FOREIGN KEY (id) REFERENCES public.system_users(id) ON DELETE CASCADE", "validated": True}),
    ("triggers", {"name": "touch", "definition": "BEFORE UPDATE", "enabled": "O", "function": "public.touch()"},
     {"name": "touch", "definition": "AFTER UPDATE", "enabled": "D", "function": "public.touch()"}),
])
def test_changed_constraint_delete_rule_and_trigger_state(category, before, after):
    reference = snapshot()
    reference["tables"][0][category] = [before]
    site = deepcopy(reference)
    site["tables"][0][category] = [after]
    assert compare(site, reference)[1] == 1


def test_shared_function_drift_is_reported_once_without_changing_table_verdicts():
    reference = snapshot()
    reference["functions"] = [{"name": "public.touch()", "owner": "site_owner", "extension": None,
                               "definition": "CREATE FUNCTION public.touch() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$",
                               "privileges": [], "tables": ["public.system_example"]}]
    site = deepcopy(reference)
    site["functions"][0]["definition"] = site["functions"][0]["definition"].replace("RETURN NEW", "RETURN OLD")
    report, status = compare(site, reference)
    assert status == 1
    assert report["tables"][0]["verdict"] == "matched"
    assert report["tables"][0]["differences"] == []
    assert report["tables"][0]["related_drift"]["functions"] == ["public.touch()"]
    assert len(report["managed_objects"]) == 1
    summary = drift_module().render_summary(report)
    assert "## Functions" in summary
    assert summary.count("functions.public.touch().definition:") == 1


def test_schema_owner_and_grants_are_global_and_summary_categories_are_separate():
    site = snapshot()
    site["schemas"][0].update(owner="postgres", privileges=[])
    report, status = compare(site)
    assert status == 1
    assert report["tables"][0]["verdict"] == "matched"
    assert report["tables"][0]["differences"] == []
    assert report["tables"][0]["related_drift"]["schemas"] == ["public"]
    assert report["category_counts"] == {
        "structural": {"objects": 0, "differences": 0, "tables": 0},
        "ownership": {"objects": 1, "differences": 1, "tables": 0},
        "privileges": {"objects": 1, "differences": 1, "tables": 0}}
    summary = drift_module().render_summary(report)
    assert summary.count("schemas.public.owner:") == 1
    assert summary.count("schemas.public.privileges:") == 1
    assert summary.index("## Structural tables") < summary.index("## Ownership") < summary.index("## Privileges")
    assert summary.index("Structural table inventory:") < summary.index("Ownership:") < summary.index("Privileges:")


def test_table_structure_can_match_while_its_own_owner_and_column_grants_drift():
    site = snapshot()
    site["tables"][0]["owner"] = "postgres"
    site["tables"][0]["columns"][1]["privileges"] = [grant()]
    report, status = compare(site)
    assert status == 1
    row = report["tables"][0]
    assert row["verdict"] == "drift"
    assert row["structural_verdict"] == "matched"
    assert {d["category"] for d in row["differences"]} == {"ownership", "privileges"}
    assert report["structural_table_counts"] == {"matched": 1, "changed": 0, "extra": 0, "missing": 0}


def test_owned_sequence_drift_is_reported_once_and_only_referenced_by_table():
    reference = snapshot()
    reference["sequences"] = [sequence()]
    site = deepcopy(reference)
    site["sequences"][0]["increment"] = 2
    report, status = compare(site, reference)
    assert status == 1
    assert report["tables"][0]["verdict"] == "matched"
    assert report["tables"][0]["related_drift"]["sequences"] == ["sequence:public.system_example.id"]
    assert report["category_counts"]["structural"] == {"objects": 1, "differences": 1, "tables": 0}


def test_runtime_datasets_and_metadata_are_site_owned():
    site = snapshot()
    site["tables"].append(table("public.app_people"))
    site["metadata"]["datasets"] = [{"name": "public.app_people", "table_uid": 20000}]
    site["metadata"]["columns"] = [{"table_uid": 20000, "column_name": "title", "co_number": 1}]
    site["metadata"]["aliases"] = [{"table_uid": 20000, "alias_slug": "people"}]
    site["metadata"]["relations_1_m"] = [{"source_table_uid": 20000, "target_table_uid": 10}]
    site["metadata"]["relations_m_m"] = [{"table_a_uid": 20000, "table_b_uid": 10}]
    site["functions"] = [{"name": "public.dynamic_touch()", "owner": "site_owner", "extension": None,
                          "definition": "a site trigger body", "privileges": [], "tables": ["public.app_people"]}]
    report, status = compare(site)
    assert status == 0
    owned = report["site_owned"]
    assert owned["tables"][0]["name"] == "public.app_people"
    assert len(owned["metadata"]["columns"]) == 1
    assert len(owned["metadata"]["relations_1_m"]) == 1
    assert len(owned["metadata"]["relations_m_m"]) == 1
    assert len(owned["functions"]) == 1


def test_registry_recognizes_nonprefix_site_datasets_and_retains_unknown_extras():
    site = snapshot()
    site["tables"] += [table("public.travel_deals"), table("public.test_perm_assets"),
                       table("public.unregistered_extra"), table("public.app_unregistered")]
    site["metadata"]["datasets"] = [{"name": "public.travel_deals", "table_uid": 20000},
                                     {"name": "public.test_perm_assets", "table_uid": 20001}]
    site["metadata"]["aliases"] = [{"table_uid": 20000, "alias_slug": "deals"}]
    site["sequences"] = [{**sequence(), "name": "public.travel_deals_id_seq", "table": "public.travel_deals"}]
    report, status = compare(site)
    assert status == 1
    assert {t["name"] for t in report["site_owned"]["tables"]} == {"public.travel_deals", "public.test_perm_assets"}
    assert {t["name"] for t in report["tables"] if t["verdict"] == "drift"} == {
        "public.unregistered_extra", "public.app_unregistered"}
    assert len(report["site_owned"]["sequences"]) == 1
    assert len(report["site_owned"]["metadata"]["aliases"]) == 1
    assert set(report["site_owned"]["classification"].values()) == {"dataset_registry"}


def test_prefix_is_only_a_fallback_when_the_export_has_no_registry_entries():
    site = snapshot()
    site["tables"].append(table("public.app_people"))
    report, status = compare(site)
    assert status == 0
    assert report["site_owned"]["classification"] == {"public.app_people": "app_prefix_fallback"}


def test_reference_seed_registration_never_becomes_site_owned():
    reference = snapshot()
    reference["metadata"]["datasets"] = [{"name": "public.app_seeded", "table_uid": 30}]
    site = deepcopy(reference)
    site["tables"].append(table("public.app_seeded"))
    report, status = compare(site, reference)
    assert status == 1
    assert report["site_owned"]["tables"] == []
    assert next(t for t in report["tables"] if t["name"] == "public.app_seeded")["verdict"] == "drift"


def test_reference_function_stays_managed_when_its_only_attachment_is_site_owned():
    reference = snapshot()
    reference["functions"] = [{"name": "public.touch()", "owner": "site_owner", "extension": None,
                               "definition": "a platform function body", "privileges": [], "tables": []}]
    site = deepcopy(reference)
    site["tables"].append(table("public.travel_deals"))
    site["metadata"]["datasets"] = [{"name": "public.travel_deals", "table_uid": 20000}]
    site["functions"][0]["tables"] = ["public.travel_deals"]
    assert compare(site, reference)[1] == 0
    site["functions"][0]["definition"] = "a changed platform body"
    report, status = compare(site, reference)
    assert status == 1
    assert report["site_owned"]["functions"] == []
    assert report["managed_objects"][0]["name"] == "public.touch()"


def test_missing_table_and_column_have_structural_and_access_findings():
    reference = snapshot()
    reference["tables"].append(table("public.system_missing"))
    site = snapshot()
    site["tables"][0]["columns"].append({**column("secret", 3), "privileges": [grant()]})
    report, status = compare(site, reference)
    assert status == 1
    missing = next(t for t in report["tables"] if t["name"] == "public.system_missing")
    assert missing["structural_state"] == "missing"
    assert {d["category"] for d in missing["differences"]} == {"structural", "ownership", "privileges"}
    assert "owner" not in missing["differences"][0]["expected"]
    assert "privileges" not in missing["differences"][0]["expected"]["columns"][0]
    assert report["structural_table_counts"] == {"matched": 0, "changed": 1, "extra": 0, "missing": 1}


@pytest.mark.parametrize("registry", [[{}], [{"name": "public.extra"}],
                                      [{"name": "", "table_uid": 10}]])
def test_invalid_dataset_registry_cannot_trigger_a_prefix_exemption(registry):
    site = snapshot()
    site["metadata"]["datasets"] = registry
    assert compare(site)[1] == 2


def test_bootstrap_app_table_is_managed_and_unknown_system_table_is_drift():
    reference = snapshot()
    reference["tables"].append(table("public.app_service_catalog"))
    site = deepcopy(reference)
    site["tables"][1]["columns"].pop()
    site["tables"].append(table("public.system_unexplained"))
    report, status = compare(site, reference)
    assert status == 1
    assert {t["name"] for t in report["tables"] if t["verdict"] == "drift"} == {
        "public.app_service_catalog", "public.system_unexplained"}


def test_extensions_and_their_member_tables_and_functions_are_separate():
    site = snapshot()
    site["extensions"] = [{"name": "postgis", "schema": "postgis", "version": "3.4.0"}]
    site["extension_objects"] = [{"extension": "postgis", "type": "table", "identity": "postgis.spatial_ref_sys"}]
    member = table("postgis.spatial_ref_sys")
    member["extension"] = "postgis"
    site["tables"].append(member)
    site["functions"] = [{"name": "postgis.ST_X(geometry)", "owner": "site_owner", "extension": "postgis",
                          "definition": "extension implementation", "privileges": [], "tables": []}]
    report, status = compare(site)
    assert status == 0
    assert report["extensions"]["installation"]["objects"] == site["extension_objects"]


def test_relocated_extension_type_normalizes_but_typmod_changes_still_count():
    reference = snapshot()
    reference["extensions"] = [{"name": "postgis", "schema": "postgis", "version": "3.4"}]
    reference["extension_objects"] = [{"extension": "postgis", "type": "type", "identity": "postgis.geometry"}]
    reference["tables"][0]["columns"][1]["type"] = "postgis.geometry(Point,4326)"
    site = deepcopy(reference)
    site["extensions"][0]["schema"] = "geo"
    site["extension_objects"][0]["identity"] = "geo.geometry"
    site["tables"][0]["columns"][1]["type"] = "geo.geometry(Point,4326)"
    assert compare(site, reference)[1] == 0
    site["tables"][0]["columns"][1]["type"] = "geo.geometry(Point,3857)"
    assert compare(site, reference)[1] == 1


def test_unattached_function_and_default_privilege_drift_changes_the_overall_verdict():
    site = snapshot()
    site["functions"] = [{"name": "public.platform_helper()", "owner": "site_owner", "extension": None,
                          "definition": "a platform function body", "privileges": [], "tables": []}]
    site["default_privileges"] = [{"owner": "site_owner", "schema": "public", "kind": "r", "privileges": [grant()]}]
    report, status = compare(site)
    assert status == 1
    assert report["tables"][0]["verdict"] == "matched"
    assert {obj["category"] for obj in report["managed_objects"]} == {"functions", "default_privileges"}


def test_environment_roles_and_unused_column_positions_normalize_without_hiding_defaults():
    site = snapshot()
    site["database"] = "another_database"
    site["tables"][0]["owner"] = "another_owner"
    site["tables"][0]["privileges"] = [{**grant("another_reader"), "grantor": "another_owner"}]
    site["schemas"][0]["owner"] = "another_owner"
    site["schemas"][0]["privileges"] = [{**grant("another_reader"), "grantor": "another_owner"}]
    site["tables"][0]["columns"][1]["position"] = 5  # dropped physical slots are not live order
    report, status = compare(site, installation_roles={"another_owner": "owner", "another_reader": "reader"},
                             reference_roles={"site_owner": "owner", "site_reader": "reader"})
    assert status == 0
    assert report["verdict"] == "no_managed_drift"
    site["tables"][0]["columns"][1]["default"] = "'another_database'::text"
    assert compare(site)[1] == 1  # literals must never be rewritten as environment names


def sequence(name="public.example_seq"):
    return {"name": name, "owner": "site_owner", "extension": None,
            "table": "public.system_example", "column": "id", "type": "bigint",
            "start": 1, "increment": 1, "minimum": 1, "maximum": 9223372036854775807,
            "cache": 1, "cycle": False, "privileges": []}


def test_sequence_values_and_environmental_names_normalize_but_definitions_do_not():
    reference = snapshot()
    reference["sequences"] = [sequence()]
    reference["tables"][0]["columns"][0]["default"] = "nextval('public.example_seq'::regclass)"
    site = deepcopy(reference)
    site["sequences"][0].update(name="public.local_seq", last_value=98765)
    site["tables"][0]["columns"][0]["default"] = "nextval('public.local_seq'::regclass)"
    assert compare(site, reference)[1] == 0
    for field, value in [("increment", 2), ("start", 10), ("cache", 20), ("cycle", True)]:
        changed = deepcopy(site)
        changed["sequences"][0][field] = value
        assert compare(changed, reference)[1] == 1


def test_missing_table_gets_its_own_verdict():
    reference = snapshot()
    reference["tables"].append(table("restricted.users_restricted"))
    report, status = compare(snapshot(), reference)
    assert status == 1
    assert next(t for t in report["tables"] if t["name"] == "restricted.users_restricted")["differences"][0]["path"] == "table"


@pytest.mark.parametrize("broken", [
    {}, {"format_version": 1}, {**snapshot(), "tables": []},
    {**snapshot(), "functions": None}, {**snapshot(), "db_version": "unknown"},
])
def test_incomplete_evidence_never_passes(broken):
    report, status = compare(broken)
    assert status == 2
    assert report["verdict"] == "could_not_compare"
    assert report["errors"]
    summary = drift_module().render_summary(report)
    assert "counts unavailable" in summary
    assert "No differences." not in summary


def test_mismatched_version_cannot_compare():
    report, status = compare(snapshot("9.7.13"))
    assert status == 2
    assert "version" in " ".join(report["errors"]).lower()


def test_matching_older_version_uses_its_reference_not_current_schema():
    old = snapshot("9.7.13")
    old["tables"][0]["columns"].pop()
    report, status = compare(deepcopy(old), old)
    assert status == 0
    assert report["db_version"] == "9.7.13"
    assert compare(old, snapshot())[1] == 2


def bootstrap_package(tmp_path, reference):
    root = tmp_path / "checkout"
    package = root / "app/server_tools/public_bootstrap"
    package.mkdir(parents=True)
    migration = root / "app/server_tools/migrations/20260101000001_example.sql"
    migration.parent.mkdir()
    migration.write_text("-- fixture migration\n")
    for filename in ("schema.sql", "seed_data.sql"):
        (package / filename).write_text("-- reviewed fixture input\n")
    (root / "app/VERSION_DB").write_text(reference["db_version"] + "\n")
    digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    manifest = {"artifact": "filterest-public-bootstrap", "db_version": reference["db_version"],
                "allowed_schema_tables": [t["name"] for t in reference["tables"] if t["kind"] in {"r", "p"}],
                "generated_files": {"server_tools/public_bootstrap/" + f: {"sha256": digest(package / f)}
                                    for f in ("schema.sql", "seed_data.sql")},
                "source_files": {"filterest/app/server_tools/migrations/" + migration.name: {"sha256": digest(migration)}},
                "migration_ledger_baseline": [migration.name]}
    (package / "manifest.json").write_text(json.dumps(manifest))
    reference["ledger"] = [{"filename": migration.name, "content_sha256": digest(migration),
                            "outcome": "bootstrap_baseline", "provenance": "bootstrap"}]
    return root


@pytest.mark.parametrize("version", ["9.11.0", "9.7.13"])
def test_cli_reads_existing_db_json_envelope_and_matching_bootstrap(tmp_path, version):
    reference = snapshot(version)
    root = bootstrap_package(tmp_path, reference)
    site_path, reference_path = tmp_path / "site.json", tmp_path / "fresh.json"
    site_path.write_text(json.dumps([{"schema_catalogue": snapshot(version)}]))
    reference_path.write_text(json.dumps(reference))
    output, summary = tmp_path / "report.json", tmp_path / "report.md"
    run = subprocess.run([sys.executable, str(TOOLS / "schema_drift.py"), "--installation", str(site_path),
                          "--reference", str(reference_path), "--reference-root", str(root),
                          "--json-output", str(output), "--summary-output", str(summary)], capture_output=True, text=True)
    assert run.returncode == 0, run.stderr
    assert json.loads(output.read_text())["verdict"] == "no_managed_drift"
    assert "public.system_example: matched" in summary.read_text()
    assert site_path.read_text() == json.dumps([{"schema_catalogue": snapshot(version)}])


def test_cli_distinguishes_drift_from_invalid_exports_with_per_table_verdicts(tmp_path):
    reference = snapshot()
    root = bootstrap_package(tmp_path, reference)
    site = snapshot()
    site["tables"][0]["columns"][1]["default"] = "'changed'::text"
    site_path, reference_path = tmp_path / "site.json", tmp_path / "fresh.json"
    site_path.write_text(json.dumps(site))
    reference_path.write_text(json.dumps(reference))
    command = [sys.executable, str(TOOLS / "schema_drift.py"), "--installation", str(site_path),
               "--reference", str(reference_path), "--reference-root", str(root)]
    run = subprocess.run(command, capture_output=True, text=True)
    assert run.returncode == 1
    assert json.loads(run.stdout)["verdict"] == "managed_drift"
    site_path.write_text('{"error":"export failed"}')
    run = subprocess.run(command, capture_output=True, text=True)
    assert run.returncode == 2
    report = json.loads(run.stdout)
    assert report["verdict"] == "could_not_compare"
    assert report["tables"][0]["verdict"] == "could_not_compare"


def test_reference_provenance_is_required_even_when_every_table_matches(tmp_path):
    reference = snapshot()
    root = bootstrap_package(tmp_path, reference)
    reference["ledger"][0]["outcome"] = "succeeded"
    report, status = drift_module().check_exports(snapshot(), reference, root)
    assert status == 2
    assert "bootstrap" in " ".join(report["errors"]).lower()


def test_reference_from_bootstrap_without_identity_still_refuses_an_extra_table(tmp_path):
    reference = snapshot()
    root = bootstrap_package(tmp_path, reference)
    reference["tables"].append(table("public.system_database_identity"))
    report, status = drift_module().check_exports(deepcopy(reference), reference, root)
    assert status == 2
    assert "inventory" in " ".join(report["errors"])


def test_bootstrap_views_are_compared_but_do_not_break_the_table_manifest(tmp_path):
    reference = snapshot()
    view = table("public.system_column_supported_views")
    view.update(kind="v", definition="SELECT 1 AS id")
    reference["tables"].append(view)
    root = bootstrap_package(tmp_path, reference)
    assert drift_module().check_exports(deepcopy(reference), reference, root)[1] == 0
    site = deepcopy(reference)
    site["tables"][1]["definition"] = "SELECT 2 AS id"
    report, status = drift_module().check_exports(site, reference, root)
    assert status == 1
    assert next(t for t in report["tables"] if t["name"] == "public.system_column_supported_views")["verdict"] == "drift"


def test_older_bootstrap_without_ledger_evidence_columns_can_compare(tmp_path):
    reference = snapshot("9.10.1")
    old_ledger = table("public.system_schema_migrations")
    old_ledger["columns"] = [column("filename", 1), column("applied_at", 2, "timestamp with time zone")]
    reference["tables"].append(old_ledger)
    root = bootstrap_package(tmp_path, reference)
    reference["ledger"][0].update(content_sha256=None, outcome=None, provenance=None)
    report, status = drift_module().check_exports(deepcopy(reference), reference, root)
    assert status == 0
    assert report["reference"]["ledger_evidence"] == "legacy_filename_baseline"
    reference["tables"][1]["columns"].append(column("content_sha256", 3))
    assert drift_module().check_exports(deepcopy(reference), reference, root)[1] == 2


@pytest.mark.parametrize("change", [
    lambda s: s["tables"].append(deepcopy(s["tables"][0])),
    lambda s: s["tables"][0]["columns"][1].update(position=1),
    lambda s: s["tables"][0].pop("policies"),
    lambda s: s["tables"][0]["columns"][0].pop("identity"),
    lambda s: s["tables"][0]["privileges"][0].pop("grantable"),
])
def test_partial_nested_evidence_is_unknown(change):
    site = snapshot()
    change(site)
    report, status = compare(site)
    assert status == 2
    assert all(t["verdict"] == "could_not_compare" for t in report["tables"])


def test_report_files_cannot_overwrite_an_export_or_each_other(tmp_path):
    export = tmp_path / "export.json"
    raw = json.dumps(snapshot())
    export.write_text(raw)
    result = subprocess.run([sys.executable, str(TOOLS / "schema_drift.py"), "--installation", str(export),
                             "--reference", str(export), "--json-output", str(export)], capture_output=True, text=True)
    assert result.returncode == 2
    assert export.read_text() == raw
    assert json.loads(result.stdout)["verdict"] == "could_not_compare"


@pytest.mark.parametrize("target", ["export", "report"])
def test_hard_links_cannot_turn_a_report_into_an_export_or_another_report(tmp_path, target):
    export = tmp_path / "export.json"
    raw = json.dumps(snapshot())
    export.write_text(raw)
    report = tmp_path / "report.json"
    report.write_text("kept")
    linked = tmp_path / "linked.json"
    os.link(export if target == "export" else report, linked)
    extra = ["--json-output", str(linked)] if target == "export" else ["--json-output", str(report), "--summary-output", str(linked)]
    result = subprocess.run([sys.executable, str(TOOLS / "schema_drift.py"), "--installation", str(export),
                             "--reference", str(export), *extra], capture_output=True, text=True)
    assert result.returncode == 2
    assert export.read_text() == raw and report.read_text() == "kept"
    assert json.loads(result.stdout)["verdict"] == "could_not_compare"


def test_reader_rejects_duplicate_json_keys_and_plain_schema_skeleton(tmp_path):
    export = tmp_path / "export.json"
    export.write_text('{"format_version": 1, "format_version": 2}')
    with pytest.raises(ValueError, match="Duplicate"):
        drift_module().read_catalogue(export)
    export.write_text("CREATE TABLE public.system_example (id bigint);")
    with pytest.raises(ValueError):
        drift_module().read_catalogue(export)


@pytest.mark.parametrize("change", [
    lambda s: s["extension_objects"].append("incomplete"),
    lambda s: s["tables"][0]["columns"][0].update(default=123),
    lambda s: s["tables"][0]["triggers"].append({"name": "broken", "definition": None, "enabled": "O", "function": "public.touch()"}),
])
def test_invalid_definition_shapes_cannot_crash_or_pass(change):
    site = snapshot()
    change(site)
    assert compare(site)[1] == 2


def test_role_mapping_cannot_collapse_an_existing_principal():
    site = snapshot()
    site["tables"][0]["privileges"].append(grant("other_reader"))
    assert compare(site, installation_roles={"other_reader": "site_reader"})[1] == 2


def test_export_sql_is_accepted_by_existing_read_only_guard():
    from server_tools.agent_tools.db import validate_readonly_query
    sql = (TOOLS / "schema_drift_export.sql").read_text()
    assert validate_readonly_query(sql) == (True, None)
    assert "pg_sequence" in sql
    assert "pg_get_functiondef" in sql
    assert "pg_policy" in sql
    assert "aclexplode" in sql


def test_every_acl_expansion_guards_empty_and_null_arrays_without_postgres():
    """Empty column/default/relation ACLs must take the NULL branch before expansion."""
    sql = (TOOLS / "schema_drift_export.sql").read_text()
    sql = re.sub(r"--[^\n]*", "", sql)
    calls = list(re.finditer(r"\baclexplode\s*\(", sql, re.I))
    assert calls, "The export must still include privilege evidence"
    guarded = re.compile(r"\s*CASE\s+WHEN\s+pg_catalog\.cardinality\(a\.acl\)\s*>\s*0\s+"
                         r"THEN\s+a\.acl\s+END\s*\)", re.I)
    for call in calls:
        assert guarded.match(sql, call.end()), "An empty ACL must never reach aclexplode"


def test_real_fresh_bootstrap_export_and_readonly_transaction(cluster, tmp_path):
    """Supervisor opt-in: exercise the actual catalogue query without a live site."""
    drift = drift_module()
    generated = subprocess.run([sys.executable, str(APP / "server_tools/public_bootstrap/generate_bootstrap.py"),
                                "--target", str(tmp_path)], capture_output=True, text=True)
    assert generated.returncode == 0, generated.stderr
    package = tmp_path / "app/server_tools/public_bootstrap"
    cluster("CREATE DATABASE schema_drift_fresh")
    for filename in ("schema.sql", "seed_data.sql"):
        cluster((package / filename).read_text(), "schema_drift_fresh")
    query = (TOOLS / "schema_drift_export.sql").read_text()
    exported = json.loads(cluster("BEGIN READ ONLY;\n" + query + "\nROLLBACK;", "schema_drift_fresh").stdout)
    # Compare to this checkout; the staged package is byte-identical.
    report, status = drift.check_exports(exported, deepcopy(exported), APP.parent)
    assert status == 0, report["errors"]
    assert len(report["tables"]) >= 90
    cluster("ALTER TABLE public.system_column_control ADD COLUMN unexpected text", "schema_drift_fresh")
    changed = json.loads(cluster("BEGIN READ ONLY;\n" + query + "\nROLLBACK;", "schema_drift_fresh").stdout)
    report, status = drift.check_exports(changed, exported, APP.parent)
    assert status == 1
    assert next(t for t in report["tables"] if t["name"] == "public.system_column_control")["verdict"] == "drift"
    cluster("CREATE TRIGGER builtin_touch BEFORE UPDATE ON public.system_column_control "
            "FOR EACH ROW EXECUTE FUNCTION pg_catalog.tsvector_update_trigger(search_vector_simple, 'pg_catalog.simple', unexpected)",
            "schema_drift_fresh")
    builtin_export = json.loads(cluster("BEGIN READ ONLY;\n" + query + "\nROLLBACK;", "schema_drift_fresh").stdout)
    control = next(t for t in builtin_export["tables"] if t["name"] == "public.system_column_control")
    assert any(t["name"] == "builtin_touch" and t["function"].startswith("pg_catalog.") for t in control["triggers"])


# The fixture creates only a disposable local cluster when explicitly enabled.
from row_actor_support_contracts import cluster  # noqa: E402, F401
