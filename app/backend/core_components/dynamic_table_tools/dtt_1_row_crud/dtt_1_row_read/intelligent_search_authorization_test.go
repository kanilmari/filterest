// intelligent_search_authorization_test.go
// Verifies the shared intelligent-search row authorization SQL contract.
// Bridges legacy row policy, row-group membership, candidate ranking, and final hydration.
// Exists so every search stage reuses ordered parameter placeholders without leaking hidden rows.
package dtt_1_row_read

import (
	"reflect"
	"strings"
	"testing"
)

func TestAppendIntelligentSearchAuthorizationConditionContinuesExistingPlaceholders(t *testing.T) {
	authorization := intelligentSearchAuthorization{
		userRole: "basic",
		userID:   8,
		readPolicy: ReadRowPolicy{
			Name:        rowPolicyAllFlagsTrueUnlessOwner,
			FlagColumns: []string{"published"},
			OwnerColumn: "user_id",
		},
		tableUID:     104,
		rowGroupSlug: "security",
	}
	condition, args, err := appendIntelligentSearchAuthorizationCondition(
		"travel_info",
		"candidate",
		authorization,
		[]interface{}{"existing"},
	)
	if err != nil {
		t.Fatalf("appendIntelligentSearchAuthorizationCondition returned error: %v", err)
	}
	for _, fragment := range []string{
		`("candidate"."published" = TRUE OR "candidate"."user_id" = $2)`,
		`public.resolve_effective_row_access($3, "candidate"."id", $4, 'read'`,
		`search_row_group_membership.table_uid = $5`,
		`search_row_group_membership.row_id = "candidate"."id"`,
		`search_row_group.slug = $6`,
	} {
		if !strings.Contains(condition, fragment) {
			t.Fatalf("authorization condition lacks %q: %s", fragment, condition)
		}
	}
	wantArgs := []interface{}{"existing", 8, "travel_info", 8, int64(104), "security"}
	if !reflect.DeepEqual(args, wantArgs) {
		t.Fatalf("args = %#v, want %#v", args, wantArgs)
	}
}

func TestAppendIntelligentSearchAuthorizationConditionKeepsRLSPilotOnDatabasePolicy(t *testing.T) {
	authorization := intelligentSearchAuthorization{
		userRole: "basic",
		userID:   8,
		readPolicy: ReadRowPolicy{
			Name:        rowPolicyAllFlagsTrueUnlessOwner,
			FlagColumns: []string{"approved"},
			OwnerColumn: "user_id",
		},
		tableUID:     42,
		rowGroupSlug: "security",
	}
	condition, args, err := appendIntelligentSearchAuthorizationCondition(
		rlsPilotTableName,
		"src",
		authorization,
		nil,
	)
	if err != nil {
		t.Fatalf("appendIntelligentSearchAuthorizationCondition returned error: %v", err)
	}
	if strings.Contains(condition, "approved") || !strings.Contains(condition, "search_row_group_membership") {
		t.Fatalf("pilot condition mixed Go row policy with RLS or lost group filter: %s", condition)
	}
	wantArgs := []interface{}{rlsPilotTableName, 8, int64(42), "security"}
	if !reflect.DeepEqual(args, wantArgs) {
		t.Fatalf("args = %#v, want %#v", args, wantArgs)
	}
}

func TestAppendIntelligentSearchAuthorizationConditionContinuesLanguageVectorArguments(t *testing.T) {
	authorization := intelligentSearchAuthorization{
		tableUID:     104,
		rowGroupSlug: "security",
	}
	condition, args, err := appendIntelligentSearchAuthorizationCondition(
		"travel_info",
		"travel_info",
		authorization,
		[]interface{}{"vector", "fi"},
	)
	if err != nil {
		t.Fatalf("appendIntelligentSearchAuthorizationCondition returned error: %v", err)
	}
	for _, fragment := range []string{
		`public.resolve_effective_row_access($3, "travel_info"."id", $4, 'read'`,
		`search_row_group_membership.table_uid = $5`,
		`search_row_group.slug = $6`,
	} {
		if !strings.Contains(condition, fragment) {
			t.Fatalf("language-vector authorization lacks %q: %s", fragment, condition)
		}
	}
	wantArgs := []interface{}{"vector", "fi", "travel_info", 1, int64(104), "security"}
	if !reflect.DeepEqual(args, wantArgs) {
		t.Fatalf("args = %#v, want %#v", args, wantArgs)
	}
}
