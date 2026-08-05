package dtt_1_row_create

import (
	"database/sql"
	"testing"

	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
)

func TestIsAddRowColumnUserInsertable(t *testing.T) {
	tests := []struct {
		name   string
		value  sql.NullBool
		wanted bool
	}{
		{name: "missing metadata preserves legacy form", value: sql.NullBool{}, wanted: true},
		{name: "explicit true stays editable", value: sql.NullBool{Bool: true, Valid: true}, wanted: true},
		{name: "explicit false is server owned", value: sql.NullBool{Bool: false, Valid: true}, wanted: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			column := dtt_models.AddRowColumnInfo{Insertable: test.value}
			if got := isAddRowColumnUserInsertable(column); got != test.wanted {
				t.Fatalf("isAddRowColumnUserInsertable() = %v, want %v", got, test.wanted)
			}
		})
	}
}

func TestApplyCurrentActorOwnership(t *testing.T) {
	locked := sql.NullBool{Bool: false, Valid: true}
	editable := sql.NullBool{Bool: true, Valid: true}
	row := map[string]interface{}{
		"user_id":         999,
		"cached_username": "spoofed",
		"reviewer_id":     17,
	}
	columns := []dtt_models.AddRowColumnInfo{
		{ColumnName: "user_id", Insertable: locked},
		{ColumnName: "cached_username", Insertable: locked},
		{ColumnName: "reviewer_id", Insertable: editable},
		{ColumnName: "server_note", Insertable: locked},
	}

	applyCurrentActorOwnership(row, columns, 42, "teppo_tekija")

	if got := row["user_id"]; got != 42 {
		t.Fatalf("user_id = %#v, want authenticated user 42", got)
	}
	if got := row["cached_username"]; got != "teppo_tekija" {
		t.Fatalf("cached_username = %#v, want authenticated username", got)
	}
	if got := row["reviewer_id"]; got != 17 {
		t.Fatalf("editable reviewer_id changed to %#v", got)
	}
	if _, exists := row["server_note"]; exists {
		t.Fatal("unrecognized server-owned field must not be invented")
	}
}
