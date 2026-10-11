"""test_schema_drift_scope_equivalence.py
Verify sequence scope and reviewed definition/order equivalence in offline reports.
Connect small saved-schema fixtures with the reporter's managed verdict.
Keep near matches and substantive changes visible while removing false drift.
"""
from copy import deepcopy
import json
from pathlib import Path

import pytest

from test_schema_drift import compare, drift_module, sequence, snapshot, table

REVIEWED = json.loads((Path(__file__).parent / "fixtures/schema_drift_equivalences.json").read_text())


def index(name, table_name="public.system_example", expression="title"):
    return {"name": "public." + name,
            "definition": f"CREATE UNIQUE INDEX {name} ON {table_name} USING btree ({expression})",
            "valid": True, "ready": True, "clustered": False, "replica_identity": False}


@pytest.fixture
def site_sequence():
    reference = snapshot()
    site = deepcopy(reference)
    site["tables"].append(table("public.travel_deals"))
    site["metadata"]["datasets"] = [{"name": "public.travel_deals", "table_uid": 20000}]
    site["sequences"] = [{**sequence("public.travel_id_seq"), "table": None, "column": None}]
    site["tables"][1]["columns"][0]["default"] = "nextval('public.travel_id_seq'::regclass)"
    return site, reference


def test_unowned_sequence_used_only_by_site_defaults_is_site_owned(site_sequence):
    site, reference = site_sequence
    report, status = compare(site, reference)
    assert status == 0
    assert report["managed_objects"] == []
    assert report["site_owned"]["sequences"][0]["name"] == "public.travel_id_seq"
    assert report["site_owned"]["sequences"][0]["tables"] == ["public.travel_deals"]


@pytest.fixture
def shared_sequence(site_sequence):
    site, reference = site_sequence
    # The sequence itself matches: only its shared scope must force a conflict.
    reference["sequences"] = deepcopy(site["sequences"])
    for catalogue in (site, reference):
        catalogue["tables"][0]["columns"][0]["default"] = "nextval('public.travel_id_seq'::regclass)"
    return site, reference


def test_shared_sequence_reports_conflict_even_when_its_definition_matches(shared_sequence):
    site, reference = shared_sequence
    report, status = compare(site, reference)
    assert status == 1
    assert report["verdict"] == "managed_drift"
    assert report["site_owned"]["sequences"] == []
    assert report["managed_objects"] == []
    assert report["scope_conflicts"] == [{"catalogue": "installation", "category": "sequences",
        "name": "public.travel_id_seq", "managed_tables": ["public.system_example"],
        "site_owned_tables": ["public.travel_deals"]}]
    assert "## Sequence scope conflicts" in drift_module().render_summary(report)


def test_site_owned_sequence_owner_cannot_hide_a_managed_default(shared_sequence):
    site, reference = shared_sequence
    site["sequences"][0].update(table="public.travel_deals", column="id")
    reference["sequences"][0].update(table="public.travel_deals", column="id")
    report, status = compare(site, reference)
    assert status == 1
    assert report["scope_conflicts"][0]["managed_tables"] == ["public.system_example"]
    assert report["site_owned"]["sequences"] == []


def test_unowned_sequence_used_by_a_managed_table_stays_managed():
    site = snapshot()
    site["sequences"] = [{**sequence(), "table": None, "column": None}]
    site["tables"][0]["columns"][0]["default"] = "nextval('public.example_seq'::regclass)"
    report, status = compare(site)
    assert status == 1
    assert report["site_owned"]["sequences"] == []
    assert report["managed_objects"][0]["name"] == "public.example_seq"
    assert report["tables"][0]["related_drift"]["sequences"] == ["public.example_seq"]


def test_late_bound_managed_default_keeps_changed_sequence_in_managed_scope(shared_sequence):
    site, reference = shared_sequence
    for catalogue in (site, reference):
        catalogue["tables"][0]["columns"][0]["default"] = "nextval(('public.travel_id_seq'::text)::regclass)"
    site["sequences"][0]["increment"] = 2
    report, status = compare(site, reference)
    assert status == 1
    assert report["site_owned"]["sequences"] == []
    assert report["managed_objects"][0]["differences"] == [{"path": "sequences.public.travel_id_seq.increment",
        "expected": 1, "observed": 2, "category": "structural"}]
    assert report["scope_conflicts"][0]["managed_tables"] == ["public.system_example"]


