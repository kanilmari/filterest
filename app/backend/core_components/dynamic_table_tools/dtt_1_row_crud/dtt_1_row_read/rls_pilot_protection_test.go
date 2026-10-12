// rls_pilot_protection_test.go
// Proves the pilot never loses its fallback at the shared SQL boundary.
// Bridges canonical protection metadata, aliases, actor arguments and ordinary datasets.
// Complements executable PostgreSQL proofs with fast compiler regressions.
package dtt_1_row_read

import (
	"strings"
	"testing"
)

func TestPilotReadProtectionIsStatementScopedAndKeepsFallback(t *testing.T) {
	policy := legacyMustTrueReadPolicy(pilotExpectedFlags, rlsPilotOwnerColumn)
	condition, args := buildReadRowPolicyConditionForReference(rlsPilotTableName, "candidate", "basic", 8, policy, 4)
	for _, fragment := range []string{
		"CASE WHEN (SELECT EXISTS", "THEN TRUE ELSE", "relrowsecurity", "rolsuper", "rolbypassrls",
		"relforcerowsecurity", "row_security_active", "pg_get_expr", "actual.polroles = ARRAY[0::oid]",
		"current_setting('app.user_id', true) = '8'", "current_setting('app.is_admin', true) = 'false'",
		`"candidate"."published" = TRUE`, `"candidate"."admin_approved" = TRUE`,
		`"candidate"."user_id" = $4`, "resolve_effective_row_access($5",
	} {
		if !strings.Contains(condition, fragment) {
			t.Fatalf("missing %q in %s", fragment, condition)
		}
	}
	if len(args) != 3 || args[0] != 8 || args[1] != rlsPilotTableName || args[2] != 8 {
		t.Fatalf("args = %#v", args)
	}
}

func TestPilotReadProtectionNeverSkipsChangedMetadata(t *testing.T) {
	for _, policy := range []ReadRowPolicy{
		legacyMustTrueReadPolicy(append(append([]string{}, pilotExpectedFlags...), "extra_flag"), rlsPilotOwnerColumn),
		legacyMustTrueReadPolicy(pilotExpectedFlags, "created_by"),
		legacyMustTrueReadPolicy([]string{"published", "published", "published", "published"}, rlsPilotOwnerColumn),
	} {
		condition, _ := buildReadRowPolicyCondition(rlsPilotTableName, "basic", 8, policy, 1)
		if strings.Contains(condition, "CASE WHEN") || !strings.Contains(condition, `"published" = TRUE`) {
			t.Fatalf("changed metadata skipped fallback: %s", condition)
		}
	}
}

func TestPilotProtectionDoesNotChangeOrdinaryDatasetOrAdminReads(t *testing.T) {
	policy := legacyMustTrueReadPolicy(pilotExpectedFlags, rlsPilotOwnerColumn)
	condition, _ := buildReadRowPolicyCondition("ordinary_rows", "basic", 8, policy, 1)
	if strings.Contains(condition, "pg_catalog") || !strings.Contains(condition, `"ordinary_rows"."published" = TRUE`) {
		t.Fatalf("ordinary dataset changed: %s", condition)
	}
	for _, table := range []string{rlsPilotTableName, "ordinary_rows"} {
		condition, args := buildReadRowPolicyCondition(table, "admin", 2, policy, 1)
		if condition != "" || len(args) != 0 {
			t.Fatalf("admin read changed: %s %#v", condition, args)
		}
	}
}
