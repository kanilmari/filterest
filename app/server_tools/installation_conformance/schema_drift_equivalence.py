"""schema_drift_equivalence.py
Annotate exact definition renames and the reviewed WL167 expression equivalents.
Connect saved PostgreSQL definitions with the offline reporter's comparison.
Keep the allow-list narrow; never normalize arbitrary SQL expressions or bodies.
"""
from copy import deepcopy
import re

# Reviewed in WL167's accepted 2026-10-11--11-20--wl167-s2-plan,
# worker_summary_wl167-s2-plan.md:11,43,62; owner decision K332.
# Pairs are (reference text, installation text), scoped to table AND constraint.
# Retain the exact catalogue bytes: parentheses/casts are not generally equivalent.
CHECK_EQUIVALENCES = {
    ('public.dev_agent_workline_reports', 'ck_dev_agent_workline_reports_git_scope'): (
        "CHECK (((git_has_other_changes IS NULL) OR ((git_worktree_state = 'clean'::text) AND (git_has_other_changes = false) AND (cardinality(git_workline_changed_paths) = 0)) OR ((git_worktree_state = 'dirty'::text) AND ((git_has_other_changes = true) OR (cardinality(git_workline_changed_paths) > 0)))))",
        "CHECK (((git_has_other_changes IS NULL) OR (((git_worktree_state = 'clean'::text) AND (git_has_other_changes = false) AND (cardinality(git_workline_changed_paths) = 0)) OR ((git_worktree_state = 'dirty'::text) AND ((git_has_other_changes = true) OR (cardinality(git_workline_changed_paths) > 0))))))",
    ),
    ('public.system_column_details', 'ck_system_column_details_client_delivery_mode'): (
        "CHECK (((client_delivery_mode)::text = ANY ((ARRAY['include'::character varying, 'server_only'::character varying])::text[])))",
        "CHECK (((client_delivery_mode)::text = ANY (ARRAY[('include'::character varying)::text, ('server_only'::character varying)::text])))",
    ),
    ('public.system_permission_actions', 'ck_system_permission_actions_scope'): (
        "CHECK (((scope_type)::text = ANY ((ARRAY['dataset'::character varying, 'row'::character varying, 'system'::character varying])::text[])))",
        "CHECK (((scope_type)::text = ANY (ARRAY[('dataset'::character varying)::text, ('row'::character varying)::text, ('system'::character varying)::text])))",
    ),
    ('public.system_row_access_rule_events', 'ck_system_row_access_rule_events_principal'): (
        "CHECK ((((principal_type)::text = ANY ((ARRAY['user'::character varying, 'group'::character varying])::text[])) AND (principal_id > 0)))",
        "CHECK ((((principal_type)::text = ANY (ARRAY[('user'::character varying)::text, ('group'::character varying)::text])) AND (principal_id > 0)))",
    ),
    ('public.system_row_access_rules', 'ck_system_row_access_rules_effect'): (
        "CHECK (((effect)::text = ANY ((ARRAY['allow'::character varying, 'deny'::character varying])::text[])))",
        "CHECK (((effect)::text = ANY (ARRAY[('allow'::character varying)::text, ('deny'::character varying)::text])))",
    ),
}

# The view_key consumer uses ON CONFLICT(view_key); the reviewed standalone
# index and UNIQUE constraint/backing index enforce the same immediate uniqueness.
TABLE_VIEWS_UNIQUE = {
    "reference": {
        "constraints": [{"name": "system_table_views_view_key_key", "validated": True,
                         "definition": "UNIQUE (view_key)"}],
        "indexes": [{"name": "public.system_table_views_view_key_key", "valid": True, "ready": True,
                     "clustered": False, "replica_identity": False,
                     "definition": "CREATE UNIQUE INDEX system_table_views_view_key_key ON "
                                   "public.system_table_views USING btree (view_key)"}],
    },
    "installation": {
        "constraints": [],
        "indexes": [{"name": "public.uq_system_table_views_view_key", "valid": True, "ready": True,
                     "clustered": False, "replica_identity": False,
                     "definition": "CREATE UNIQUE INDEX uq_system_table_views_view_key ON "
                                   "public.system_table_views USING btree (view_key)"}],
    },
}