def test_late_bound_sequence_only_in_installation_cannot_report_no_managed_drift(site_sequence):
    site, reference = site_sequence
    for catalogue in (site, reference):
        catalogue["tables"][0]["columns"][0]["default"] = "nextval(('public.travel_id_seq'::text)::regclass)"
    report, status = compare(site, reference)
    assert status == 1
    assert report["verdict"] == "managed_drift"
    assert report["site_owned"]["sequences"] == []
    assert report["managed_objects"][0]["name"] == "public.travel_id_seq"
    assert report["managed_objects"][0]["differences"][0]["expected"] is None
    assert any(row.get("reason") == "unresolved sequence reference" and row["catalogue"] == "reference"
               for row in report["scope_conflicts"])


def test_computed_managed_sequence_reference_prevents_exclusive_site_scope(shared_sequence):
    site, reference = shared_sequence
    # Even a literal regclass inside a computation does not resolve its result.
    default = "nextval(('public.travel_id_seq'::regclass::text || current_setting('sequence_suffix'))::regclass)"
    for catalogue in (site, reference):
        catalogue["tables"][0]["columns"][0]["default"] = default
    site["sequences"].append({**sequence("public.other_site_seq"), "table": "public.travel_deals"})
    site["sequences"][0]["increment"] = 2
    report, status = compare(site, reference)
    assert status == 1
    assert report["site_owned"]["sequences"] == []
    unresolved = [row for row in report["scope_conflicts"] if row.get("reason") == "unresolved sequence reference"]
    assert unresolved == [{"catalogue": label, "category": "sequences", "reason": "unresolved sequence reference",
        "table": "public.system_example", "column": "id"} for label in ("reference", "installation")]
    assert any(change["path"] == "sequences.public.travel_id_seq.increment"
               for row in report["managed_objects"] for change in row["differences"])
    assert "unresolved sequence reference: public.system_example.id" in drift_module().render_summary(report)


@pytest.mark.parametrize("name,literal", [
    ("public.travel_id_seq", '"public"."travel_id_seq"'),
    ('"Trip.Schema"."Deal ""ID\'s"" Seq"', '"Trip.Schema"."Deal ""ID\'s"" Seq"'),
])
def test_quoted_sequence_identifiers_resolve_managed_and_site_users(shared_sequence, name, literal):
    site, reference = shared_sequence
    escaped = literal.replace("'", "''")
    for catalogue in (site, reference):
        catalogue["sequences"][0]["name"] = name
        catalogue["tables"][0]["columns"][0]["default"] = f"nextval(('{escaped}'::text)::regclass)"
    site["tables"][1]["columns"][0]["default"] = f"nextval('{escaped}'::regclass)"
    report, status = compare(site, reference)
    assert status == 1
    assert report["site_owned"]["sequences"] == []
    assert report["managed_objects"] == []
    assert report["scope_conflicts"] == [{"catalogue": "installation", "category": "sequences", "name": name,
        "managed_tables": ["public.system_example"], "site_owned_tables": ["public.travel_deals"]}]


@pytest.mark.parametrize("identity", ["a", "d"])
def test_identity_owned_sequence_users_include_late_bound_managed_defaults(shared_sequence, identity):
    site, reference = shared_sequence
    for catalogue in (site, reference):
        catalogue["sequences"][0].update(table="public.travel_deals", column="id")
        catalogue["tables"][0]["columns"][0]["default"] = "nextval(('public.travel_id_seq'::text)::regclass)"
    site["tables"][1]["columns"][0].update(identity=identity, default=None)
    report, status = compare(site, reference)
    assert status == 1
    assert report["site_owned"]["sequences"] == []
    assert report["scope_conflicts"][0]["managed_tables"] == ["public.system_example"]
    assert report["scope_conflicts"][0]["name"] == "sequence:public.travel_deals.id"


