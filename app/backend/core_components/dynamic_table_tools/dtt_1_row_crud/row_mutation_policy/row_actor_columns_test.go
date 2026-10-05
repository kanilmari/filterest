// row_actor_columns_test.go
// Exercises the permanent actor rules independently of presentation metadata.
// Connects marked roles to schema, value and card-role refusals.
// Keeps legacy user references outside the actor boundary.
package row_mutation_policy

import (
	"easelect/backend/core_components/httpresponse"
	"errors"
	"testing"
)

func TestRowActorRefusals(t *testing.T) {
	marks := RowActorColumns{"created_by": "creator", "user_id": "owner"}
	for _, tc := range []struct{ column, key string }{{"created_by", "error_creator_column_not_editable"}, {"user_id", "error_owner_column_not_editable"}} {
		for _, err := range []error{marks.RefuseValue(tc.column), marks.Protect(tc.column)} {
			var refusal *httpresponse.Refusal
			if !errors.As(err, &refusal) || refusal.Status != 400 || refusal.Message == "" {
				t.Fatalf("%s: %v", tc.column, err)
			}
			if refusal.LangKey != tc.key && refusal.LangKey != "error_owner_column_protected" {
				t.Fatalf("unexpected key: %s", refusal.LangKey)
			}
		}
	}
	if marks.RefuseValue("reviewer_id") != nil || marks.Protect("owner_id") != nil {
		t.Fatal("unmarked columns must keep their rules")
	}
	for _, tc := range []struct {
		column, role string
		allowed      bool
	}{
		{"created_by", "hidden", true}, {"created_by", "details", true}, {"created_by", "username", false}, {"created_by", "header", false},
		{"user_id", "username", true}, {"user_id", "hidden", true}, {"user_id", "details", false}, {"reviewer_id", "username", false}, {"reviewer_id", "details", true},
	} {
		if err := marks.ValidateCardRoles(map[string]string{tc.column: tc.role}); (err == nil) != tc.allowed {
			t.Fatalf("%+v: %v", tc, err)
		}
	}
	if err := (RowActorColumns{}).ValidateCardRoles(map[string]string{"legacy": "username"}); err != nil {
		t.Fatal(err)
	}
}

func TestInternalRegistriesAndDedicatedMutationTables(t *testing.T) {
	for _, name := range []string{"system_row_actor_columns", "system_media_assets", "system_media_asset_usages"} {
		if !IsInternalRegistryTable(name) {
			t.Fatal(name)
		}
	}
	if IsInternalRegistryTable("system_data_repair_records") {
		t.Fatal("repair history is a registered dataset")
	}
	for _, name := range []string{"system_row_actor_columns", "system_data_repair_records"} {
		if !RequiresDedicatedMutationAPI(name) {
			t.Fatal(name)
		}
	}
}