def reviewed_check(table_name, expected, observed):
    """Accept only the reviewed text pair at its exact table/constraint identity."""
    pair = CHECK_EQUIVALENCES.get((table_name, expected["name"]))
    return pair == (expected["definition"], observed["definition"])


def definition_without_name(row, label):
    """Remove only an object's own name; retain every definition byte and flag.

    pg_get_indexdef includes the index's declared name. Remove that one verified
    declaration token, never occurrences in columns, predicates or SQL literals.
    A declaration inconsistent with the catalogue identity cannot form a pair.
    """
    result = {key: value for key, value in row.items() if key != "name"}
    if label == "indexes":
        declaration = re.match(r'^(CREATE (?:UNIQUE )?INDEX )("(?:""|[^"])+"|[^\s"]+)( ON .*)$',
                               row["definition"], re.DOTALL)
        if not declaration or not row["name"].endswith("." + declaration[2]):
            result["unverified_name"] = row["name"]
        else:
            result["definition"] = declaration[1] + "<index-name>" + declaration[3]
    return result


def named_definition_findings(table_name, label, expected, observed, differences):
    """Compare names first, then pair remaining exact definitions deterministically."""
    wanted = {row["name"]: row for row in expected}
    actual = {row["name"]: row for row in observed}
    changes, renames, equivalents = [], [], []
    for name in sorted(wanted.keys() & actual.keys()):
        before, after = wanted.pop(name), actual.pop(name)
        compared = after
        if (label == "constraints" and before["definition"] != after["definition"]
                and reviewed_check(table_name, before, after)):
            equivalents.append({"table": table_name, "object_type": label, "rule": "reviewed_check",
                                "expected": before, "observed": after})
            compared = {**after, "definition": before["definition"]}
        changes.extend(differences(before, compared, f"{label}.{name}"))
    for name in sorted(wanted):
        before = wanted[name]
        match = next((other for other in sorted(actual) if
                      definition_without_name(before, label) == definition_without_name(actual[other], label)), None)
        if match is not None:
            after = actual.pop(match)
            renames.append({"table": table_name, "object_type": label, "expected_name": name,
                            "observed_name": match, "expected": before, "observed": after})
        else:
            changes.extend(differences(before, None, f"{label}.{name}"))
    for name in sorted(actual):
        changes.extend(differences(None, actual[name], f"{label}.{name}"))
    return changes, renames, equivalents


def table_views_unique_equivalence(wanted, actual):
    """Consume only the reviewed UNIQUE constraint/backing-index/standalone pair.

    Require full records, including validation/readiness/replica flags. The
    annotation retains all three originals and their names for review.
    """
    if wanted["name"] != "public.system_table_views":
        return None
    before, after = TABLE_VIEWS_UNIQUE["reference"], TABLE_VIEWS_UNIQUE["installation"]
    if not all(row in wanted[label] for label, rows in before.items() for row in rows):
        return None
    if not all(row in actual[label] for label, rows in after.items() for row in rows):
        return None
    # If the reference constraint/index also exists in the installation, keep
    # comparing the duplicate objects rather than annotating a replacement.
    if any(row["name"] == item["name"] for label, rows in before.items()
           for row in rows for item in actual[label]):
        return None
    for label, rows in before.items():
        for row in rows:
            wanted[label].remove(row)
    for label, rows in after.items():
        for row in rows:
            actual[label].remove(row)
    return {"table": wanted["name"], "object_type": "constraints/indexes",
            "rule": "table_views_unique_index_constraint", "expected": deepcopy(before), "observed": deepcopy(after)}