@pytest.mark.parametrize("default", [
    "nextval(current_setting('chosen_sequence')::regclass)",
    "pg_catalog.currval(current_setting('chosen_sequence')::regclass)",
    "setval(current_setting('chosen_sequence')::regclass, 1, false)",
    "pg_sequence_last_value(current_setting('chosen_sequence')::regclass)",
    "lastval()",
    "nextval('public.absent_seq'::regclass)",
    "nextval(('travel_id_seq'::text)::regclass)",
    "nextval('public.travel_id_seq'::regclass) + nextval(current_setting('other_sequence')::regclass)",
])
def test_unresolved_reference_alone_affects_verdict_and_retains_all_sequences(site_sequence, default):
    site, reference = site_sequence
    for catalogue in (site, reference):
        catalogue["tables"][0]["columns"][0]["default"] = default
    report, status = compare(site, reference)
    assert status == 1
    assert report["site_owned"]["sequences"] == []
    assert report["counts"]["drift"] == 0
    assert any(row.get("reason") == "unresolved sequence reference" for row in report["scope_conflicts"])
    # No sequence inventory or definition difference is needed to fail closed.
    report, status = compare(reference, deepcopy(reference))
    assert status == 1
    assert report["managed_objects"] == []


@pytest.mark.parametrize("identity", ["a", "d"])
def test_site_identity_sequence_is_exempt_when_managed_defaults_are_resolved(site_sequence, identity):
    site, reference = site_sequence
    site["sequences"][0].update(table="public.travel_deals", column="id")
    site["tables"][1]["columns"][0].update(identity=identity, default=None)
    report, status = compare(site, reference)
    assert status == 0
    assert report["site_owned"]["sequences"][0]["tables"] == ["public.travel_deals"]


def test_sequence_function_text_inside_a_literal_does_not_make_scope_uncertain(site_sequence):
    site, reference = site_sequence
    for catalogue in (site, reference):
        catalogue["tables"][0]["columns"][1]["default"] = "'nextval(''public.unknown_seq''::regclass)'::text"
    assert compare(site, reference)[1] == 0


@pytest.mark.parametrize("default", [
    "pg_catalog.nextval ( ('\"public\".\"travel_id_seq\"' :: pg_catalog.text) :: pg_catalog.regclass )",
    "nextval('PUBLIC.TRAVEL_ID_SEQ'::regclass)",
    "currval('public.travel_id_seq'::regclass)",
    "setval(('public.travel_id_seq'::text)::regclass, 10, false)",
    "pg_sequence_last_value('public.travel_id_seq'::regclass)",
])
def test_resolved_sequence_call_variants_report_shared_scope(shared_sequence, default):
    site, reference = shared_sequence
    for catalogue in (site, reference):
        catalogue["tables"][0]["columns"][0]["default"] = default
    report, status = compare(site, reference)
    assert status == 1
    assert report["site_owned"]["sequences"] == []
    assert report["managed_objects"] == []
    assert report["scope_conflicts"] == [{"catalogue": "installation", "category": "sequences",
        "name": "public.travel_id_seq", "managed_tables": ["public.system_example"],
        "site_owned_tables": ["public.travel_deals"]}]


def test_reference_uncertainty_also_prevents_installation_site_sequence_exemption(site_sequence):
    site, reference = site_sequence
    reference["tables"][0]["columns"][0]["default"] = "nextval(current_setting('chosen_sequence')::regclass)"
    report, status = compare(site, reference)
    assert status == 1
    assert report["site_owned"]["sequences"] == []
    assert report["managed_objects"][0]["name"] == "public.travel_id_seq"
    assert report["scope_conflicts"] == [{"catalogue": "reference", "category": "sequences",
        "reason": "unresolved sequence reference", "table": "public.system_example", "column": "id"}]


def test_unresolved_site_default_does_not_block_proven_site_sequence_scope(site_sequence):
    site, reference = site_sequence
    site["tables"][1]["columns"][1]["default"] = "nextval(current_setting('chosen_sequence')::regclass)"
    report, status = compare(site, reference)
    assert status == 0
    assert report["scope_conflicts"] == []
    assert report["site_owned"]["sequences"][0]["name"] == "public.travel_id_seq"


