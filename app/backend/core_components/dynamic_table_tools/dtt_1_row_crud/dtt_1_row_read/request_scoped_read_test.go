package dtt_1_row_read

import "testing"

func TestRLSPilotTableNameTargetsAppServiceCatalog(t *testing.T) {
	if rlsPilotTableName != "app_service_catalog" {
		t.Fatalf("rlsPilotTableName = %q, want app_service_catalog", rlsPilotTableName)
	}
}

func TestShouldApplyReadRowPolicySkipsPilotAndAdmin(t *testing.T) {
	policy := legacyMustTrueReadPolicy([]string{"published"}, "")
	if shouldApplyReadRowPolicy(rlsPilotTableName, "basic", policy) {
		t.Fatalf("pilot table should rely on its database policy, not the Go-side flag filter")
	}
	if !shouldApplyReadRowPolicy("some_other_table", "basic", policy) {
		t.Fatalf("non-pilot table should still use the Go-side flag filter")
	}
	if shouldApplyReadRowPolicy("some_other_table", "admin", policy) {
		t.Fatalf("admin role should not receive the Go-side flag filter")
	}
}

// A dataset without a proven owner keeps its flags for everyone but
// administrators: the own-row branch and its argument disappear entirely.
func TestBuildReadRowPolicyConditionWithoutOwnerRequiresEveryFlag(t *testing.T) {
	policy := legacyMustTrueReadPolicy([]string{"admin_approved"}, "")

	condition, args := buildReadRowPolicyCondition("system_about", "basic", 42, policy, 1)
	want := `("system_about"."admin_approved" = TRUE) AND (public.resolve_effective_row_access($1, "system_about"."id", $2, 'read', (TRUE), FALSE))`
	if condition != want {
		t.Fatalf("condition = %q, want %q", condition, want)
	}
	if len(args) != 2 || args[0] != "system_about" || args[1] != 42 {
		t.Fatalf("args = %#v, want only the exact-row resolver arguments", args)
	}
}

func TestBuildReadRowPolicyConditionAddsOwnerFallbackForNonPilot(t *testing.T) {
	policy := ReadRowPolicy{
		Name:        rowPolicyAllFlagsTrueUnlessOwner,
		FlagColumns: []string{"published", "enabled"},
		OwnerColumn: "user_id",
	}

	condition, args := buildReadRowPolicyCondition("some_other_table", "basic", 42, policy, 3)
	want := `(("some_other_table"."published" = TRUE OR "some_other_table"."user_id" = $3) AND ("some_other_table"."enabled" = TRUE OR "some_other_table"."user_id" = $3)) AND (public.resolve_effective_row_access($4, "some_other_table"."id", $5, 'read', (TRUE), FALSE))`
	if condition != want {
		t.Fatalf("condition = %q, want %q", condition, want)
	}
	if len(args) != 3 || args[0] != 42 || args[1] != "some_other_table" || args[2] != 42 {
		t.Fatalf("args = %v, want [42 some_other_table 42]", args)
	}
}

func TestBuildReadRowPolicyConditionSkipsUnknownPolicy(t *testing.T) {
	policy := ReadRowPolicy{
		Name:        "unknown_policy",
		FlagColumns: []string{"published"},
		OwnerColumn: "user_id",
	}

	condition, args := buildReadRowPolicyCondition("some_other_table", "basic", 42, policy, 1)
	want := `public.resolve_effective_row_access($1, "some_other_table"."id", $2, 'read', (TRUE), FALSE)`
	if condition != want {
		t.Fatalf("condition = %q, want exact-row resolver with broader TRUE", condition)
	}
	if len(args) != 2 || args[0] != "some_other_table" || args[1] != 42 {
		t.Fatalf("args = %#v, want dataset and actor", args)
	}
}

func TestBuildEffectiveRowAccessConditionRejectsUnsupportedActions(t *testing.T) {
	condition, args := buildEffectiveRowAccessConditionForReference(
		"some_other_table", "candidate", 42, "create", "TRUE", 1,
	)
	if condition != "FALSE" || len(args) != 0 {
		t.Fatalf("unsupported row action = (%q, %#v), want fail-closed FALSE", condition, args)
	}
}

func TestLegacyMustTrueReadPolicyCopiesColumns(t *testing.T) {
	cols := []string{"published"}
	policy := legacyMustTrueReadPolicy(cols, "user_id")
	cols[0] = "mutated"

	if policy.Name != rowPolicyAllFlagsTrueUnlessOwner {
		t.Fatalf("policy name = %q, want %q", policy.Name, rowPolicyAllFlagsTrueUnlessOwner)
	}
	if len(policy.FlagColumns) != 1 || policy.FlagColumns[0] != "published" {
		t.Fatalf("policy flag columns = %#v, want copied published", policy.FlagColumns)
	}
	if policy.OwnerColumn != "user_id" {
		t.Fatalf("policy owner = %q, want user_id", policy.OwnerColumn)
	}
}

// A nil querier proves the pilot never reaches the metadata lookup.
func TestGetLegacyMustTrueReadPolicySkipsPilotMetadataLookup(t *testing.T) {
	policy, err := getLegacyMustTrueReadPolicy(nil, rlsPilotTableName)
	if err != nil {
		t.Fatalf("getLegacyMustTrueReadPolicy returned error for pilot table: %v", err)
	}
	if policy.hasFlagColumns() || policy.OwnerColumn != "" || policy.Name != "" {
		t.Fatalf("pilot table policy = %#v, want empty", policy)
	}
}

// The guest (user 1) never owns a row, even on a dataset with a proven owner.
func TestBuildReadRowPolicyConditionSkipsGuestOwnerBranch(t *testing.T) {
	policy := legacyMustTrueReadPolicy([]string{"published"}, "user_id")

	condition, args := buildReadRowPolicyCondition("some_other_table", "guest", 1, policy, 1)
	want := `("some_other_table"."published" = TRUE) AND (public.resolve_effective_row_access($1, "some_other_table"."id", $2, 'read', (TRUE), FALSE))`
	if condition != want {
		t.Fatalf("condition = %q, want %q", condition, want)
	}
	if len(args) != 2 || args[0] != "some_other_table" || args[1] != 1 {
		t.Fatalf("args = %#v, want no owner argument for the guest", args)
	}
}
