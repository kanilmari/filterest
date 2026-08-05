package dtt_1_row_read

import "testing"

func TestRLSPilotTableNameTargetsAppServiceCatalog(t *testing.T) {
	if rlsPilotTableName != "app_service_catalog" {
		t.Fatalf("rlsPilotTableName = %q, want app_service_catalog", rlsPilotTableName)
	}
}

func TestShouldApplyLegacyReadMustTrueFilter(t *testing.T) {
	if shouldApplyLegacyReadMustTrueFilter(rlsPilotTableName, "basic", []string{"published"}) {
		t.Fatalf("pilot table should not use legacy must_true read filter")
	}
	if !shouldApplyLegacyReadMustTrueFilter("some_other_table", "basic", []string{"published"}) {
		t.Fatalf("non-pilot table should still use legacy must_true read filter")
	}
	if shouldApplyLegacyReadMustTrueFilter("some_other_table", "admin", []string{"published"}) {
		t.Fatalf("admin role should not receive legacy must_true read filter")
	}
}

func TestBuildLegacyReadMustTrueConditionSkipsPilotTable(t *testing.T) {
	condition, args := buildLegacyReadMustTrueCondition(rlsPilotTableName, "basic", 42, []string{"published", "enabled"}, "user_id", 1)
	if condition != "" {
		t.Fatalf("pilot condition = %q, want empty", condition)
	}
	if len(args) != 0 {
		t.Fatalf("pilot args = %v, want none", args)
	}
}

func TestBuildLegacyReadMustTrueConditionAddsOwnerFallbackForNonPilot(t *testing.T) {
	condition, args := buildLegacyReadMustTrueCondition("some_other_table", "basic", 42, []string{"published", "enabled"}, "user_id", 3)
	want := `("some_other_table"."published" = TRUE OR "some_other_table"."user_id" = $3) AND ("some_other_table"."enabled" = TRUE OR "some_other_table"."user_id" = $3)`
	if condition != want {
		t.Fatalf("condition = %q, want %q", condition, want)
	}
	if len(args) != 1 || args[0] != 42 {
		t.Fatalf("args = %v, want [42]", args)
	}
}

func TestBuildReadRowPolicyConditionAddsOwnerFallbackForNonPilot(t *testing.T) {
	policy := ReadRowPolicy{
		Name:        rowPolicyAllFlagsTrueUnlessOwner,
		FlagColumns: []string{"published", "enabled"},
		OwnerColumn: "user_id",
	}

	condition, args := buildReadRowPolicyCondition("some_other_table", "basic", 42, policy, 3)
	want := `("some_other_table"."published" = TRUE OR "some_other_table"."user_id" = $3) AND ("some_other_table"."enabled" = TRUE OR "some_other_table"."user_id" = $3)`
	if condition != want {
		t.Fatalf("condition = %q, want %q", condition, want)
	}
	if len(args) != 1 || args[0] != 42 {
		t.Fatalf("args = %v, want [42]", args)
	}
}

func TestBuildReadRowPolicyConditionIgnoresShadowLegacyOwnerColumn(t *testing.T) {
	policy := ReadRowPolicy{
		Name:                         rowPolicyAllFlagsTrueUnlessOwner,
		FlagColumns:                  []string{"published"},
		OwnerColumn:                  "user_id",
		ShadowLegacyOwnerColumn:      "created_by",
		OwnerColumnMatchesLegacyPath: false,
	}

	condition, _ := buildReadRowPolicyCondition("some_other_table", "basic", 42, policy, 1)
	want := `("some_other_table"."published" = TRUE OR "some_other_table"."user_id" = $1)`
	if condition != want {
		t.Fatalf("condition = %q, want active owner column to stay user_id", condition)
	}
}

func TestBuildReadRowPolicyConditionSkipsUnknownPolicy(t *testing.T) {
	policy := ReadRowPolicy{
		Name:        "unknown_policy",
		FlagColumns: []string{"published"},
		OwnerColumn: "user_id",
	}

	condition, args := buildReadRowPolicyCondition("some_other_table", "basic", 42, policy, 1)
	if condition != "" {
		t.Fatalf("condition = %q, want empty for unknown policy", condition)
	}
	if len(args) != 0 {
		t.Fatalf("args = %#v, want none", args)
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

func TestGetLegacyMustTrueReadFilterSkipsPilotMetadataLookup(t *testing.T) {
	cols, owner, err := getLegacyMustTrueReadFilter(nil, rlsPilotTableName)
	if err != nil {
		t.Fatalf("getLegacyMustTrueReadFilter returned error for pilot table: %v", err)
	}
	if len(cols) != 0 {
		t.Fatalf("pilot table cols = %v, want empty", cols)
	}
	if owner != "" {
		t.Fatalf("pilot table owner = %q, want empty", owner)
	}
}

func TestBuildLegacyReadMustTrueConditionSkipsGuestOwnerFallback(t *testing.T) {
	cond, args := buildLegacyReadMustTrueCondition(
		"some_other_table",
		"guest",
		1,
		[]string{"published"},
		"user_id",
		1,
	)

	wantCond := "\"some_other_table\".\"published\" = TRUE"
	if cond != wantCond {
		t.Fatalf("condition = %q, want %q", cond, wantCond)
	}
	if len(args) != 0 {
		t.Fatalf("args = %#v, want no owner fallback for guest user", args)
	}
}
