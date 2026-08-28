// view_field_sets_test.go
// Verifies the pure validation and permission-filtering boundaries for field collections.
// Exists so presentation preferences cannot disclose or invent dataset columns.
package system_table_tools

import (
	"database/sql"
	"reflect"
	"testing"
)

func TestValidateViewFieldSetTargetAcceptsStableRegisteredViewKeys(t *testing.T) {
	for _, viewKey := range []string{"table", "card", "calendar", "product_card"} {
		dataset, gotView, err := validateViewFieldSetTarget("orders", viewKey)
		if err != nil || dataset != "orders" || gotView != viewKey {
			t.Fatalf("validate target = (%q, %q, %v), want orders/%s", dataset, gotView, err, viewKey)
		}
	}
}

func TestValidateViewFieldSetTargetRejectsUnsafeIdentifiers(t *testing.T) {
	if _, _, err := validateViewFieldSetTarget("orders;drop", "table"); err == nil {
		t.Fatal("unsafe dataset must be rejected")
	}
	if _, _, err := validateViewFieldSetTarget("orders", "card/view"); err == nil {
		t.Fatal("unsafe view key must be rejected")
	}
}

func TestNormalizeVisibleColumnNamesDeduplicatesWithoutReordering(t *testing.T) {
	got, err := normalizeVisibleColumnNames([]string{"title", "id", "title"})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"title", "id"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("normalized columns = %#v, want %#v", got, want)
	}
}

func TestFilterViewFieldSetsByPermissionRemovesForbiddenColumnNames(t *testing.T) {
	sets := []viewFieldSet{{
		ID:             7,
		Name:           "Shared",
		Scope:          "shared",
		VisibleColumns: []string{"title", "private_note"},
	}}
	filtered := filterViewFieldSetsByPermission(sets, map[string]bool{"title": true})
	want := []string{"title"}
	if len(filtered) != 1 || !reflect.DeepEqual(filtered[0].VisibleColumns, want) {
		t.Fatalf("filtered field sets = %#v, want only title", filtered)
	}
}

func TestPersonalViewFieldSetOwnerExcludesGuestIdentity(t *testing.T) {
	tests := []struct {
		name   string
		userID int64
		want   sql.NullInt64
	}{
		{name: "guest", userID: 1, want: sql.NullInt64{}},
		{name: "authenticated user", userID: 42, want: sql.NullInt64{Int64: 42, Valid: true}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := personalViewFieldSetOwner(test.userID); got != test.want {
				t.Fatalf("personal owner = %#v, want %#v", got, test.want)
			}
		})
	}
}