def test_uncertainty_retains_nonextension_sequences_even_with_only_known_extension_users():
    reference = snapshot()
    reference["tables"][0]["columns"][0]["default"] = "nextval(current_setting('chosen_sequence')::regclass)"
    reference["tables"].append({**table("public.extension_data"), "extension": "custom"})
    reference["sequences"] = [
        {**sequence("public.user_seq"), "table": "public.extension_data"},
        {**sequence("public.extension_seq"), "extension": "custom", "table": None, "column": None},
    ]
    site = deepcopy(reference)
    site["sequences"][0]["increment"] = 2
    report, status = compare(site, reference)
    assert status == 1
    assert [row["name"] for row in report["managed_objects"]] == ["sequence:public.extension_data.id"]
    assert report["managed_objects"][0]["differences"][0]["path"].endswith(".increment")


@pytest.fixture(params=["constraints", "indexes"])
def rename_pair(request):
    label = request.param
    reference = snapshot()
    if label == "constraints":
        before = {"name": "canonical_key", "definition": "UNIQUE (title)", "validated": True}
        after = {**before, "name": "legacy_key"}
    else:
        before, after = index("canonical_key"), index("legacy_key")
    reference["tables"][0][label] = [before]
    site = deepcopy(reference)
    site["tables"][0][label] = [after]
    return site, reference, label, before, after


def test_rename_pair_is_reported_once_with_both_names(rename_pair):
    site, reference, label, before, after = rename_pair
    report, status = compare(site, reference)
    assert status == 0
    assert report["tables"][0]["differences"] == []
    assert report["renamed"] == [{"table": "public.system_example", "object_type": label,
        "expected_name": before["name"], "observed_name": after["name"],
        "expected": before, "observed": after}]
    summary = drift_module().render_summary(report)
    assert "## Renamed (same definition)" in summary
    assert before["name"] in summary and after["name"] in summary


def test_rename_pair_preserves_definition_and_validity_changes(rename_pair):
    site, reference, label, _, _ = rename_pair
    site["tables"][0][label][0]["definition"] += " changed"
    assert compare(site, reference)[1] == 1
    site["tables"][0][label][0] = deepcopy(rename_pair[4])
    site["tables"][0][label][0]["validated" if label == "constraints" else "valid"] = False
    report, status = compare(site, reference)
    assert status == 1
    assert report["renamed"] == []


def test_index_name_pair_never_rewrites_a_predicate_literal():
    reference = snapshot()
    reference["tables"][0]["indexes"] = [{**index("canonical_key"),
        "definition": index("canonical_key")["definition"] + " WHERE title = 'canonical_key'::text"}]
    site = deepcopy(reference)
    site["tables"][0]["indexes"] = [{**index("legacy_key"),
        "definition": index("legacy_key")["definition"] + " WHERE title = 'legacy_key'::text"}]
    report, status = compare(site, reference)
    assert status == 1
    assert report["renamed"] == []


def test_duplicate_definitions_pair_once_and_keep_the_remaining_extra():
    reference = snapshot()
    reference["tables"][0]["constraints"] = [{"name": "canonical_key", "definition": "UNIQUE (title)", "validated": True}]
    site = deepcopy(reference)
    site["tables"][0]["constraints"] = [{**reference["tables"][0]["constraints"][0], "name": name}
                                         for name in ("legacy_a", "legacy_b")]
    report, status = compare(site, reference)
    assert status == 1
    assert len(report["renamed"]) == 1
    assert report["renamed"][0]["observed_name"] == "legacy_a"
    assert report["tables"][0]["differences"][0]["path"] == "constraints.legacy_b"


@pytest.fixture(params=REVIEWED["checks"], ids=lambda row: row["table"])
def allowlisted_check(request):
    row = request.param
    reference = snapshot()
    reference["tables"] = [table(row["table"])]
    reference["tables"][0]["constraints"] = [deepcopy(row["reference"])]
    site = deepcopy(reference)
    site["tables"][0]["constraints"] = [deepcopy(row["installation"])]
    return site, reference


def test_reviewed_check_pair_is_annotated_with_exact_evidence(allowlisted_check):
    site, reference = allowlisted_check
    report, status = compare(site, reference)
    assert status == 0
    assert report["tables"][0]["structural_state"] == "matched"
    assert report["equivalences"][0]["expected"] == reference["tables"][0]["constraints"][0]
    assert report["equivalences"][0]["observed"] == site["tables"][0]["constraints"][0]
    assert "## Reviewed equivalences" in drift_module().render_summary(report)


@pytest.fixture
def near_miss_check():
    row = REVIEWED["checks"][-1]
    reference = snapshot()
    reference["tables"] = [table(row["table"])]
    reference["tables"][0]["constraints"] = [deepcopy(row["reference"])]
    site = deepcopy(reference)
    site["tables"][0]["constraints"] = [deepcopy(row["installation"])]
    site["tables"][0]["constraints"][0]["definition"] = row["installation"]["definition"].replace("'deny'", "'reject'")
    return site, reference


def test_near_miss_check_remains_structural_drift(near_miss_check):
    site, reference = near_miss_check
    report, status = compare(site, reference)
    assert status == 1
    assert report["tables"][0]["differences"][0]["path"].endswith(".definition")
    assert report["equivalences"] == []


def test_reviewed_check_is_scoped_to_table_constraint_and_validation(allowlisted_check):
    site, reference = allowlisted_check
    changed, other_reference = deepcopy(site), deepcopy(reference)
    for catalogue in (changed, other_reference):
        catalogue["tables"][0]["name"] = "public.other_table"
    assert compare(changed, other_reference)[1] == 1
    changed, other_reference = deepcopy(site), deepcopy(reference)
    for catalogue in (changed, other_reference):
        catalogue["tables"][0]["constraints"][0]["name"] = "other_constraint"
    assert compare(changed, other_reference)[1] == 1
    site["tables"][0]["constraints"][0]["validated"] = False
    report, status = compare(site, reference)
    assert status == 1
    assert any(d["path"].endswith(".validated") for d in report["tables"][0]["differences"])


def test_table_views_unique_index_constraint_is_reviewed_equivalence():
    reference = snapshot()
    reference["tables"] = [table("public.system_table_views")]
    reference["tables"][0].update(deepcopy(REVIEWED["table_views"]["reference"]))
    site = deepcopy(reference)
    site["tables"][0].update(deepcopy(REVIEWED["table_views"]["installation"]))
    report, status = compare(site, reference)
    assert status == 0
    assert len(report["equivalences"]) == 1
    assert report["equivalences"][0]["rule"] == "table_views_unique_index_constraint"
    site["tables"][0]["indexes"][0]["valid"] = False
    report, status = compare(site, reference)
    assert status == 1
    assert report["equivalences"] == []


@pytest.fixture
def order_only():
    reference = snapshot()
    site = deepcopy(reference)
    site["tables"][0]["columns"][0]["position"] = 3
    return site, reference


def test_order_only_is_information_and_does_not_change_verdict(order_only):
    site, reference = order_only
    report, status = compare(site, reference)
    assert status == 0
    assert report["tables"][0]["differences"] == []
    assert report["structural_table_counts"] == {"matched": 1, "changed": 0, "extra": 0, "missing": 0}
    assert report["column_order"] == [{"table": "public.system_example", "expected": ["id", "title"],
                                      "observed": ["title", "id"]}]
    summary = drift_module().render_summary(report)
    assert "## Physical column order (informational)" in summary


@pytest.fixture
def order_and_type(order_only):
    site, reference = order_only
    site["tables"][0]["columns"][1]["type"] = "bigint"
    return site, reference


def test_order_plus_type_change_keeps_the_type_drift(order_and_type):
    site, reference = order_and_type
    report, status = compare(site, reference)
    assert status == 1
    assert report["tables"][0]["differences"] == [{"path": "columns.title.type", "expected": "text",
                                                "observed": "bigint", "category": "structural"}]
    assert report["tables"][0]["structural_state"] == "changed"
    assert len(report["column_order"]) == 1


def test_order_information_does_not_hide_missing_columns(order_only):
    site, reference = order_only
    site["tables"][0]["columns"].pop()
    report, status = compare(site, reference)
    assert status == 1
    assert any(d["path"] == "columns.title" for d in report["tables"][0]["differences"])


def test_report_version_changes_without_changing_export_format():
    report, status = compare(snapshot())
    assert status == 0
    assert report["format_version"] == 2
    assert snapshot()["format_version"] == 1
